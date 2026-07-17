// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.*s");

// Mirrors convex/orders.test.ts: insert a real users row + session and hand
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

async function makePublishedEvent(
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  capacity = 100,
) {
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Ticketed Event",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity,
  });
  await as.mutation(api.events.publishEvent, { eventId });
  return eventId;
}

async function makePaidTicketType(
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  eventId: Id<"events">,
  priceCents: number,
  name = "General",
) {
  return as.mutation(api.ticketTypes.create, { eventId, name, kind: "paid", priceCents });
}

/** Create an order for the given ticket type/quantity and mark it paid. */
async function makePaidOrder(
  t: TestConvex<typeof schema>,
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  eventId: Id<"events">,
  ticketTypeId: Id<"ticketTypes">,
  quantity: number,
) {
  const result = await as.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
  });
  await t.mutation(internal.orders.markOrderPaid, { orderId: result.orderId });
  return result.orderId;
}

test("getEventSummary: revenue counts only paid orders (pending/cancelled excluded)", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000);

  const paidOrderId = await makePaidOrder(t, as, eventId, ticketTypeId, 2);
  const paidOrder = await t.run((ctx) => ctx.db.get(paidOrderId));

  // A pending order (never marked paid) -- must be excluded from revenue.
  await as.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Pending Buyer",
    buyerEmail: "pending@example.com",
  });

  // A cancelled order -- must be excluded from revenue.
  const cancelledResult = await as.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Cancelled Buyer",
    buyerEmail: "cancelled@example.com",
  });
  await as.mutation(api.orders.cancelOrder, { orderId: cancelledResult.orderId });

  const summary = await as.query(api.analytics.getEventSummary, { eventId });

  expect(summary.revenue.grossCents).toBe(paidOrder!.subtotalCents);
  expect(summary.revenue.feeCents).toBe(paidOrder!.feeCents);
  expect(summary.revenue.netPayoutCents).toBe(paidOrder!.payoutCents);
  expect(summary.orders).toEqual({ paid: 1, pending: 1, cancelled: 1 });
  expect(summary.currency).toBe("USD");
  expect(summary.capacity).toBe(100);
});

test("getEventSummary: ticketsSold excludes cancelled tickets", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000);

  const orderId = await makePaidOrder(t, as, eventId, ticketTypeId, 3);
  const tickets = await t.run((ctx) =>
    ctx.db.query("tickets").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect(),
  );
  expect(tickets).toHaveLength(3);

  // Cancel one of the issued tickets directly (mirrors a refund's ticket-side effect).
  await t.run((ctx) => ctx.db.patch(tickets[0]._id, { status: "cancelled" }));

  const summary = await as.query(api.analytics.getEventSummary, { eventId });
  expect(summary.ticketsSold).toBe(2);
});

test("getEventSummary: checkedIn counts checked-in tickets", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000);

  const orderId = await makePaidOrder(t, as, eventId, ticketTypeId, 2);
  const tickets = await t.run((ctx) =>
    ctx.db.query("tickets").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect(),
  );
  await t.run((ctx) =>
    ctx.db.patch(tickets[0]._id, { status: "checked_in", checkedInAt: Date.now() }),
  );

  const summary = await as.query(api.analytics.getEventSummary, { eventId });
  expect(summary.checkedIn).toBe(1);
  expect(summary.ticketsSold).toBe(2); // checked-in tickets are still "issued"
});

test("getEventSummary: byTicketType groups sold + revenue correctly per type", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);
  const adultId = await makePaidTicketType(as, eventId, 1000, "Adult");
  const childId = await makePaidTicketType(as, eventId, 500, "Child");

  await makePaidOrder(t, as, eventId, adultId, 2); // 2 adult @ 1000
  await makePaidOrder(t, as, eventId, childId, 3); // 3 child @ 500
  // A pending order for adult should not count toward revenue, but note:
  // createOrder increments `sold` on the ticket type immediately (capacity
  // reservation), tickets/orderItems rows are what analytics actually reads.
  await as.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId: adultId, quantity: 1 }],
    buyerName: "Pending Buyer",
    buyerEmail: "pending@example.com",
  });

  const summary = await as.query(api.analytics.getEventSummary, { eventId });
  const byType = new Map(summary.byTicketType.map((t) => [t.ticketTypeId, t]));

  const adult = byType.get(adultId)!;
  expect(adult.name).toBe("Adult");
  expect(adult.sold).toBe(2); // pending order's tickets are not issued
  expect(adult.revenueCents).toBe(2000);

  const child = byType.get(childId)!;
  expect(child.name).toBe("Child");
  expect(child.sold).toBe(3);
  expect(child.revenueCents).toBe(1500);

  expect(summary.ticketsSold).toBe(5);
});

