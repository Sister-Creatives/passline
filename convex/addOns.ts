import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
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

/** Load an add-on + its event, enforcing organizer ownership of the event. */
async function requireOwnedAddOn(ctx: QueryCtx | MutationCtx, addOnId: Id<"addOns">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const addOn = await ctx.db.get(addOnId);
  if (!addOn) throw new Error("Not found");
  const event = await ctx.db.get(addOn.eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return { addOn, event };
}

export const create = mutation({
  args: {
    eventId: v.id("events"),
    name: v.string(),
    priceCents: v.number(),
    capacity: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const event = await requireOwnedEvent(ctx, args.eventId);

    const name = args.name.trim();
    if (name.length === 0) throw new Error("Name is required");
    if (!Number.isInteger(args.priceCents) || args.priceCents <= 0) {
      throw new Error("Price must be a whole number of cents greater than 0");
    }
    if (args.capacity !== undefined) {
      if (!Number.isInteger(args.capacity) || args.capacity < 1) {
        throw new Error("Capacity must be a whole number of at least 1");
      }
    }

    const existing = await ctx.db
      .query("addOns")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    const sortOrder = existing.reduce((max, a) => Math.max(max, a.sortOrder), -1) + 1;

    return ctx.db.insert("addOns", {
      eventId: args.eventId,
      organizerId: event.organizerId,
      name,
      priceCents: args.priceCents,
      capacity: args.capacity,
      sold: 0,
      sortOrder,
      active: true,
    });
  },
});

/** Owner-only: every add-on for the event (including inactive), for the dashboard. */
export const list = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireOwnedEvent(ctx, eventId);
    const addOns = await ctx.db
      .query("addOns")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    return addOns.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

/**
 * Public: the active add-ons of a published event, sorted for rendering at
 * checkout. No account required (mirrors checkoutQuestions.listForEvent).
 * Returns an empty array -- rather than throwing -- for a missing or
 * unpublished event, since an empty add-on set is a valid checkout state.
 */
export const listForEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "published") return [];
    const addOns = await ctx.db
      .query("addOns")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    return addOns.filter((a) => a.active).sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

export const remove = mutation({
  args: { addOnId: v.id("addOns") },
  handler: async (ctx, { addOnId }) => {
    await requireOwnedAddOn(ctx, addOnId);
    await ctx.db.delete(addOnId);
    return null;
  },
});

/** Owner-only: rewrite sortOrder to match orderedIds. Mirrors ticketTypes.reorder. */
export const reorder = mutation({
  args: { eventId: v.id("events"), orderedIds: v.array(v.id("addOns")) },
  handler: async (ctx, { eventId, orderedIds }) => {
    await requireOwnedEvent(ctx, eventId);
    const addOns = await ctx.db
      .query("addOns")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    const idSet = new Set(addOns.map((a) => a._id));
    if (
      orderedIds.length !== addOns.length ||
      new Set(orderedIds).size !== orderedIds.length ||
      !orderedIds.every((id) => idSet.has(id))
    ) {
      throw new Error("orderedIds must be a permutation of the event's add-ons");
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await ctx.db.patch(orderedIds[i], { sortOrder: i });
    }
    return null;
  },
});
