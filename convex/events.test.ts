// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

// Passed explicitly for the same pnpm module-resolution reason documented in
// schema.test.ts.
const modules = import.meta.glob("./**/*.*s");

// Auth identity subject is `${userId}|${sessionId}` (divider "|"). Insert a real
// users row (+ session) and hand withIdentity a matching subject so
// getAuthUserId resolves through ctx.db.get(userId). See auth.test.ts for the
// full derivation of this format from @convex-dev/auth's source.
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

test("create then publish makes the event findable by slug", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await as.mutation(api.events.createEvent, {
    title: "Rooftop Jazz",
    description: "Live jazz night.",
    startsAt: 100,
    endsAt: 200,
    location: "Rooftop",
    capacity: 80,
  });
  const draft = await t.run((ctx) => ctx.db.get(eventId));
  expect(draft?.status).toBe("draft");

  await as.mutation(api.events.publishEvent, { eventId });
  const published = await t.query(api.events.getEventBySlug, { slug: draft!.slug });
  expect(published?._id).toEqual(eventId);
});

test("unpublished events are not returned by slug", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await as.mutation(api.events.createEvent, {
    title: "Hidden",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 5,
  });
  const draft = await t.run((ctx) => ctx.db.get(eventId));
  const found = await t.query(api.events.getEventBySlug, { slug: draft!.slug });
  expect(found).toBeNull();
});

test("a second organizer cannot publish or unpublish another organizer's event", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await asAda.mutation(api.events.createEvent, {
    title: "Ada's Gala",
    description: "Ada's own event.",
    startsAt: 10,
    endsAt: 20,
    location: "Ballroom",
    capacity: 40,
  });
  await asAda.mutation(api.events.publishEvent, { eventId });

  await expect(asBob.mutation(api.events.publishEvent, { eventId })).rejects.toThrow();
  await expect(asBob.mutation(api.events.unpublishEvent, { eventId })).rejects.toThrow();

  // Bob's rejected calls must not have altered Ada's event: it is still
  // published, proving the ownership check is enforced, not merely checked
  // after the fact.
  const stillPublished = await t.run((ctx) => ctx.db.get(eventId));
  expect(stillPublished?.status).toBe("published");
});

test("an organizer can unpublish their own event, hiding it from getEventBySlug again", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await as.mutation(api.events.createEvent, {
    title: "Rooftop Jazz",
    description: "Live jazz night.",
    startsAt: 100,
    endsAt: 200,
    location: "Rooftop",
    capacity: 80,
  });
  const draft = await t.run((ctx) => ctx.db.get(eventId));

  await as.mutation(api.events.publishEvent, { eventId });
  const published = await t.query(api.events.getEventBySlug, { slug: draft!.slug });
  expect(published?._id).toEqual(eventId);

  await as.mutation(api.events.unpublishEvent, { eventId });
  const hiddenAgain = await t.query(api.events.getEventBySlug, { slug: draft!.slug });
  expect(hiddenAgain).toBeNull();

  const row = await t.run((ctx) => ctx.db.get(eventId));
  expect(row?.status).toBe("draft");
});

test("listMyEvents only returns events owned by the calling organizer", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});

  const adaEvent1 = await asAda.mutation(api.events.createEvent, {
    title: "Ada Event One",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 5,
  });
  const adaEvent2 = await asAda.mutation(api.events.createEvent, {
    title: "Ada Event Two",
    description: "x",
    startsAt: 3,
    endsAt: 4,
    location: "x",
    capacity: 5,
  });
  const bobEvent = await asBob.mutation(api.events.createEvent, {
    title: "Bob Event",
    description: "x",
    startsAt: 5,
    endsAt: 6,
    location: "x",
    capacity: 5,
  });

  const adaEvents = await asAda.query(api.events.listMyEvents, {});
  expect(adaEvents.map((e) => e._id).sort()).toEqual([adaEvent1, adaEvent2].sort());

  const bobEvents = await asBob.query(api.events.listMyEvents, {});
  expect(bobEvents.map((e) => e._id)).toEqual([bobEvent]);
});

test("createEvent rejects when unauthenticated", async () => {
  const t = convexTest(schema, modules);

  await expect(
    t.mutation(api.events.createEvent, {
      title: "Anonymous Event",
      description: "x",
      startsAt: 1,
      endsAt: 2,
      location: "x",
      capacity: 1,
    }),
  ).rejects.toThrow();
});
