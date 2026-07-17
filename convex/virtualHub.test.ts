// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");

// Mirrors convex/eventContent.test.ts: insert a real users row + session and
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
    title: "Hub Event",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity,
  });
}

async function makePublishedEvent(
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  capacity = 100,
) {
  const eventId = await makeEvent(as, capacity);
  await as.mutation(api.events.publishEvent, { eventId });
  return eventId;
}

const baseUpdateArgs = { enabled: true, resources: [] };

// Seeds a paid ticket type (owner-authenticated) and returns a `pending`
// order for it via `createOrder`, mirroring convex/orders.test.ts. Paid
// (rather than free) so the order stays `pending` -- a free cart is
// fulfilled inline by `createOrder` and can't be `cancelOrder`'d.
async function makePendingOrder(
  t: TestConvex<typeof schema>,
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  eventId: Awaited<ReturnType<typeof makeEvent>>,
) {
  const ticketTypeId = await as.mutation(api.ticketTypes.create, {
    eventId,
    name: "General",
    kind: "paid",
    priceCents: 1000,
  });
  return t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer One",
    buyerEmail: "buyer@example.com",
  });
}

// Same as makePendingOrder, but immediately marks the order paid (mirroring
// a real payment confirmation), for tests that need a `paid` order.
async function makePaidOrder(
  t: TestConvex<typeof schema>,
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  eventId: Awaited<ReturnType<typeof makeEvent>>,
) {
  const order = await makePendingOrder(t, as, eventId);
  await t.mutation(internal.orders.markOrderPaid, { orderId: order.orderId });
  return order;
}

// --- get -----------------------------------------------------------------

test("get returns an empty default when no hub has been saved yet", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  const hub = await as.query(api.virtualHub.get, { eventId });
  expect(hub).toEqual({ enabled: false, resources: [] });
});

test("get is owner-only", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);

  await expect(asBob.query(api.virtualHub.get, { eventId })).rejects.toThrow();
});

// --- update ----------------------------------------------------------------

test("update inserts on first save and patches (upserts) on the next", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  const firstId = await as.mutation(api.virtualHub.update, {
    eventId,
    enabled: true,
    heading: "Join us online",
    description: "Stream + resources",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    meetingUrl: "https://zoom.us/j/123456",
    resources: [{ title: "Slides", url: "https://example.com/slides.pdf" }],
    accessPassword: "letmein",
  });

  const rowsAfterFirst = await t.run((ctx) =>
    ctx.db.query("virtualHubs").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(rowsAfterFirst).toHaveLength(1);
  expect(rowsAfterFirst[0]._id).toEqual(firstId);
  expect(rowsAfterFirst[0].heading).toBe("Join us online");
  expect(rowsAfterFirst[0].accessPassword).toBe("letmein");

  const secondId = await as.mutation(api.virtualHub.update, {
    eventId,
    enabled: false,
    heading: "Updated heading",
    resources: [],
  });

  const rowsAfterSecond = await t.run((ctx) =>
    ctx.db.query("virtualHubs").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(rowsAfterSecond).toHaveLength(1);
  expect(secondId).toEqual(firstId);
  expect(rowsAfterSecond[0].enabled).toBe(false);
  expect(rowsAfterSecond[0].heading).toBe("Updated heading");
  // Fields omitted on the second save clear (an omitted/empty field means
  // "clear this field"), mirroring eventContent.update.
  expect(rowsAfterSecond[0].description).toBeUndefined();
  expect(rowsAfterSecond[0].videoUrl).toBeUndefined();
  expect(rowsAfterSecond[0].meetingUrl).toBeUndefined();
  expect(rowsAfterSecond[0].accessPassword).toBeUndefined();
});

test("update rejects an unparseable video URL", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  await expect(
    as.mutation(api.virtualHub.update, {
      eventId,
      videoUrl: "https://example.com/not-a-video",
      ...baseUpdateArgs,
    }),
  ).rejects.toThrow();

  const rows = await t.run((ctx) =>
    ctx.db.query("virtualHubs").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(rows).toHaveLength(0);
});

test("update accepts an empty video URL (clears the field, no validation)", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  await as.mutation(api.virtualHub.update, { eventId, videoUrl: "", ...baseUpdateArgs });

  const hub = await t.run((ctx) =>
    ctx.db.query("virtualHubs").withIndex("by_event", (q) => q.eq("eventId", eventId)).unique(),
  );
  expect(hub?.videoUrl).toBeUndefined();
});

