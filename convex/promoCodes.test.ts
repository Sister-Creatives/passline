// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { resolveAndComputeDiscount } from "./promoCodes";

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

// --- create ---------------------------------------------------------------

test("create inserts a percent code, uppercased/trimmed, with timesRedeemed=0 and active=true", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  const id = await as.mutation(api.promoCodes.create, {
    eventId,
    code: "  summer10  ",
    discountKind: "percent",
    percentBps: 1000,
  });

  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row?.code).toBe("SUMMER10");
  expect(row?.discountKind).toBe("percent");
  expect(row?.percentBps).toBe(1000);
  expect(row?.timesRedeemed).toBe(0);
  expect(row?.active).toBe(true);
});

test("create inserts a fixed code with maxRedemptions", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  const id = await as.mutation(api.promoCodes.create, {
    eventId,
    code: "FIVEOFF",
    discountKind: "fixed",
    fixedCents: 500,
    maxRedemptions: 10,
  });

  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row?.discountKind).toBe("fixed");
  expect(row?.fixedCents).toBe(500);
  expect(row?.maxRedemptions).toBe(10);
});

test("create rejects an empty/whitespace-only code", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await expect(
    as.mutation(api.promoCodes.create, {
      eventId,
      code: "   ",
      discountKind: "percent",
      percentBps: 1000,
    }),
  ).rejects.toThrow();
});

test("create rejects a duplicate code for the same event (case-insensitive)", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await as.mutation(api.promoCodes.create, {
    eventId,
    code: "SAVE10",
    discountKind: "percent",
    percentBps: 1000,
  });
  await expect(
    as.mutation(api.promoCodes.create, {
      eventId,
      code: "save10",
      discountKind: "fixed",
      fixedCents: 100,
    }),
  ).rejects.toThrow();
});

test("create allows the same code across two different events", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId1 = await makeEvent(as);
  const eventId2 = await makeEvent(as);
  await as.mutation(api.promoCodes.create, {
    eventId: eventId1,
    code: "SAVE10",
    discountKind: "percent",
    percentBps: 1000,
  });
  await expect(
    as.mutation(api.promoCodes.create, {
      eventId: eventId2,
      code: "SAVE10",
      discountKind: "percent",
      percentBps: 1000,
    }),
  ).resolves.toBeDefined();
});

test("create rejects percent kind with percentBps out of 1..10000", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await expect(
    as.mutation(api.promoCodes.create, {
      eventId,
      code: "ZERO",
      discountKind: "percent",
      percentBps: 0,
    }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.promoCodes.create, {
      eventId,
      code: "TOOBIG",
      discountKind: "percent",
      percentBps: 10001,
    }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.promoCodes.create, {
      eventId,
      code: "MISSING",
      discountKind: "percent",
    }),
  ).rejects.toThrow();
});

test("create rejects fixed kind with fixedCents < 1 or missing", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await expect(
    as.mutation(api.promoCodes.create, {
      eventId,
      code: "ZERO",
      discountKind: "fixed",
      fixedCents: 0,
    }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.promoCodes.create, {
      eventId,
      code: "MISSING",
      discountKind: "fixed",
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
    asBob.mutation(api.promoCodes.create, {
      eventId,
      code: "HIJACK",
      discountKind: "percent",
      percentBps: 1000,
    }),
  ).rejects.toThrow();
  await expect(
    t.mutation(api.promoCodes.create, {
      eventId,
      code: "ANON",
      discountKind: "percent",
      percentBps: 1000,
    }),
  ).rejects.toThrow();
});

// --- list -------------------------------------------------------------

test("list returns the owner's promo codes for the event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await as.mutation(api.promoCodes.create, { eventId, code: "A", discountKind: "percent", percentBps: 500 });
  await as.mutation(api.promoCodes.create, { eventId, code: "B", discountKind: "fixed", fixedCents: 100 });

  const list = await as.query(api.promoCodes.list, { eventId });
  expect(list.map((p) => p.code).sort()).toEqual(["A", "B"]);
});

test("list rejects a non-owner", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  await expect(asBob.query(api.promoCodes.list, { eventId })).rejects.toThrow();
});

