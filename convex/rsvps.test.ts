// @vitest-environment edge-runtime
import { convexTest as rawConvexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

// Passed explicitly for the same pnpm module-resolution reason documented in
// schema.test.ts.
const modules = import.meta.glob("./**/*.*s");

// `rsvp` now calls the rate limiter component synchronously (before its
// dedupe/insert work -- see convex/rateLimits.ts and convex/rsvps.ts), so
// every test instance needs that component registered. Wrapping convex-test's
// constructor here means every `convexTest(schema, modules)` call below gets
// it for free, with no changes to the test bodies themselves.
function convexTest(schemaArg: typeof schema, modulesArg: typeof modules) {
  const t = rawConvexTest(schemaArg, modulesArg);
  registerRateLimiter(t);
  return t;
}

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

test("getRsvpByToken returns the attendee's name, status, and event title", async () => {
  const t = convexTest(schema, modules);
  const slug = await seedPublishedEvent(t, 5);

  const a = await t.mutation(api.rsvps.rsvp, { slug, name: "A", email: "a@x.com" });

  const ticket = await t.query(api.rsvps.getRsvpByToken, { token: a.token });
  expect(ticket).toMatchObject({
    name: "A",
    status: "confirmed",
    token: a.token,
    eventTitle: "Room",
  });
});

test("getRsvpByToken returns null for an unknown token", async () => {
  const t = convexTest(schema, modules);

  const ticket = await t.query(api.rsvps.getRsvpByToken, { token: "does-not-exist" });
  expect(ticket).toBeNull();
});

test("a repeat rsvp with the same email returns the same token and creates no new row", async () => {
  const t = convexTest(schema, modules);
  const slug = await seedPublishedEvent(t, 5);

  const first = await t.mutation(api.rsvps.rsvp, { slug, name: "A", email: "a@x.com" });
  const second = await t.mutation(api.rsvps.rsvp, { slug, name: "A", email: "a@x.com" });

  expect(second).toMatchObject({ status: "confirmed", token: first.token });

  const rows = await t.run((ctx) => ctx.db.query("rsvps").collect());
  expect(rows.length).toBe(1);
});

test("a repeat rsvp with the same email while waitlisted returns the same waitlist position", async () => {
  const t = convexTest(schema, modules);
  const slug = await seedPublishedEvent(t, 1);

  // Fill the single seat so the next rsvp lands on the waitlist.
  await t.mutation(api.rsvps.rsvp, { slug, name: "Filler", email: "filler@x.com" });

  const first = await t.mutation(api.rsvps.rsvp, { slug, name: "A", email: "a@x.com" });
  expect(first).toMatchObject({ status: "waitlisted", waitlistPosition: 1 });

  const second = await t.mutation(api.rsvps.rsvp, { slug, name: "A", email: "a@x.com" });
  expect(second).toMatchObject({
    status: "waitlisted",
    token: first.token,
    waitlistPosition: 1,
  });

  const rows = await t.run((ctx) => ctx.db.query("rsvps").collect());
  expect(rows.length).toBe(2);
});

test("a different email still creates a new rsvp", async () => {
  const t = convexTest(schema, modules);
  const slug = await seedPublishedEvent(t, 5);

  await t.mutation(api.rsvps.rsvp, { slug, name: "A", email: "a@x.com" });
  await t.mutation(api.rsvps.rsvp, { slug, name: "B", email: "b@x.com" });

  const rows = await t.run((ctx) => ctx.db.query("rsvps").collect());
  expect(rows.length).toBe(2);
});

test("the same email can rsvp again after cancelling", async () => {
  const t = convexTest(schema, modules);
  const slug = await seedPublishedEvent(t, 5);

  const first = await t.mutation(api.rsvps.rsvp, { slug, name: "A", email: "a@x.com" });
  await t.mutation(api.rsvps.cancelRsvp, { token: first.token });

  const second = await t.mutation(api.rsvps.rsvp, { slug, name: "A", email: "a@x.com" });
  expect(second.status).toBe("confirmed");
  expect(second.token).not.toBe(first.token);

  const rows = await t.run((ctx) => ctx.db.query("rsvps").collect());
  expect(rows.length).toBe(2);
});

// The `rsvp` rate limit (convex/rateLimits.ts) is a token bucket with
// capacity 5, keyed by email, checked before the dedupe/insert logic runs --
// so every call consumes a token even when it dedupes to an existing ticket.
// That lets these tests exhaust the bucket with repeat calls from the same
// email without needing distinct events or to wait out a time window.
test("rsvp rate-limits repeated attempts from the same email", async () => {
  const t = convexTest(schema, modules);
  const slug = await seedPublishedEvent(t, 5);

  for (let i = 0; i < 5; i++) {
    const res = await t.mutation(api.rsvps.rsvp, { slug, name: "A", email: "a@x.com" });
    expect(res.status).toBe("confirmed");
  }

  await expect(
    t.mutation(api.rsvps.rsvp, { slug, name: "A", email: "a@x.com" }),
  ).rejects.toThrow(/too many/i);
});

test("the rsvp rate limit is keyed per email, so a different email is unaffected", async () => {
  const t = convexTest(schema, modules);
  const slug = await seedPublishedEvent(t, 5);

  // Exhaust a@x.com's bucket.
  for (let i = 0; i < 5; i++) {
    await t.mutation(api.rsvps.rsvp, { slug, name: "A", email: "a@x.com" });
  }
  await expect(
    t.mutation(api.rsvps.rsvp, { slug, name: "A", email: "a@x.com" }),
  ).rejects.toThrow(/too many/i);

  // b@x.com has its own bucket and is untouched by a@x.com's exhaustion.
  const b = await t.mutation(api.rsvps.rsvp, { slug, name: "B", email: "b@x.com" });
  expect(b.status).toBe("confirmed");
});

test("rsvp confirm raises seatsTaken; cancel with a waitlister nets to zero", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Tiny", description: "x", startsAt: 100, endsAt: 200, location: "Hall", capacity: 1,
  });
  const slug = (await t.run((ctx) => ctx.db.get(eventId)))!.slug;
  await as.mutation(api.events.publishEvent, { eventId });

  const first = await t.mutation(api.rsvps.rsvp, { slug, name: "A", email: "a@x.co" });
  expect(first.status).toBe("confirmed");
  expect((await t.run((ctx) => ctx.db.get(eventId)))!.seatsTaken).toBe(1);

  // Second RSVP is waitlisted (capacity 1).
  const second = await t.mutation(api.rsvps.rsvp, { slug, name: "B", email: "b@x.co" });
  expect(second.status).toBe("waitlisted");
  expect((await t.run((ctx) => ctx.db.get(eventId)))!.seatsTaken).toBe(1);

  // Cancel A -> promoteNext moves B into a seat-holding hold -> net seatsTaken stays 1.
  await t.mutation(api.rsvps.cancelRsvp, { token: first.token });
  expect((await t.run((ctx) => ctx.db.get(eventId)))!.seatsTaken).toBe(1);
});

