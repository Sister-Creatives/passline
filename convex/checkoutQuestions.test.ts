// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { validateAndSnapshotAnswers } from "./checkoutQuestions";

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

test("create inserts a text question, appended sortOrder, active=true", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  const first = await as.mutation(api.checkoutQuestions.create, {
    eventId,
    label: "Dietary needs",
    kind: "text",
    required: false,
  });
  const second = await as.mutation(api.checkoutQuestions.create, {
    eventId,
    label: "Company name",
    kind: "text",
    required: true,
  });

  const rows = await t.run((ctx) =>
    ctx.db.query("checkoutQuestions").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  const q1 = rows.find((r) => r._id === first)!;
  const q2 = rows.find((r) => r._id === second)!;
  expect(q1.active).toBe(true);
  expect(q1.sortOrder).toBe(0);
  expect(q1.required).toBe(false);
  expect(q2.sortOrder).toBe(1);
  expect(q2.required).toBe(true);
});

test("create trims the label and stores trimmed select options", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  const id = await as.mutation(api.checkoutQuestions.create, {
    eventId,
    label: "  T-shirt size  ",
    kind: "select",
    options: [" S ", "M", " L"],
    required: true,
  });
  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row?.label).toBe("T-shirt size");
  expect(row?.options).toEqual(["S", "M", "L"]);
});

test("create rejects an empty/whitespace-only label", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await expect(
    as.mutation(api.checkoutQuestions.create, { eventId, label: "   ", kind: "text", required: false }),
  ).rejects.toThrow();
});

test("create rejects a select question with no options, and with a blank option", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await expect(
    as.mutation(api.checkoutQuestions.create, { eventId, label: "Size", kind: "select", required: false }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.checkoutQuestions.create, {
      eventId,
      label: "Size",
      kind: "select",
      options: [],
      required: false,
    }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.checkoutQuestions.create, {
      eventId,
      label: "Size",
      kind: "select",
      options: ["S", "   "],
      required: false,
    }),
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
    asBob.mutation(api.checkoutQuestions.create, { eventId, label: "Hijack", kind: "text", required: false }),
  ).rejects.toThrow();
  await expect(
    t.mutation(api.checkoutQuestions.create, { eventId, label: "Anon", kind: "text", required: false }),
  ).rejects.toThrow();
});

// --- list ---------------------------------------------------------------

test("list returns all of the owner's questions for the event, including inactive, sorted", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const a = await as.mutation(api.checkoutQuestions.create, { eventId, label: "A", kind: "text", required: false });
  await as.mutation(api.checkoutQuestions.create, { eventId, label: "B", kind: "text", required: false });
  await t.run((ctx) => ctx.db.patch(a, { active: false }));

  const list = await as.query(api.checkoutQuestions.list, { eventId });
  expect(list.map((q) => q.label)).toEqual(["A", "B"]);
  expect(list.find((q) => q.label === "A")?.active).toBe(false);
});

test("list rejects a non-owner", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  await expect(asBob.query(api.checkoutQuestions.list, { eventId })).rejects.toThrow();
});

// --- listForEvent (public) ----------------------------------------------

test("listForEvent returns only active questions of a published event, sorted", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const a = await as.mutation(api.checkoutQuestions.create, { eventId, label: "A", kind: "text", required: false });
  const b = await as.mutation(api.checkoutQuestions.create, { eventId, label: "B", kind: "text", required: false });
  const c = await as.mutation(api.checkoutQuestions.create, { eventId, label: "C", kind: "text", required: false });
  await t.run((ctx) => ctx.db.patch(c, { active: false }));

  // Not yet published: no questions are visible, even though A/B are active.
  const beforePublish = await t.query(api.checkoutQuestions.listForEvent, { eventId });
  expect(beforePublish).toEqual([]);

  await as.mutation(api.events.publishEvent, { eventId });
  await as.mutation(api.checkoutQuestions.reorder, { eventId, orderedIds: [b, a, c] });

  const list = await t.query(api.checkoutQuestions.listForEvent, { eventId });
  expect(list.map((q) => q.label)).toEqual(["B", "A"]);
  expect(list.every((q) => q.active)).toBe(true);
});

test("listForEvent returns an empty array for a nonexistent event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await t.run((ctx) => ctx.db.delete(eventId));
  const list = await t.query(api.checkoutQuestions.listForEvent, { eventId });
  expect(list).toEqual([]);
});

// --- remove ---------------------------------------------------------------

test("remove deletes the question (owner-only)", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  const id = await asAda.mutation(api.checkoutQuestions.create, {
    eventId,
    label: "Remove me",
    kind: "text",
    required: false,
  });

  await expect(asBob.mutation(api.checkoutQuestions.remove, { questionId: id })).rejects.toThrow();
  await asAda.mutation(api.checkoutQuestions.remove, { questionId: id });
  const gone = await t.run((ctx) => ctx.db.get(id));
  expect(gone).toBeNull();
});

