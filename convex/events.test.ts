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

test("getMyEventWithRsvps buckets rsvps by status and sorts the waitlist", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await as.mutation(api.events.createEvent, {
    title: "Bucket Test",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 3,
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("rsvps", {
      eventId,
      name: "Confirmed One",
      email: "c1@example.com",
      token: "t-confirmed-1",
      status: "confirmed",
    });
    await ctx.db.insert("rsvps", {
      eventId,
      name: "Pending One",
      email: "p1@example.com",
      token: "t-pending-1",
      status: "confirmed_pending_claim",
      claimExpiresAt: Date.now() + 1000,
    });
    await ctx.db.insert("rsvps", {
      eventId,
      name: "Waitlist Two",
      email: "w2@example.com",
      token: "t-waitlist-2",
      status: "waitlisted",
      waitlistPosition: 2,
    });
    await ctx.db.insert("rsvps", {
      eventId,
      name: "Waitlist One",
      email: "w1@example.com",
      token: "t-waitlist-1",
      status: "waitlisted",
      waitlistPosition: 1,
    });
    await ctx.db.insert("rsvps", {
      eventId,
      name: "Cancelled One",
      email: "x1@example.com",
      token: "t-cancelled-1",
      status: "cancelled",
    });
  });

  const result = await as.query(api.events.getMyEventWithRsvps, { eventId });

  expect(result.event._id).toEqual(eventId);
  expect(result.confirmed.map((r) => r.name)).toEqual(["Confirmed One"]);
  expect(result.pendingClaim.map((r) => r.name)).toEqual(["Pending One"]);
  // Ascending by waitlistPosition, not insertion order.
  expect(result.waitlisted.map((r) => r.name)).toEqual(["Waitlist One", "Waitlist Two"]);
});

test("a second organizer cannot read another organizer's rsvps via getMyEventWithRsvps", async () => {
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

  await expect(asBob.query(api.events.getMyEventWithRsvps, { eventId })).rejects.toThrow();
});

test("updateEvent lets the owner change fields", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await as.mutation(api.events.createEvent, {
    title: "Original Title",
    description: "Original description.",
    startsAt: 100,
    endsAt: 200,
    location: "Original Location",
    capacity: 10,
  });

  await as.mutation(api.events.updateEvent, {
    eventId,
    title: "Updated Title",
    description: "Updated description.",
    startsAt: 300,
    endsAt: 400,
    location: "Updated Location",
    capacity: 20,
  });

  const updated = await t.run((ctx) => ctx.db.get(eventId));
  expect(updated?.title).toBe("Updated Title");
  expect(updated?.description).toBe("Updated description.");
  expect(updated?.startsAt).toBe(300);
  expect(updated?.endsAt).toBe(400);
  expect(updated?.location).toBe("Updated Location");
  expect(updated?.capacity).toBe(20);
});

test("updateEvent rejects lowering capacity below seats already taken", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await as.mutation(api.events.createEvent, {
    title: "Small Venue",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 10,
  });

  // Seed 3 confirmed (seat-holding) rsvps directly, bypassing the rsvp mutation.
  await t.run(async (ctx) => {
    for (let i = 0; i < 3; i++) {
      await ctx.db.insert("rsvps", {
        eventId,
        name: `Confirmed ${i}`,
        email: `c${i}@example.com`,
        token: `t-confirmed-${i}`,
        status: "confirmed",
      });
    }
  });

  await expect(
    as.mutation(api.events.updateEvent, {
      eventId,
      title: "Small Venue",
      description: "x",
      startsAt: 1,
      endsAt: 2,
      location: "x",
      capacity: 2,
    }),
  ).rejects.toThrow();

  // The rejected update must not have altered capacity.
  const stillTen = await t.run((ctx) => ctx.db.get(eventId));
  expect(stillTen?.capacity).toBe(10);
});

test("updateEvent raising capacity promotes the next waitlister to a pending claim", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await as.mutation(api.events.createEvent, {
    title: "One Seat",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 1,
  });

  const waitlistedId = await t.run(async (ctx) => {
    await ctx.db.insert("rsvps", {
      eventId,
      name: "Confirmed One",
      email: "c1@example.com",
      token: "t-confirmed-1",
      status: "confirmed",
    });
    return ctx.db.insert("rsvps", {
      eventId,
      name: "Waitlisted One",
      email: "w1@example.com",
      token: "t-waitlisted-1",
      status: "waitlisted",
      waitlistPosition: 1,
    });
  });

  await as.mutation(api.events.updateEvent, {
    eventId,
    title: "One Seat",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 2,
  });

  const promoted = await t.run((ctx) => ctx.db.get(waitlistedId));
  expect(promoted?.status).toBe("confirmed_pending_claim");
  expect(promoted?.claimExpiresAt ?? 0).toBeGreaterThan(0);
  expect(promoted?.waitlistPosition).toBeUndefined();
});

test("a second organizer cannot update or delete another organizer's event", async () => {
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

  await expect(
    asBob.mutation(api.events.updateEvent, {
      eventId,
      title: "Hijacked",
      description: "x",
      startsAt: 1,
      endsAt: 2,
      location: "x",
      capacity: 5,
    }),
  ).rejects.toThrow();
  await expect(asBob.mutation(api.events.deleteEvent, { eventId })).rejects.toThrow();

  // Bob's rejected calls must not have altered Ada's event.
  const stillThere = await t.run((ctx) => ctx.db.get(eventId));
  expect(stillThere?.title).toBe("Ada's Gala");
});

test("deleteEvent removes the event and all of its rsvps", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await as.mutation(api.events.createEvent, {
    title: "Doomed Event",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 5,
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("rsvps", {
      eventId,
      name: "Confirmed One",
      email: "c1@example.com",
      token: "t-confirmed-1",
      status: "confirmed",
    });
    await ctx.db.insert("rsvps", {
      eventId,
      name: "Waitlisted One",
      email: "w1@example.com",
      token: "t-waitlisted-1",
      status: "waitlisted",
      waitlistPosition: 1,
    });
  });

  await as.mutation(api.events.deleteEvent, { eventId });

  const gone = await t.run((ctx) => ctx.db.get(eventId));
  expect(gone).toBeNull();

  const remainingRsvps = await t.run((ctx) =>
    ctx.db
      .query("rsvps")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect(),
  );
  expect(remainingRsvps).toEqual([]);
});
