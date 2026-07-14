// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");

// Mirrors convex/eventSessions.test.ts: insert a real users row + session and
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

async function makeEvent(as: ReturnType<TestConvex<typeof schema>["withIdentity"]>, capacity = 500) {
  return as.mutation(api.events.createEvent, {
    title: "Seated Event",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity,
  });
}

async function makeTicketType(
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  eventId: Awaited<ReturnType<typeof makeEvent>>,
  name = "Adult",
) {
  return as.mutation(api.ticketTypes.create, {
    eventId,
    name,
    kind: "paid",
    priceCents: 2500,
  });
}

// --- generateSection -------------------------------------------------------

test("generateSection creates rows x seatsPerRow available seats with expected labels/sortOrder", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const ticketTypeId = await makeTicketType(as, eventId);

  const count = await as.mutation(api.seats.generateSection, {
    eventId,
    ticketTypeId,
    section: "Orchestra",
    rows: 3,
    seatsPerRow: 4,
  });
  expect(count).toBe(12);

  const rows = await t.run((ctx) =>
    ctx.db.query("seats").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(rows).toHaveLength(12);
  expect(rows.every((r) => r.status === "available")).toBe(true);
  expect(rows.every((r) => r.ticketTypeId === ticketTypeId)).toBe(true);
  expect(rows.every((r) => r.section === "Orchestra")).toBe(true);

  const rowA = rows.filter((r) => r.row === "A").sort((a, b) => a.number - b.number);
  expect(rowA.map((r) => r.number)).toEqual([1, 2, 3, 4]);
  expect(rowA.map((r) => r.sortOrder)).toEqual([1, 2, 3, 4]);

  const rowB = rows.filter((r) => r.row === "B").sort((a, b) => a.number - b.number);
  expect(rowB.map((r) => r.sortOrder)).toEqual([1001, 1002, 1003, 1004]);

  const rowC = rows.filter((r) => r.row === "C");
  expect(rowC).toHaveLength(4);
  expect(new Set(rows.map((r) => r.row))).toEqual(new Set(["A", "B", "C"]));
});

test("generateSection rejects rows/seatsPerRow outside 1..100 (zero, negative, fractional, >100)", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const ticketTypeId = await makeTicketType(as, eventId);

  await expect(
    as.mutation(api.seats.generateSection, { eventId, ticketTypeId, section: "A", rows: 0, seatsPerRow: 4 }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.seats.generateSection, { eventId, ticketTypeId, section: "A", rows: -1, seatsPerRow: 4 }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.seats.generateSection, { eventId, ticketTypeId, section: "A", rows: 2.5, seatsPerRow: 4 }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.seats.generateSection, { eventId, ticketTypeId, section: "A", rows: 101, seatsPerRow: 4 }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.seats.generateSection, { eventId, ticketTypeId, section: "A", rows: 4, seatsPerRow: 0 }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.seats.generateSection, { eventId, ticketTypeId, section: "A", rows: 4, seatsPerRow: 101 }),
  ).rejects.toThrow();

  // Bounds are inclusive: 100 is valid.
  const count = await as.mutation(api.seats.generateSection, {
    eventId,
    ticketTypeId,
    section: "Big",
    rows: 1,
    seatsPerRow: 100,
  });
  expect(count).toBe(100);
});

test("generateSection rejects a duplicate section name for the event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const ticketTypeId = await makeTicketType(as, eventId);

  await as.mutation(api.seats.generateSection, {
    eventId,
    ticketTypeId,
    section: "Orchestra",
    rows: 2,
    seatsPerRow: 2,
  });
  await expect(
    as.mutation(api.seats.generateSection, {
      eventId,
      ticketTypeId,
      section: "Orchestra",
      rows: 1,
      seatsPerRow: 1,
    }),
  ).rejects.toThrow();

  // Only 4 seats exist -- the rejected call inserted nothing.
  const rows = await t.run((ctx) =>
    ctx.db.query("seats").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(rows).toHaveLength(4);
});

test("generateSection rejects a ticket type that doesn't belong to the event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const otherEventId = await makeEvent(as);
  const foreignTicketTypeId = await makeTicketType(as, otherEventId);

  await expect(
    as.mutation(api.seats.generateSection, {
      eventId,
      ticketTypeId: foreignTicketTypeId,
      section: "Orchestra",
      rows: 1,
      seatsPerRow: 1,
    }),
  ).rejects.toThrow();
});

