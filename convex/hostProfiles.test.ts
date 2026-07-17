// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");

// Mirrors convex/eventContent.test.ts: insert a real users row + session and
// hand withIdentity a matching subject so getAuthUserId resolves.
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
    title: "Host Profile Event",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity,
  });
}

async function makePublishedEvent(
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  capacity = 100,
) {
  const eventId = await makeEvent(as, capacity);
  await as.mutation(api.events.publishEvent, { eventId });
  return eventId;
}

const validCreateArgs = {
  name: "Passline Events",
  bio: "We throw great parties.",
  websiteUrl: "https://example.com",
};

// --- create ----------------------------------------------------------------

test("create rejects an empty/whitespace-only name", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  await expect(
    as.mutation(api.hostProfiles.create, { ...validCreateArgs, name: "   " }),
  ).rejects.toThrow();
});

test("create rejects a non-https:// websiteUrl", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  await expect(
    as.mutation(api.hostProfiles.create, {
      ...validCreateArgs,
      websiteUrl: "http://example.com",
    }),
  ).rejects.toThrow();

  await expect(
    as.mutation(api.hostProfiles.create, {
      ...validCreateArgs,
      websiteUrl: "javascript:alert(1)",
    }),
  ).rejects.toThrow();
});

test("create rejects a bio longer than 600 characters", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  await expect(
    as.mutation(api.hostProfiles.create, { ...validCreateArgs, bio: "x".repeat(601) }),
  ).rejects.toThrow();
});

test("create succeeds with valid fields and stamps organizerId/createdAt", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});

  const hostProfileId = await as.mutation(api.hostProfiles.create, validCreateArgs);

  const row = await t.run((ctx) => ctx.db.get(hostProfileId));
  expect(row?.organizerId).toEqual(organizerId);
  expect(row?.name).toBe("Passline Events");
  expect(row?.bio).toBe("We throw great parties.");
  expect(row?.websiteUrl).toBe("https://example.com");
  expect(typeof row?.createdAt).toBe("number");
});

test("create rejects an unauthenticated caller", async () => {
  const t = convexTest(schema, modules);

  await expect(t.mutation(api.hostProfiles.create, validCreateArgs)).rejects.toThrow();
});

// --- listMine ----------------------------------------------------------------

test("listMine returns only the caller's profiles, newest first, and [] when unauthenticated", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});

  const firstId = await asAda.mutation(api.hostProfiles.create, { ...validCreateArgs, name: "First" });
  const secondId = await asAda.mutation(api.hostProfiles.create, { ...validCreateArgs, name: "Second" });
  await asBob.mutation(api.hostProfiles.create, { ...validCreateArgs, name: "Bob's profile" });

  const mine = await asAda.query(api.hostProfiles.listMine, {});
  expect(mine.map((p) => p._id)).toEqual([secondId, firstId]);
  expect(mine.every((p) => p.name !== "Bob's profile")).toBe(true);

  const unauthenticated = await t.query(api.hostProfiles.listMine, {});
  expect(unauthenticated).toEqual([]);
});

// --- update ----------------------------------------------------------------

test("update is owner-only", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});

  const hostProfileId = await asAda.mutation(api.hostProfiles.create, validCreateArgs);

  await expect(
    asBob.mutation(api.hostProfiles.update, {
      hostProfileId,
      ...validCreateArgs,
      name: "Hijacked",
    }),
  ).rejects.toThrow();

  const row = await t.run((ctx) => ctx.db.get(hostProfileId));
  expect(row?.name).toBe("Passline Events");
});

test("update re-validates fields (rejects a bad URL)", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const hostProfileId = await as.mutation(api.hostProfiles.create, validCreateArgs);

  await expect(
    as.mutation(api.hostProfiles.update, {
      hostProfileId,
      ...validCreateArgs,
      websiteUrl: "http://example.com",
    }),
  ).rejects.toThrow();

  const row = await t.run((ctx) => ctx.db.get(hostProfileId));
  expect(row?.websiteUrl).toBe("https://example.com");
});

