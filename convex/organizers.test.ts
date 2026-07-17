// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");

async function asOrganizer(t: TestConvex<typeof schema>, email: string) {
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, name: email });
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 });
    return { userId, sessionId };
  });
  return t.withIdentity({ subject: `${userId}|${sessionId}` });
}

test("getMe returns the authenticated organizer, null when signed out", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.organizers.getMe, {})).toBeNull();
  const as = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const me = await as.query(api.organizers.getMe, {});
  expect(me?.email).toBe("ada@example.com");
});

test("setImage stores the storage id and clears the legacy image url", async () => {
  const t = convexTest(schema, modules);
  const as = await asOrganizer(t, "ada@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});
  await t.run(async (ctx) => {
    await ctx.db.patch(organizerId, { image: "https://legacy.example.com/old.png" });
  });

  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  await as.mutation(api.organizers.setImage, { storageId });

  const row = await t.run((ctx) => ctx.db.get(organizerId));
  expect(row?.imageId).toBe(storageId);
  expect(row?.image).toBeUndefined();
});

test("setImage deletes the blob it replaces", async () => {
  const t = convexTest(schema, modules);
  const as = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const first = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  await as.mutation(api.organizers.setImage, { storageId: first });
  const second = await t.run((ctx) => ctx.storage.store(new Blob(["b"], { type: "image/png" })));
  await as.mutation(api.organizers.setImage, { storageId: second });

  expect(await t.run((ctx) => ctx.storage.getUrl(first))).toBeNull();
  expect(await t.run((ctx) => ctx.storage.getUrl(second))).not.toBeNull();
});

test("setImage with null removes the logo and deletes the blob", async () => {
  const t = convexTest(schema, modules);
  const as = await asOrganizer(t, "ada@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});

  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  await as.mutation(api.organizers.setImage, { storageId });
  await as.mutation(api.organizers.setImage, { storageId: null });

  const row = await t.run((ctx) => ctx.db.get(organizerId));
  expect(row?.imageId).toBeUndefined();
  expect(await t.run((ctx) => ctx.storage.getUrl(storageId))).toBeNull();
});

test("setImage requires authentication", async () => {
  const t = convexTest(schema, modules);
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  await expect(t.mutation(api.organizers.setImage, { storageId })).rejects.toThrow(/not authenticated/i);
});

test("getMe prefers the uploaded image over the legacy url", async () => {
  const t = convexTest(schema, modules);
  const as = await asOrganizer(t, "ada@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});
  await t.run(async (ctx) => {
    await ctx.db.patch(organizerId, { image: "https://legacy.example.com/old.png" });
  });

  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  await as.mutation(api.organizers.setImage, { storageId });

  const me = await as.query(api.organizers.getMe, {});
  expect(me?.image).not.toBe("https://legacy.example.com/old.png");
  expect(me?.image).toBeTruthy();
});

test("getMe falls back to the legacy url when nothing is uploaded", async () => {
  const t = convexTest(schema, modules);
  const as = await asOrganizer(t, "ada@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});
  await t.run(async (ctx) => {
    await ctx.db.patch(organizerId, { image: "https://legacy.example.com/old.png" });
  });

  const me = await as.query(api.organizers.getMe, {});
  expect(me?.image).toBe("https://legacy.example.com/old.png");
});

test("getPublicProfile resolves the uploaded image", async () => {
  const t = convexTest(schema, modules);
  const as = await asOrganizer(t, "ada@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  await as.mutation(api.organizers.setImage, { storageId });

  const profile = await t.query(api.organizers.getPublicProfile, { organizerId });
  expect(profile?.image).toBeTruthy();
});
