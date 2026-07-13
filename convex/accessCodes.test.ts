// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { unlockedTicketTypeIds } from "./accessCodes";

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

async function makeHiddenTicketType(
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  eventId: Awaited<ReturnType<typeof makeEvent>>,
  name = "VIP",
) {
  return as.mutation(api.ticketTypes.create, {
    eventId,
    name,
    kind: "paid",
    priceCents: 5000,
    visibility: "hidden",
  });
}

async function makeVisibleTicketType(
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  eventId: Awaited<ReturnType<typeof makeEvent>>,
  name = "General",
) {
  return as.mutation(api.ticketTypes.create, {
    eventId,
    name,
    kind: "paid",
    priceCents: 1000,
    visibility: "visible",
  });
}

// --- create ---------------------------------------------------------------

test("create inserts a code, uppercased/trimmed, unlocking the given hidden types, active=true", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const vipId = await makeHiddenTicketType(as, eventId, "VIP");
  const staffId = await makeHiddenTicketType(as, eventId, "Staff");

  const id = await as.mutation(api.accessCodes.create, {
    eventId,
    code: "  vip2026  ",
    ticketTypeIds: [vipId, staffId],
  });

  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row?.code).toBe("VIP2026");
  expect(row?.ticketTypeIds.sort()).toEqual([staffId, vipId].sort());
  expect(row?.active).toBe(true);
  expect(row?.eventId).toBe(eventId);
});

test("create rejects an empty/whitespace-only code", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const vipId = await makeHiddenTicketType(as, eventId);
  await expect(
    as.mutation(api.accessCodes.create, { eventId, code: "   ", ticketTypeIds: [vipId] }),
  ).rejects.toThrow();
});

test("create rejects a duplicate code for the same event (case-insensitive)", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const vipId = await makeHiddenTicketType(as, eventId);
  await as.mutation(api.accessCodes.create, { eventId, code: "VIP", ticketTypeIds: [vipId] });
  await expect(
    as.mutation(api.accessCodes.create, { eventId, code: "vip", ticketTypeIds: [vipId] }),
  ).rejects.toThrow();
});

test("create allows the same code across two different events", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId1 = await makeEvent(as);
  const eventId2 = await makeEvent(as);
  const vip1 = await makeHiddenTicketType(as, eventId1);
  const vip2 = await makeHiddenTicketType(as, eventId2);
  await as.mutation(api.accessCodes.create, { eventId: eventId1, code: "VIP", ticketTypeIds: [vip1] });
  await expect(
    as.mutation(api.accessCodes.create, { eventId: eventId2, code: "VIP", ticketTypeIds: [vip2] }),
  ).resolves.toBeDefined();
});

test("create rejects a ticketTypeId that belongs to a different event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId1 = await makeEvent(as);
  const eventId2 = await makeEvent(as);
  const foreignHiddenId = await makeHiddenTicketType(as, eventId2);
  await expect(
    as.mutation(api.accessCodes.create, {
      eventId: eventId1,
      code: "VIP",
      ticketTypeIds: [foreignHiddenId],
    }),
  ).rejects.toThrow();
});

test("create rejects a visible ticket type id", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const visibleId = await makeVisibleTicketType(as, eventId);
  await expect(
    as.mutation(api.accessCodes.create, { eventId, code: "VIP", ticketTypeIds: [visibleId] }),
  ).rejects.toThrow();
});

test("create rejects a nonexistent ticket type id", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const vipId = await makeHiddenTicketType(as, eventId);
  await as.mutation(api.ticketTypes.remove, { ticketTypeId: vipId });
  await expect(
    as.mutation(api.accessCodes.create, { eventId, code: "VIP", ticketTypeIds: [vipId] }),
  ).rejects.toThrow();
});

test("create rejects a non-owner and an unauthenticated caller", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  const vipId = await makeHiddenTicketType(asAda, eventId);
  await expect(
    asBob.mutation(api.accessCodes.create, { eventId, code: "HIJACK", ticketTypeIds: [vipId] }),
  ).rejects.toThrow();
  await expect(
    t.mutation(api.accessCodes.create, { eventId, code: "ANON", ticketTypeIds: [vipId] }),
  ).rejects.toThrow();
});

// --- list -------------------------------------------------------------

test("list returns the owner's access codes for the event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const vipId = await makeHiddenTicketType(as, eventId, "VIP");
  const staffId = await makeHiddenTicketType(as, eventId, "Staff");
  await as.mutation(api.accessCodes.create, { eventId, code: "A", ticketTypeIds: [vipId] });
  await as.mutation(api.accessCodes.create, { eventId, code: "B", ticketTypeIds: [staffId] });

  const list = await as.query(api.accessCodes.list, { eventId });
  expect(list.map((c) => c.code).sort()).toEqual(["A", "B"]);
});

