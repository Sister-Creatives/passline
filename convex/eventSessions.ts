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

/** Load a session + its event, enforcing organizer ownership of the event. */
async function requireOwnedSession(ctx: QueryCtx | MutationCtx, sessionId: Id<"eventSessions">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const session = await ctx.db.get(sessionId);
  if (!session) throw new Error("Not found");
  const event = await ctx.db.get(session.eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return { session, event };
}

/** Shared invariant checks for create + update (throws on the first violation). */
function validateSessionWindow(startsAt: number, endsAt: number) {
  if (endsAt <= startsAt) throw new Error("endsAt must be after startsAt");
}

function validateSessionCapacity(capacity: number) {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error("Capacity must be a whole number of at least 1");
  }
}

export const create = mutation({
  args: {
    eventId: v.id("events"),
    startsAt: v.number(),
    endsAt: v.number(),
    capacity: v.number(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const event = await requireOwnedEvent(ctx, args.eventId);
    validateSessionWindow(args.startsAt, args.endsAt);
    validateSessionCapacity(args.capacity);
    const existing = await ctx.db
      .query("eventSessions")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    const sortOrder = existing.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1;
    return ctx.db.insert("eventSessions", {
      eventId: args.eventId,
      organizerId: event.organizerId,
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      capacity: args.capacity,
      sold: 0,
      label: args.label,
      sortOrder,
    });
  },
});

/** Owner-only: every session for the event, for the dashboard. */
export const list = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireOwnedEvent(ctx, eventId);
    const sessions = await ctx.db
      .query("eventSessions")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    return sessions.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

/**
 * Public: the sessions of a published event, sorted by startsAt, each with
 * `remaining = capacity - sold` for the buyer's session picker. No account
 * required. Returns an empty array -- rather than throwing -- for a missing
 * or unpublished event (mirrors addOns.listForEvent).
 */
export const listForEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "published") return [];
    const sessions = await ctx.db
      .query("eventSessions")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    return sessions
      .sort((a, b) => a.startsAt - b.startsAt)
      .map((session) => ({ ...session, remaining: session.capacity - session.sold }));
  },
});

export const update = mutation({
  args: {
    sessionId: v.id("eventSessions"),
    startsAt: v.number(),
    endsAt: v.number(),
    capacity: v.number(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { session } = await requireOwnedSession(ctx, args.sessionId);
    validateSessionWindow(args.startsAt, args.endsAt);
    validateSessionCapacity(args.capacity);
    if (args.capacity < session.sold) {
      throw new Error(`Capacity cannot drop below the ${session.sold} seat(s) already sold`);
    }
    await ctx.db.patch(args.sessionId, {
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      capacity: args.capacity,
      label: args.label,
    });
    return null;
  },
});

export const remove = mutation({
  args: { sessionId: v.id("eventSessions") },
  handler: async (ctx, { sessionId }) => {
    const { session } = await requireOwnedSession(ctx, sessionId);
    if (session.sold > 0) {
      throw new Error("Cannot remove a session with tickets already sold");
    }
    await ctx.db.delete(sessionId);
    return null;
  },
});

/** Owner-only: rewrite sortOrder to match orderedIds. Mirrors ticketTypes.reorder. */
export const reorder = mutation({
  args: { eventId: v.id("events"), orderedIds: v.array(v.id("eventSessions")) },
  handler: async (ctx, { eventId, orderedIds }) => {
    await requireOwnedEvent(ctx, eventId);
    const sessions = await ctx.db
      .query("eventSessions")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    const idSet = new Set(sessions.map((s) => s._id));
    if (
      orderedIds.length !== sessions.length ||
      new Set(orderedIds).size !== orderedIds.length ||
      !orderedIds.every((id) => idSet.has(id))
    ) {
      throw new Error("orderedIds must be a permutation of the event's sessions");
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await ctx.db.patch(orderedIds[i], { sortOrder: i });
    }
    return null;
  },
});
