// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

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

// Mirrors convex/eventContent.test.ts.
async function storeN(t: TestConvex<typeof schema>, n: number) {
  const ids: Id<"_storage">[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(await t.run((ctx) => ctx.storage.store(new Blob([`x${i}`], { type: "image/png" }))));
  }
  return ids;
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

test("deleteEvent purges the cover image and gallery files from storage", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await as.mutation(api.events.createEvent, {
    title: "Doomed Event With Media",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 5,
  });

  const [cover, galleryImage] = await storeN(t, 2);
  await as.mutation(api.eventContent.setCoverImage, { eventId, storageId: cover });
  await as.mutation(api.eventContent.setGallery, {
    eventId,
    images: [{ storageId: galleryImage }],
  });

  await as.mutation(api.events.deleteEvent, { eventId });

  expect(await t.run((ctx) => ctx.storage.getUrl(cover))).toBeNull();
  expect(await t.run((ctx) => ctx.storage.getUrl(galleryImage))).toBeNull();
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

test("updateEvent sets eventType/eventCategory/keywords/sharingDescription/currency together", async () => {
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
    title: "Original Title",
    description: "Original description.",
    startsAt: 100,
    endsAt: 200,
    location: "Original Location",
    capacity: 10,
    eventType: "Conference",
    eventCategory: "Business & professional",
    keywords: ["music", "live"],
    sharingDescription: "Come join us for a great time.",
    currency: "EUR",
  });

  const updated = await t.run((ctx) => ctx.db.get(eventId));
  expect(updated?.eventType).toBe("Conference");
  expect(updated?.eventCategory).toBe("Business & professional");
  expect(updated?.keywords).toEqual(["music", "live"]);
  expect(updated?.sharingDescription).toBe("Come join us for a great time.");
  expect(updated?.currency).toBe("EUR");
});

test("updateEvent rejects an invalid slug", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await as.mutation(api.events.createEvent, {
    title: "Original Title",
    description: "x",
    startsAt: 100,
    endsAt: 200,
    location: "x",
    capacity: 10,
  });

  await expect(
    as.mutation(api.events.updateEvent, {
      eventId,
      title: "Original Title",
      description: "x",
      startsAt: 100,
      endsAt: 200,
      location: "x",
      capacity: 10,
      slug: "Has Spaces",
    }),
  ).rejects.toThrow();

  await expect(
    as.mutation(api.events.updateEvent, {
      eventId,
      title: "Original Title",
      description: "x",
      startsAt: 100,
      endsAt: 200,
      location: "x",
      capacity: 10,
      slug: "-leading",
    }),
  ).rejects.toThrow();
});

test("updateEvent rejects a slug already used by another event, but allows keeping the event's own current slug", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await as.mutation(api.events.createEvent, {
    title: "First Event",
    description: "x",
    startsAt: 100,
    endsAt: 200,
    location: "x",
    capacity: 10,
  });
  const otherEventId = await as.mutation(api.events.createEvent, {
    title: "Second Event",
    description: "x",
    startsAt: 100,
    endsAt: 200,
    location: "x",
    capacity: 10,
  });
  const other = await t.run((ctx) => ctx.db.get(otherEventId));

  await expect(
    as.mutation(api.events.updateEvent, {
      eventId,
      title: "First Event",
      description: "x",
      startsAt: 100,
      endsAt: 200,
      location: "x",
      capacity: 10,
      slug: other!.slug,
    }),
  ).rejects.toThrow();

  const own = await t.run((ctx) => ctx.db.get(eventId));

  // Keeping the event's own current slug unchanged must not throw.
  await as.mutation(api.events.updateEvent, {
    eventId,
    title: "First Event",
    description: "x",
    startsAt: 100,
    endsAt: 200,
    location: "x",
    capacity: 10,
    slug: own!.slug,
  });

  const stillOwn = await t.run((ctx) => ctx.db.get(eventId));
  expect(stillOwn?.slug).toBe(own!.slug);
});

