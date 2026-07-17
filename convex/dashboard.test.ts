// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.*s");

const DAY = 24 * 60 * 60 * 1000;

// Mirrors convex/events.test.ts: insert a real users row + session and hand
// withIdentity a matching subject so getAuthUserId resolves.
async function asOrganizer(t: TestConvex<typeof schema>, email: string) {
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, name: email });
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 1000 * 60 * 60,
    });
    return { userId, sessionId };
  });
  return { as: t.withIdentity({ subject: `${userId}|${sessionId}` }), userId };
}

async function makeEvent(
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  overrides: Partial<{ startsAt: number; endsAt: number; capacity: number; title: string }> = {},
) {
  return as.mutation(api.events.createEvent, {
    title: overrides.title ?? "Ticketed Event",
    description: "x",
    startsAt: overrides.startsAt ?? 1,
    endsAt: overrides.endsAt ?? 2,
    location: "x",
    capacity: overrides.capacity ?? 100,
  });
}

// --- owner scoping ----------------------------------------------------

test("getOverview is owner-scoped: a second organizer sees only their own data; unauthenticated returns a zeroed shape", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});

  const adaEventId = await makeEvent(asAda);
  const bobEventId = await makeEvent(asBob);

  await t.run(async (ctx) => {
    await ctx.db.insert("rsvps", {
      eventId: adaEventId,
      name: "Ada Guest",
      email: "ag@example.com",
      token: "tok-ada",
      status: "confirmed",
    });
    await ctx.db.insert("rsvps", {
      eventId: bobEventId,
      name: "Bob Guest 1",
      email: "bg1@example.com",
      token: "tok-bob-1",
      status: "confirmed",
    });
    await ctx.db.insert("rsvps", {
      eventId: bobEventId,
      name: "Bob Guest 2",
      email: "bg2@example.com",
      token: "tok-bob-2",
      status: "confirmed",
    });
  });

  const adaOverview = await asAda.query(api.dashboard.getOverview, {});
  expect(adaOverview.events.total).toBe(1);
  expect(adaOverview.attendance.attendees).toBe(1);

  const bobOverview = await asBob.query(api.dashboard.getOverview, {});
  expect(bobOverview.events.total).toBe(1);
  expect(bobOverview.attendance.attendees).toBe(2);

  const anonOverview = await t.query(api.dashboard.getOverview, {});
  expect(anonOverview.events).toEqual({ total: 0, published: 0, draft: 0, upcoming: 0 });
  expect(anonOverview.attendance).toEqual({ attendees: 0, checkedIn: 0 });
  expect(anonOverview.sales).toEqual({ revenueCents: 0, orders: 0, ticketsSold: 0, currency: "USD" });
  expect(anonOverview.upcomingEvents).toEqual([]);
  expect(anonOverview.recentActivity).toEqual([]);
  expect(anonOverview.timeseries).toHaveLength(30);
  expect(anonOverview.timeseries.every((b) => b.registrations === 0 && b.revenueCents === 0)).toBe(true);
});

// --- event counts -------------------------------------------------------

test("events counts split total/published/draft/upcoming correctly", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const now = Date.now();

  const publishedUpcoming = await makeEvent(as, { startsAt: now + DAY, endsAt: now + 2 * DAY });
  await as.mutation(api.events.publishEvent, { eventId: publishedUpcoming });

  const publishedPast = await makeEvent(as, { startsAt: now - 2 * DAY, endsAt: now - DAY });
  await as.mutation(api.events.publishEvent, { eventId: publishedPast });

  await makeEvent(as, { startsAt: now + DAY, endsAt: now + 2 * DAY }); // draft, upcoming
  await makeEvent(as, { startsAt: now - 2 * DAY, endsAt: now - DAY }); // draft, past

  const overview = await as.query(api.dashboard.getOverview, {});
  expect(overview.events).toEqual({ total: 4, published: 2, draft: 2, upcoming: 2 });
});

// --- attendance -----------------------------------------------------------

