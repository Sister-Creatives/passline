import { v } from "convex/values";
import { query } from "./_generated/server";
import { getAuthOrganizerId } from "./auth";

/**
 * Queries that feed the app sidebar's contextual sections: the "Upcoming"
 * quick-jump list, the "Live now" indicator, and the getting-started
 * checklist. All are organizer-scoped and return only the light fields the
 * sidebar renders, so they stay cheap to subscribe to on every page.
 */

const UPCOMING_LIMIT = 5;

/**
 * Lightweight lookup for the contextual event sub-nav: just the current
 * event's display fields, owner-checked. Returns null for a missing event or
 * one belonging to another organizer (so the sub-nav simply doesn't render),
 * mirroring the rest of the owner-read surface. Deliberately does NOT load
 * RSVPs/tickets like `events.getMyEventWithRsvps` -- the sub-nav only needs a
 * title.
 */
export const getEventNav = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return null;
    const event = await ctx.db.get(eventId);
    if (!event || event.organizerId !== organizerId) return null;
    return { _id: event._id, title: event.title, status: event.status };
  },
});

/**
 * The organizer's next few events that haven't ended yet, soonest first --
 * powers the "Upcoming" quick-jump list. An event counts as upcoming while it
 * is still running (endsAt in the future), so an in-progress event stays in
 * the list until it actually ends.
 */
export const getUpcomingEvents = query({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return [];
    const now = Date.now();

    const events = await ctx.db
      .query("events")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .collect();

    return events
      .filter((e) => e.endsAt >= now)
      .sort((a, b) => a.startsAt - b.startsAt)
      .slice(0, UPCOMING_LIMIT)
      .map((e) => ({
        _id: e._id,
        title: e.title,
        slug: e.slug,
        startsAt: e.startsAt,
        status: e.status,
      }));
  },
});

/**
 * Events that are happening right now (started, not yet ended), with a live
 * checked-in count -- powers the "Live now" banner and its door shortcut.
 * Only walks RSVPs/tickets for the events that are actually live, so the cost
 * scales with concurrent events, not total history.
 */
export const getLiveEvents = query({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return [];
    const now = Date.now();

    const events = await ctx.db
      .query("events")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .collect();

    const live = events.filter((e) => e.startsAt <= now && e.endsAt >= now);

    return Promise.all(
      live
        .sort((a, b) => a.startsAt - b.startsAt)
        .map(async (e) => {
          const [rsvps, tickets] = await Promise.all([
            ctx.db.query("rsvps").withIndex("by_event", (q) => q.eq("eventId", e._id)).collect(),
            ctx.db.query("tickets").withIndex("by_event", (q) => q.eq("eventId", e._id)).collect(),
          ]);
          const checkedIn =
            rsvps.filter((r) => r.status === "checked_in").length +
            tickets.filter((t) => t.status === "checked_in").length;
          return { _id: e._id, title: e.title, slug: e.slug, checkedIn };
        }),
    );
  },
});

/**
 * Activation checklist state, scoped to signals we can actually detect from
 * the data: whether the organizer has created an event, published one, and
 * made a first paid sale. (Payments-connected and team-invited aren't wired to
 * backend state yet, so they're deliberately left out rather than faked.)
 */
export const getGettingStarted = query({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) {
      return { createdEvent: false, publishedEvent: false, firstSale: false };
    }

    const events = await ctx.db
      .query("events")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .collect();

    const createdEvent = events.length > 0;
    const publishedEvent = events.some((e) => e.status === "published");

    let firstSale = false;
    for (const event of events) {
      const orders = await ctx.db
        .query("orders")
        .withIndex("by_event", (q) => q.eq("eventId", event._id))
        .collect();
      if (orders.some((o) => o.status === "paid")) {
        firstSale = true;
        break;
      }
    }

    return { createdEvent, publishedEvent, firstSale };
  },
});
