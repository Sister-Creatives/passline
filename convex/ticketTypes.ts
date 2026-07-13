import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getAuthOrganizerId } from "./auth";

const kindValidator = v.union(v.literal("paid"), v.literal("free"), v.literal("donation"));
const visibilityValidator = v.union(v.literal("visible"), v.literal("hidden"));

/** Load an event and enforce that it belongs to the authenticated organizer. */
async function requireOwnedEvent(ctx: QueryCtx | MutationCtx, eventId: Id<"events">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const event = await ctx.db.get(eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return event;
}

/** Load a ticket type + its event, enforcing organizer ownership of the event. */
async function requireOwnedTicketType(ctx: QueryCtx | MutationCtx, ticketTypeId: Id<"ticketTypes">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const ticketType = await ctx.db.get(ticketTypeId);
  if (!ticketType) throw new Error("Not found");
  const event = await ctx.db.get(ticketType.eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return { ticketType, event };
}

type TicketTypeInput = {
  name: string;
  kind: "paid" | "free" | "donation";
  priceCents: number;
  capacity?: number;
  minPerOrder?: number;
  maxPerOrder?: number;
};

/** Shared invariant checks for create + update (throws on the first violation). */
function validateTicketTypeInput(input: TicketTypeInput, eventCapacity: number) {
  if (input.name.trim().length === 0) throw new Error("Name is required");
  if (!Number.isInteger(input.priceCents) || input.priceCents < 0) {
    throw new Error("Price must be a whole number of cents of at least 0");
  }
  if (input.kind === "free" && input.priceCents !== 0) {
    throw new Error("Free ticket types must have a price of 0");
  }
  if (input.capacity !== undefined) {
    if (!Number.isInteger(input.capacity) || input.capacity < 1) {
      throw new Error("Capacity must be a whole number of at least 1");
    }
    if (input.capacity > eventCapacity) {
      throw new Error(`Capacity cannot exceed the event capacity of ${eventCapacity}`);
    }
  }
  if (
    input.minPerOrder !== undefined &&
    input.maxPerOrder !== undefined &&
    input.minPerOrder > input.maxPerOrder
  ) {
    throw new Error("Min per order cannot exceed max per order");
  }
}

export const create = mutation({
  args: {
    eventId: v.id("events"),
    name: v.string(),
    kind: kindValidator,
    priceCents: v.number(),
    capacity: v.optional(v.number()),
    badge: v.optional(v.string()),
    minPerOrder: v.optional(v.number()),
    maxPerOrder: v.optional(v.number()),
    visibility: v.optional(visibilityValidator),
  },
  handler: async (ctx, args) => {
    const event = await requireOwnedEvent(ctx, args.eventId);
    validateTicketTypeInput(args, event.capacity);
    const existing = await ctx.db
      .query("ticketTypes")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    const sortOrder = existing.reduce((max, t) => Math.max(max, t.sortOrder), -1) + 1;
    return await ctx.db.insert("ticketTypes", {
      eventId: args.eventId,
      name: args.name.trim(),
      kind: args.kind,
      priceCents: args.priceCents,
      capacity: args.capacity,
      sold: 0,
      badge: args.badge,
      minPerOrder: args.minPerOrder,
      maxPerOrder: args.maxPerOrder,
      visibility: args.visibility ?? "visible",
      sortOrder,
      status: "active",
    });
  },
});

export const listForEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireOwnedEvent(ctx, eventId);
    const types = await ctx.db
      .query("ticketTypes")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    return types.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

export const update = mutation({
  args: {
    ticketTypeId: v.id("ticketTypes"),
    name: v.string(),
    kind: kindValidator,
    priceCents: v.number(),
    capacity: v.optional(v.number()),
    badge: v.optional(v.string()),
    minPerOrder: v.optional(v.number()),
    maxPerOrder: v.optional(v.number()),
    visibility: visibilityValidator,
  },
  handler: async (ctx, args) => {
    const { event } = await requireOwnedTicketType(ctx, args.ticketTypeId);
    validateTicketTypeInput(args, event.capacity);
    await ctx.db.patch(args.ticketTypeId, {
      name: args.name.trim(),
      kind: args.kind,
      priceCents: args.priceCents,
      capacity: args.capacity,
      badge: args.badge,
      minPerOrder: args.minPerOrder,
      maxPerOrder: args.maxPerOrder,
      visibility: args.visibility,
    });
    return null;
  },
});
