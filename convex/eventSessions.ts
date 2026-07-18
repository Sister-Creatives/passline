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

/**
 * Owner-only: bulk-create sessions from a pre-computed set of windows (the
 * output of `generateRecurringDates`). Validates every window before
 * inserting any -- the mutation is transactional, but validating up front
 * keeps the rejection path a single clean throw instead of a partial insert
 * followed by a rollback.
 */
export const createRecurring = mutation({
  args: {
    eventId: v.id("events"),
    sessions: v.array(v.object({ startsAt: v.number(), endsAt: v.number() })),
    capacity: v.number(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const event = await requireOwnedEvent(ctx, args.eventId);
    if (args.sessions.length === 0) throw new Error("Add at least one date");
    if (args.sessions.length > 100) throw new Error("Too many dates at once (max 100)");
    validateSessionCapacity(args.capacity);
    for (const session of args.sessions) {
      validateSessionWindow(session.startsAt, session.endsAt);
    }

    const existing = await ctx.db
      .query("eventSessions")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    let sortOrder = existing.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1;
    const label = args.label?.trim() || undefined;

    for (const session of args.sessions) {
      await ctx.db.insert("eventSessions", {
        eventId: args.eventId,
        organizerId: event.organizerId,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        capacity: args.capacity,
        sold: 0,
        label,
        sortOrder,
      });
      sortOrder++;
    }

    return { created: args.sessions.length };
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