test("attendance counts confirmed/checked-in RSVPs + valid/checked-in tickets, excluding other statuses", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const ticketTypeId = await as.mutation(api.ticketTypes.create, {
    eventId,
    name: "General",
    kind: "paid",
    priceCents: 1000,
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("rsvps", {
      eventId, name: "Confirmed", email: "c@example.com", token: "t-c", status: "confirmed",
    });
    await ctx.db.insert("rsvps", {
      eventId, name: "CheckedIn", email: "ci@example.com", token: "t-ci", status: "checked_in",
    });
    await ctx.db.insert("rsvps", {
      eventId, name: "Waitlisted", email: "w@example.com", token: "t-w", status: "waitlisted", waitlistPosition: 1,
    });
    await ctx.db.insert("rsvps", {
      eventId, name: "PendingClaim", email: "pc@example.com", token: "t-pc", status: "confirmed_pending_claim",
    });
    await ctx.db.insert("rsvps", {
      eventId, name: "Cancelled", email: "x@example.com", token: "t-x", status: "cancelled",
    });

    const orderId = await ctx.db.insert("orders", {
      eventId,
      organizerId,
      buyerName: "Buyer",
      buyerEmail: "buyer@example.com",
      status: "paid",
      currency: "USD",
      feeMode: "pass",
      subtotalCents: 3000,
      feeCents: 0,
      totalCents: 3000,
      payoutCents: 3000,
      token: "ord-tix",
      createdAt: Date.now(),
      paidAt: Date.now(),
    });

    await ctx.db.insert("tickets", {
      orderId, eventId, ticketTypeId, code: "tkt-valid", status: "valid", createdAt: Date.now(),
    });
    await ctx.db.insert("tickets", {
      orderId, eventId, ticketTypeId, code: "tkt-checkedin", status: "checked_in", createdAt: Date.now(),
    });
    await ctx.db.insert("tickets", {
      orderId, eventId, ticketTypeId, code: "tkt-cancelled", status: "cancelled", createdAt: Date.now(),
    });
  });

  const overview = await as.query(api.dashboard.getOverview, {});
  expect(overview.attendance).toEqual({ attendees: 4, checkedIn: 2 });
});

// --- sales ------------------------------------------------------------

test("sales sums only PAID orders; ticketsSold counts only tickets on paid orders", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const ticketTypeId = await as.mutation(api.ticketTypes.create, {
    eventId,
    name: "General",
    kind: "paid",
    priceCents: 1000,
  });

  await t.run(async (ctx) => {
    const paidOrderId = await ctx.db.insert("orders", {
      eventId, organizerId, buyerName: "Paid", buyerEmail: "paid@example.com",
      status: "paid", currency: "USD", feeMode: "pass",
      subtotalCents: 2000, feeCents: 0, totalCents: 2000, payoutCents: 2000,
      token: "ord-paid", createdAt: Date.now(), paidAt: Date.now(),
    });
    const pendingOrderId = await ctx.db.insert("orders", {
      eventId, organizerId, buyerName: "Pending", buyerEmail: "pending@example.com",
      status: "pending", currency: "USD", feeMode: "pass",
      subtotalCents: 500, feeCents: 0, totalCents: 500, payoutCents: 500,
      token: "ord-pending", createdAt: Date.now(),
    });
    const refundedOrderId = await ctx.db.insert("orders", {
      eventId, organizerId, buyerName: "Refunded", buyerEmail: "refunded@example.com",
      status: "refunded", currency: "USD", feeMode: "pass",
      subtotalCents: 700, feeCents: 0, totalCents: 700, payoutCents: 700,
      token: "ord-refunded", createdAt: Date.now(), paidAt: Date.now(), refundedAt: Date.now(),
    });
    const cancelledOrderId = await ctx.db.insert("orders", {
      eventId, organizerId, buyerName: "Cancelled", buyerEmail: "cancelled@example.com",
      status: "cancelled", currency: "USD", feeMode: "pass",
      subtotalCents: 300, feeCents: 0, totalCents: 300, payoutCents: 300,
      token: "ord-cancelled", createdAt: Date.now(),
    });

    await ctx.db.insert("tickets", {
      orderId: paidOrderId, eventId, ticketTypeId, code: "tkt-paid-1", status: "valid", createdAt: Date.now(),
    });
    await ctx.db.insert("tickets", {
      orderId: paidOrderId, eventId, ticketTypeId, code: "tkt-paid-2", status: "valid", createdAt: Date.now(),
    });
    await ctx.db.insert("tickets", {
      orderId: pendingOrderId, eventId, ticketTypeId, code: "tkt-pending", status: "valid", createdAt: Date.now(),
    });
    await ctx.db.insert("tickets", {
      orderId: refundedOrderId, eventId, ticketTypeId, code: "tkt-refunded", status: "cancelled", createdAt: Date.now(),
    });
    await ctx.db.insert("tickets", {
      orderId: cancelledOrderId, eventId, ticketTypeId, code: "tkt-cancelled-order", status: "valid", createdAt: Date.now(),
    });
  });

  const overview = await as.query(api.dashboard.getOverview, {});
  expect(overview.sales).toEqual({ revenueCents: 2000, orders: 1, ticketsSold: 2, currency: "USD" });
});

