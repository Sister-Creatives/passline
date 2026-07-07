// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { CLAIM_WINDOW_MS } from "./lib/constants";

// Passed explicitly for the same pnpm module-resolution reason documented in
// schema.test.ts.
const modules = import.meta.glob("./**/*.*s");

// Authenticate as an organizer by inserting a real users + session row and
// handing withIdentity the `${userId}|${sessionId}` subject Convex Auth uses
// (see auth.test.ts for the derivation).
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

// Publish a capacity-1 event, then RSVP A (confirmed) and B (waitlisted).
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
  return { slug: ev!.slug, a, b, eventId };
}

function byToken(t: TestConvex<typeof schema>, token: string) {
  return t.run((ctx) =>
    ctx.db
      .query("rsvps")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique(),
  );
}

test("cancelling a confirmed seat promotes the next waitlisted person to pending claim", async () => {
  const t = convexTest(schema, modules);
  const { a, b } = await fullEventWithWaitlist(t);
  expect(a.status).toBe("confirmed");
  expect(b.status).toBe("waitlisted");

  await t.mutation(api.rsvps.cancelRsvp, { token: a.token });

  const bRow = await byToken(t, b.token);
  expect(bRow?.status).toBe("confirmed_pending_claim");
  expect(bRow?.claimExpiresAt ?? 0).toBeGreaterThan(0);
  expect(bRow?.waitlistPosition).toBeUndefined();
});

test("claiming within the window confirms the seat", async () => {
  const t = convexTest(schema, modules);
  const { a, b } = await fullEventWithWaitlist(t);
  await t.mutation(api.rsvps.cancelRsvp, { token: a.token });

  const res = await t.mutation(api.rsvps.claimSpot, { token: b.token });
  expect(res.status).toBe("confirmed");

  const bRow = await byToken(t, b.token);
  expect(bRow?.status).toBe("confirmed");
  expect(bRow?.claimExpiresAt).toBeUndefined();
});

test("an expired hold reverts to the waitlist and the seat is offered again", async () => {
  const t = convexTest(schema, modules);
  const { a, b } = await fullEventWithWaitlist(t);
  await t.mutation(api.rsvps.cancelRsvp, { token: a.token });

  // Force the hold to look expired, then run the deterministic sweep.
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("rsvps")
      .withIndex("by_token", (q) => q.eq("token", b.token))
      .unique();
    await ctx.db.patch(row!._id, { claimExpiresAt: 1 });
  });
  const sweepNow = 10 + CLAIM_WINDOW_MS;
  const reprocessed = await t.mutation(internal.waitlist.sweepExpiredClaims, {
    now: sweepNow,
  });
  expect(reprocessed).toBeGreaterThanOrEqual(1);

  // B was the only waitlister, so after expiry the sweep re-offers the same
  // seat back to B with a fresh claim window -- a deterministic outcome, so
  // assert it exactly rather than accepting the intermediate waitlisted state.
  const bRow = await byToken(t, b.token);
  expect(bRow?.status).toBe("confirmed_pending_claim");
  expect(bRow?.claimExpiresAt ?? 0).toBeGreaterThan(sweepNow);
});

test("claiming after expiry returns expired and does not confirm", async () => {
  const t = convexTest(schema, modules);
  const { a, b } = await fullEventWithWaitlist(t);
  await t.mutation(api.rsvps.cancelRsvp, { token: a.token });

  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("rsvps")
      .withIndex("by_token", (q) => q.eq("token", b.token))
      .unique();
    await ctx.db.patch(row!._id, { claimExpiresAt: 1 });
  });

  const res = await t.mutation(api.rsvps.claimSpot, { token: b.token });
  expect(res.status).toBe("expired");
});

test("promotion offers the seat to the lowest waitlist position first", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "organizer2@example.com");
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
  const c = await t.mutation(api.rsvps.rsvp, { slug: ev!.slug, name: "C", email: "c@x.com" });
  expect(b.status).toBe("waitlisted");
  expect(c.status).toBe("waitlisted");
  expect(b.waitlistPosition).toBe(1);
  expect(c.waitlistPosition).toBe(2);

  await t.mutation(api.rsvps.cancelRsvp, { token: a.token });

  const bRow = await byToken(t, b.token);
  const cRow = await byToken(t, c.token);
  expect(bRow?.status).toBe("confirmed_pending_claim");
  expect(cRow?.status).toBe("waitlisted");
  expect(cRow?.waitlistPosition).toBe(2);
});
