import { v } from "convex/values";
import { query, mutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthOrganizerId } from "./auth";

const LIST_LIMIT = 30;

export const notificationType = v.union(
  v.literal("rsvp"),
  v.literal("waitlist"),
  v.literal("sold_out"),
  v.literal("cancellation"),
);
export type NotificationType = "rsvp" | "waitlist" | "sold_out" | "cancellation";

/**
 * Insert a notification for an organizer. Called inline (same transaction) from
 * the activity that triggers it, so a notification only exists if the activity
 * actually committed.
 */
export async function createNotification(
  ctx: MutationCtx,
  args: {
    organizerId: Id<"organizers">;
    type: NotificationType;
    title: string;
    body: string;
    eventId?: Id<"events">;
  },
): Promise<void> {
  await ctx.db.insert("notifications", {
    organizerId: args.organizerId,
    type: args.type,
    title: args.title,
    body: args.body,
    eventId: args.eventId,
    read: false,
    createdAt: Date.now(),
  });
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return [];
    return await ctx.db
      .query("notifications")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .order("desc")
      .take(LIST_LIMIT);
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return 0;
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_organizer_unread", (q) =>
        q.eq("organizerId", organizerId).eq("read", false),
      )
      .collect();
    return unread.length;
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_organizer_unread", (q) =>
        q.eq("organizerId", organizerId).eq("read", false),
      )
      .collect();
    for (const n of unread) {
      await ctx.db.patch(n._id, { read: true });
    }
    return null;
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");
    const notification = await ctx.db.get(notificationId);
    if (!notification || notification.organizerId !== organizerId) {
      throw new Error("Not found");
    }
    await ctx.db.patch(notificationId, { read: true });
    return null;
  },
});