test("getEventSummary: byTicketType revenue is net of discount and reconciles with the top-line", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);
  const adultId = await makePaidTicketType(as, eventId, 1000, "Adult");
  const childId = await makePaidTicketType(as, eventId, 500, "Child");

  await as.mutation(api.promoCodes.create, {
    eventId,
    code: "SAVE10",
    discountKind: "percent",
    percentBps: 1000, // 10%
  });

  // Discounted order: 2 adult @ 1000 + 3 child @ 500 = 3500 gross, 10% off -> 3150 net.
  const discountedResult = await as.mutation(api.orders.createOrder, {
    eventId,
    items: [
      { ticketTypeId: adultId, quantity: 2 },
      { ticketTypeId: childId, quantity: 3 },
    ],
    buyerName: "Discount Buyer",
    buyerEmail: "discount@example.com",
    promoCode: "SAVE10",
  });
  await t.mutation(internal.orders.markOrderPaid, { orderId: discountedResult.orderId });
  const discountedOrder = await t.run((ctx) => ctx.db.get(discountedResult.orderId));
  expect(discountedOrder!.subtotalCents).toBe(3150);

  // Undiscounted order: 1 adult @ 1000, gross.
  await makePaidOrder(t, as, eventId, adultId, 1);

  const summary = await as.query(api.analytics.getEventSummary, { eventId });
  const byType = new Map(summary.byTicketType.map((row) => [row.ticketTypeId, row]));

  const totalByTicketType = (byType.get(adultId)?.revenueCents ?? 0) + (byType.get(childId)?.revenueCents ?? 0);
  // Sum of per-type revenue reconciles with the discounted top-line
  // (revenue.grossCents = 3150 discounted + 1000 undiscounted = 4150),
  // within a couple cents of rounding.
  expect(summary.revenue.grossCents).toBe(4150);
  expect(Math.abs(totalByTicketType - summary.revenue.grossCents)).toBeLessThanOrEqual(2);

  // The undiscounted order's 1000 is exact/identity, so the adult total is
  // its share of the discounted order (2000 * 3150/3500 = 1800) plus the
  // undiscounted order's 1000 -- exact, no rounding needed here.
  expect(byType.get(adultId)?.revenueCents).toBe(1800 + 1000);
});

test("getEventSummary: rejects a foreign organizer and unauthenticated callers", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(asAda);

  await expect(asBob.query(api.analytics.getEventSummary, { eventId })).rejects.toThrow();
  await expect(t.query(api.analytics.getEventSummary, { eventId })).rejects.toThrow();
});

test("getSalesTimeseries: buckets paid orders by day, zero-fills gaps, sorted ascending", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000);

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const today = Date.now();
  const twoDaysAgo = today - 2 * MS_PER_DAY;

  const olderOrderId = await makePaidOrder(t, as, eventId, ticketTypeId, 1);
  await t.run((ctx) => ctx.db.patch(olderOrderId, { paidAt: twoDaysAgo }));

  const todayOrderId = await makePaidOrder(t, as, eventId, ticketTypeId, 2);
  await t.run((ctx) => ctx.db.patch(todayOrderId, { paidAt: today }));

  const series = await as.query(api.analytics.getSalesTimeseries, { eventId });

  expect(series).toHaveLength(3);
  const dates = series.map((d) => d.date);
  expect(dates).toEqual([...dates].sort()); // ascending

  const [first, middle, last] = series;
  expect(first.orders).toBe(1);
  expect(first.revenueCents).toBe(1000);
  expect(middle.orders).toBe(0);
  expect(middle.revenueCents).toBe(0);
  expect(last.orders).toBe(1);
  expect(last.revenueCents).toBe(2000);
});

test("getSalesTimeseries: empty when there are no paid orders", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);

  const series = await as.query(api.analytics.getSalesTimeseries, { eventId });
  expect(series).toEqual([]);
});

test("getSalesTimeseries: rejects a foreign organizer and unauthenticated callers", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(asAda);

  await expect(asBob.query(api.analytics.getSalesTimeseries, { eventId })).rejects.toThrow();
  await expect(t.query(api.analytics.getSalesTimeseries, { eventId })).rejects.toThrow();
});
