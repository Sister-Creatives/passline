// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

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

async function makeEvent(as: ReturnType<TestConvex<typeof schema>["withIdentity"]>, capacity = 100) {
  return as.mutation(api.events.createEvent, {
    title: "Ticketed Event",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity,
  });
}

test("create inserts a ticket type with sold=0, active, appended sortOrder", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  const first = await as.mutation(api.ticketTypes.create, {
    eventId,
    name: "Adult",
    kind: "paid",
    priceCents: 2500,
    capacity: 40,
  });
  const second = await as.mutation(api.ticketTypes.create, {
    eventId,
    name: "Child",
    kind: "free",
    priceCents: 0,
  });

  const rows = await t.run((ctx) =>
    ctx.db.query("ticketTypes").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  const adult = rows.find((r) => r._id === first)!;
  const child = rows.find((r) => r._id === second)!;
  expect(adult.sold).toBe(0);
  expect(adult.status).toBe("active");
  expect(adult.visibility).toBe("visible");
  expect(adult.sortOrder).toBe(0);
  expect(child.sortOrder).toBe(1);
});

test("create rejects a free ticket with a nonzero price", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await expect(
    as.mutation(api.ticketTypes.create, { eventId, name: "Bad", kind: "free", priceCents: 500 }),
  ).rejects.toThrow();
});

test("create rejects a per-type capacity above the event capacity", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as, 50);
  await expect(
    as.mutation(api.ticketTypes.create, { eventId, name: "Too big", kind: "paid", priceCents: 100, capacity: 51 }),
  ).rejects.toThrow();
});

test("create rejects an empty name and a negative price", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await expect(
    as.mutation(api.ticketTypes.create, { eventId, name: "   ", kind: "paid", priceCents: 100 }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.ticketTypes.create, { eventId, name: "Neg", kind: "paid", priceCents: -1 }),
  ).rejects.toThrow();
});

test("create rejects a second organizer and unauthenticated callers", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  await expect(
    asBob.mutation(api.ticketTypes.create, { eventId, name: "Hijack", kind: "paid", priceCents: 100 }),
  ).rejects.toThrow();
  await expect(
    t.mutation(api.ticketTypes.create, { eventId, name: "Anon", kind: "paid", priceCents: 100 }),
  ).rejects.toThrow();
});

test("create rejects a fractional price and a fractional capacity", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await expect(
    as.mutation(api.ticketTypes.create, { eventId, name: "Frac price", kind: "paid", priceCents: 10.5 }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.ticketTypes.create, { eventId, name: "Frac cap", kind: "paid", priceCents: 100, capacity: 5.5 }),
  ).rejects.toThrow();
});

test("listForEvent returns the owner's ticket types sorted by sortOrder", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await as.mutation(api.ticketTypes.create, { eventId, name: "A", kind: "paid", priceCents: 100 });
  await as.mutation(api.ticketTypes.create, { eventId, name: "B", kind: "paid", priceCents: 200 });
  const list = await as.query(api.ticketTypes.listForEvent, { eventId });
  expect(list.map((t) => t.name)).toEqual(["A", "B"]);
});

test("listForEvent rejects a non-owner", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  await expect(asBob.query(api.ticketTypes.listForEvent, { eventId })).rejects.toThrow();
});
