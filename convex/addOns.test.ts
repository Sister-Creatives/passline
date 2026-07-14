// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");

// Mirrors convex/ticketTypes.test.ts: insert a real users row + session and
// hand withIdentity a matching subject so getAuthUserId resolves.
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

// --- create -----------------------------------------------------------

test("create inserts an add-on with sold=0, active=true, appended sortOrder", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  const first = await as.mutation(api.addOns.create, {
    eventId,
    name: "T-shirt",
    priceCents: 2000,
    capacity: 50,
  });
  const second = await as.mutation(api.addOns.create, {
    eventId,
    name: "Parking pass",
    priceCents: 1000,
  });

  const rows = await t.run((ctx) =>
    ctx.db.query("addOns").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  const shirt = rows.find((r) => r._id === first)!;
  const parking = rows.find((r) => r._id === second)!;
  expect(shirt.sold).toBe(0);
  expect(shirt.active).toBe(true);
  expect(shirt.sortOrder).toBe(0);
  expect(shirt.capacity).toBe(50);
  expect(parking.sortOrder).toBe(1);
  expect(parking.capacity).toBeUndefined();
});

test("create trims the name", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const id = await as.mutation(api.addOns.create, { eventId, name: "  T-shirt  ", priceCents: 2000 });
  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row?.name).toBe("T-shirt");
});

test("create rejects an empty/whitespace-only name", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await expect(
    as.mutation(api.addOns.create, { eventId, name: "   ", priceCents: 2000 }),
  ).rejects.toThrow();
});

test("create rejects priceCents that is zero, negative, or fractional", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await expect(
    as.mutation(api.addOns.create, { eventId, name: "Zero", priceCents: 0 }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.addOns.create, { eventId, name: "Neg", priceCents: -100 }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.addOns.create, { eventId, name: "Frac", priceCents: 10.5 }),
  ).rejects.toThrow();
});

test("create rejects a capacity that is zero, negative, or fractional", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await expect(
    as.mutation(api.addOns.create, { eventId, name: "Bad cap", priceCents: 100, capacity: 0 }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.addOns.create, { eventId, name: "Bad cap", priceCents: 100, capacity: -5 }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.addOns.create, { eventId, name: "Bad cap", priceCents: 100, capacity: 2.5 }),
  ).rejects.toThrow();
});

test("create rejects a non-owner and an unauthenticated caller", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  await expect(
    asBob.mutation(api.addOns.create, { eventId, name: "Hijack", priceCents: 100 }),
  ).rejects.toThrow();
  await expect(
    t.mutation(api.addOns.create, { eventId, name: "Anon", priceCents: 100 }),
  ).rejects.toThrow();
});

// --- list (owner-only, all) --------------------------------------------

test("list returns the owner's add-ons sorted by sortOrder", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await as.mutation(api.addOns.create, { eventId, name: "A", priceCents: 100 });
  await as.mutation(api.addOns.create, { eventId, name: "B", priceCents: 200 });
  const list = await as.query(api.addOns.list, { eventId });
  expect(list.map((a) => a.name)).toEqual(["A", "B"]);
});

test("list rejects a non-owner", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  await expect(asBob.query(api.addOns.list, { eventId })).rejects.toThrow();
});

// --- listForEvent (public) ----------------------------------------------

test("listForEvent returns only active add-ons of a published event, sorted", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const a = await as.mutation(api.addOns.create, { eventId, name: "A", priceCents: 100 });
  const b = await as.mutation(api.addOns.create, { eventId, name: "B", priceCents: 200 });
  const c = await as.mutation(api.addOns.create, { eventId, name: "C", priceCents: 300 });
  await t.run((ctx) => ctx.db.patch(c, { active: false }));

  // Not yet published: no add-ons are visible, even though A/B are active.
  const beforePublish = await t.query(api.addOns.listForEvent, { eventId });
  expect(beforePublish).toEqual([]);

  await as.mutation(api.events.publishEvent, { eventId });
  await as.mutation(api.addOns.reorder, { eventId, orderedIds: [b, a, c] });

  const list = await t.query(api.addOns.listForEvent, { eventId });
  expect(list.map((a) => a.name)).toEqual(["B", "A"]);
  expect(list.every((a) => a.active)).toBe(true);
});

test("listForEvent returns an empty array for a nonexistent event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await t.run((ctx) => ctx.db.delete(eventId));
  const list = await t.query(api.addOns.listForEvent, { eventId });
  expect(list).toEqual([]);
});

// --- remove --------------------------------------------------------------

test("remove deletes the add-on; non-owner is rejected", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  const id = await asAda.mutation(api.addOns.create, { eventId, name: "A", priceCents: 100 });
  await expect(asBob.mutation(api.addOns.remove, { addOnId: id })).rejects.toThrow();
  await asAda.mutation(api.addOns.remove, { addOnId: id });
  const gone = await t.run((ctx) => ctx.db.get(id));
  expect(gone).toBeNull();
});

// --- reorder ---------------------------------------------------------------

test("reorder rewrites sortOrder to the given order", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const a = await as.mutation(api.addOns.create, { eventId, name: "A", priceCents: 100 });
  const b = await as.mutation(api.addOns.create, { eventId, name: "B", priceCents: 200 });
  await as.mutation(api.addOns.reorder, { eventId, orderedIds: [b, a] });
  const list = await as.query(api.addOns.list, { eventId });
  expect(list.map((x) => x.name)).toEqual(["B", "A"]);
});

test("reorder rejects a non-permutation (wrong length)", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const a = await as.mutation(api.addOns.create, { eventId, name: "A", priceCents: 100 });
  await as.mutation(api.addOns.create, { eventId, name: "B", priceCents: 200 });
  await expect(as.mutation(api.addOns.reorder, { eventId, orderedIds: [a] })).rejects.toThrow();
});

test("reorder rejects duplicate ids", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const a = await as.mutation(api.addOns.create, { eventId, name: "A", priceCents: 100 });
  await as.mutation(api.addOns.create, { eventId, name: "B", priceCents: 200 });
  await expect(as.mutation(api.addOns.reorder, { eventId, orderedIds: [a, a] })).rejects.toThrow();
});

test("reorder rejects an id that doesn't belong to the event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const otherEventId = await makeEvent(as);
  const a = await as.mutation(api.addOns.create, { eventId, name: "A", priceCents: 100 });
  const foreign = await as.mutation(api.addOns.create, { eventId: otherEventId, name: "X", priceCents: 100 });
  await expect(
    as.mutation(api.addOns.reorder, { eventId, orderedIds: [a, foreign] }),
  ).rejects.toThrow();
});

test("reorder rejects a non-owner", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  const a = await asAda.mutation(api.addOns.create, { eventId, name: "A", priceCents: 100 });
  await asAda.mutation(api.addOns.create, { eventId, name: "B", priceCents: 200 });
  await expect(
    asBob.mutation(api.addOns.reorder, { eventId, orderedIds: [a] }),
  ).rejects.toThrow();
});
