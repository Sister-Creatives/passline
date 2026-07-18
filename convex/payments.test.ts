// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.*s");

async function asOrganizer(t: TestConvex<typeof schema>, email: string) {
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, name: email });
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 });
    return { userId, sessionId };
  });
  return t.withIdentity({ subject: `${userId}|${sessionId}` });
}

/** Minimal valid `orders` row, overridable per test. */
function orderFields(overrides: {
  eventId: Id<"events">;
  organizerId: Id<"organizers">;
  status: "pending" | "paid" | "cancelled" | "refunded";
  totalCents: number;
  feeCents?: number;
  payoutCents?: number;
  paymentMethod?: "cash" | "card" | "online";
  currency?: string;
}) {
  return {
    eventId: overrides.eventId,
    organizerId: overrides.organizerId,
    buyerName: "Ada Lovelace",
    buyerEmail: "ada@example.com",
    status: overrides.status,
    currency: overrides.currency ?? "USD",
    feeMode: "pass" as const,
    subtotalCents: overrides.totalCents,
    feeCents: overrides.feeCents ?? 0,
    totalCents: overrides.totalCents,
    payoutCents: overrides.payoutCents ?? overrides.totalCents,
    paymentMethod: overrides.paymentMethod,
    token: crypto.randomUUID(),
    createdAt: Date.now(),
  };
}

test("getEarnings returns all-zero with currency USD when unauthenticated", async () => {
  const t = convexTest(schema, modules);
  const earnings = await t.query(api.payments.getEarnings, {});
  expect(earnings).toEqual({
    currency: "USD",
    paid: { count: 0, grossCents: 0, feeCents: 0, netPayoutCents: 0 },
    pending: { count: 0, amountCents: 0 },
    refunded: { count: 0, amountCents: 0 },
    cancelled: { count: 0 },
    byMethod: {
      cash: { count: 0, payoutCents: 0 },
      card: { count: 0, payoutCents: 0 },
      online: { count: 0, payoutCents: 0 },
    },
  });
});

test("getEarnings aggregates paid/pending/refunded/cancelled and buckets paid orders by method", async () => {
  const t = convexTest(schema, modules);
  const as = await asOrganizer(t, "ada@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId1 = await as.mutation(api.events.createEvent, {
    title: "Rooftop Jazz",
    description: "Live jazz night.",
    startsAt: 100,
    endsAt: 200,
    location: "Rooftop",
    capacity: 80,
  });
  const eventId2 = await as.mutation(api.events.createEvent, {
    title: "Garden Party",
    description: "Outdoor gathering.",
    startsAt: 300,
    endsAt: 400,
    location: "Garden",
    capacity: 40,
  });

  await t.run(async (ctx) => {
    // Paid, paymentMethod "card": gross 1000, fee 30, payout 970.
    await ctx.db.insert(
      "orders",
      orderFields({
        eventId: eventId1,
        organizerId,
        status: "paid",
        totalCents: 1000,
        feeCents: 30,
        payoutCents: 970,
        paymentMethod: "card",
      }),
    );
    // Paid, paymentMethod unset (online order) -> buckets as "online": gross 2000, fee 60, payout 1940.
    await ctx.db.insert(
      "orders",
      orderFields({
        eventId: eventId2,
        organizerId,
        status: "paid",
        totalCents: 2000,
        feeCents: 60,
        payoutCents: 1940,
      }),
    );
    // Pending.
    await ctx.db.insert(
      "orders",
      orderFields({ eventId: eventId1, organizerId, status: "pending", totalCents: 500 }),
    );
    // Refunded.
    await ctx.db.insert(
      "orders",
      orderFields({ eventId: eventId2, organizerId, status: "refunded", totalCents: 750 }),
    );
    // Cancelled.
    await ctx.db.insert(
      "orders",
      orderFields({ eventId: eventId1, organizerId, status: "cancelled", totalCents: 300 }),
    );
  });

  // A different organizer's paid order must be excluded from the totals above.
  const asBob = await asOrganizer(t, "bob@example.com");
  const bobOrganizerId = await asBob.mutation(api.organizers.ensureOrganizer, {});
  const bobEventId = await asBob.mutation(api.events.createEvent, {
    title: "Bob's Show",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 5,
  });
  await t.run(async (ctx) => {
    await ctx.db.insert(
      "orders",
      orderFields({
        eventId: bobEventId,
        organizerId: bobOrganizerId,
        status: "paid",
        totalCents: 99_999,
        feeCents: 999,
        payoutCents: 98_000,
        paymentMethod: "cash",
      }),
    );
  });

  const earnings = await as.query(api.payments.getEarnings, {});

  expect(earnings.currency).toBe("USD");
  expect(earnings.paid).toEqual({
    count: 2,
    grossCents: 3000,
    feeCents: 90,
    netPayoutCents: 2910,
  });
  expect(earnings.pending).toEqual({ count: 1, amountCents: 500 });
  expect(earnings.refunded).toEqual({ count: 1, amountCents: 750 });
  expect(earnings.cancelled).toEqual({ count: 1 });
  expect(earnings.byMethod.card).toEqual({ count: 1, payoutCents: 970 });
  expect(earnings.byMethod.online).toEqual({ count: 1, payoutCents: 1940 });
  expect(earnings.byMethod.cash).toEqual({ count: 0, payoutCents: 0 });
});