test("sales.currency is the organizer's most common event currency", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eur1 = await makeEvent(as);
  const eur2 = await makeEvent(as);
  const gbp1 = await makeEvent(as);
  await as.mutation(api.events.updateEvent, {
    eventId: eur1, title: "x", description: "x", startsAt: 1, endsAt: 2, location: "x", capacity: 100, currency: "EUR",
  });
  await as.mutation(api.events.updateEvent, {
    eventId: eur2, title: "x", description: "x", startsAt: 1, endsAt: 2, location: "x", capacity: 100, currency: "EUR",
  });
  await as.mutation(api.events.updateEvent, {
    eventId: gbp1, title: "x", description: "x", startsAt: 1, endsAt: 2, location: "x", capacity: 100, currency: "GBP",
  });

  const overview = await as.query(api.dashboard.getOverview, {});
  expect(overview.sales.currency).toBe("EUR");
});

// --- timeseries -----------------------------------------------------------

test("timeseries has exactly 30 zero-filled buckets and lands registrations/revenue on the right UTC day", async () => {
  vi.useFakeTimers();
  try {
    const now = Date.UTC(2026, 0, 15, 12, 0, 0); // Jan 15 2026, noon UTC
    vi.setSystemTime(now - 40 * DAY); // safely before the 30-day window, for setup

    const t = convexTest(schema, modules);
    const { as } = await asOrganizer(t, "ada@example.com");
    const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});
    const eventId = await makeEvent(as);
    const ticketTypeId = await as.mutation(api.ticketTypes.create, {
      eventId, name: "General", kind: "paid", priceCents: 1000,
    });

    // Outside the 30-day window -- must not appear in any bucket.
    vi.setSystemTime(now - 35 * DAY);
    await t.run((ctx) =>
      ctx.db.insert("rsvps", {
        eventId, name: "TooOld", email: "old@example.com", token: "t-old", status: "confirmed",
      }),
    );

    // 10 days ago -- inside the window.
    const tenDaysAgo = now - 10 * DAY;
    vi.setSystemTime(tenDaysAgo);
    await t.run(async (ctx) => {
      await ctx.db.insert("rsvps", {
        eventId, name: "TenDaysAgo", email: "tda@example.com", token: "t-tda", status: "confirmed",
      });
      const orderId = await ctx.db.insert("orders", {
        eventId, organizerId, buyerName: "Buyer", buyerEmail: "buyer@example.com",
        status: "paid", currency: "USD", feeMode: "pass",
        subtotalCents: 1000, feeCents: 0, totalCents: 1000, payoutCents: 1000,
        token: "ord-tda", createdAt: tenDaysAgo, paidAt: tenDaysAgo,
      });
      await ctx.db.insert("tickets", {
        orderId, eventId, ticketTypeId, code: "tkt-tda", status: "valid", createdAt: tenDaysAgo,
      });
    });

    // Today -- inside the window.
    vi.setSystemTime(now);
    await t.run((ctx) =>
      ctx.db.insert("rsvps", {
        eventId, name: "Today", email: "today@example.com", token: "t-today", status: "confirmed",
      }),
    );

    const overview = await as.query(api.dashboard.getOverview, {});

    expect(overview.timeseries).toHaveLength(30);

    const dateFor = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const byDate = new Map(overview.timeseries.map((b) => [b.date, b]));

    const tenDaysAgoBucket = byDate.get(dateFor(tenDaysAgo));
    expect(tenDaysAgoBucket).toBeDefined();
    expect(tenDaysAgoBucket).toMatchObject({ registrations: 2, revenueCents: 1000 });

    const todayBucket = byDate.get(dateFor(now));
    expect(todayBucket).toBeDefined();
    expect(todayBucket).toMatchObject({ registrations: 1, revenueCents: 0 });

    const totalRegistrations = overview.timeseries.reduce((sum, b) => sum + b.registrations, 0);
    const totalRevenue = overview.timeseries.reduce((sum, b) => sum + b.revenueCents, 0);
    expect(totalRegistrations).toBe(3); // "TooOld" excluded (outside the 30-day window)
    expect(totalRevenue).toBe(1000);
  } finally {
    vi.useRealTimers();
  }
});

