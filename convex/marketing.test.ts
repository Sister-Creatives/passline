// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sanitizePixelId } from "./marketing";

// Passed explicitly for the same pnpm module-resolution reason documented in
// schema.test.ts.
const modules = import.meta.glob("./**/*.*s");

// Mirrors convex/analytics.test.ts / convex/email.test.ts: insert a real
// users row + session and hand withIdentity a matching subject so
// getAuthUserId resolves. RESEND_API_KEY is intentionally unset, so
// deliverCampaign is a clean no-op -- these tests assert the mutation
// SCHEDULES delivery + records a campaign, not that any email is sent.
async function asOrganizer(t: TestConvex<typeof schema>, email: string) {
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, name: email });
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 1000 * 60 * 60,
    });
    return { userId, sessionId };
  });
  return { as: t.withIdentity({ subject: `${userId}|${sessionId}` }) };
}

async function makePublishedEvent(
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  capacity = 100,
) {
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Marketing Event",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity,
  });
  await as.mutation(api.events.publishEvent, { eventId });
  return eventId;
}

async function makePaidTicketType(
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  eventId: Id<"events">,
  priceCents = 1000,
) {
  return as.mutation(api.ticketTypes.create, { eventId, name: "General", kind: "paid", priceCents });
}

/** Create + pay an order, returning both the order id and its buyer token. */
async function makePaidOrder(
  t: TestConvex<typeof schema>,
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  eventId: Id<"events">,
  ticketTypeId: Id<"ticketTypes">,
  buyerEmail: string,
) {
  const result = await as.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer",
    buyerEmail,
  });
  await t.mutation(internal.orders.markOrderPaid, { orderId: result.orderId });
  return result;
}

function scheduled(t: TestConvex<typeof schema>) {
  return t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
}

test("sendEventEmail collects distinct emails across orders (excl. cancelled) + tickets + rsvps, records a campaign, and schedules delivery", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "organizer@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);
  const ticketTypeId = await makePaidTicketType(as, eventId);

  // Order A: buyer + attendee share the same email -- must be deduped to one.
  const orderA = await makePaidOrder(t, as, eventId, ticketTypeId, "shared@example.com");
  const ticketsA = await t.run((ctx) =>
    ctx.db.query("tickets").withIndex("by_order", (q) => q.eq("orderId", orderA.orderId)).collect(),
  );
  await t.mutation(api.tickets.transferTicket, {
    orderToken: orderA.token,
    ticketId: ticketsA[0]._id,
    attendeeName: "Shared Person",
    attendeeEmail: "shared@example.com",
  });

  // Order B: a distinct buyer, no attendee transfer.
  await makePaidOrder(t, as, eventId, ticketTypeId, "unique-buyer@example.com");

  // Order C: cancelled before payment -- its buyerEmail must be excluded.
  const orderC = await as.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Cancelled Buyer",
    buyerEmail: "cancelled-buyer@example.com",
  });
  await as.mutation(api.orders.cancelOrder, { orderId: orderC.orderId });

  // Legacy RSVP path contributes its own distinct email.
  await as.mutation(api.rsvps.rsvp, { slug: (await t.run((ctx) => ctx.db.get(eventId)))!.slug, name: "Rsvp", email: "rsvp-only@example.com" });

  const result = await as.mutation(api.marketing.sendEventEmail, {
    eventId,
    subject: "Big update",
    body: "<p>See you there!</p>",
  });

  // Distinct set: shared@example.com, unique-buyer@example.com, rsvp-only@example.com
  expect(result.recipientCount).toBe(3);

  const campaigns = await t.run((ctx) =>
    ctx.db.query("emailCampaigns").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(campaigns).toHaveLength(1);
  expect(campaigns[0].subject).toBe("Big update");
  expect(campaigns[0].body).toBe("<p>See you there!</p>");
  expect(campaigns[0].recipientCount).toBe(3);

  const jobs = await scheduled(t);
  const delivery = jobs.find((j) => j.name.includes("deliverCampaign"));
  expect(delivery).toBeDefined();
  const args = delivery!.args[0] as { recipients: string[]; subject: string; body: string };
  expect(new Set(args.recipients)).toEqual(
    new Set(["shared@example.com", "unique-buyer@example.com", "rsvp-only@example.com"]),
  );
  expect(args.recipients).toHaveLength(3);
  expect(args.subject).toBe("Big update");
});

