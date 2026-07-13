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

async function seedEventWithTicketType(as: ReturnType<TestConvex<typeof schema>["withIdentity"]>) {
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Test Event",
    description: "desc",
    startsAt: 1000,
    endsAt: 2000,
    location: "Somewhere",
    capacity: 100,
  });
  const ticketTypeId = await as.mutation(api.ticketTypes.create, {
    eventId,
    name: "General",
    kind: "paid",
    priceCents: 1500,
    capacity: 50,
  });
  return { eventId, ticketTypeId };
}

test("GET /v1/events with no Authorization header returns 401", async () => {
  const t = convexTest(schema, modules);

  const res = await t.fetch("/v1/events");

  expect(res.status).toBe(401);
  expect(res.headers.get("content-type")).toMatch(/application\/json/);
  expect(await res.json()).toEqual({ error: "unauthorized" });
});

test("GET /v1/events with an unknown key returns 401", async () => {
  const t = convexTest(schema, modules);

  const res = await t.fetch("/v1/events", {
    headers: { Authorization: "Bearer pl_live_0000000000000000000000000000000000000000" },
  });

  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthorized" });
});

test("GET /v1/events returns the caller's events for a valid key", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const { eventId } = await seedEventWithTicketType(as);
  const { secret } = await as.mutation(api.apiKeys.create, { name: "Prod" });

  const res = await t.fetch("/v1/events", {
    headers: { Authorization: `Bearer ${secret}` },
  });

  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/application\/json/);
  const body = await res.json();
  expect(body.data).toHaveLength(1);
  expect(body.data[0]).toMatchObject({
    id: eventId,
    title: "Test Event",
    status: "draft",
    capacity: 100,
    currency: "USD",
    startsAt: 1000,
    endsAt: 2000,
  });
  expect(body.data[0].slug).toEqual(expect.any(String));
});

test("GET /v1/events is scoped to the caller's organizer, not other organizers' events", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  await seedEventWithTicketType(asAda);

  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const { secret } = await asBob.mutation(api.apiKeys.create, { name: "Bob's key" });

  const res = await t.fetch("/v1/events", {
    headers: { Authorization: `Bearer ${secret}` },
  });

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data).toHaveLength(0);
});

test("a revoked key returns 401", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const { id: keyId, secret } = await as.mutation(api.apiKeys.create, { name: "Prod" });
  await as.mutation(api.apiKeys.revoke, { keyId });

  const res = await t.fetch("/v1/events", {
    headers: { Authorization: `Bearer ${secret}` },
  });

  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthorized" });
});

test("a valid key's lastUsedAt is touched on use", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const { id: keyId, secret } = await as.mutation(api.apiKeys.create, { name: "Prod" });

  const before = await t.run((ctx) => ctx.db.get(keyId));
  expect(before!.lastUsedAt).toBeUndefined();

  await t.fetch("/v1/events", { headers: { Authorization: `Bearer ${secret}` } });

  const after = await t.run((ctx) => ctx.db.get(keyId));
  expect(after!.lastUsedAt).toBeTypeOf("number");
});

test("GET /v1/events/{eventId}/ticket-types returns the event's ticket types sorted by sortOrder", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const { eventId, ticketTypeId } = await seedEventWithTicketType(as);
  await as.mutation(api.ticketTypes.create, {
    eventId,
    name: "VIP",
    kind: "paid",
    priceCents: 5000,
  });
  const { secret } = await as.mutation(api.apiKeys.create, { name: "Prod" });

  const res = await t.fetch(`/v1/events/${eventId}/ticket-types`, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data).toHaveLength(2);
  expect(body.data[0]).toMatchObject({
    id: ticketTypeId,
    name: "General",
    kind: "paid",
    priceCents: 1500,
    currency: "USD",
    capacity: 50,
    sold: 0,
    sortOrder: 0,
  });
  expect(body.data[1]).toMatchObject({ name: "VIP", priceCents: 5000, sortOrder: 1 });
});

test("GET /v1/events/{eventId}/ticket-types excludes archived ticket types", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const { eventId, ticketTypeId } = await seedEventWithTicketType(as);
  await t.run((ctx) =>
    ctx.db.insert("ticketTypes", {
      eventId,
      name: "Archived",
      kind: "paid",
      priceCents: 2000,
      sold: 0,
      sortOrder: 1,
      visibility: "visible",
      status: "archived",
    }),
  );
  const { secret } = await as.mutation(api.apiKeys.create, { name: "Prod" });

  const res = await t.fetch(`/v1/events/${eventId}/ticket-types`, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data).toHaveLength(1);
  expect(body.data[0]).toMatchObject({ id: ticketTypeId, name: "General" });
});

test("GET /v1/events/{eventId}/ticket-types without a key returns 401", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const { eventId } = await seedEventWithTicketType(as);

  const res = await t.fetch(`/v1/events/${eventId}/ticket-types`);

  expect(res.status).toBe(401);
});

test("GET /v1/events/{eventId}/ticket-types 404s for another organizer's event", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { eventId } = await seedEventWithTicketType(asAda);

  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const { secret } = await asBob.mutation(api.apiKeys.create, { name: "Bob's key" });

  const res = await t.fetch(`/v1/events/${eventId}/ticket-types`, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not found" });
});