test("updateEvent rejects an invalid eventType and an invalid eventCategory", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await as.mutation(api.events.createEvent, {
    title: "Original Title",
    description: "x",
    startsAt: 100,
    endsAt: 200,
    location: "x",
    capacity: 10,
  });

  await expect(
    as.mutation(api.events.updateEvent, {
      eventId,
      title: "Original Title",
      description: "x",
      startsAt: 100,
      endsAt: 200,
      location: "x",
      capacity: 10,
      eventType: "Not A Type",
    }),
  ).rejects.toThrow();

  await expect(
    as.mutation(api.events.updateEvent, {
      eventId,
      title: "Original Title",
      description: "x",
      startsAt: 100,
      endsAt: 200,
      location: "x",
      capacity: 10,
      eventCategory: "Not A Category",
    }),
  ).rejects.toThrow();
});

test("updateEvent rejects more than 10 keywords", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await as.mutation(api.events.createEvent, {
    title: "Original Title",
    description: "x",
    startsAt: 100,
    endsAt: 200,
    location: "x",
    capacity: 10,
  });

  const tooMany = Array.from({ length: 11 }, (_, i) => `keyword-${i}`);

  await expect(
    as.mutation(api.events.updateEvent, {
      eventId,
      title: "Original Title",
      description: "x",
      startsAt: 100,
      endsAt: 200,
      location: "x",
      capacity: 10,
      keywords: tooMany,
    }),
  ).rejects.toThrow();
});

test("updateEvent rejects a sharingDescription longer than 160 characters", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await as.mutation(api.events.createEvent, {
    title: "Original Title",
    description: "x",
    startsAt: 100,
    endsAt: 200,
    location: "x",
    capacity: 10,
  });

  await expect(
    as.mutation(api.events.updateEvent, {
      eventId,
      title: "Original Title",
      description: "x",
      startsAt: 100,
      endsAt: 200,
      location: "x",
      capacity: 10,
      sharingDescription: "x".repeat(161),
    }),
  ).rejects.toThrow();
});

test("updateEvent trims and de-dupes keywords (case-sensitive)", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await as.mutation(api.events.createEvent, {
    title: "Original Title",
    description: "x",
    startsAt: 100,
    endsAt: 200,
    location: "x",
    capacity: 10,
  });

  await as.mutation(api.events.updateEvent, {
    eventId,
    title: "Original Title",
    description: "x",
    startsAt: 100,
    endsAt: 200,
    location: "x",
    capacity: 10,
    keywords: ["music", " Music ", "music", "live"],
  });

  const updated = await t.run((ctx) => ctx.db.get(eventId));
  expect(updated?.keywords).toEqual(["music", "Music", "live"]);
});

test("updateEvent rejects a non-owner setting the new fields on another organizer's event", async () => {
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
      title: "Ada's Gala",
      description: "Ada's own event.",
      startsAt: 10,
      endsAt: 20,
      location: "Ballroom",
      capacity: 40,
      eventType: "Conference",
      eventCategory: "Music",
      keywords: ["hijack"],
      sharingDescription: "Hijacked",
      currency: "USD",
    }),
  ).rejects.toThrow();

  const stillUntouched = await t.run((ctx) => ctx.db.get(eventId));
  expect(stillUntouched?.eventType).toBeUndefined();
  expect(stillUntouched?.eventCategory).toBeUndefined();
  expect(stillUntouched?.keywords).toBeUndefined();
  expect(stillUntouched?.sharingDescription).toBeUndefined();
});

test("updateEvent leaves omitted new fields untouched on a subsequent call", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await as.mutation(api.events.createEvent, {
    title: "Original Title",
    description: "x",
    startsAt: 100,
    endsAt: 200,
    location: "x",
    capacity: 10,
  });

  await as.mutation(api.events.updateEvent, {
    eventId,
    title: "Original Title",
    description: "x",
    startsAt: 100,
    endsAt: 200,
    location: "x",
    capacity: 10,
    eventType: "Conference",
  });

  const afterFirst = await t.run((ctx) => ctx.db.get(eventId));
  expect(afterFirst?.eventType).toBe("Conference");

  // Second call omits eventType but changes title -- eventType must survive.
  await as.mutation(api.events.updateEvent, {
    eventId,
    title: "Updated Title",
    description: "x",
    startsAt: 100,
    endsAt: 200,
    location: "x",
    capacity: 10,
  });

  const afterSecond = await t.run((ctx) => ctx.db.get(eventId));
  expect(afterSecond?.title).toBe("Updated Title");
  expect(afterSecond?.eventType).toBe("Conference");
});

