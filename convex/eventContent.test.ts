// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { isValidHexColor, parseVideoEmbed } from "./lib/eventContent";

const modules = import.meta.glob("./**/*.*s");

// Mirrors convex/checkoutQuestions.test.ts: insert a real users row + session
// and hand withIdentity a matching subject so getAuthUserId resolves.
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

async function makeEvent(as: ReturnType<TestConvex<typeof schema>["withIdentity"]>, capacity = 100) {
  return as.mutation(api.events.createEvent, {
    title: "Content Event",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity,
  });
}

async function storeN(t: TestConvex<typeof schema>, n: number) {
  const ids: Id<"_storage">[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(await t.run((ctx) => ctx.storage.store(new Blob([`x${i}`], { type: "image/png" }))));
  }
  return ids;
}

const baseUpdateArgs = { agenda: [], speakers: [], faqs: [] };

// --- isValidHexColor ----------------------------------------------------

test("isValidHexColor accepts a well-formed 6-digit hex color", () => {
  expect(isValidHexColor("#1a2b3c")).toBe(true);
  expect(isValidHexColor("#ABCDEF")).toBe(true);
});

test("isValidHexColor rejects a named color", () => {
  expect(isValidHexColor("red")).toBe(false);
});

test("isValidHexColor rejects a 3-digit shorthand hex", () => {
  expect(isValidHexColor("#fff")).toBe(false);
});

test("isValidHexColor rejects an injection string", () => {
  expect(isValidHexColor('#fff"><script>alert(1)</script>')).toBe(false);
  expect(isValidHexColor("#123456; background:url(javascript:alert(1))")).toBe(false);
});

// --- parseVideoEmbed -----------------------------------------------------

test("parseVideoEmbed extracts the id from a YouTube watch?v= URL", () => {
  expect(parseVideoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
    provider: "youtube",
    id: "dQw4w9WgXcQ",
  });
});

test("parseVideoEmbed extracts the id from a youtu.be short URL", () => {
  expect(parseVideoEmbed("https://youtu.be/dQw4w9WgXcQ")).toEqual({
    provider: "youtube",
    id: "dQw4w9WgXcQ",
  });
});

test("parseVideoEmbed extracts the id from a YouTube /embed/ URL", () => {
  expect(parseVideoEmbed("https://www.youtube.com/embed/dQw4w9WgXcQ")).toEqual({
    provider: "youtube",
    id: "dQw4w9WgXcQ",
  });
});

test("parseVideoEmbed extracts the id from a Vimeo URL", () => {
  expect(parseVideoEmbed("https://vimeo.com/76979871")).toEqual({
    provider: "vimeo",
    id: "76979871",
  });
});

test("parseVideoEmbed rejects an arbitrary non-video URL", () => {
  expect(parseVideoEmbed("https://example.com/video")).toBeNull();
});

test("parseVideoEmbed rejects a malformed URL", () => {
  expect(parseVideoEmbed("not a url")).toBeNull();
});

test("parseVideoEmbed rejects a YouTube URL whose id contains unsafe characters", () => {
  expect(parseVideoEmbed('https://www.youtube.com/watch?v=abc"><script>')).toBeNull();
});

test("parseVideoEmbed rejects a Vimeo URL whose id isn't purely digits", () => {
  expect(parseVideoEmbed("https://vimeo.com/abc123")).toBeNull();
});

test("parseVideoEmbed rejects a javascript: URL", () => {
  expect(parseVideoEmbed("javascript:alert(1)")).toBeNull();
});

// --- get -----------------------------------------------------------------

test("get returns an empty default when no content has been saved yet", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  const content = await as.query(api.eventContent.get, { eventId });
  expect(content).toEqual({ agenda: [], speakers: [], faqs: [] });
});

test("get is owner-only", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);

  await expect(asBob.query(api.eventContent.get, { eventId })).rejects.toThrow();
});

// --- update ----------------------------------------------------------------

