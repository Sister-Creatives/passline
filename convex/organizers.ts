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
 * Update the signed-in organizer's own name. Name is required and trimmed.
 *
 * The logo is deliberately NOT settable here -- it's a file now, applied
 * immediately by `setImage` (mirroring `eventContent.setCoverImage`) so an
 * upload can't be stranded in storage by navigating away without saving.
 */
export const updateProfile = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error("Name is required");
    await ctx.db.patch(organizerId, { name: trimmedName });
    return null;
  },
});

/**
 * Set (or clear, with null) the organizer's uploaded logo.
 *
 * Deletes the blob it replaces so storage doesn't accumulate orphans, and
 * clears the legacy `image` URL so resolution is unambiguous -- the same
 * contract as `eventContent.setCoverImage`.
 */
export const setImage = mutation({
  args: { storageId: v.union(v.id("_storage"), v.null()) },
  handler: async (ctx, { storageId }) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");
    const organizer = await ctx.db.get(organizerId);
    const prev = organizer?.imageId;
    if (prev && prev !== storageId) await ctx.storage.delete(prev);
    await ctx.db.patch(organizerId, {
      imageId: storageId ?? undefined,
      image: undefined,
    });
    return null;
  },
});

/**
 * Update the signed-in organizer's saved event defaults (location, capacity,
 * currency, fee mode), applied to prefill the create-event form. Only fields
 * present in `args` are touched -- an omitted field is left unchanged,
 * matching `updateProfile`'s narrow-patch style. Location and currency are
 * trimmed and an empty/whitespace string clears the field (patched to
 * `undefined`) so an organizer can unset a default without a separate
 * "clear" affordance. `defaultFeeMode` is an enum, not a free-text field, so
 * there's no empty-string clearing path -- a provided value simply sets it.
 */
export const updatePreferences = mutation({
  args: {
    defaultLocation: v.optional(v.string()),
    defaultCapacity: v.optional(v.number()),
    defaultCurrency: v.optional(v.string()),
    defaultFeeMode: v.optional(v.union(v.literal("pass"), v.literal("absorb"))),
  },
  handler: async (ctx, args) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");
    if (args.defaultCapacity !== undefined && args.defaultCapacity < 1) {
      throw new Error("Capacity must be at least 1");
    }
    const patch: Record<string, unknown> = {};
    if (args.defaultLocation !== undefined) {
      const trimmed = args.defaultLocation.trim();
      patch.defaultLocation = trimmed ? trimmed : undefined;
    }
    if (args.defaultCapacity !== undefined) {
      patch.defaultCapacity = args.defaultCapacity;
    }
    if (args.defaultCurrency !== undefined) {
      const trimmed = args.defaultCurrency.trim();
      patch.defaultCurrency = trimmed ? trimmed : undefined;
    }
    if (args.defaultFeeMode !== undefined) {
      patch.defaultFeeMode = args.defaultFeeMode;
    }
    await ctx.db.patch(organizerId, patch);
    return null;
  },
});

/**
 * The signed-in organizer. `image` is the resolved logo URL: the uploaded file
 * when present, otherwise the legacy URL, so callers keep receiving a plain
 * string and don't need to know which storage era a row is from.
 */
export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return null;
    const organizer = await ctx.db.get(organizerId);
    if (!organizer) return null;
    return {
      ...organizer,
      image: organizer.imageId
        ? ((await ctx.storage.getUrl(organizer.imageId)) ?? undefined)
        : organizer.image,
    };
  },
});

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
    return {
      name: organizer.name,
      image: organizer.imageId
        ? ((await ctx.storage.getUrl(organizer.imageId)) ?? undefined)
        : organizer.image,
    };
  },
});
