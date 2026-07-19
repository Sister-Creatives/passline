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

test("create inserts a session with sold=0, appended sortOrder", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  const first = await as.mutation(api.eventSessions.create, {
    eventId,
    startsAt: 1000,
    endsAt: 2000,
    capacity: 40,
    label: "Matinee",
  });
  const second = await as.mutation(api.eventSessions.create, {
    eventId,
    startsAt: 3000,
    endsAt: 4000,
    capacity: 20,
  });

  const rows = await t.run((ctx) =>
    ctx.db.query("eventSessions").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  const matinee = rows.find((r) => r._id === first)!;
  const evening = rows.find((r) => r._id === second)!;
  expect(matinee.sold).toBe(0);
  expect(matinee.sortOrder).toBe(0);
  expect(matinee.label).toBe("Matinee");
  expect(evening.sortOrder).toBe(1);
  expect(evening.label).toBeUndefined();
});

test("create rejects endsAt <= startsAt", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await expect(
    as.mutation(api.eventSessions.create, { eventId, startsAt: 2000, endsAt: 2000, capacity: 10 }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.eventSessions.create, { eventId, startsAt: 2000, endsAt: 1000, capacity: 10 }),
  ).rejects.toThrow();
});

test("create rejects a capacity that is zero, negative, or fractional", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await expect(
    as.mutation(api.eventSessions.create, { eventId, startsAt: 1, endsAt: 2, capacity: 0 }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.eventSessions.create, { eventId, startsAt: 1, endsAt: 2, capacity: -5 }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.eventSessions.create, { eventId, startsAt: 1, endsAt: 2, capacity: 2.5 }),
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
    asBob.mutation(api.eventSessions.create, { eventId, startsAt: 1, endsAt: 2, capacity: 10 }),
  ).rejects.toThrow();
  await expect(
    t.mutation(api.eventSessions.create, { eventId, startsAt: 1, endsAt: 2, capacity: 10 }),
  ).rejects.toThrow();
});

// --- createRecurring -------------------------------------------------------

test("createRecurring inserts N sessions with sold=0, given capacity, sortOrder continuing from existing", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  // One session already exists (sortOrder 0).
  await as.mutation(api.eventSessions.create, {
    eventId, startsAt: 100, endsAt: 200, capacity: 10,
  });

  const result = await as.mutation(api.eventSessions.createRecurring, {
    eventId,
    sessions: [
      { startsAt: 1000, endsAt: 2000 },
      { startsAt: 3000, endsAt: 4000 },
      { startsAt: 5000, endsAt: 6000 },
    ],
    capacity: 30,
    label: "Weekly class",
  });
  expect(result).toEqual({ created: 3 });

  const rows = await t.run((ctx) =>
    ctx.db.query("eventSessions").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(rows).toHaveLength(4);
  const recurring = rows.filter((r) => r.startsAt >= 1000);
  expect(recurring).toHaveLength(3);
  for (const row of recurring) {
    expect(row.sold).toBe(0);
    expect(row.capacity).toBe(30);
    expect(row.label).toBe("Weekly class");
  }
  const sortOrders = recurring.map((r) => r.sortOrder).sort((a, b) => a - b);
  expect(sortOrders).toEqual([1, 2, 3]);
  const allSortOrders = rows.map((r) => r.sortOrder).sort((a, b) => a - b);
  expect(new Set(allSortOrders).size).toBe(4); // no collisions
});

test("createRecurring rejects an empty sessions array", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await expect(
    as.mutation(api.eventSessions.createRecurring, { eventId, sessions: [], capacity: 10 }),
  ).rejects.toThrow(/at least one date/i);
});

test("createRecurring rejects more than 100 sessions", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const sessions = Array.from({ length: 101 }, (_, i) => ({
    startsAt: 1000 + i * 10,
    endsAt: 2000 + i * 10,
  }));
  await expect(
    as.mutation(api.eventSessions.createRecurring, { eventId, sessions, capacity: 10 }),
  ).rejects.toThrow(/max 100/i);
});

