import { query } from "./_generated/server";
import { getAuthOrganizerId } from "./auth";

/**
 * Cross-event attendee roster for the organizer's "Attendees" page: every
 * non-cancelled RSVP and ticket across all of the organizer's events, flattened
 * into one list with the event title attached, newest first.
 *
 * Walks every event's RSVPs and tickets on each run -- fine at the current
 * scale; a large history would want pagination or a denormalized roster.
 */
export const listForOrganizer = query({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return [];

    const events = await ctx.db
      .query("events")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .collect();

    // Fan out across events concurrently (mirrors getEventBreakdown /
    // getOverview), then flatten and sort newest first.
    const perEvent = await Promise.all(
      events.map(async (event) => {
        const [rsvps, tickets] = await Promise.all([
          ctx.db.query("rsvps").withIndex("by_event", (q) => q.eq("eventId", event._id)).collect(),
          ctx.db.query("tickets").withIndex("by_event", (q) => q.eq("eventId", event._id)).collect(),
        ]);

        const eventRows = [];
        for (const r of rsvps) {
          if (r.status === "cancelled") continue;
          eventRows.push({
            _id: r._id,
            name: r.name,
            email: r.email,
            eventTitle: event.title,
            eventId: event._id,
            status: r.status,
            checkedIn: r.status === "checked_in",
            kind: "rsvp" as const,
            createdAt: r._creationTime,
          });
        }
        for (const t of tickets) {
          if (t.status === "cancelled") continue;
          eventRows.push({
            _id: t._id,
            name: t.attendeeName ?? "Guest",
            email: t.attendeeEmail ?? "",
            eventTitle: event.title,
            eventId: event._id,
            status: t.status,
            checkedIn: t.status === "checked_in",
            kind: "ticket" as const,
            createdAt: t.createdAt,
          });
        }
        return eventRows;
      }),
    );

    return perEvent.flat().sort((a, b) => b.createdAt - a.createdAt);
  },
});
