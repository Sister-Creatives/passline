// @vitest-environment edge-runtime
import { convexTest as rawConvexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

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
  return { as: t.withIdentity({ subject: `${userId}|${sessionId}` }) };
}

// Publish a capacity-1 event, then RSVP A (confirmed) and B (waitlisted), so
// tests get one confirmed and one non-confirmed token to check in against.
async function fullEventWithWaitlist(t: TestConvex<typeof schema>) {
  const { as } = await asOrganizer(t, "organizer@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await as.mutation(api.events.createEvent, {
    title: "One Seat",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 1,
  });
  await as.mutation(api.events.publishEvent, { eventId });
  const ev = await t.run((ctx) => ctx.db.get(eventId));
  const a = await t.mutation(api.rsvps.rsvp, { slug: ev!.slug, name: "A", email: "a@x.com" });
  const b = await t.mutation(api.rsvps.rsvp, { slug: ev!.slug, name: "B", email: "b@x.com" });
  return { as, eventId, a, b };
}

test("checkIn confirms a checked-in status for a confirmed rsvp", async () => {
  const t = convexTest(schema, modules);
  const { a } = await fullEventWithWaitlist(t);

  const result = await t.mutation(api.rsvps.checkIn, { token: a.token });
  expect(result).toEqual({ status: "checked_in" });

  const row = await t.run((ctx) =>
    ctx.db
      .query("rsvps")
      .withIndex("by_token", (q) => q.eq("token", a.token))
      .unique(),
  );
  expect(row?.status).toBe("checked_in");
});

test("checking in an already-checked-in rsvp returns already", async () => {
  const t = convexTest(schema, modules);
  const { a } = await fullEventWithWaitlist(t);

  await t.mutation(api.rsvps.checkIn, { token: a.token });
  const result = await t.mutation(api.rsvps.checkIn, { token: a.token });
  expect(result).toEqual({ status: "already" });
});

test("checking in a waitlisted rsvp's token returns not_confirmed", async () => {
  const t = convexTest(schema, modules);
  const { b } = await fullEventWithWaitlist(t);

  const result = await t.mutation(api.rsvps.checkIn, { token: b.token });
  expect(result).toEqual({ status: "not_confirmed" });
});

test("checkIn rejects an unknown token", async () => {
  const t = convexTest(schema, modules);

  await expect(t.mutation(api.rsvps.checkIn, { token: "does-not-exist" })).rejects.toThrow();
});

test("getDoorState reports checked-in/confirmed counts and recent check-ins", async () => {
  const t = convexTest(schema, modules);
  const { as, eventId, a, b } = await fullEventWithWaitlist(t);

  let state = await as.query(api.rsvps.getDoorState, { eventId });
  expect(state).toMatchObject({ checkedIn: 0, confirmed: 1, recent: [] });

  await t.mutation(api.rsvps.checkIn, { token: a.token });

  state = await as.query(api.rsvps.getDoorState, { eventId });
  expect(state.checkedIn).toBe(1);
  // Confirmed seats include checked-in attendees (still counts as a seat).
  expect(state.confirmed).toBe(1);
  expect(state.recent).toHaveLength(1);
  expect(state.recent[0]?.name).toBe("A");
  expect(typeof state.recent[0]?.at).toBe("number");

  // Checking in the waitlisted token is a no-op for counts (not_confirmed).
  await t.mutation(api.rsvps.checkIn, { token: b.token });
  state = await as.query(api.rsvps.getDoorState, { eventId });
  expect(state.checkedIn).toBe(1);
});

test("getDoorState rejects a non-owner organizer", async () => {
  const t = convexTest(schema, modules);
  const { eventId } = await fullEventWithWaitlist(t);
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});

  await expect(asBob.query(api.rsvps.getDoorState, { eventId })).rejects.toThrow();
});

test("getDoorState rejects an unauthenticated caller", async () => {
  const t = convexTest(schema, modules);
  const { eventId } = await fullEventWithWaitlist(t);

  await expect(t.query(api.rsvps.getDoorState, { eventId })).rejects.toThrow();
});
