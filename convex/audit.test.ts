// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");

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

async function makeEvent(as: ReturnType<TestConvex<typeof schema>["withIdentity"]>) {
  return as.mutation(api.events.createEvent, {
    title: "Ticketed Event",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 100,
  });
}

// --- listForEvent -----------------------------------------------------

test("listForEvent returns the event's audit rows newest first", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  await t.run(async (ctx) => {
    await ctx.db.insert("auditLogs", {
      organizerId,
      eventId,
      action: "event.updated",
      summary: "Updated event details",
      createdAt: 100,
    });
    await ctx.db.insert("auditLogs", {
      organizerId,
      eventId,
      action: "event.published",
      summary: "Published event",
      createdAt: 300,
    });
    await ctx.db.insert("auditLogs", {
      organizerId,
      eventId,
      action: "ticket_type.created",
      summary: 'Created ticket type "Adult"',
      createdAt: 200,
    });
  });

  const rows = await as.query(api.audit.listForEvent, { eventId });
  expect(rows.map((r) => r.action)).toEqual([
    "event.published",
    "ticket_type.created",
    "event.updated",
  ]);
});

test("listForEvent only returns rows for the requested event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId1 = await makeEvent(as);
  const eventId2 = await makeEvent(as);

  await t.run(async (ctx) => {
    await ctx.db.insert("auditLogs", {
      organizerId,
      eventId: eventId1,
      action: "event.updated",
      summary: "Updated event 1",
      createdAt: 100,
    });
    await ctx.db.insert("auditLogs", {
      organizerId,
      eventId: eventId2,
      action: "event.updated",
      summary: "Updated event 2",
      createdAt: 200,
    });
  });

  const rows = await as.query(api.audit.listForEvent, { eventId: eventId1 });
  expect(rows).toHaveLength(1);
  expect(rows[0].summary).toBe("Updated event 1");
});

test("listForEvent rejects a non-owner and an unauthenticated caller", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);

  await expect(asBob.query(api.audit.listForEvent, { eventId })).rejects.toThrow();
  await expect(t.query(api.audit.listForEvent, { eventId })).rejects.toThrow();
});

// --- recordAudit hook points (F17.2) -----------------------------------

test("publishEvent appends exactly one event.published audit row", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  await as.mutation(api.events.publishEvent, { eventId });

  const rows = await as.query(api.audit.listForEvent, { eventId });
  expect(rows).toHaveLength(1);
  expect(rows[0].action).toBe("event.published");
  expect(rows[0].summary).toBeTruthy();
});

test("ticketTypes.create appends exactly one ticket_type.created audit row", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  await as.mutation(api.ticketTypes.create, {
    eventId,
    name: "Adult",
    kind: "free",
    priceCents: 0,
  });

  const rows = await as.query(api.audit.listForEvent, { eventId });
  expect(rows).toHaveLength(1);
  expect(rows[0].action).toBe("ticket_type.created");
  expect(rows[0].summary).toBeTruthy();
});

test("refundOrder appends exactly one order.refunded audit row", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Ticketed Event",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 100,
  });
  await as.mutation(api.events.publishEvent, { eventId });
  const ticketTypeId = await as.mutation(api.ticketTypes.create, {
    eventId,
    name: "General",
    kind: "paid",
    priceCents: 1000,
  });

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
  });
  await t.mutation(internal.orders.markOrderPaid, { orderId: result.orderId });

  // publishEvent + ticketTypes.create above already recorded their own rows;
  // isolate refundOrder's effect by counting before/after.
  const before = await as.query(api.audit.listForEvent, { eventId });

  await as.mutation(api.orders.refundOrder, { orderId: result.orderId });

  const after = await as.query(api.audit.listForEvent, { eventId });
  expect(after).toHaveLength(before.length + 1);
  const newRow = after.find((row) => !before.some((b) => b._id === row._id));
  expect(newRow?.action).toBe("order.refunded");
  expect(newRow?.summary).toBeTruthy();
});
