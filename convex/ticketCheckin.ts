import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthOrganizerId } from "./auth";

/**
 * Load a ticket + its event, enforcing organizer ownership of the event.
 * Mirrors `ticketTypes.requireOwnedTicketType`. Used by mutations/queries
 * that should throw on a non-owner (e.g. `undoCheckIn`); `checkInTicket` and
 * `getTicketByCode` deliberately do NOT use this -- a foreign-org ticket must
 * resolve to a structured `not_found`/`null`, not a thrown error, so the gate
 * scanner never learns whether a code belongs to someone else's event.
 */
async function requireOwnedTicket(ctx: QueryCtx | MutationCtx, ticketId: Id<"tickets">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const ticket = await ctx.db.get(ticketId);
  if (!ticket) throw new Error("Not found");
  const event = await ctx.db.get(ticket.eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return { ticket, event };
}

/** The gate-facing display fields sourced from a ticket's ticket type. */
async function ticketTypeGateInfo(ctx: QueryCtx | MutationCtx, ticketTypeId: Id<"ticketTypes">) {
  const ticketType = await ctx.db.get(ticketTypeId);
  return { ticketTypeName: ticketType?.name, gateAlert: ticketType?.gateAlert };
}

/**
 * Door check-in by scanned/entered `code`. Organizer-authenticated (unlike
 * the public RSVP door flow) and event-ownership-scoped: a ticket whose event
 * belongs to a different organizer resolves to `not_found`, identically to an
 * unknown code, so a scan never leaks another org's ticket existence.
 *
 * Returns a structured, never-thrown business result so the gate UI can
 * render every case (spec F7 §4): `not_found`, `cancelled`, `already`
 * (idempotent re-scan -- no second state transition), or `ok` (the only case
 * that mutates state: `valid` -> `checked_in` with `checkedInAt` stamped).
 * Only an unauthenticated caller throws.
 */
export const checkInTicket = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");

    const ticket = await ctx.db
      .query("tickets")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!ticket) return { result: "not_found" as const };

    const event = await ctx.db.get(ticket.eventId);
    if (!event || event.organizerId !== organizerId) return { result: "not_found" as const };

    if (ticket.status === "cancelled") {
      return { result: "cancelled" as const, ticket };
    }

    const { ticketTypeName, gateAlert } = await ticketTypeGateInfo(ctx, ticket.ticketTypeId);

    if (ticket.status === "checked_in") {
      return {
        result: "already" as const,
        ticket,
        checkedInAt: ticket.checkedInAt ?? ticket._creationTime,
        gateAlert,
      };
    }

    const checkedInAt = Date.now();
    await ctx.db.patch(ticket._id, { status: "checked_in", checkedInAt });
    const updated = (await ctx.db.get(ticket._id)) as Doc<"tickets">;
    return { result: "ok" as const, ticket: updated, ticketTypeName, gateAlert };
  },
});

/**
 * Correct a mis-scan: owner-only, reverts a `checked_in` ticket back to
 * `valid` and clears `checkedInAt`. A no-op for any other status.
 */
export const undoCheckIn = mutation({
  args: { ticketId: v.id("tickets") },
  handler: async (ctx, { ticketId }) => {
    const { ticket } = await requireOwnedTicket(ctx, ticketId);
    if (ticket.status === "checked_in") {
      await ctx.db.patch(ticketId, { status: "valid", checkedInAt: undefined });
    }
    return null;
  },
});

/**
 * Owner-only pre-scan peek by code: the ticket + its type name + gate alert,
 * or `null` when the code is unknown or belongs to another organizer's event.
 */
export const getTicketByCode = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");

    const ticket = await ctx.db
      .query("tickets")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!ticket) return null;

    const event = await ctx.db.get(ticket.eventId);
    if (!event || event.organizerId !== organizerId) return null;

    const { ticketTypeName, gateAlert } = await ticketTypeGateInfo(ctx, ticket.ticketTypeId);
    return { ticket, ticketTypeName, gateAlert };
  },
});

/**
 * Owner-only live count for the door dashboard header, over the event's
 * non-cancelled tickets (a cancelled ticket never counts toward `total`).
 */
export const getScanState = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");
    const event = await ctx.db.get(eventId);
    if (!event || event.organizerId !== organizerId) throw new Error("Not found");

    const tickets = await ctx.db
      .query("tickets")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    const active = tickets.filter((t) => t.status !== "cancelled");
    const checkedIn = active.filter((t) => t.status === "checked_in").length;
    return { total: active.length, checkedIn };
  },
});
