// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { computeReadiness } from "./lib/readiness";

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

test("duplicateEvent creates a draft copy with a distinct slug, deep-copies config, and excludes orders/tickets", async () => {
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
  await as.mutation(api.events.publishEvent, { eventId });

  const ticketTypeId = await as.mutation(api.ticketTypes.create, {
    eventId,
    name: "General",
    kind: "free",
    priceCents: 0,
  });
  await as.mutation(api.checkoutQuestions.create, {
    eventId,
    label: "T-shirt size",
    kind: "text",
    required: false,
  });
  await as.mutation(api.addOns.create, {
    eventId,
    name: "Poster",
    priceCents: 500,
  });
  await as.mutation(api.eventContent.update, {
    eventId,
    coverImageUrl: "https://example.com/cover.jpg",
    brandColor: "#112233",
    ctaLabel: "Register",
    videoUrl: undefined,
    agenda: [{ time: "10:00", title: "Doors open" }],
    speakers: [{ name: "Ada Lovelace" }],
    faqs: [{ question: "Is it free?", answer: "Yes." }],
  });
  await as.mutation(api.marketing.updateTrackingPixels, {
    eventId,
    metaPixelId: "pixel-123",
    googleAnalyticsId: "G-ABC123",
    gtmId: "GTM-XYZ",
  });
  await as.mutation(api.virtualHub.update, {
    eventId,
    enabled: true,
    heading: "Join us online",
    description: "Stream the show live.",
    videoUrl: undefined,
    meetingUrl: "https://meet.example.com/room",
    resources: [{ title: "Slides", url: "https://example.com/slides" }],
    accessPassword: "secret",
  });

  // Seed activity that must NOT be copied.
  await as.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
  });

  const newEventId = await as.mutation(api.events.duplicateEvent, { eventId });

  const source = await t.run((ctx) => ctx.db.get(eventId));
  const copy = await t.run((ctx) => ctx.db.get(newEventId));
  expect(copy?.status).toBe("draft");
  expect(copy?.title).toBe("Rooftop Jazz (Copy)");
  expect(copy?.slug).not.toBe(source?.slug);
  expect(copy?.description).toBe("Live jazz night.");
  expect(copy?.startsAt).toBe(100);
  expect(copy?.endsAt).toBe(200);
  expect(copy?.location).toBe("Rooftop");
  expect(copy?.capacity).toBe(80);
  expect(copy?.organizerId).toEqual(source?.organizerId);

  const copiedTicketTypes = await t.run((ctx) =>
    ctx.db
      .query("ticketTypes")
      .withIndex("by_event", (q) => q.eq("eventId", newEventId))
      .collect(),
  );
  expect(copiedTicketTypes).toHaveLength(1);
  expect(copiedTicketTypes[0].name).toBe("General");
  expect(copiedTicketTypes[0].sold).toBe(0);
  expect(copiedTicketTypes[0]._id).not.toBe(ticketTypeId);

  const copiedQuestions = await t.run((ctx) =>
    ctx.db
      .query("checkoutQuestions")
      .withIndex("by_event", (q) => q.eq("eventId", newEventId))
      .collect(),
  );
  expect(copiedQuestions).toHaveLength(1);
  expect(copiedQuestions[0].label).toBe("T-shirt size");

  const copiedAddOns = await t.run((ctx) =>
    ctx.db
      .query("addOns")
      .withIndex("by_event", (q) => q.eq("eventId", newEventId))
      .collect(),
  );
  expect(copiedAddOns).toHaveLength(1);
  expect(copiedAddOns[0].name).toBe("Poster");
  expect(copiedAddOns[0].sold).toBe(0);

  const copiedContent = await t.run((ctx) =>
    ctx.db
      .query("eventContent")
      .withIndex("by_event", (q) => q.eq("eventId", newEventId))
      .unique(),
  );
  expect(copiedContent?.brandColor).toBe("#112233");
  expect(copiedContent?.agenda).toEqual([
    { time: "10:00", title: "Doors open", description: undefined },
  ]);

  expect(copy?.metaPixelId).toBe("pixel-123");
  expect(copy?.googleAnalyticsId).toBe("G-ABC123");
  expect(copy?.gtmId).toBe("GTM-XYZ");

  const copiedHub = await t.run((ctx) =>
    ctx.db
      .query("virtualHubs")
      .withIndex("by_event", (q) => q.eq("eventId", newEventId))
      .unique(),
  );
  expect(copiedHub).not.toBeNull();
  expect(copiedHub?.enabled).toBe(true);
  expect(copiedHub?.heading).toBe("Join us online");
  expect(copiedHub?.description).toBe("Stream the show live.");
  expect(copiedHub?.meetingUrl).toBe("https://meet.example.com/room");
  expect(copiedHub?.resources).toEqual([
    { title: "Slides", url: "https://example.com/slides" },
  ]);
  expect(copiedHub?.accessPassword).toBe("secret");
  expect(copiedHub?.eventId).toBe(newEventId);

  // The source's orders/tickets must never appear against the copy.
  const copiedOrders = await t.run((ctx) =>
    ctx.db
      .query("orders")
      .withIndex("by_event", (q) => q.eq("eventId", newEventId))
      .collect(),
  );
  expect(copiedOrders).toEqual([]);

  const copiedTickets = await t.run((ctx) =>
    ctx.db
      .query("tickets")
      .withIndex("by_event", (q) => q.eq("eventId", newEventId))
      .collect(),
  );
  expect(copiedTickets).toEqual([]);
});

