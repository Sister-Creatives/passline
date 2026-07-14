import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getAuthOrganizerId } from "./auth";

/**
 * Ensure an `organizers` row exists for the currently authenticated user.
 *
 * Called on first sign-in. Idempotent: if a row already exists for the user's
 * email it returns that row's id instead of inserting a duplicate.
 */
export const ensureOrganizer = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const user = await ctx.db.get(userId);
    if (!user?.email) throw new Error("No email on account");
    const existing = await ctx.db
      .query("organizers")
      .withIndex("by_email", (q) => q.eq("email", user.email!))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("organizers", {
      name: user.name ?? user.email,
      email: user.email,
      image: user.image ?? undefined,
    });
  },
});

export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return null;
    return await ctx.db.get(organizerId);
  },
});

/**
 * Public: the display identity of an organizer for the host directory page
 * (`/host/$organizerId`) -- just `name`/`image`, never `email`. Returns null
 * (rather than throwing) for an unknown id, mirroring the rest of the
 * public-read surface (e.g. `events.getEventBySlug`).
 */
export const getPublicProfile = query({
  args: { organizerId: v.id("organizers") },
  handler: async (ctx, { organizerId }) => {
    const organizer = await ctx.db.get(organizerId);
    if (!organizer) return null;
    return { name: organizer.name, image: organizer.image };
  },
});
