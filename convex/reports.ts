import { query } from "./_generated/server";
import { getAuthOrganizerId } from "./auth";

// Attendee-representing statuses, matching dashboard.getOverview /
// organizers.getSidebarCounts EXACTLY (confirmed_pending_claim is deliberately
// excluded there, and pinned by dashboard.test.ts) so cross-surface numbers
// can't disagree.
const ATTENDING_RSVP = new Set(["confirmed", "checked_in"]);
const ATTENDING_TICKET = new Set(["valid", "checked_in"]);

/**
 * Per-event performance rows for the cross-event Reports page: registrations,
 * check-ins, and paid revenue for each of the organizer's events, newest event
 * first. Reuses the same attendee/revenue predicates as the dashboard overview.
 */
export const getEventBreakdown = query({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return [];

    const events = await ctx.db
      .query("events")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .collect();

    return Promise.all(
      events
        .sort((a, b) => b.startsAt - a.startsAt)
        .map(async (event) => {
          const [rsvps, tickets, orders] = await Promise.all([
            ctx.db.query("rsvps").withIndex("by_event", (q) => q.eq("eventId", event._id)).collect(),
            ctx.db.query("tickets").withIndex("by_event", (q) => q.eq("eventId", event._id)).collect(),
            ctx.db.query("orders").withIndex("by_event", (q) => q.eq("eventId", event._id)).collect(),
          ]);

          const registrations =
            rsvps.filter((r) => ATTENDING_RSVP.has(r.status)).length +
            tickets.filter((t) => ATTENDING_TICKET.has(t.status)).length;
          const checkedIn =
            rsvps.filter((r) => r.status === "checked_in").length +
            tickets.filter((t) => t.status === "checked_in").length;
          const revenueCents = orders
            .filter((o) => o.status === "paid")
            .reduce((sum, o) => sum + o.payoutCents, 0);

          return {
            _id: event._id,
            title: event.title,
            startsAt: event.startsAt,
            status: event.status,
            capacity: event.capacity,
            currency: event.currency ?? "USD",
            registrations,
            checkedIn,
            revenueCents,
          };
        }),
    );
  },
});