// --- reorder ----------------------------------------------------------

test("reorder rewrites sortOrder to the given order", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const a = await as.mutation(api.checkoutQuestions.create, { eventId, label: "A", kind: "text", required: false });
  const b = await as.mutation(api.checkoutQuestions.create, { eventId, label: "B", kind: "text", required: false });
  await as.mutation(api.checkoutQuestions.reorder, { eventId, orderedIds: [b, a] });
  const list = await as.query(api.checkoutQuestions.list, { eventId });
  expect(list.map((q) => q.label)).toEqual(["B", "A"]);
});

test("reorder rejects a non-permutation (wrong length, duplicate, or foreign id)", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const a = await as.mutation(api.checkoutQuestions.create, { eventId, label: "A", kind: "text", required: false });
  await as.mutation(api.checkoutQuestions.create, { eventId, label: "B", kind: "text", required: false });

  await expect(as.mutation(api.checkoutQuestions.reorder, { eventId, orderedIds: [a] })).rejects.toThrow();
  await expect(as.mutation(api.checkoutQuestions.reorder, { eventId, orderedIds: [a, a] })).rejects.toThrow();

  const otherEventId = await makeEvent(as);
  const foreign = await as.mutation(api.checkoutQuestions.create, {
    eventId: otherEventId,
    label: "Foreign",
    kind: "text",
    required: false,
  });
  await expect(
    as.mutation(api.checkoutQuestions.reorder, { eventId, orderedIds: [a, foreign] }),
  ).rejects.toThrow();
});

test("reorder rejects a non-owner", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  const a = await asAda.mutation(api.checkoutQuestions.create, { eventId, label: "A", kind: "text", required: false });
  const b = await asAda.mutation(api.checkoutQuestions.create, { eventId, label: "B", kind: "text", required: false });
  await expect(
    asBob.mutation(api.checkoutQuestions.reorder, { eventId, orderedIds: [b, a] }),
  ).rejects.toThrow();
});

// --- validateAndSnapshotAnswers -------------------------------------------

test("validateAndSnapshotAnswers throws when a required question has no answer", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const qId = await as.mutation(api.checkoutQuestions.create, {
    eventId,
    label: "Company",
    kind: "text",
    required: true,
  });

  await expect(t.run((ctx) => validateAndSnapshotAnswers(ctx, eventId, []))).rejects.toThrow();
  await expect(
    // Whitespace-only counts as no answer.
    t.run((ctx) => validateAndSnapshotAnswers(ctx, eventId, [{ questionId: qId, value: "  " }])),
  ).rejects.toThrow();
});

test("validateAndSnapshotAnswers throws on a select value outside the option set", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const qId = await as.mutation(api.checkoutQuestions.create, {
    eventId,
    label: "Size",
    kind: "select",
    options: ["S", "M", "L"],
    required: true,
  });

  await expect(
    t.run((ctx) => validateAndSnapshotAnswers(ctx, eventId, [{ questionId: qId, value: "XL" }])),
  ).rejects.toThrow();
});

test("validateAndSnapshotAnswers throws on an answer to an unknown/foreign/inactive question", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const otherEventId = await makeEvent(as);
  const foreignId = await as.mutation(api.checkoutQuestions.create, {
    eventId: otherEventId,
    label: "Foreign",
    kind: "text",
    required: false,
  });

  await expect(
    t.run((ctx) => validateAndSnapshotAnswers(ctx, eventId, [{ questionId: foreignId, value: "x" }])),
  ).rejects.toThrow();

  const inactiveId = await as.mutation(api.checkoutQuestions.create, {
    eventId,
    label: "Inactive",
    kind: "text",
    required: false,
  });
  await t.run((ctx) => ctx.db.patch(inactiveId, { active: false }));
  await expect(
    t.run((ctx) => validateAndSnapshotAnswers(ctx, eventId, [{ questionId: inactiveId, value: "x" }])),
  ).rejects.toThrow();
});

test("validateAndSnapshotAnswers returns snapshot rows for valid answers", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const textId = await as.mutation(api.checkoutQuestions.create, {
    eventId,
    label: "Dietary needs",
    kind: "text",
    required: false,
  });
  const selectId = await as.mutation(api.checkoutQuestions.create, {
    eventId,
    label: "Size",
    kind: "select",
    options: ["S", "M", "L"],
    required: true,
  });

  const snapshots = await t.run((ctx) =>
    validateAndSnapshotAnswers(ctx, eventId, [
      { questionId: textId, value: "Vegetarian" },
      { questionId: selectId, value: "M" },
    ]),
  );

  expect(snapshots).toEqual(
    expect.arrayContaining([
      { questionId: textId, label: "Dietary needs", value: "Vegetarian" },
      { questionId: selectId, label: "Size", value: "M" },
    ]),
  );
  expect(snapshots).toHaveLength(2);
});