test("update patches all fields for the owner", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const hostProfileId = await as.mutation(api.hostProfiles.create, validCreateArgs);
  const logoId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));

  await as.mutation(api.hostProfiles.update, {
    hostProfileId,
    name: "Updated Name",
    bio: "Updated bio",
    logoId,
    websiteUrl: "https://example.org",
  });

  const row = await t.run((ctx) => ctx.db.get(hostProfileId));
  expect(row?.name).toBe("Updated Name");
  expect(row?.bio).toBe("Updated bio");
  expect(row?.logoId).toBe(logoId);
  expect(row?.websiteUrl).toBe("https://example.org");
});

test("update preserves a legacy logoUrl on a name-only edit (no logoId)", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const hostProfileId = await as.mutation(api.hostProfiles.create, validCreateArgs);
  await t.run(async (ctx) => {
    await ctx.db.patch(hostProfileId, { logoUrl: "https://legacy.example.com/old.png" });
  });

  await as.mutation(api.hostProfiles.update, {
    hostProfileId,
    ...validCreateArgs,
    name: "Renamed Only",
  });

  const row = await t.run((ctx) => ctx.db.get(hostProfileId));
  expect(row?.name).toBe("Renamed Only");
  expect(row?.logoUrl).toBe("https://legacy.example.com/old.png");
});

test("update clears a legacy logoUrl once a logoId is uploaded", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const hostProfileId = await as.mutation(api.hostProfiles.create, validCreateArgs);
  await t.run(async (ctx) => {
    await ctx.db.patch(hostProfileId, { logoUrl: "https://legacy.example.com/old.png" });
  });
  const logoId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));

  await as.mutation(api.hostProfiles.update, {
    hostProfileId,
    ...validCreateArgs,
    logoId,
  });

  const row = await t.run((ctx) => ctx.db.get(hostProfileId));
  expect(row?.logoUrl).toBeUndefined();
  expect(row?.logoId).toBe(logoId);
});

// --- remove ------------------------------------------------------------------

test("remove is owner-only", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});

  const hostProfileId = await asAda.mutation(api.hostProfiles.create, validCreateArgs);

  await expect(asBob.mutation(api.hostProfiles.remove, { hostProfileId })).rejects.toThrow();

  const row = await t.run((ctx) => ctx.db.get(hostProfileId));
  expect(row).not.toBeNull();
});

test("remove clears hostProfileId on any of the organizer's events that reference the deleted profile", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await makeEvent(as);
  const hostProfileId = await as.mutation(api.hostProfiles.create, validCreateArgs);

  await as.mutation(api.events.updateEvent, {
    eventId,
    title: "Host Profile Event",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 100,
    hostProfileId,
  });

  const beforeRemove = await t.run((ctx) => ctx.db.get(eventId));
  expect(beforeRemove?.hostProfileId).toEqual(hostProfileId);

  await as.mutation(api.hostProfiles.remove, { hostProfileId });

  const afterRemove = await t.run((ctx) => ctx.db.get(eventId));
  expect(afterRemove?.hostProfileId).toBeUndefined();

  const profile = await t.run((ctx) => ctx.db.get(hostProfileId));
  expect(profile).toBeNull();
});

// --- getForEvent ---------------------------------------------------------------

test("getForEvent returns the public projection for a published event with an attached profile", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await makePublishedEvent(as);
  const logoId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  const hostProfileId = await as.mutation(api.hostProfiles.create, { ...validCreateArgs, logoId });
  await as.mutation(api.events.updateEvent, {
    eventId,
    title: "Host Profile Event",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 100,
    hostProfileId,
  });

  const result = await t.query(api.hostProfiles.getForEvent, { eventId });
  expect(result?.name).toBe("Passline Events");
  expect(result?.bio).toBe("We throw great parties.");
  expect(result?.logoUrl).toBeTruthy();
  expect(result?.websiteUrl).toBe("https://example.com");
  expect(result).not.toHaveProperty("_id");
  expect(result).not.toHaveProperty("organizerId");
  expect(result).not.toHaveProperty("createdAt");
  expect(result).not.toHaveProperty("_creationTime");
});

