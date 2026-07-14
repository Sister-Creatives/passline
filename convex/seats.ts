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

/**
 * Spreadsheet-style row labels from a 0-based index: 0 -> "A", 25 -> "Z",
 * 26 -> "AA", … (rows are capped at 100, so this never needs to go past "CV").
 */
function rowLabel(index: number): string {
  let label = "";
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

function validateGridDimension(value: number, name: string) {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error(`${name} must be a whole number between 1 and 100`);
  }
}

/**
 * Organizer: lay out a section of a seated venue as rows x seatsPerRow, all
 * priced by `ticketTypeId`. Row labels are A, B, C, … by row index; seat
 * numbers run 1..seatsPerRow; `sortOrder = rowIndex*1000 + number` gives a
 * stable reading order across the whole section. Returns the seat count
 * created.
 */
export const generateSection = mutation({
  args: {
    eventId: v.id("events"),
    ticketTypeId: v.id("ticketTypes"),
    section: v.string(),
    rows: v.number(),
    seatsPerRow: v.number(),
  },
  handler: async (ctx, args) => {
    const event = await requireOwnedEvent(ctx, args.eventId);
    const ticketType = await ctx.db.get(args.ticketTypeId);
    if (!ticketType || ticketType.eventId !== args.eventId) {
      throw new Error("Ticket type does not belong to this event");
    }
    validateGridDimension(args.rows, "rows");
    validateGridDimension(args.seatsPerRow, "seatsPerRow");
    const section = args.section.trim();
    if (section.length === 0) throw new Error("Section name is required");

    // Reject a duplicate section name for the event -- this is also what
    // protects already-sold seats from being clobbered by a "regenerate":
    // the organizer must removeSection (which itself refuses a section with
    // any sold seat) before generateSection can reuse the name.
    const existing = await ctx.db
      .query("seats")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    if (existing.some((s) => s.section === section)) {
      throw new Error(`A section named "${section}" already exists for this event`);
    }

    let count = 0;
    for (let rowIndex = 0; rowIndex < args.rows; rowIndex++) {
      const row = rowLabel(rowIndex);
      for (let number = 1; number <= args.seatsPerRow; number++) {
        await ctx.db.insert("seats", {
          eventId: args.eventId,
          organizerId: event.organizerId,
          ticketTypeId: args.ticketTypeId,
          section,
          row,
          number,
          status: "available",
          sortOrder: rowIndex * 1000 + number,
        });
        count++;
      }
    }
    return count;
  },
});

/** Owner-only: every seat for the event (all statuses), for the dashboard. */
export const list = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireOwnedEvent(ctx, eventId);
    const seats = await ctx.db
      .query("seats")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    return seats.sort(
      (a, b) => a.section.localeCompare(b.section) || a.sortOrder - b.sortOrder,
    );
  },
});

/**
 * Public: the seats of a published event's seat map, sorted by section then
 * reading order, for the buyer's seat picker. No account required. Returns
 * an empty array -- rather than throwing -- for a missing or unpublished
 * event (mirrors eventSessions.listForEvent / addOns.listForEvent).
 */
export const listForEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "published") return [];
    const seats = await ctx.db
      .query("seats")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    return seats
      .sort((a, b) => a.section.localeCompare(b.section) || a.sortOrder - b.sortOrder)
      .map((s) => ({
        id: s._id,
        ticketTypeId: s.ticketTypeId,
        section: s.section,
        row: s.row,
        number: s.number,
        status: s.status,
      }));
  },
});

/** Owner-only: delete every seat in a section. Refuses if any seat is sold. */
export const removeSection = mutation({
  args: { eventId: v.id("events"), section: v.string() },
  handler: async (ctx, { eventId, section }) => {
    await requireOwnedEvent(ctx, eventId);
    const seats = await ctx.db
      .query("seats")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    const inSection = seats.filter((s) => s.section === section);
    if (inSection.length === 0) throw new Error("Not found");
    if (inSection.some((s) => s.status === "sold")) {
      throw new Error("Cannot remove a section with seats already sold");
    }
    for (const seat of inSection) {
      await ctx.db.delete(seat._id);
    }
    return null;
  },
});