async function seedPublishedEventWithFreeTicketType(
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  capacity = 10,
) {
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Free Test Event",
    description: "desc",
    startsAt: 1000,
    endsAt: 2000,
    location: "Somewhere",
    capacity: 100,
  });
  await as.mutation(api.events.publishEvent, { eventId });
  const ticketTypeId = await as.mutation(api.ticketTypes.create, {
    eventId,
    name: "Free",
    kind: "free",
    priceCents: 0,
    capacity,
  });
  return { eventId, ticketTypeId };
}

test("POST /v1/orders returns 201 for a valid free order", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const { eventId, ticketTypeId } = await seedPublishedEventWithFreeTicketType(as);
  const { secret } = await as.mutation(api.apiKeys.create, { name: "Prod" });

  const res = await t.fetch("/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      eventId,
      items: [{ ticketTypeId, quantity: 2 }],
      buyerName: "Buyer One",
      buyerEmail: "buyer@example.com",
    }),
  });

  expect(res.status).toBe(201);
  expect(res.headers.get("content-type")).toMatch(/application\/json/);
  const body = await res.json();
  expect(body.data).toMatchObject({
    totalCents: 0,
    currency: "USD",
    status: "paid",
  });
  expect(body.data.orderId).toEqual(expect.any(String));
  expect(body.data.token).toEqual(expect.any(String));
});

test("POST /v1/orders returns 400 on oversell", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const { eventId, ticketTypeId } = await seedPublishedEventWithFreeTicketType(as, 1);
  const { secret } = await as.mutation(api.apiKeys.create, { name: "Prod" });

  const res = await t.fetch("/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      eventId,
      items: [{ ticketTypeId, quantity: 2 }],
      buyerName: "Buyer One",
      buyerEmail: "buyer@example.com",
    }),
  });

  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toEqual(expect.any(String));
});

test("POST /v1/orders with a bad promo code returns 400", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const { eventId, ticketTypeId } = await seedPublishedEventWithFreeTicketType(as);
  const { secret } = await as.mutation(api.apiKeys.create, { name: "Prod" });

  const res = await t.fetch("/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      eventId,
      items: [{ ticketTypeId, quantity: 1 }],
      buyerName: "Buyer One",
      buyerEmail: "buyer@example.com",
      promoCode: "DOESNOTEXIST",
    }),
  });

  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toEqual(expect.any(String));
});

test("POST /v1/orders 404s for another organizer's event", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { eventId, ticketTypeId } = await seedPublishedEventWithFreeTicketType(asAda);

  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const { secret } = await asBob.mutation(api.apiKeys.create, { name: "Bob's key" });

  const res = await t.fetch("/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      eventId,
      items: [{ ticketTypeId, quantity: 1 }],
      buyerName: "Buyer One",
      buyerEmail: "buyer@example.com",
    }),
  });

  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not found" });
});

test("GET /v1/events/{eventId}/questions returns the event's active questions", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const { eventId } = await seedPublishedEventWithFreeTicketType(as);
  const questionId = await as.mutation(api.checkoutQuestions.create, {
    eventId,
    label: "Company name",
    kind: "text",
    required: true,
  });
  const { secret } = await as.mutation(api.apiKeys.create, { name: "Prod" });

  const res = await t.fetch(`/v1/events/${eventId}/questions`, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/application\/json/);
  const body = await res.json();
  expect(body.data).toHaveLength(1);
  expect(body.data[0]).toMatchObject({
    _id: questionId,
    label: "Company name",
    kind: "text",
    required: true,
  });
});

test("GET /v1/events/{eventId}/questions 404s for another organizer's event", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { eventId } = await seedPublishedEventWithFreeTicketType(asAda);
  await asAda.mutation(api.checkoutQuestions.create, {
    eventId,
    label: "Company name",
    kind: "text",
    required: true,
  });

  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const { secret } = await asBob.mutation(api.apiKeys.create, { name: "Bob's key" });

  const res = await t.fetch(`/v1/events/${eventId}/questions`, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not found" });
});

test("GET /v1/events/{eventId}/questions without a key returns 401", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const { eventId } = await seedPublishedEventWithFreeTicketType(as);

  const res = await t.fetch(`/v1/events/${eventId}/questions`);

  expect(res.status).toBe(401);
});

test("POST /v1/orders with a missing required answer returns 400", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const { eventId, ticketTypeId } = await seedPublishedEventWithFreeTicketType(as);
  await as.mutation(api.checkoutQuestions.create, {
    eventId,
    label: "Company name",
    kind: "text",
    required: true,
  });
  const { secret } = await as.mutation(api.apiKeys.create, { name: "Prod" });

  const res = await t.fetch("/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      eventId,
      items: [{ ticketTypeId, quantity: 1 }],
      buyerName: "Buyer One",
      buyerEmail: "buyer@example.com",
    }),
  });

  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toEqual(expect.any(String));
});

test("POST /v1/orders without a key returns 401", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const { eventId, ticketTypeId } = await seedPublishedEventWithFreeTicketType(as);

  const res = await t.fetch("/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventId,
      items: [{ ticketTypeId, quantity: 1 }],
      buyerName: "Buyer One",
      buyerEmail: "buyer@example.com",
    }),
  });

  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthorized" });
});