test("updateEvent assigns an owned hostProfileId", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await as.mutation(api.events.createEvent, {
    title: "Original Title",
    description: "x",
    startsAt: 100,
    endsAt: 200,
    location: "x",
    capacity: 10,
  });
  const hostProfileId = await as.mutation(api.hostProfiles.create, { name: "Ada's Events" });

  await as.mutation(api.events.updateEvent, {
    eventId,
    title: "Original Title",
    description: "x",
    startsAt: 100,
    endsAt: 200,
    location: "x",
    capacity: 10,
    hostProfileId,
  });

  const updated = await t.run((ctx) => ctx.db.get(eventId));
  expect(updated?.hostProfileId).toEqual(hostProfileId);
});

test("updateEvent rejects a hostProfileId owned by another organizer", async () => {
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
  const bobsHostProfileId = await asBob.mutation(api.hostProfiles.create, { name: "Bob's Events" });

  await expect(
    asAda.mutation(api.events.updateEvent, {
      eventId,
      title: "Ada's Gala",
      description: "Ada's own event.",
      startsAt: 10,
      endsAt: 20,
      location: "Ballroom",
      capacity: 40,
      hostProfileId: bobsHostProfileId,
    }),
  ).rejects.toThrow();

  const stillUntouched = await t.run((ctx) => ctx.db.get(eventId));
  expect(stillUntouched?.hostProfileId).toBeUndefined();
});

test("updateEvent clears hostProfileId to undefined when passed null", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await as.mutation(api.events.createEvent, {
    title: "Original Title",
    description: "x",
    startsAt: 100,
    endsAt: 200,
    location: "x",
    capacity: 10,
  });
  const hostProfileId = await as.mutation(api.hostProfiles.create, { name: "Ada's Events" });

  await as.mutation(api.events.updateEvent, {
    eventId,
    title: "Original Title",
    description: "x",
    startsAt: 100,
    endsAt: 200,
    location: "x",
    capacity: 10,
    hostProfileId,
  });

  await as.mutation(api.events.updateEvent, {
    eventId,
    title: "Original Title",
    description: "x",
    startsAt: 100,
    endsAt: 200,
    location: "x",
    capacity: 10,
    hostProfileId: null,
  });

  const updated = await t.run((ctx) => ctx.db.get(eventId));
  expect(updated?.hostProfileId).toBeUndefined();
});

test("updateEvent omitting hostProfileId leaves it untouched", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await as.mutation(api.events.createEvent, {
    title: "Original Title",
    description: "x",
    startsAt: 100,
    endsAt: 200,
    location: "x",
    capacity: 10,
  });
  const hostProfileId = await as.mutation(api.hostProfiles.create, { name: "Ada's Events" });

  await as.mutation(api.events.updateEvent, {
    eventId,
    title: "Original Title",
    description: "x",
    startsAt: 100,
    endsAt: 200,
    location: "x",
    capacity: 10,
    hostProfileId,
  });

  // Second call omits hostProfileId but changes title -- hostProfileId must survive.
  await as.mutation(api.events.updateEvent, {
    eventId,
    title: "Updated Title",
    description: "x",
    startsAt: 100,
    endsAt: 200,
    location: "x",
    capacity: 10,
  });

  const updated = await t.run((ctx) => ctx.db.get(eventId));
  expect(updated?.title).toBe("Updated Title");
  expect(updated?.hostProfileId).toEqual(hostProfileId);
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

test("getMyEventsKpis sums denormalized counters over all events", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const now = 1_000_000_000_000;
  // One upcoming published, one past draft. Set counters directly.
  const e1 = await as.mutation(api.events.createEvent, {
    title: "Upcoming", description: "x", startsAt: now + 1000, endsAt: now + 2000, location: "H", capacity: 100,
  });
  await as.mutation(api.events.publishEvent, { eventId: e1 });
  const e2 = await as.mutation(api.events.createEvent, {
    title: "Past", description: "x", startsAt: now - 2000, endsAt: now - 1000, location: "H", capacity: 50,
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(e1, { seatsTaken: 30, ticketsSold: 10, revenueCents: 20000 });
    await ctx.db.patch(e2, { seatsTaken: 5, ticketsSold: 2, revenueCents: 4000 });
  });

  const k = await as.query(api.events.getMyEventsKpis, { now });
  expect(k.total).toBe(2);
  expect(k.published).toBe(1);
  expect(k.draft).toBe(1);
  expect(k.upcoming).toBe(1); // only e1 has endsAt >= now
  expect(k.attendees).toBe(35);
  expect(k.ticketsSold).toBe(12);
  expect(k.revenueCents).toBe(24000);
  expect(k.nextStartsAt).toBe(now + 1000); // e1 is the only not-yet-started event
});