test("list rejects a non-owner", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  await expect(asBob.query(api.accessCodes.list, { eventId })).rejects.toThrow();
});

// --- remove -------------------------------------------------------------

test("remove deletes the access code (owner-only)", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  const vipId = await makeHiddenTicketType(asAda, eventId);
  const id = await asAda.mutation(api.accessCodes.create, {
    eventId,
    code: "REMOVEME",
    ticketTypeIds: [vipId],
  });

  await expect(asBob.mutation(api.accessCodes.remove, { accessCodeId: id })).rejects.toThrow();
  await asAda.mutation(api.accessCodes.remove, { accessCodeId: id });
  const gone = await t.run((ctx) => ctx.db.get(id));
  expect(gone).toBeNull();
});

// --- resolveAccessCode ----------------------------------------------------

test("resolveAccessCode returns the unlocked hidden types for an active code on a published event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const vipId = await makeHiddenTicketType(as, eventId, "VIP");
  await as.mutation(api.accessCodes.create, { eventId, code: "VIP2026", ticketTypeIds: [vipId] });
  await as.mutation(api.events.publishEvent, { eventId });

  const result = await t.query(api.accessCodes.resolveAccessCode, { eventId, code: "vip2026" });
  expect(result.ticketTypes).toHaveLength(1);
  expect(result.ticketTypes[0]).toMatchObject({
    id: vipId,
    name: "VIP",
    priceCents: 5000,
    kind: "paid",
    currency: "USD",
  });
});

test("resolveAccessCode returns [] for a missing code", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await as.mutation(api.events.publishEvent, { eventId });

  const result = await t.query(api.accessCodes.resolveAccessCode, { eventId, code: "NOPE" });
  expect(result.ticketTypes).toEqual([]);
});

test("resolveAccessCode returns [] for an inactive code", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const vipId = await makeHiddenTicketType(as, eventId);
  const id = await as.mutation(api.accessCodes.create, { eventId, code: "VIP", ticketTypeIds: [vipId] });
  await as.mutation(api.events.publishEvent, { eventId });
  await t.run((ctx) => ctx.db.patch(id, { active: false }));

  const result = await t.query(api.accessCodes.resolveAccessCode, { eventId, code: "VIP" });
  expect(result.ticketTypes).toEqual([]);
});

test("resolveAccessCode returns [] for an unpublished event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const vipId = await makeHiddenTicketType(as, eventId);
  await as.mutation(api.accessCodes.create, { eventId, code: "VIP", ticketTypeIds: [vipId] });
  // Event left in "draft" status (never published).

  const result = await t.query(api.accessCodes.resolveAccessCode, { eventId, code: "VIP" });
  expect(result.ticketTypes).toEqual([]);
});

test("resolveAccessCode returns [] for a code from a different event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId1 = await makeEvent(as);
  const eventId2 = await makeEvent(as);
  const vipId = await makeHiddenTicketType(as, eventId1);
  await as.mutation(api.accessCodes.create, { eventId: eventId1, code: "ONLYONE", ticketTypeIds: [vipId] });
  await as.mutation(api.events.publishEvent, { eventId: eventId2 });

  const result = await t.query(api.accessCodes.resolveAccessCode, { eventId: eventId2, code: "ONLYONE" });
  expect(result.ticketTypes).toEqual([]);
});

// --- unlockedTicketTypeIds -------------------------------------------------

test("unlockedTicketTypeIds returns the set of hidden type ids for a valid active code", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const vipId = await makeHiddenTicketType(as, eventId, "VIP");
  const staffId = await makeHiddenTicketType(as, eventId, "Staff");
  await as.mutation(api.accessCodes.create, { eventId, code: "BOTH", ticketTypeIds: [vipId, staffId] });

  // `t.run`'s return value round-trips through Convex's JSON encoding (which
  // has no `Set` type), so convert to an array inside the callback.
  const result = await t.run(async (ctx) => Array.from(await unlockedTicketTypeIds(ctx, eventId, "both")));
  expect(new Set(result)).toEqual(new Set([vipId, staffId]));
});

test("unlockedTicketTypeIds returns an empty set for a missing code", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  const result = await t.run(async (ctx) => Array.from(await unlockedTicketTypeIds(ctx, eventId, "NOPE")));
  expect(result).toHaveLength(0);
});

test("unlockedTicketTypeIds returns an empty set for an inactive code", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const vipId = await makeHiddenTicketType(as, eventId);
  const id = await as.mutation(api.accessCodes.create, { eventId, code: "VIP", ticketTypeIds: [vipId] });
  await t.run((ctx) => ctx.db.patch(id, { active: false }));

  const result = await t.run(async (ctx) => Array.from(await unlockedTicketTypeIds(ctx, eventId, "VIP")));
  expect(result).toHaveLength(0);
});
