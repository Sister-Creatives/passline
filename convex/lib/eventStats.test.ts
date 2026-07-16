// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { recomputeEventStats } from "./eventStats";

const modules = import.meta.glob("../**/*.*s");

async function asOrganizer(t: TestConvex<typeof schema>, email: string) {
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, name: email });
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 1000 * 60 * 60,
    });
    return { userId, sessionId };
  });
  return { as: t.withIdentity({ subject: `${userId}|${sessionId}` }) };
}

test("recomputeEventStats writes seatsTaken/ticketsSold/revenueCents from children", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Mixer", description: "x", startsAt: 100, endsAt: 200, location: "Hall", capacity: 50,
  });
  const organizerId = (await t.run((ctx) => ctx.db.get(eventId)))!.organizerId;

  await t.run(async (ctx) => {
    // 2 seat-holding rsvps + 1 waitlisted (not counted).
    await ctx.db.insert("rsvps", { eventId, name: "A", email: "a@x.co", token: "t1", status: "confirmed" });
    await ctx.db.insert("rsvps", { eventId, name: "B", email: "b@x.co", token: "t2", status: "checked_in" });
    await ctx.db.insert("rsvps", { eventId, name: "C", email: "c@x.co", token: "t3", status: "waitlisted", waitlistPosition: 1 });
    // 1 paid order (payout 2000) with 1 valid ticket; 1 pending order (excluded).
    const ttId = await ctx.db.insert("ticketTypes", {
      eventId, name: "GA", kind: "paid", priceCents: 2000, sold: 0, visibility: "visible", sortOrder: 0, status: "active",
    });
    const base = { eventId, organizerId, buyerName: "Bo", buyerEmail: "bo@x.co", currency: "USD",
      feeMode: "absorb" as const, subtotalCents: 2000, feeCents: 0, totalCents: 2000, createdAt: Date.now() };
    const paid = await ctx.db.insert("orders", { ...base, status: "paid", payoutCents: 2000, token: "o1", paidAt: Date.now() });
    await ctx.db.insert("orders", { ...base, status: "pending", payoutCents: 2000, token: "o2" });
    await ctx.db.insert("tickets", { orderId: paid, eventId, ticketTypeId: ttId, code: "TK1", status: "valid", createdAt: Date.now() });
    await recomputeEventStats(ctx, eventId);
  });

  const ev = await t.run((ctx) => ctx.db.get(eventId));
  expect(ev?.seatsTaken).toBe(2);
  expect(ev?.ticketsSold).toBe(1);
  expect(ev?.revenueCents).toBe(2000);
});

test("createEvent initialises the counters to 0", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Empty", description: "x", startsAt: 1, endsAt: 2, location: "x", capacity: 5,
  });
  const ev = await t.run((ctx) => ctx.db.get(eventId));
  expect(ev?.seatsTaken).toBe(0);
  expect(ev?.ticketsSold).toBe(0);
  expect(ev?.revenueCents).toBe(0);
});