test("sendEventEmail with zero recipients still records a campaign but skips scheduling delivery", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "organizer@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);

  const result = await as.mutation(api.marketing.sendEventEmail, {
    eventId,
    subject: "Hello",
    body: "Nobody yet",
  });
  expect(result.recipientCount).toBe(0);

  const campaigns = await t.run((ctx) =>
    ctx.db.query("emailCampaigns").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(campaigns).toHaveLength(1);
  expect(campaigns[0].recipientCount).toBe(0);

  const jobs = await scheduled(t);
  expect(jobs.some((j) => j.name.includes("deliverCampaign"))).toBe(false);
});

test("sendEventEmail rejects an empty subject or body", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "organizer@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);

  await expect(
    as.mutation(api.marketing.sendEventEmail, { eventId, subject: "   ", body: "hi" }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.marketing.sendEventEmail, { eventId, subject: "hi", body: "   " }),
  ).rejects.toThrow();
});

test("sendEventEmail is owner-only", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(asAda);

  await expect(
    asBob.mutation(api.marketing.sendEventEmail, { eventId, subject: "hi", body: "hi" }),
  ).rejects.toThrow();
  await expect(
    t.mutation(api.marketing.sendEventEmail, { eventId, subject: "hi", body: "hi" }),
  ).rejects.toThrow();
});

test("listCampaigns returns campaigns newest first and is owner-only", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(asAda);

  await asAda.mutation(api.marketing.sendEventEmail, { eventId, subject: "First", body: "b1" });
  await asAda.mutation(api.marketing.sendEventEmail, { eventId, subject: "Second", body: "b2" });

  const list = await asAda.query(api.marketing.listCampaigns, { eventId });
  expect(list.map((c) => c.subject)).toEqual(["Second", "First"]);

  await expect(asBob.query(api.marketing.listCampaigns, { eventId })).rejects.toThrow();
  await expect(t.query(api.marketing.listCampaigns, { eventId })).rejects.toThrow();
});

test("updateTrackingPixels sets and clears fields, and getEventMarketing reads them back; both owner-only", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(asAda);

  const initial = await asAda.query(api.marketing.getEventMarketing, { eventId });
  expect(initial).toEqual({
    metaPixelId: undefined,
    googleAnalyticsId: undefined,
    gtmId: undefined,
  });

  await asAda.mutation(api.marketing.updateTrackingPixels, {
    eventId,
    metaPixelId: "  1234567890  ",
    googleAnalyticsId: "G-ABC123",
    gtmId: "GTM-XYZ789",
  });

  const set = await asAda.query(api.marketing.getEventMarketing, { eventId });
  expect(set).toEqual({
    metaPixelId: "1234567890",
    googleAnalyticsId: "G-ABC123",
    gtmId: "GTM-XYZ789",
  });

  // Empty string clears a field.
  await asAda.mutation(api.marketing.updateTrackingPixels, {
    eventId,
    metaPixelId: "   ",
    googleAnalyticsId: "G-ABC123",
    gtmId: "GTM-XYZ789",
  });
  const cleared = await asAda.query(api.marketing.getEventMarketing, { eventId });
  expect(cleared.metaPixelId).toBeUndefined();
  expect(cleared.googleAnalyticsId).toBe("G-ABC123");

  // Omitting a field also clears it.
  await asAda.mutation(api.marketing.updateTrackingPixels, { eventId });
  const allCleared = await asAda.query(api.marketing.getEventMarketing, { eventId });
  expect(allCleared).toEqual({
    metaPixelId: undefined,
    googleAnalyticsId: undefined,
    gtmId: undefined,
  });

  await expect(
    asBob.mutation(api.marketing.updateTrackingPixels, { eventId, metaPixelId: "x" }),
  ).rejects.toThrow();
  await expect(
    t.mutation(api.marketing.updateTrackingPixels, { eventId, metaPixelId: "x" }),
  ).rejects.toThrow();
  await expect(asBob.query(api.marketing.getEventMarketing, { eventId })).rejects.toThrow();
  await expect(t.query(api.marketing.getEventMarketing, { eventId })).rejects.toThrow();
});

test("sanitizePixelId strips characters outside [A-Za-z0-9-]", () => {
  expect(sanitizePixelId("G-ABC123")).toBe("G-ABC123");
  expect(sanitizePixelId("GTM-XYZ789")).toBe("GTM-XYZ789");
  expect(sanitizePixelId(`</script><script>alert(1)</script>`)).toBe("scriptscriptalert1script");
  expect(sanitizePixelId("abc 123!@#$%^&*()")).toBe("abc123");
});
