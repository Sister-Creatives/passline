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

test("creating a ticket type emits ticket_type.created to a subscribed active webhook", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});

  await as.mutation(api.webhooks.create, {
    url: "https://example.com/hook",
    subscribedEvents: ["ticket_type.created"],
  });

  const eventId = await as.mutation(api.events.createEvent, {
    title: "Ticketed Event",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 100,
  });

  await as.mutation(api.ticketTypes.create, {
    eventId,
    name: "Adult",
    kind: "paid",
    priceCents: 2500,
  });

  const deliveries = await t.run((ctx) =>
    ctx.db
      .query("webhookDeliveries")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .collect(),
  );
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0].eventType).toBe("ticket_type.created");
  expect(deliveries[0].status).toBe("pending");
});