// --- remove -------------------------------------------------------------

test("remove deletes the promo code (owner-only)", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  const id = await asAda.mutation(api.promoCodes.create, {
    eventId,
    code: "REMOVEME",
    discountKind: "percent",
    percentBps: 500,
  });

  await expect(asBob.mutation(api.promoCodes.remove, { promoCodeId: id })).rejects.toThrow();
  await asAda.mutation(api.promoCodes.remove, { promoCodeId: id });
  const gone = await t.run((ctx) => ctx.db.get(id));
  expect(gone).toBeNull();
});

// --- resolveAndComputeDiscount -------------------------------------------

test("resolveAndComputeDiscount throws for a missing code", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await expect(
    t.run((ctx) => resolveAndComputeDiscount(ctx, eventId, "NOPE", 10000)),
  ).rejects.toThrow();
});

test("resolveAndComputeDiscount throws for an inactive code", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const id = await as.mutation(api.promoCodes.create, {
    eventId,
    code: "OFF10",
    discountKind: "percent",
    percentBps: 1000,
  });
  await t.run((ctx) => ctx.db.patch(id, { active: false }));
  await expect(
    t.run((ctx) => resolveAndComputeDiscount(ctx, eventId, "OFF10", 10000)),
  ).rejects.toThrow();
});

test("resolveAndComputeDiscount throws for an exhausted code (timesRedeemed >= maxRedemptions)", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const id = await as.mutation(api.promoCodes.create, {
    eventId,
    code: "LIMITED",
    discountKind: "fixed",
    fixedCents: 200,
    maxRedemptions: 2,
  });
  await t.run((ctx) => ctx.db.patch(id, { timesRedeemed: 2 }));
  await expect(
    t.run((ctx) => resolveAndComputeDiscount(ctx, eventId, "LIMITED", 10000)),
  ).rejects.toThrow();
});

test("resolveAndComputeDiscount computes a percent discount and matches the code case-insensitively", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const id = await as.mutation(api.promoCodes.create, {
    eventId,
    code: "TENOFF",
    discountKind: "percent",
    percentBps: 1000, // 10%
  });
  const result = await t.run((ctx) => resolveAndComputeDiscount(ctx, eventId, "tenoff", 6000));
  expect(result.promoCodeId).toBe(id);
  expect(result.discountCents).toBe(600);
});

test("resolveAndComputeDiscount computes a fixed discount", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await as.mutation(api.promoCodes.create, {
    eventId,
    code: "FLAT500",
    discountKind: "fixed",
    fixedCents: 500,
  });
  const result = await t.run((ctx) => resolveAndComputeDiscount(ctx, eventId, "FLAT500", 6000));
  expect(result.discountCents).toBe(500);
});

test("resolveAndComputeDiscount clamps a fixed discount larger than the gross subtotal", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await as.mutation(api.promoCodes.create, {
    eventId,
    code: "BIGFIXED",
    discountKind: "fixed",
    fixedCents: 9999,
  });
  const result = await t.run((ctx) => resolveAndComputeDiscount(ctx, eventId, "BIGFIXED", 3000));
  expect(result.discountCents).toBe(3000);
});

test("resolveAndComputeDiscount rounds a percent discount to the nearest cent", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await as.mutation(api.promoCodes.create, {
    eventId,
    code: "ODDPCT",
    discountKind: "percent",
    percentBps: 3333, // 33.33%
  });
  // 999 * 3333 / 10000 = 333.0... let's use 100 -> 33.33 -> rounds to 33
  const result = await t.run((ctx) => resolveAndComputeDiscount(ctx, eventId, "ODDPCT", 100));
  expect(result.discountCents).toBe(33);
});

test("resolveAndComputeDiscount does not match a code from a different event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId1 = await makeEvent(as);
  const eventId2 = await makeEvent(as);
  await as.mutation(api.promoCodes.create, {
    eventId: eventId1,
    code: "ONLYONE",
    discountKind: "percent",
    percentBps: 1000,
  });
  await expect(
    t.run((ctx) => resolveAndComputeDiscount(ctx, eventId2, "ONLYONE", 10000)),
  ).rejects.toThrow();
});