test("getForEvent returns null for an unpublished (draft) event even with a profile attached", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await makeEvent(as);
  const hostProfileId = await as.mutation(api.hostProfiles.create, validCreateArgs);
  await as.mutation(api.events.updateEvent, {
    eventId,
    title: "Host Profile Event",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 100,
    hostProfileId,
  });

  const result = await t.query(api.hostProfiles.getForEvent, { eventId });
  expect(result).toBeNull();
});

test("getForEvent returns null when the event has no hostProfileId", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await makePublishedEvent(as);

  const result = await t.query(api.hostProfiles.getForEvent, { eventId });
  expect(result).toBeNull();
});

test("getForEvent returns null when the referenced profile was deleted", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await makePublishedEvent(as);
  const hostProfileId = await as.mutation(api.hostProfiles.create, validCreateArgs);
  await as.mutation(api.events.updateEvent, {
    eventId,
    title: "Host Profile Event",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 100,
    hostProfileId,
  });

  // Bypass `remove` (which would also clear the event's hostProfileId) so the
  // event still points at a since-deleted profile id.
  await t.run((ctx) => ctx.db.delete(hostProfileId));

  const result = await t.query(api.hostProfiles.getForEvent, { eventId });
  expect(result).toBeNull();
});

// --- logoId (Task 5) ---------------------------------------------------------

test("create stores an uploaded logo id", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const logoId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));

  const id = await as.mutation(api.hostProfiles.create, { name: "Acme", logoId });
  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row?.logoId).toBe(logoId);
});

test("update deletes the logo blob it replaces and clears the legacy url", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const first = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  const id = await as.mutation(api.hostProfiles.create, { name: "Acme", logoId: first });
  await t.run(async (ctx) => {
    await ctx.db.patch(id, { logoUrl: "https://legacy.example.com/old.png" });
  });

  const second = await t.run((ctx) => ctx.storage.store(new Blob(["b"], { type: "image/png" })));
  await as.mutation(api.hostProfiles.update, { hostProfileId: id, name: "Acme", logoId: second });

  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row?.logoId).toBe(second);
  expect(row?.logoUrl).toBeUndefined();
  expect(await t.run((ctx) => ctx.storage.getUrl(first))).toBeNull();
});

test("remove deletes the profile's logo blob", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const logoId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  const id = await as.mutation(api.hostProfiles.create, { name: "Acme", logoId });

  await as.mutation(api.hostProfiles.remove, { hostProfileId: id });

  expect(await t.run((ctx) => ctx.storage.getUrl(logoId))).toBeNull();
});

test("setting a logo on another organizer's profile is rejected", async () => {
  const t = convexTest(schema, modules);
  const { as: ada } = await asOrganizer(t, "ada@example.com");
  await ada.mutation(api.organizers.ensureOrganizer, {});
  const id = await ada.mutation(api.hostProfiles.create, { name: "Acme" });

  const { as: bob } = await asOrganizer(t, "bob@example.com");
  await bob.mutation(api.organizers.ensureOrganizer, {});
  const logoId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));

  await expect(
    bob.mutation(api.hostProfiles.update, { hostProfileId: id, name: "Acme", logoId }),
  ).rejects.toThrow(/not found/i);
});

test("listMine resolves an uploaded logo to a url", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const logoId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  await as.mutation(api.hostProfiles.create, { name: "Acme", logoId });

  const rows = await as.query(api.hostProfiles.listMine, {});
  expect(rows[0]?.logoUrl).toBeTruthy();
});

test("listMine falls back to the legacy logo url", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const id = await as.mutation(api.hostProfiles.create, { name: "Acme" });
  await t.run(async (ctx) => {
    await ctx.db.patch(id, { logoUrl: "https://legacy.example.com/old.png" });
  });

  const rows = await as.query(api.hostProfiles.listMine, {});
  expect(rows[0]?.logoUrl).toBe("https://legacy.example.com/old.png");
});