test("update inserts on first save and patches (upserts) on the next", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  const firstId = await as.mutation(api.eventContent.update, {
    eventId,
    coverImageUrl: "https://example.com/cover.jpg",
    brandColor: "#1a2b3c",
    ctaLabel: "Register",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    agenda: [{ time: "10:00", title: "Doors open" }],
    speakers: [{ name: "Ada Lovelace", title: "Keynote" }],
    faqs: [{ question: "Refunds?", answer: "Yes, within 30 days." }],
  });

  const rowsAfterFirst = await t.run((ctx) =>
    ctx.db.query("eventContent").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(rowsAfterFirst).toHaveLength(1);
  expect(rowsAfterFirst[0]._id).toEqual(firstId);
  expect(rowsAfterFirst[0].brandColor).toBe("#1a2b3c");
  expect(rowsAfterFirst[0].ctaLabel).toBe("Register");

  const secondId = await as.mutation(api.eventContent.update, {
    eventId,
    ctaLabel: "Donate",
    agenda: [],
    speakers: [],
    faqs: [],
  });

  const rowsAfterSecond = await t.run((ctx) =>
    ctx.db.query("eventContent").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(rowsAfterSecond).toHaveLength(1);
  expect(secondId).toEqual(firstId);
  expect(rowsAfterSecond[0].ctaLabel).toBe("Donate");
  // Fields omitted on the second save clear (an omitted/empty field means
  // "clear this field"), mirroring marketing.updateTrackingPixels.
  expect(rowsAfterSecond[0].coverImageUrl).toBeUndefined();
  expect(rowsAfterSecond[0].brandColor).toBeUndefined();
  expect(rowsAfterSecond[0].videoUrl).toBeUndefined();
});

test("update rejects a bad hex color", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  await expect(
    as.mutation(api.eventContent.update, { eventId, brandColor: "red", ...baseUpdateArgs }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.eventContent.update, { eventId, brandColor: "#fff", ...baseUpdateArgs }),
  ).rejects.toThrow();

  const rows = await t.run((ctx) =>
    ctx.db.query("eventContent").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(rows).toHaveLength(0);
});

test("update rejects an unparseable video URL", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  await expect(
    as.mutation(api.eventContent.update, {
      eventId,
      videoUrl: "https://example.com/not-a-video",
      ...baseUpdateArgs,
    }),
  ).rejects.toThrow();
});

test("update drops empty agenda/speaker/faq rows and trims surviving ones", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  await as.mutation(api.eventContent.update, {
    eventId,
    agenda: [
      { time: "  10:00  ", title: "  Doors open  " },
      { time: "11:00", title: "   " }, // blank title -> dropped
    ],
    speakers: [
      { name: "  Ada Lovelace  ", title: "  Keynote  " },
      { name: "   " }, // blank name -> dropped
    ],
    faqs: [
      { question: "  Refunds?  ", answer: "  Yes.  " },
      { question: "Blank answer?", answer: "   " }, // blank answer -> dropped
      { question: "   ", answer: "Blank question" }, // blank question -> dropped
    ],
  });

  const content = await as.query(api.eventContent.get, { eventId });
  expect(content.agenda).toEqual([{ time: "10:00", title: "Doors open", description: undefined }]);
  expect(content.speakers).toEqual([
    { name: "Ada Lovelace", title: "Keynote", bio: undefined, imageUrl: undefined },
  ]);
  expect(content.faqs).toEqual([{ question: "Refunds?", answer: "Yes." }]);
});

test("update caps each array at 50 rows", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  const faqs = Array.from({ length: 60 }, (_, i) => ({ question: `Q${i}`, answer: `A${i}` }));
  await as.mutation(api.eventContent.update, { eventId, agenda: [], speakers: [], faqs });

  const content = await as.query(api.eventContent.get, { eventId });
  expect(content.faqs).toHaveLength(50);
});

test("update is owner-only", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);

  await expect(
    asBob.mutation(api.eventContent.update, { eventId, ctaLabel: "Hijacked", ...baseUpdateArgs }),
  ).rejects.toThrow();

  const rows = await t.run((ctx) =>
    ctx.db.query("eventContent").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(rows).toHaveLength(0);
});

// --- getBySlug ---------------------------------------------------------------

test("getBySlug returns the content for a published event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await as.mutation(api.eventContent.update, {
    eventId,
    ctaLabel: "RSVP",
    agenda: [],
    speakers: [],
    faqs: [],
  });
  const event = await t.run((ctx) => ctx.db.get(eventId));
  await as.mutation(api.events.publishEvent, { eventId });

  const content = await t.query(api.eventContent.getBySlug, { slug: event!.slug });
  expect(content).toMatchObject({ ctaLabel: "RSVP" });
});

test("getBySlug returns an empty default for a published event with no saved content", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const event = await t.run((ctx) => ctx.db.get(eventId));
  await as.mutation(api.events.publishEvent, { eventId });

  const content = await t.query(api.eventContent.getBySlug, { slug: event!.slug });
  expect(content).toEqual({ agenda: [], speakers: [], faqs: [] });
});

test("getBySlug returns null for an unpublished (draft) event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const event = await t.run((ctx) => ctx.db.get(eventId));

  const content = await t.query(api.eventContent.getBySlug, { slug: event!.slug });
  expect(content).toBeNull();
});

test("getBySlug returns null for an unknown slug", async () => {
  const t = convexTest(schema, modules);
  const content = await t.query(api.eventContent.getBySlug, { slug: "does-not-exist" });
  expect(content).toBeNull();
});

// --- image mutations ---------------------------------------------------

test("generateUploadUrl rejects a non-owner", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);

  await expect(asBob.mutation(api.eventContent.generateUploadUrl, { eventId })).rejects.toThrow();
});

test("setGallery rejects more than 8 images", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const ids = await storeN(t, 9);

  await expect(
    as.mutation(api.eventContent.setGallery, {
      eventId,
      images: ids.map((storageId) => ({ storageId })),
    }),
  ).rejects.toThrow();
});

