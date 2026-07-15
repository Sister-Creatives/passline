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

/**
 * Update the signed-in organizer's own profile (name + optional logo/avatar
 * URL). Name is required and trimmed; an empty image clears it, mirroring the
 * optional-field clearing pattern used across the codebase.
 */
export const updateProfile = mutation({
  args: { name: v.string(), image: v.optional(v.string()) },
  handler: async (ctx, { name, image }) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error("Name is required");
    const trimmedImage = image?.trim();
    await ctx.db.patch(organizerId, {
      name: trimmedName,
      image: trimmedImage ? trimmedImage : undefined,
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
/**
 * Aggregate counts for the sidebar badges: how many events the organizer has,
 * and how many attendees across all of them. "Attendees" mirrors the metric on
 * the dashboard Overview (`dashboard.getOverview`) so the badge and the Overview
 * headline never disagree: confirmed/checked-in RSVPs plus valid/checked-in
 * tickets (the paid-ticketing flow). Waitlisted, pending-claim, and cancelled
 * are excluded.
 *
 * This walks every event's RSVPs and tickets on each run, which is fine at the
 * current scale; if an organizer ever accumulates a very large history this is
 * the spot to swap in a denormalized counter.
 */
export const getSidebarCounts = query({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return { events: 0, attendees: 0 };

    const events = await ctx.db
      .query("events")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .collect();

    const [rsvpsByEvent, ticketsByEvent] = await Promise.all([
      Promise.all(
        events.map((e) =>
          ctx.db.query("rsvps").withIndex("by_event", (q) => q.eq("eventId", e._id)).collect(),
        ),
      ),
      Promise.all(
        events.map((e) =>
          ctx.db.query("tickets").withIndex("by_event", (q) => q.eq("eventId", e._id)).collect(),
        ),
      ),
    ]);

    const attendees =
      rsvpsByEvent.flat().filter((r) => r.status === "confirmed" || r.status === "checked_in").length +
      ticketsByEvent.flat().filter((t) => t.status === "valid" || t.status === "checked_in").length;

    return { events: events.length, attendees };
  },
});

export const getPublicProfile = query({
  args: { organizerId: v.id("organizers") },
  handler: async (ctx, { organizerId }) => {
    const organizer = await ctx.db.get(organizerId);
    if (!organizer) return null;
    return { name: organizer.name, image: organizer.image };
  },
});