test("generateSection rejects a non-owner and an unauthenticated caller", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  const ticketTypeId = await makeTicketType(asAda, eventId);

  await expect(
    asBob.mutation(api.seats.generateSection, {
      eventId,
      ticketTypeId,
      section: "Orchestra",
      rows: 1,
      seatsPerRow: 1,
    }),
  ).rejects.toThrow();
  await expect(
    t.mutation(api.seats.generateSection, {
      eventId,
      ticketTypeId,
      section: "Orchestra",
      rows: 1,
      seatsPerRow: 1,
    }),
  ).rejects.toThrow();
});

// --- list (organizer, all) --------------------------------------------------

test("list returns all seats for the event, owner-only", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  const ticketTypeId = await makeTicketType(asAda, eventId);
  await asAda.mutation(api.seats.generateSection, {
    eventId,
    ticketTypeId,
    section: "Orchestra",
    rows: 2,
    seatsPerRow: 3,
  });

  const rows = await asAda.query(api.seats.list, { eventId });
  expect(rows).toHaveLength(6);
  expect(rows.every((r) => r.status === "available")).toBe(true);

  await expect(asBob.query(api.seats.list, { eventId })).rejects.toThrow();
});

// --- listForEvent (public) --------------------------------------------------

test("listForEvent returns nothing for an unpublished event, and sorted seats after publish", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const ticketTypeId = await makeTicketType(as, eventId);
  await as.mutation(api.seats.generateSection, {
    eventId,
    ticketTypeId,
    section: "Balcony",
    rows: 2,
    seatsPerRow: 2,
  });

  const beforePublish = await t.query(api.seats.listForEvent, { eventId });
  expect(beforePublish).toEqual([]);

  await as.mutation(api.events.publishEvent, { eventId });
  const list = await t.query(api.seats.listForEvent, { eventId });
  expect(list).toHaveLength(4);
  // Public shape: id/ticketTypeId/section/row/number/status only.
  for (const seat of list) {
    expect(Object.keys(seat).sort()).toEqual(
      ["id", "ticketTypeId", "number", "row", "section", "status"].sort(),
    );
  }
  // Sorted: row A before row B, seat 1 before seat 2 within a row.
  expect(list.map((s: any) => `${s.row}${s.number}`)).toEqual(["A1", "A2", "B1", "B2"]);
});

test("listForEvent returns an empty array for a nonexistent event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await t.run((ctx) => ctx.db.delete(eventId));
  const list = await t.query(api.seats.listForEvent, { eventId });
  expect(list).toEqual([]);
});

// --- removeSection -----------------------------------------------------------

test("removeSection deletes every seat in the section", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const ticketTypeId = await makeTicketType(as, eventId);
  await as.mutation(api.seats.generateSection, {
    eventId,
    ticketTypeId,
    section: "Orchestra",
    rows: 2,
    seatsPerRow: 2,
  });
  await as.mutation(api.seats.generateSection, {
    eventId,
    ticketTypeId,
    section: "Balcony",
    rows: 1,
    seatsPerRow: 2,
  });

  await as.mutation(api.seats.removeSection, { eventId, section: "Orchestra" });

  const rows = await t.run((ctx) =>
    ctx.db.query("seats").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.section === "Balcony")).toBe(true);
});

test("removeSection rejects a section with a sold seat", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const ticketTypeId = await makeTicketType(as, eventId);
  await as.mutation(api.seats.generateSection, {
    eventId,
    ticketTypeId,
    section: "Orchestra",
    rows: 1,
    seatsPerRow: 2,
  });
  const [seat] = await t.run((ctx) =>
    ctx.db.query("seats").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  await t.run((ctx) => ctx.db.patch(seat._id, { status: "sold" }));

  await expect(as.mutation(api.seats.removeSection, { eventId, section: "Orchestra" })).rejects.toThrow();

  const rows = await t.run((ctx) =>
    ctx.db.query("seats").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(rows).toHaveLength(2); // nothing was deleted
});

test("removeSection rejects a non-owner", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  const ticketTypeId = await makeTicketType(asAda, eventId);
  await asAda.mutation(api.seats.generateSection, {
    eventId,
    ticketTypeId,
    section: "Orchestra",
    rows: 1,
    seatsPerRow: 2,
  });

  await expect(asBob.mutation(api.seats.removeSection, { eventId, section: "Orchestra" })).rejects.toThrow();
});
