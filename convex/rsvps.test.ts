// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

// Passed explicitly for the same pnpm module-resolution reason documented in
// schema.test.ts.
const modules = import.meta.glob("./**/*.*s");

// Auth identity subject is `${userId}|${sessionId}` (divider "|"). See
// auth.test.ts for the full derivation of this format from @convex-dev/auth's
// source.
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

// Create + publish an event as an organizer, return its public slug.
async function seedPublishedEvent(t: TestConvex<typeof schema>, capacity: number) {
  const { as } = await asOrganizer(t, "organizer@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Room",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity,
  });
  await as.mutation(api.events.publishEvent, { eventId });
  const ev = await t.run((ctx) => ctx.db.get(eventId));
  return ev!.slug;
}

test("RSVP confirms until capacity, then waitlists in order", async () => {
  const t = convexTest(schema, modules);
  const slug = await seedPublishedEvent(t, 2);

  const a = await t.mutation(api.rsvps.rsvp, { slug, name: "A", email: "a@x.com" });
  const b = await t.mutation(api.rsvps.rsvp, { slug, name: "B", email: "b@x.com" });
  const c = await t.mutation(api.rsvps.rsvp, { slug, name: "C", email: "c@x.com" });
  const d = await t.mutation(api.rsvps.rsvp, { slug, name: "D", email: "d@x.com" });

  expect(a.status).toBe("confirmed");
  expect(b.status).toBe("confirmed");
  expect(c.status).toBe("waitlisted");
  expect(c.waitlistPosition).toBe(1);
  expect(d.status).toBe("waitlisted");
  expect(d.waitlistPosition).toBe(2);

  // Every RSVP gets its own unique token.
  const tokens = new Set([a.token, b.token, c.token, d.token]);
  expect(tokens.size).toBe(4);

  const state = await t.query(api.rsvps.getEventPublicState, { slug });
  expect(state).toMatchObject({ capacity: 2, seatsTaken: 2, waitlistCount: 2 });
});

test("getEventPublicState reflects zero seats taken before any RSVPs", async () => {
  const t = convexTest(schema, modules);
  const slug = await seedPublishedEvent(t, 5);

  const state = await t.query(api.rsvps.getEventPublicState, { slug });
  expect(state).toMatchObject({ capacity: 5, seatsTaken: 0, waitlistCount: 0 });
});

test("rsvp rejects an unknown slug", async () => {
  const t = convexTest(schema, modules);

  await expect(
    t.mutation(api.rsvps.rsvp, { slug: "does-not-exist", name: "A", email: "a@x.com" }),
  ).rejects.toThrow();
});

test("rsvp rejects an unpublished (draft) event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "organizer@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Draft Room",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 5,
  });
  const draft = await t.run((ctx) => ctx.db.get(eventId));

  await expect(
    t.mutation(api.rsvps.rsvp, { slug: draft!.slug, name: "A", email: "a@x.com" }),
  ).rejects.toThrow();
});