test("getMyEventsKpis returns zeros when unauthenticated", async () => {
  const t = convexTest(schema, modules);
  const k = await t.query(api.events.getMyEventsKpis, { now: 1 });
  expect(k).toEqual({ total: 0, published: 0, draft: 0, upcoming: 0, attendees: 0, revenueCents: 0, ticketsSold: 0, currency: "USD", nextStartsAt: null });
});

test("getMyEventsKpis treats pre-backfill (undefined) counters as 0, not NaN", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const now = 1_000_000_000_000;
  const e1 = await as.mutation(api.events.createEvent, {
    title: "Has stats", description: "x", startsAt: now + 1000, endsAt: now + 2000, location: "H", capacity: 100,
  });
  const organizerId = (await t.run((ctx) => ctx.db.get(e1)))!.organizerId;
  await t.run((ctx) => ctx.db.patch(e1, { seatsTaken: 7, ticketsSold: 3, revenueCents: 5000 }));
  // Raw event WITHOUT the denormalized counters (simulates pre-backfill data).
  await t.run((ctx) =>
    ctx.db.insert("events", {
      organizerId, title: "No stats", description: "x", startsAt: now + 1000, endsAt: now + 2000,
      location: "H", capacity: 50, status: "draft", slug: "no-stats-xyz",
    }),
  );

  const k = await as.query(api.events.getMyEventsKpis, { now });
  expect(k.total).toBe(2);
  // Undefined counters must fold in as 0, not NaN -> only passes with `?? 0`.
  expect(k.attendees).toBe(7);
  expect(k.ticketsSold).toBe(3);
  expect(k.revenueCents).toBe(5000);
  expect(Number.isFinite(k.attendees)).toBe(true);
});