test("update rejects a meetingUrl that doesn't start with https://", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  await expect(
    as.mutation(api.virtualHub.update, {
      eventId,
      meetingUrl: "http://zoom.us/j/123456",
      ...baseUpdateArgs,
    }),
  ).rejects.toThrow();

  await expect(
    as.mutation(api.virtualHub.update, {
      eventId,
      meetingUrl: "javascript:alert(1)",
      ...baseUpdateArgs,
    }),
  ).rejects.toThrow();

  const rows = await t.run((ctx) =>
    ctx.db.query("virtualHubs").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(rows).toHaveLength(0);
});

test("update accepts a valid https:// meetingUrl", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  await as.mutation(api.virtualHub.update, {
    eventId,
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    ...baseUpdateArgs,
  });

  const hub = await t.run((ctx) =>
    ctx.db.query("virtualHubs").withIndex("by_event", (q) => q.eq("eventId", eventId)).unique(),
  );
  expect(hub?.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
});

test("update rejects a resource url that isn't http:// or https://", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  await expect(
    as.mutation(api.virtualHub.update, {
      eventId,
      enabled: true,
      resources: [{ title: "x", url: "javascript:alert(1)" }],
    }),
  ).rejects.toThrow();

  await expect(
    as.mutation(api.virtualHub.update, {
      eventId,
      enabled: true,
      resources: [{ title: "x", url: "data:text/html,<script>alert(1)</script>" }],
    }),
  ).rejects.toThrow();

  const rows = await t.run((ctx) =>
    ctx.db.query("virtualHubs").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(rows).toHaveLength(0);
});

test("update accepts a normal https:// resource url", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  await as.mutation(api.virtualHub.update, {
    eventId,
    enabled: true,
    resources: [{ title: "Slides", url: "https://example.com/slides.pdf" }],
  });

  const hub = await as.query(api.virtualHub.get, { eventId });
  expect(hub.resources).toEqual([{ title: "Slides", url: "https://example.com/slides.pdf" }]);
});

test("update drops resource rows with a blank title or url and trims surviving ones", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  await as.mutation(api.virtualHub.update, {
    eventId,
    enabled: true,
    resources: [
      { title: "  Slides  ", url: "  https://example.com/slides.pdf  " },
      { title: "   ", url: "https://example.com/blank-title.pdf" }, // blank title -> dropped
      { title: "Blank URL", url: "   " }, // blank url -> dropped
    ],
  });

  const hub = await as.query(api.virtualHub.get, { eventId });
  expect(hub.resources).toEqual([{ title: "Slides", url: "https://example.com/slides.pdf" }]);
});

test("update caps resources at 50 rows", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  const resources = Array.from({ length: 60 }, (_, i) => ({
    title: `Resource ${i}`,
    url: `https://example.com/${i}`,
  }));
  await as.mutation(api.virtualHub.update, { eventId, enabled: true, resources });

  const hub = await as.query(api.virtualHub.get, { eventId });
  expect(hub.resources).toHaveLength(50);
});

test("update is owner-only", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);

  await expect(
    asBob.mutation(api.virtualHub.update, { eventId, ...baseUpdateArgs }),
  ).rejects.toThrow();

  const rows = await t.run((ctx) =>
    ctx.db.query("virtualHubs").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(rows).toHaveLength(0);
});

// --- getForOrder -----------------------------------------------------------

test("getForOrder returns the hub (no password) for a paid order of an enabled hub", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);
  await as.mutation(api.virtualHub.update, {
    eventId,
    enabled: true,
    heading: "Join us online",
    description: "Stream + resources",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    meetingUrl: "https://zoom.us/j/123456",
    resources: [{ title: "Slides", url: "https://example.com/slides.pdf" }],
    accessPassword: "letmein",
  });
  const order = await makePaidOrder(t, as, eventId);

  const hub = await t.query(api.virtualHub.getForOrder, { token: order.token });
  expect(hub).toMatchObject({
    heading: "Join us online",
    description: "Stream + resources",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    meetingUrl: "https://zoom.us/j/123456",
    resources: [{ title: "Slides", url: "https://example.com/slides.pdf" }],
  });
  expect(hub).not.toHaveProperty("accessPassword");
});