test("createRecurring rejects a batch with a bad window and creates none", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await expect(
    as.mutation(api.eventSessions.createRecurring, {
      eventId,
      sessions: [
        { startsAt: 1000, endsAt: 2000 },
        { startsAt: 3000, endsAt: 3000 }, // endsAt <= startsAt
      ],
      capacity: 10,
    }),
  ).rejects.toThrow();
  const rows = await t.run((ctx) =>
    ctx.db.query("eventSessions").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(rows).toHaveLength(0);
});

test("createRecurring rejects a non-owner", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  await expect(
    asBob.mutation(api.eventSessions.createRecurring, {
      eventId,
      sessions: [{ startsAt: 1000, endsAt: 2000 }],
      capacity: 10,
    }),
  ).rejects.toThrow();
});

// --- list (owner-only, all) --------------------------------------------

test("list returns the owner's sessions sorted by sortOrder", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await as.mutation(api.eventSessions.create, { eventId, startsAt: 1, endsAt: 2, capacity: 10, label: "A" });
  await as.mutation(api.eventSessions.create, { eventId, startsAt: 3, endsAt: 4, capacity: 10, label: "B" });
  const list = await as.query(api.eventSessions.list, { eventId });
  expect(list.map((s) => s.label)).toEqual(["A", "B"]);
});

test("list rejects a non-owner", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  await expect(asBob.query(api.eventSessions.list, { eventId })).rejects.toThrow();
});

// --- listForEvent (public) ----------------------------------------------

test("listForEvent returns sessions of a published event sorted by startsAt with remaining", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  // Insert out of chronological order to prove sort-by-startsAt (not sortOrder/creation order).
  const later = await as.mutation(api.eventSessions.create, {
    eventId,
    startsAt: 5000,
    endsAt: 6000,
    capacity: 30,
    label: "Evening",
  });
  const earlier = await as.mutation(api.eventSessions.create, {
    eventId,
    startsAt: 1000,
    endsAt: 2000,
    capacity: 10,
    label: "Matinee",
  });

  // Not yet published: no sessions are visible.
  const beforePublish = await t.query(api.eventSessions.listForEvent, { eventId });
  expect(beforePublish).toEqual([]);

  await as.mutation(api.events.publishEvent, { eventId });
  await t.run((ctx) => ctx.db.patch(earlier, { sold: 4 }));

  const list = await t.query(api.eventSessions.listForEvent, { eventId });
  expect(list.map((s) => s._id)).toEqual([earlier, later]);
  const earlierRow = list.find((s) => s._id === earlier)!;
  const laterRow = list.find((s) => s._id === later)!;
  expect(earlierRow.remaining).toBe(6); // 10 - 4
  expect(laterRow.remaining).toBe(30); // 30 - 0
});

test("listForEvent returns an empty array for a nonexistent event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await t.run((ctx) => ctx.db.delete(eventId));
  const list = await t.query(api.eventSessions.listForEvent, { eventId });
  expect(list).toEqual([]);
});

// --- update --------------------------------------------------------------

test("update changes fields", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const id = await as.mutation(api.eventSessions.create, {
    eventId, startsAt: 1000, endsAt: 2000, capacity: 10, label: "A",
  });
  await as.mutation(api.eventSessions.update, {
    sessionId: id, startsAt: 1500, endsAt: 2500, capacity: 25, label: "A2",
  });
  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row?.startsAt).toBe(1500);
  expect(row?.endsAt).toBe(2500);
  expect(row?.capacity).toBe(25);
  expect(row?.label).toBe("A2");
});

test("update rejects capacity dropping below sold", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const id = await as.mutation(api.eventSessions.create, {
    eventId, startsAt: 1000, endsAt: 2000, capacity: 10,
  });
  await t.run((ctx) => ctx.db.patch(id, { sold: 8 }));
  await expect(
    as.mutation(api.eventSessions.update, { sessionId: id, startsAt: 1000, endsAt: 2000, capacity: 7 }),
  ).rejects.toThrow();
  // Exactly at sold is fine.
  await as.mutation(api.eventSessions.update, { sessionId: id, startsAt: 1000, endsAt: 2000, capacity: 8 });
  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row?.capacity).toBe(8);
});

