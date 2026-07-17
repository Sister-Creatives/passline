import { query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getAuthOrganizerId } from "./auth";

/** Load an event and enforce that it belongs to the authenticated organizer. */
async function requireOwnedEvent(ctx: QueryCtx | MutationCtx, eventId: Id<"events">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const event = await ctx.db.get(eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return event;
}

/**
 * Record a meaningful backend change to an event's activity trail.
 *
 * Plain helper (not a Convex function) -- called from inside mutations that
 * already resolved `organizerId` + the event via their own ownership checks,
 * so the insert runs in the same transaction (rolls back with the mutation on
 * failure; no orphan logs). Kept defensive: it only inserts and won't throw
 * in practice.
 */
export async function recordAudit(
  ctx: MutationCtx,
  args: {
    organizerId: Id<"organizers">;
    eventId?: Id<"events">;
    action: string;
    summary: string;
  },
): Promise<void> {
  await ctx.db.insert("auditLogs", {
    organizerId: args.organizerId,
    eventId: args.eventId,
    action: args.action,
    summary: args.summary,
    createdAt: Date.now(),
  });
}

/** Organizer-only: an event's audit trail, newest first. */
export const listForEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireOwnedEvent(ctx, eventId);
    const rows = await ctx.db
      .query("auditLogs")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});