test("duplicateEvent is owner-only", async () => {
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

  await expect(asBob.mutation(api.events.duplicateEvent, { eventId })).rejects.toThrow();

  // Bob's rejected call must not have created anything under his account.
  const bobEvents = await asBob.query(api.events.listMyEvents, {});
  expect(bobEvents).toEqual([]);
});

test("listPublishedByOrganizer returns only that organizer's published events, sorted by startsAt", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  const adaOrganizerId = await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});

  const later = await asAda.mutation(api.events.createEvent, {
    title: "Later Event",
    description: "x",
    startsAt: 200,
    endsAt: 300,
    location: "Later Place",
    capacity: 5,
  });
  await asAda.mutation(api.events.publishEvent, { eventId: later });

  const earlier = await asAda.mutation(api.events.createEvent, {
    title: "Earlier Event",
    description: "x",
    startsAt: 100,
    endsAt: 150,
    location: "Earlier Place",
    capacity: 5,
  });
  await asAda.mutation(api.events.publishEvent, { eventId: earlier });

  const draft = await asAda.mutation(api.events.createEvent, {
    title: "Still Draft",
    description: "x",
    startsAt: 50,
    endsAt: 60,
    location: "z",
    capacity: 5,
  });

  const bobEvent = await asBob.mutation(api.events.createEvent, {
    title: "Bob Event",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 5,
  });
  await asBob.mutation(api.events.publishEvent, { eventId: bobEvent });

  // Called unauthenticated -- this is a public query.
  const listed = await t.query(api.events.listPublishedByOrganizer, {
    organizerId: adaOrganizerId,
  });

  expect(listed.map((e) => e.id)).toEqual([earlier, later]);
  expect(listed[0]).toEqual({
    id: earlier,
    title: "Earlier Event",
    slug: expect.any(String),
    startsAt: 100,
    endsAt: 150,
    location: "Earlier Place",
  });
  expect(listed.some((e) => e.id === draft)).toBe(false);
  expect(listed.some((e) => e.id === bobEvent)).toBe(false);
});

// Future window so the recommended `date` rule passes in these tests.
async function makeFutureEvent(as: Awaited<ReturnType<typeof asOrganizer>>["as"]) {
  return as.mutation(api.events.createEvent, {
    title: "Gala", description: "x", location: "Hall",
    startsAt: Date.now() + 3_600_000, endsAt: Date.now() + 7_200_000, capacity: 100,
  });
}

test("getEventReadiness is owner-only and reflects state", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeFutureEvent(asAda);

  // No ticket types -> publishable as free RSVP.
  const r1 = await asAda.query(api.events.getEventReadiness, { eventId });
  expect(r1.canPublish).toBe(true);

  await expect(asBob.query(api.events.getEventReadiness, { eventId })).rejects.toThrow();
});

test("publishEvent rejects an unreachable ticketed event, then succeeds when a type is visible", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeFutureEvent(as);

  const hiddenId = await as.mutation(api.ticketTypes.create, {
    eventId, name: "VIP", kind: "paid", priceCents: 5000, visibility: "hidden",
  });
  await expect(as.mutation(api.events.publishEvent, { eventId })).rejects.toThrow(/Cannot publish/);

  await as.mutation(api.ticketTypes.update, {
    ticketTypeId: hiddenId, name: "VIP", kind: "paid", priceCents: 5000, visibility: "visible",
  });
  await as.mutation(api.events.publishEvent, { eventId });
  const ev = await t.run((ctx) => ctx.db.get(eventId));
  expect(ev?.status).toBe("published");
});

test("a zero-ticket RSVP draft still publishes (past dates allowed)", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Meetup", description: "x", location: "y", startsAt: 100, endsAt: 200, capacity: 10,
  });
  await as.mutation(api.events.publishEvent, { eventId });
  const ev = await t.run((ctx) => ctx.db.get(eventId));
  expect(ev?.status).toBe("published");
});

test("getPublicProfile returns an organizer's name/image, or null when not found", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});

  const profile = await t.query(api.organizers.getPublicProfile, { organizerId });
  expect(profile).toEqual({ name: "ada@example.com", image: undefined });

  const deletedId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("organizers", { name: "Temp", email: "temp@example.com" });
    await ctx.db.delete(id);
    return id;
  });
  const missing = await t.query(api.organizers.getPublicProfile, { organizerId: deletedId });
  expect(missing).toBeNull();
});