// --- upcomingEvents ---------------------------------------------------

test("upcomingEvents returns future events sorted ascending by startsAt, capped at 5, with seatsTaken/capacity", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const now = Date.now();

  // Past event -- endsAt < now -- must be excluded even though startsAt is early.
  await makeEvent(as, { startsAt: now - 5 * DAY, endsAt: now - 4 * DAY, title: "Past" });

  // 6 future events, inserted out of chronological order, capacity 10 each.
  const offsets = [5, 1, 3, 2, 4, 6];
  const ids: Id<"events">[] = [];
  for (const offset of offsets) {
    const id = await makeEvent(as, {
      startsAt: now + offset * DAY,
      endsAt: now + (offset + 1) * DAY,
      capacity: 10,
      title: `Future+${offset}`,
    });
    ids.push(id);
  }
  const eventPlus1 = ids[1]; // offset 1 -> the soonest future event

  // Seat 2 out of 10 on the soonest event (offset 1): 1 confirmed + 1
  // checked_in (both seat-holding) + 1 cancelled (not seat-holding).
  await t.run(async (ctx) => {
    await ctx.db.insert("rsvps", {
      eventId: eventPlus1, name: "A", email: "a@example.com", token: "t-a", status: "confirmed",
    });
    await ctx.db.insert("rsvps", {
      eventId: eventPlus1, name: "B", email: "b@example.com", token: "t-b", status: "checked_in",
    });
    await ctx.db.insert("rsvps", {
      eventId: eventPlus1, name: "C", email: "c@example.com", token: "t-c", status: "cancelled",
    });
  });

  const overview = await as.query(api.dashboard.getOverview, {});

  expect(overview.upcomingEvents).toHaveLength(5);
  expect(overview.upcomingEvents.map((e) => e.title)).toEqual([
    "Future+1", "Future+2", "Future+3", "Future+4", "Future+5",
  ]);
  const first = overview.upcomingEvents[0];
  expect(first.id).toBe(eventPlus1);
  expect(first.seatsTaken).toBe(2);
  expect(first.capacity).toBe(10);
  expect(first.status).toBe("draft");
});

// --- recentActivity ---------------------------------------------------

test("recentActivity returns newest-first, capped at 8, with resolved event titles", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as, { title: "Conference" });

  await t.run(async (ctx) => {
    // 10 rows total: one org-level (no eventId), 9 tied to the event, ascending createdAt.
    await ctx.db.insert("auditLogs", {
      organizerId, action: "org.updated", summary: "No event", createdAt: 0,
    });
    for (let i = 1; i <= 9; i++) {
      await ctx.db.insert("auditLogs", {
        organizerId, eventId, action: `event.action_${i}`, summary: `Action ${i}`, createdAt: i * 1000,
      });
    }
  });

  const overview = await as.query(api.dashboard.getOverview, {});

  expect(overview.recentActivity).toHaveLength(8);
  // Newest first: createdAt 9000 down to 2000 (the 10 rows minus the 2 oldest).
  expect(overview.recentActivity.map((r) => r.createdAt)).toEqual([
    9000, 8000, 7000, 6000, 5000, 4000, 3000, 2000,
  ]);
  expect(overview.recentActivity[0].action).toBe("event.action_9");
  expect(overview.recentActivity[0].summary).toBe("Action 9");
  expect(overview.recentActivity[0].eventTitle).toBe("Conference");

  // The org-level row (createdAt 0) falls outside the top 8 and is excluded here;
  // verify null-title resolution directly against a fresh event-less row.
  const soloOverview = await (async () => {
    const t2 = convexTest(schema, modules);
    const { as: as2 } = await asOrganizer(t2, "bob@example.com");
    const organizerId2 = await as2.mutation(api.organizers.ensureOrganizer, {});
    await t2.run((ctx) =>
      ctx.db.insert("auditLogs", {
        organizerId: organizerId2, action: "org.updated", summary: "No event", createdAt: 100,
      }),
    );
    return as2.query(api.dashboard.getOverview, {});
  })();
  expect(soloOverview.recentActivity).toHaveLength(1);
  expect(soloOverview.recentActivity[0].eventTitle).toBeNull();
});
