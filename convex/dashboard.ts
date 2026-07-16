import { query } from "./_generated/server";
import { getAuthOrganizerId } from "./auth";
import { countSeatsTaken } from "./lib/capacity";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TIMESERIES_DAYS = 30;
const UPCOMING_LIMIT = 5;
const ACTIVITY_LIMIT = 8;

/** UTC "YYYY-MM-DD" for a given epoch-ms timestamp. Mirrors `analytics.ts`. */
function toUtcDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Epoch-ms (UTC midnight) for a "YYYY-MM-DD" date string. Mirrors `analytics.ts`. */
function fromUtcDateString(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

type TimeseriesBucket = {
  date: string;
  registrations: number;
  checkIns: number;
  revenueCents: number;
};

/** The last 30 UTC-day buckets (including today), zero-filled, oldest first. */
function buildEmptyTimeseries(now: number): TimeseriesBucket[] {
  const todayMs = fromUtcDateString(toUtcDateString(now));
  const buckets: TimeseriesBucket[] = [];
  for (let i = TIMESERIES_DAYS - 1; i >= 0; i--) {
    buckets.push({
      date: toUtcDateString(todayMs - i * MS_PER_DAY),
      registrations: 0,
      checkIns: 0,
      revenueCents: 0,
    });
  }
  return buckets;
}

function zeroedOverview(now: number) {
  return {
    events: { total: 0, published: 0, draft: 0, upcoming: 0 },
    attendance: { attendees: 0, checkedIn: 0 },
    sales: { revenueCents: 0, orders: 0, ticketsSold: 0, currency: "USD" },
    timeseries: buildEmptyTimeseries(now),
    deltas: {
      registrations: { current: 0, previous: 0, pct: null as number | null },
      checkIns: { current: 0, previous: 0, pct: null as number | null },
      revenue: { current: 0, previous: 0, pct: null as number | null },
    },
    upcomingEvents: [] as never[],
    recentActivity: [] as never[],
  };
}

/**
 * Owner-scoped organizer overview (F22): the aggregate that powers the
 * `/dashboard` home page. Loads the organizer's `events` (`by_organizer`),
 * then aggregates their `rsvps`/`tickets`/`orders` (`by_event`) and
 * `auditLogs` (`by_organizer`) in memory -- O(the organizer's rsvps + tickets
 * + orders), mirroring `analytics.getEventSummary`'s per-event fan-out.
 * Returns a fully zeroed shape (rather than throwing) when unauthenticated,
 * so the dashboard route never needs a separate "signed out" branch.
 */
export const getOverview = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return zeroedOverview(now);

    const events = await ctx.db
      .query("events")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .collect();

    const published = events.filter((e) => e.status === "published").length;
    const upcomingEventDocs = events.filter((e) => e.endsAt >= now);

    const [rsvpsByEvent, ticketsByEvent, ordersByEvent] = await Promise.all([
      Promise.all(
        events.map((e) => ctx.db.query("rsvps").withIndex("by_event", (q) => q.eq("eventId", e._id)).collect()),
      ),
      Promise.all(
        events.map((e) => ctx.db.query("tickets").withIndex("by_event", (q) => q.eq("eventId", e._id)).collect()),
      ),
      Promise.all(
        events.map((e) => ctx.db.query("orders").withIndex("by_event", (q) => q.eq("eventId", e._id)).collect()),
      ),
    ]);
    const allRsvps = rsvpsByEvent.flat();
    const allTickets = ticketsByEvent.flat();
    const allOrders = ordersByEvent.flat();

    const attendees =
      allRsvps.filter((r) => r.status === "confirmed" || r.status === "checked_in").length +
      allTickets.filter((t) => t.status === "valid" || t.status === "checked_in").length;
    const checkedIn =
      allRsvps.filter((r) => r.status === "checked_in").length +
      allTickets.filter((t) => t.status === "checked_in").length;

    const paidOrders = allOrders.filter((o) => o.status === "paid");
    const paidOrderIds = new Set(paidOrders.map((o) => o._id));
    const revenueCents = paidOrders.reduce((sum, o) => sum + o.payoutCents, 0);
    const ticketsSold = allTickets.filter((t) => paidOrderIds.has(t.orderId)).length;

    // Most common event currency (default "USD"); ties favor whichever
    // currency is encountered first while scanning `events`.
    const currencyCounts = new Map<string, number>();
    for (const e of events) {
      const c = e.currency ?? "USD";
      currencyCounts.set(c, (currencyCounts.get(c) ?? 0) + 1);
    }
    let currency = "USD";
    let bestCount = 0;
    for (const [c, count] of currencyCounts) {
      if (count > bestCount) {
        bestCount = count;
        currency = c;
      }
    }

    const timeseries = buildEmptyTimeseries(now);
    const bucketByDate = new Map(timeseries.map((b) => [b.date, b]));
    for (const r of allRsvps) {
      const bucket = bucketByDate.get(toUtcDateString(r.createdAt ?? r._creationTime));
      if (bucket) bucket.registrations += 1;
    }
    for (const t of allTickets) {
      const bucket = bucketByDate.get(toUtcDateString(t.createdAt));
      if (bucket) bucket.registrations += 1;
    }
    for (const o of paidOrders) {
      const bucket = bucketByDate.get(toUtcDateString(o.paidAt ?? o.createdAt));
      if (bucket) bucket.revenueCents += o.payoutCents;
    }
    for (const r of allRsvps) {
      if (r.checkedInAt === undefined) continue;
      const bucket = bucketByDate.get(toUtcDateString(r.checkedInAt));
      if (bucket) bucket.checkIns += 1;
    }
    for (const t of allTickets) {
      if (t.checkedInAt === undefined) continue;
      const bucket = bucketByDate.get(toUtcDateString(t.checkedInAt));
      if (bucket) bucket.checkIns += 1;
    }

    // Period-over-period deltas: last 30 days vs the 30 days before it.
    const windowMs = TIMESERIES_DAYS * MS_PER_DAY;
    const currentStart = now - windowMs;
    const prevStart = now - 2 * windowMs;
    const inCurrent = (ms: number) => ms >= currentStart;
    const inPrevious = (ms: number) => ms >= prevStart && ms < currentStart;
    const regCurrent =
      allRsvps.filter((r) => inCurrent(r.createdAt ?? r._creationTime)).length +
      allTickets.filter((t) => inCurrent(t.createdAt)).length;
    const regPrevious =
      allRsvps.filter((r) => inPrevious(r.createdAt ?? r._creationTime)).length +
      allTickets.filter((t) => inPrevious(t.createdAt)).length;
    const ciCurrent =
      allRsvps.filter((r) => r.checkedInAt !== undefined && inCurrent(r.checkedInAt)).length +
      allTickets.filter((t) => t.checkedInAt !== undefined && inCurrent(t.checkedInAt)).length;
    const ciPrevious =
      allRsvps.filter((r) => r.checkedInAt !== undefined && inPrevious(r.checkedInAt)).length +
      allTickets.filter((t) => t.checkedInAt !== undefined && inPrevious(t.checkedInAt)).length;
    const revCurrent = paidOrders
      .filter((o) => inCurrent(o.paidAt ?? o.createdAt))
      .reduce((sum, o) => sum + o.payoutCents, 0);
    const revPrevious = paidOrders
      .filter((o) => inPrevious(o.paidAt ?? o.createdAt))
      .reduce((sum, o) => sum + o.payoutCents, 0);
    const pctChange = (current: number, previous: number): number | null =>
      previous === 0 ? null : ((current - previous) / previous) * 100;
    const deltas = {
      registrations: {
        current: regCurrent,
        previous: regPrevious,
        pct: pctChange(regCurrent, regPrevious),
      },
      checkIns: { current: ciCurrent, previous: ciPrevious, pct: pctChange(ciCurrent, ciPrevious) },
      revenue: { current: revCurrent, previous: revPrevious, pct: pctChange(revCurrent, revPrevious) },
    };

    const upcomingSorted = upcomingEventDocs.slice().sort((a, b) => a.startsAt - b.startsAt).slice(0, UPCOMING_LIMIT);
    const upcomingEvents = await Promise.all(
      upcomingSorted.map(async (e) => ({
        id: e._id,
        title: e.title,
        slug: e.slug,
        startsAt: e.startsAt,
        status: e.status,
        seatsTaken: await countSeatsTaken(ctx, e._id),
        capacity: e.capacity,
      })),
    );

    const auditLogs = await ctx.db
      .query("auditLogs")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .collect();
    const recentLogs = auditLogs.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, ACTIVITY_LIMIT);
    const recentActivity = await Promise.all(
      recentLogs.map(async (log) => ({
        id: log._id,
        action: log.action,
        summary: log.summary,
        createdAt: log.createdAt,
        eventTitle: log.eventId ? ((await ctx.db.get(log.eventId))?.title ?? null) : null,
      })),
    );

    return {
      events: {
        total: events.length,
        published,
        draft: events.length - published,
        upcoming: upcomingEventDocs.length,
      },
      attendance: { attendees, checkedIn },
      sales: { revenueCents, orders: paidOrders.length, ticketsSold, currency },
      timeseries,
      deltas,
      upcomingEvents,
      recentActivity,
    };
  },
});