test("listMyEventsPage: tab filter, sort, search, and numbered slicing", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const now = 1_000_000_000_000;
  const mk = async (title: string, startsAt: number, endsAt: number, seatsTaken: number, capacity: number) => {
    const id = await as.mutation(api.events.createEvent, {
      title, description: "x", startsAt, endsAt, location: "Town Hall", capacity,
    });
    await t.run((ctx) => ctx.db.patch(id, { seatsTaken }));
    return id;
  };
  // 3 upcoming, 2 past.
  await mk("Alpha", now + 3000, now + 4000, 10, 100); // fill 0.10
  await mk("Bravo", now + 1000, now + 2000, 90, 100); // fill 0.90, soonest
  await mk("Charlie", now + 5000, now + 6000, 50, 100);
  await mk("Delta Past", now - 4000, now - 3000, 25, 100);
  await mk("Echo Past", now - 8000, now - 7000, 15, 100); // older than Delta Past

  // Upcoming tab, date sort (soonest first), page 1 of 2.
  const p1 = await as.query(api.events.listMyEventsPage, {
    tab: "upcoming", status: "all", sort: "date", search: "", page: 1, pageSize: 2, now,
  });
  expect(p1.total).toBe(3);
  expect(p1.pageCount).toBe(2);
  expect(p1.rows.map((r) => r.title)).toEqual(["Bravo", "Alpha"]); // soonest-first
  const p2 = await as.query(api.events.listMyEventsPage, {
    tab: "upcoming", status: "all", sort: "date", search: "", page: 2, pageSize: 2, now,
  });
  expect(p2.rows.map((r) => r.title)).toEqual(["Charlie"]);

  // Fill sort (fullest first) across all upcoming.
  const byFill = await as.query(api.events.listMyEventsPage, {
    tab: "upcoming", status: "all", sort: "fill", search: "", page: 1, pageSize: 10, now,
  });
  expect(byFill.rows.map((r) => r.title)).toEqual(["Bravo", "Charlie", "Alpha"]);

  // Past tab, date sort -> most-recent-first (Delta is more recent than Echo).
  const past = await as.query(api.events.listMyEventsPage, {
    tab: "past", status: "all", sort: "date", search: "", page: 1, pageSize: 10, now,
  });
  expect(past.rows.map((r) => r.title)).toEqual(["Delta Past", "Echo Past"]);

  // All tab, date sort -> by startsAt descending (most recent first) across the whole set.
  const allByDate = await as.query(api.events.listMyEventsPage, {
    tab: "all", status: "all", sort: "date", search: "", page: 1, pageSize: 10, now,
  });
  expect(allByDate.rows.map((r) => r.title)).toEqual(["Charlie", "Alpha", "Bravo", "Delta Past", "Echo Past"]);

  // Search matches location on the All tab (all five share "Town Hall").
  const search = await as.query(api.events.listMyEventsPage, {
    tab: "all", status: "all", sort: "name", search: "town hall", page: 1, pageSize: 10, now,
  });
  expect(search.total).toBe(5);
  expect(search.rows.map((r) => r.title)).toEqual(["Alpha", "Bravo", "Charlie", "Delta Past", "Echo Past"]);

  // Page clamps beyond the end.
  const clamped = await as.query(api.events.listMyEventsPage, {
    tab: "upcoming", status: "all", sort: "date", search: "", page: 99, pageSize: 2, now,
  });
  expect(clamped.page).toBe(2);
});

test("listMyEventsPage: status filter + per-row spark endpoint, empty when unauth", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const now = 1_000_000_000_000;
  const pub = await as.mutation(api.events.createEvent, {
    title: "Pub", description: "x", startsAt: now + 1000, endsAt: now + 2000, location: "H", capacity: 10,
  });
  await as.mutation(api.events.publishEvent, { eventId: pub });
  await as.mutation(api.events.createEvent, {
    title: "Draft", description: "x", startsAt: now + 1000, endsAt: now + 2000, location: "H", capacity: 10,
  });
  // Give the published event 2 seat-holding rsvps.
  await t.run(async (ctx) => {
    await ctx.db.insert("rsvps", { eventId: pub, name: "A", email: "a@x.co", token: "t1", status: "confirmed" });
    await ctx.db.insert("rsvps", { eventId: pub, name: "B", email: "b@x.co", token: "t2", status: "checked_in" });
    await ctx.db.patch(pub, { seatsTaken: 2 });
  });

  const onlyPub = await as.query(api.events.listMyEventsPage, {
    tab: "all", status: "published", sort: "date", search: "", page: 1, pageSize: 10, now,
  });
  expect(onlyPub.rows.map((r) => r.title)).toEqual(["Pub"]);
  const row = onlyPub.rows[0];
  expect(row.spark[row.spark.length - 1]).toBe(row.seatsTaken); // spark endpoint == seatsTaken
  expect(row.seatsTaken).toBe(2);

  const unauth = await t.query(api.events.listMyEventsPage, {
    tab: "all", status: "all", sort: "date", search: "", page: 1, pageSize: 10, now,
  });
  expect(unauth).toEqual({ rows: [], page: 1, pageCount: 0, total: 0 });
});