test("getForOrder returns null for a pending order", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);
  await as.mutation(api.virtualHub.update, { eventId, enabled: true, resources: [] });
  const order = await makePendingOrder(t, as, eventId);

  const hub = await t.query(api.virtualHub.getForOrder, { token: order.token });
  expect(hub).toBeNull();
});

test("getForOrder returns null for a cancelled order", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);
  await as.mutation(api.virtualHub.update, { eventId, enabled: true, resources: [] });
  const order = await makePendingOrder(t, as, eventId);
  await as.mutation(api.orders.cancelOrder, { orderId: order.orderId });

  const hub = await t.query(api.virtualHub.getForOrder, { token: order.token });
  expect(hub).toBeNull();
});

test("getForOrder returns null for a refunded order", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);
  await as.mutation(api.virtualHub.update, { eventId, enabled: true, resources: [] });
  const order = await makePaidOrder(t, as, eventId);
  await as.mutation(api.orders.refundOrder, { orderId: order.orderId });

  const hub = await t.query(api.virtualHub.getForOrder, { token: order.token });
  expect(hub).toBeNull();
});

test("getForOrder returns null when the hub is disabled", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);
  await as.mutation(api.virtualHub.update, { eventId, enabled: false, resources: [] });
  const order = await makePaidOrder(t, as, eventId);

  const hub = await t.query(api.virtualHub.getForOrder, { token: order.token });
  expect(hub).toBeNull();
});

test("getForOrder returns null when no hub config exists for the event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);
  const order = await makePaidOrder(t, as, eventId);

  const hub = await t.query(api.virtualHub.getForOrder, { token: order.token });
  expect(hub).toBeNull();
});

test("getForOrder returns null for a bad/unknown token", async () => {
  const t = convexTest(schema, modules);
  const hub = await t.query(api.virtualHub.getForOrder, { token: "not-a-real-token" });
  expect(hub).toBeNull();
});

// --- getWithPassword ---------------------------------------------------------

test("getWithPassword returns the hub (no password) for the right password on a published enabled hub", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);
  await as.mutation(api.virtualHub.update, {
    eventId,
    enabled: true,
    heading: "Join us online",
    resources: [],
    accessPassword: "letmein",
  });
  const event = await t.run((ctx) => ctx.db.get(eventId));

  const hub = await t.query(api.virtualHub.getWithPassword, {
    slug: event!.slug,
    password: "letmein",
  });
  expect(hub).toMatchObject({ heading: "Join us online" });
  expect(hub).not.toHaveProperty("accessPassword");
});

test("getWithPassword returns null for a wrong password", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);
  await as.mutation(api.virtualHub.update, {
    eventId,
    enabled: true,
    resources: [],
    accessPassword: "letmein",
  });
  const event = await t.run((ctx) => ctx.db.get(eventId));

  const hub = await t.query(api.virtualHub.getWithPassword, {
    slug: event!.slug,
    password: "wrong",
  });
  expect(hub).toBeNull();
});

test("getWithPassword returns null for an unpublished (draft) event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await as.mutation(api.virtualHub.update, {
    eventId,
    enabled: true,
    resources: [],
    accessPassword: "letmein",
  });
  const event = await t.run((ctx) => ctx.db.get(eventId));

  const hub = await t.query(api.virtualHub.getWithPassword, {
    slug: event!.slug,
    password: "letmein",
  });
  expect(hub).toBeNull();
});

test("getWithPassword returns null when the hub is disabled", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);
  await as.mutation(api.virtualHub.update, {
    eventId,
    enabled: false,
    resources: [],
    accessPassword: "letmein",
  });
  const event = await t.run((ctx) => ctx.db.get(eventId));

  const hub = await t.query(api.virtualHub.getWithPassword, {
    slug: event!.slug,
    password: "letmein",
  });
  expect(hub).toBeNull();
});

test("getWithPassword returns null when no accessPassword is set on the hub", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);
  await as.mutation(api.virtualHub.update, { eventId, enabled: true, resources: [] });
  const event = await t.run((ctx) => ctx.db.get(eventId));

  const hub = await t.query(api.virtualHub.getWithPassword, {
    slug: event!.slug,
    password: "anything",
  });
  expect(hub).toBeNull();
});

test("getWithPassword returns null for an unknown slug", async () => {
  const t = convexTest(schema, modules);
  const hub = await t.query(api.virtualHub.getWithPassword, {
    slug: "does-not-exist",
    password: "letmein",
  });
  expect(hub).toBeNull();
});