test("update rejects endsAt <= startsAt and a non-owner", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  const id = await asAda.mutation(api.eventSessions.create, {
    eventId, startsAt: 1000, endsAt: 2000, capacity: 10,
  });
  await expect(
    asAda.mutation(api.eventSessions.update, { sessionId: id, startsAt: 2000, endsAt: 1000, capacity: 10 }),
  ).rejects.toThrow();
  await expect(
    asBob.mutation(api.eventSessions.update, { sessionId: id, startsAt: 1000, endsAt: 2000, capacity: 10 }),
  ).rejects.toThrow();
});

// --- remove --------------------------------------------------------------

test("remove deletes a session with sold=0; non-owner is rejected", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  const id = await asAda.mutation(api.eventSessions.create, {
    eventId, startsAt: 1000, endsAt: 2000, capacity: 10,
  });
  await expect(asBob.mutation(api.eventSessions.remove, { sessionId: id })).rejects.toThrow();
  await asAda.mutation(api.eventSessions.remove, { sessionId: id });
  const gone = await t.run((ctx) => ctx.db.get(id));
  expect(gone).toBeNull();
});

test("remove rejects a session with sold > 0", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const id = await as.mutation(api.eventSessions.create, {
    eventId, startsAt: 1000, endsAt: 2000, capacity: 10,
  });
  await t.run((ctx) => ctx.db.patch(id, { sold: 1 }));
  await expect(as.mutation(api.eventSessions.remove, { sessionId: id })).rejects.toThrow();
  const stillThere = await t.run((ctx) => ctx.db.get(id));
  expect(stillThere).not.toBeNull();
});

// --- reorder ---------------------------------------------------------------

test("reorder rewrites sortOrder to the given order", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const a = await as.mutation(api.eventSessions.create, { eventId, startsAt: 1, endsAt: 2, capacity: 10, label: "A" });
  const b = await as.mutation(api.eventSessions.create, { eventId, startsAt: 3, endsAt: 4, capacity: 10, label: "B" });
  await as.mutation(api.eventSessions.reorder, { eventId, orderedIds: [b, a] });
  const list = await as.query(api.eventSessions.list, { eventId });
  expect(list.map((s) => s.label)).toEqual(["B", "A"]);
});

test("reorder rejects a non-permutation (wrong length)", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const a = await as.mutation(api.eventSessions.create, { eventId, startsAt: 1, endsAt: 2, capacity: 10 });
  await as.mutation(api.eventSessions.create, { eventId, startsAt: 3, endsAt: 4, capacity: 10 });
  await expect(as.mutation(api.eventSessions.reorder, { eventId, orderedIds: [a] })).rejects.toThrow();
});

test("reorder rejects duplicate ids", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const a = await as.mutation(api.eventSessions.create, { eventId, startsAt: 1, endsAt: 2, capacity: 10 });
  await as.mutation(api.eventSessions.create, { eventId, startsAt: 3, endsAt: 4, capacity: 10 });
  await expect(as.mutation(api.eventSessions.reorder, { eventId, orderedIds: [a, a] })).rejects.toThrow();
});

test("reorder rejects an id that doesn't belong to the event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const otherEventId = await makeEvent(as);
  const a = await as.mutation(api.eventSessions.create, { eventId, startsAt: 1, endsAt: 2, capacity: 10 });
  const foreign = await as.mutation(api.eventSessions.create, { eventId: otherEventId, startsAt: 1, endsAt: 2, capacity: 10 });
  await expect(
    as.mutation(api.eventSessions.reorder, { eventId, orderedIds: [a, foreign] }),
  ).rejects.toThrow();
});

test("reorder rejects a non-owner", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  const a = await asAda.mutation(api.eventSessions.create, { eventId, startsAt: 1, endsAt: 2, capacity: 10 });
  await asAda.mutation(api.eventSessions.create, { eventId, startsAt: 3, endsAt: 4, capacity: 10 });
  await expect(
    asBob.mutation(api.eventSessions.reorder, { eventId, orderedIds: [a] }),
  ).rejects.toThrow();
});