test("setGallery deletes storage files that were removed", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const [a, b] = await storeN(t, 2);

  await as.mutation(api.eventContent.setGallery, {
    eventId,
    images: [{ storageId: a }, { storageId: b }],
  });
  await as.mutation(api.eventContent.setGallery, {
    eventId,
    images: [{ storageId: a }],
  });

  expect(await t.run((ctx) => ctx.storage.getUrl(b))).toBeNull();
  expect(await t.run((ctx) => ctx.storage.getUrl(a))).not.toBeNull();
});

test("setCoverImage replacing an uploaded cover deletes the previous file and clears legacy url", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const [a, b] = await storeN(t, 2);

  await as.mutation(api.eventContent.setCoverImage, { eventId, storageId: a });
  await as.mutation(api.eventContent.setCoverImage, { eventId, storageId: b });

  expect(await t.run((ctx) => ctx.storage.getUrl(a))).toBeNull();
  const row = await t.run((ctx) =>
    ctx.db.query("eventContent").withIndex("by_event", (q) => q.eq("eventId", eventId)).unique(),
  );
  expect(row?.coverImageId).toBe(b);
  expect(row?.coverImageUrl).toBeUndefined();
});

// --- updateAccessibility ------------------------------------------------

test("updateAccessibility upserts the accessibility block + coverImageAlt without clobbering existing page content", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  await as.mutation(api.eventContent.update, {
    eventId,
    ctaLabel: "Register",
    agenda: [{ time: "10:00", title: "Doors open" }],
    speakers: [{ name: "Ada Lovelace", title: "Keynote" }],
    faqs: [{ question: "Refunds?", answer: "Yes, within 30 days." }],
  });

  await as.mutation(api.eventContent.updateAccessibility, {
    eventId,
    coverImageAlt: "  A packed auditorium with a speaker on stage  ",
    accessibility: {
      wheelchairAccessible: true,
      signLanguage: false,
      hearingLoop: true,
      notes: "  Enter via the north door.  ",
    },
  });

  const rows = await t.run((ctx) =>
    ctx.db.query("eventContent").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(rows).toHaveLength(1);
  const row = rows[0];
  // Page content from `update` survives untouched.
  expect(row.ctaLabel).toBe("Register");
  expect(row.agenda).toEqual([{ time: "10:00", title: "Doors open", description: undefined }]);
  expect(row.speakers).toEqual([
    { name: "Ada Lovelace", title: "Keynote", bio: undefined, imageUrl: undefined },
  ]);
  expect(row.faqs).toEqual([{ question: "Refunds?", answer: "Yes, within 30 days." }]);
  // New accessibility fields are set (and trimmed).
  expect(row.coverImageAlt).toBe("A packed auditorium with a speaker on stage");
  expect(row.accessibility).toEqual({
    wheelchairAccessible: true,
    signLanguage: false,
    closedCaptions: undefined,
    hearingLoop: true,
    accessibleParking: undefined,
    assistanceAnimalsWelcome: undefined,
    notes: "Enter via the north door.",
  });
});

test("updateAccessibility inserts a fresh doc (with empty page content) when none exists yet", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  await as.mutation(api.eventContent.updateAccessibility, {
    eventId,
    coverImageAlt: "Cover photo",
    accessibility: { wheelchairAccessible: true },
  });

  const rows = await t.run((ctx) =>
    ctx.db.query("eventContent").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(rows).toHaveLength(1);
  const row = rows[0];
  expect(row.agenda).toEqual([]);
  expect(row.speakers).toEqual([]);
  expect(row.faqs).toEqual([]);
  expect(row.coverImageAlt).toBe("Cover photo");
  expect(row.accessibility).toMatchObject({ wheelchairAccessible: true });
});

test("updateAccessibility clears coverImageAlt and accessibility when omitted on a later save", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  await as.mutation(api.eventContent.updateAccessibility, {
    eventId,
    coverImageAlt: "Cover photo",
    accessibility: { wheelchairAccessible: true, notes: "North door." },
  });
  await as.mutation(api.eventContent.updateAccessibility, { eventId });

  const rows = await t.run((ctx) =>
    ctx.db.query("eventContent").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].coverImageAlt).toBeUndefined();
  expect(rows[0].accessibility).toBeUndefined();
});

test("updateAccessibility is owner-only", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);

  await expect(
    asBob.mutation(api.eventContent.updateAccessibility, {
      eventId,
      coverImageAlt: "Hijacked",
    }),
  ).rejects.toThrow();

  const rows = await t.run((ctx) =>
    ctx.db.query("eventContent").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  expect(rows).toHaveLength(0);
});

test("getBySlug returns the accessibility fields for a published event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await as.mutation(api.eventContent.updateAccessibility, {
    eventId,
    coverImageAlt: "Cover photo",
    accessibility: { wheelchairAccessible: true, closedCaptions: true, notes: "See staff at entry." },
  });
  const event = await t.run((ctx) => ctx.db.get(eventId));
  await as.mutation(api.events.publishEvent, { eventId });

  const content = await t.query(api.eventContent.getBySlug, { slug: event!.slug });
  expect(content).toMatchObject({
    coverImageAlt: "Cover photo",
    accessibility: {
      wheelchairAccessible: true,
      closedCaptions: true,
      notes: "See staff at entry.",
    },
  });
});
