import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getAuthOrganizerId } from "./auth";
import { recordAudit } from "./audit";

/** Load an event and enforce that it belongs to the authenticated organizer. */
async function requireOwnedEvent(ctx: QueryCtx | MutationCtx, eventId: Id<"events">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const event = await ctx.db.get(eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return event;
}

/** Load an access code + its event, enforcing organizer ownership of the event. */
async function requireOwnedAccessCode(ctx: QueryCtx | MutationCtx, accessCodeId: Id<"accessCodes">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const accessCode = await ctx.db.get(accessCodeId);
  if (!accessCode) throw new Error("Not found");
  const event = await ctx.db.get(accessCode.eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return { accessCode, event };
}

export const create = mutation({
  args: {
    eventId: v.id("events"),
    code: v.string(),
    ticketTypeIds: v.array(v.id("ticketTypes")),
  },
  handler: async (ctx, args) => {
    const event = await requireOwnedEvent(ctx, args.eventId);

    const code = args.code.trim().toUpperCase();
    if (code.length === 0) throw new Error("Code is required");

    const existing = await ctx.db
      .query("accessCodes")
      .withIndex("by_event_and_code", (q) => q.eq("eventId", args.eventId).eq("code", code))
      .unique();
    if (existing) throw new Error("An access code with that code already exists for this event");

    // Every unlocked type must belong to this event and currently be hidden --
    // an access code only ever exists to reveal hidden types, so a `visible`
    // (or foreign) id here is a mistake, not something to silently allow.
    for (const ticketTypeId of args.ticketTypeIds) {
      const ticketType = await ctx.db.get(ticketTypeId);
      if (!ticketType || ticketType.eventId !== args.eventId) {
        throw new Error("Ticket type not found for this event");
      }
      if (ticketType.visibility !== "hidden") {
        throw new Error(`${ticketType.name} is not a hidden ticket type`);
      }
    }

    const id = await ctx.db.insert("accessCodes", {
      eventId: args.eventId,
      organizerId: event.organizerId,
      code,
      ticketTypeIds: args.ticketTypeIds,
      active: true,
      createdAt: Date.now(),
    });
    await recordAudit(ctx, {
      organizerId: event.organizerId,
      eventId: args.eventId,
      action: "access_code.created",
      summary: `Created access code "${code}"`,
    });
    return id;
  },
});

export const list = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireOwnedEvent(ctx, eventId);
    return ctx.db
      .query("accessCodes")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
  },
});

export const remove = mutation({
  args: { accessCodeId: v.id("accessCodes") },
  handler: async (ctx, { accessCodeId }) => {
    const { accessCode, event } = await requireOwnedAccessCode(ctx, accessCodeId);
    await ctx.db.delete(accessCodeId);
    await recordAudit(ctx, {
      organizerId: event.organizerId,
      eventId: event._id,
      action: "access_code.removed",
      summary: `Removed access code "${accessCode.code}"`,
    });
    return null;
  },
});

/**
 * Resolve the hidden ticket type ids a (valid, active) access code unlocks
 * for an event. Plain helper (not a Convex function) shared by
 * `resolveAccessCode` below and, from F4b.3, the checkout path
 * (`convex/orders.ts` createOrder) so code lookup lives in one place. Returns
 * an empty set -- never throws -- for a missing/inactive code, since both
 * the public preview and the checkout gate need "no code" and "bad code" to
 * behave identically (fail closed, not with a distinguishing error).
 */
export async function unlockedTicketTypeIds(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<"events">,
  code: string,
): Promise<Set<Id<"ticketTypes">>> {
  const normalizedCode = code.trim().toUpperCase();
  if (normalizedCode.length === 0) return new Set();

  const accessCode = await ctx.db
    .query("accessCodes")
    .withIndex("by_event_and_code", (q) => q.eq("eventId", eventId).eq("code", normalizedCode))
    .unique();
  if (!accessCode || !accessCode.active) return new Set();

  return new Set(accessCode.ticketTypeIds);
}

/**
 * Public: resolve an access code for a published event into the hidden
 * ticket types it unlocks, so a checkout can render them. Returns
 * `{ ticketTypes: [] }` -- never throws -- for a missing/inactive code or an
 * unpublished/missing event, mirroring `orders.createOrder`'s public,
 * no-account checkout path.
 */
export const resolveAccessCode = query({
  args: { eventId: v.id("events"), code: v.string() },
  handler: async (ctx, { eventId, code }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "published") return { ticketTypes: [] };

    const unlockedIds = await unlockedTicketTypeIds(ctx, eventId, code);
    if (unlockedIds.size === 0) return { ticketTypes: [] };

    const currency = event.currency ?? "USD";
    const ticketTypes = await Promise.all(Array.from(unlockedIds).map((id) => ctx.db.get(id)));

    return {
      ticketTypes: ticketTypes
        // Re-check `hidden` here (not just at code-creation time): a type
        // flipped back to `visible` after the code was issued should show up
        // through the normal public listing, not be double-exposed here.
        .filter((t): t is NonNullable<typeof t> => t !== null && t.visibility === "hidden")
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((t) => ({
          id: t._id,
          name: t.name,
          priceCents: t.priceCents,
          kind: t.kind,
          currency,
          capacity: t.capacity,
          sold: t.sold,
          badge: t.badge,
          sortOrder: t.sortOrder,
        })),
    };
  },
});