test("cancelRsvp recomputes seatsTaken to 0 when there is no waitlister", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Solo", description: "x", startsAt: 100, endsAt: 200, location: "H", capacity: 1,
  });
  const slug = (await t.run((ctx) => ctx.db.get(eventId)))!.slug;
  await as.mutation(api.events.publishEvent, { eventId });

  const a = await t.mutation(api.rsvps.rsvp, { slug, name: "A", email: "a@x.co" });
  expect(a.status).toBe("confirmed");
  expect((await t.run((ctx) => ctx.db.get(eventId)))!.seatsTaken).toBe(1);

  // No waitlister -> cancel frees the seat and nothing backfills -> must drop to 0.
  // Only passes if cancelRsvp itself recomputes (the confirm-branch recompute left it at 1).
  await t.mutation(api.rsvps.cancelRsvp, { token: a.token });
  expect((await t.run((ctx) => ctx.db.get(eventId)))!.seatsTaken).toBe(0);
});

test("sweep recomputes seatsTaken for every affected event (per-event fan-out)", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const mk = async (title: string) => {
    const id = await as.mutation(api.events.createEvent, {
      title, description: "x", startsAt: 100, endsAt: 200, location: "H", capacity: 1,
    });
    await as.mutation(api.events.publishEvent, { eventId: id });
    return { id, slug: (await t.run((ctx) => ctx.db.get(id)))!.slug };
  };
  const e1 = await mk("E1");
  const e2 = await mk("E2");
  // Each event: A confirmed (fills the 1 seat) + B waitlisted.
  for (const e of [e1, e2]) {
    await t.mutation(api.rsvps.rsvp, { slug: e.slug, name: "A", email: `a@${e.slug}.co` });
    await t.mutation(api.rsvps.rsvp, { slug: e.slug, name: "B", email: `b@${e.slug}.co` });
    // Cancel A -> B is promoted into a confirmed_pending_claim hold (seatsTaken stays 1).
    const rows = await t.run((ctx) =>
      ctx.db.query("rsvps").withIndex("by_event", (q) => q.eq("eventId", e.id)).collect(),
    );
    const a = rows.find((r) => r.status === "confirmed")!;
    await t.mutation(api.rsvps.cancelRsvp, { token: a.token });
  }
  // sweep is seat-count-neutral (the expired hold is re-promoted to the same lone
  // waitlister), so the TRUE seatsTaken stays 1. Corrupt the denormalized counter on
  // both events so the per-event recompute's effect is observable.
  await t.run(async (ctx) => {
    await ctx.db.patch(e1.id, { seatsTaken: 99 });
    await ctx.db.patch(e2.id, { seatsTaken: 99 });
  });
  // Sweep far in the future to expire both holds; recompute must heal both events' counters.
  await t.mutation(internal.waitlist.sweepExpiredClaims, { now: Date.now() + 60 * 60 * 1000 });
  expect((await t.run((ctx) => ctx.db.get(e1.id)))!.seatsTaken).toBe(1);
  expect((await t.run((ctx) => ctx.db.get(e2.id)))!.seatsTaken).toBe(1);
});
