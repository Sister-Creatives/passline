// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");

// Mirrors convex/events.test.ts: insert a real users row + session and hand
// withIdentity a matching subject so getAuthUserId resolves.
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

async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

test("create returns a secret whose hash is stored; the secret itself is never persisted", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const { id, secret } = await as.mutation(api.apiKeys.create, { name: "Production storefront" });

  expect(secret).toMatch(/^pl_live_[0-9a-f]{40}$/);

  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row).not.toBeNull();
  expect(row!.name).toBe("Production storefront");
  expect(row!.prefix).toBe("pl_live_");
  expect(row!.lastFour).toBe(secret.slice(-4));
  expect(row!.keyHash).toBe(await sha256Hex(secret));

  // The full secret must not appear anywhere on the stored row.
  const serialized = JSON.stringify(row);
  expect(serialized.includes(secret)).toBe(false);
});

test("list returns metadata only (never keyHash/secret) and is scoped to the caller's org", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});

  await asAda.mutation(api.apiKeys.create, { name: "Ada's key" });
  await asBob.mutation(api.apiKeys.create, { name: "Bob's key" });

  const adaKeys = await asAda.query(api.apiKeys.list, {});
  expect(adaKeys).toHaveLength(1);
  expect(adaKeys[0].name).toBe("Ada's key");
  expect(adaKeys[0]).not.toHaveProperty("keyHash");
  expect(adaKeys[0]).not.toHaveProperty("secret");

  const bobKeys = await asBob.query(api.apiKeys.list, {});
  expect(bobKeys).toHaveLength(1);
  expect(bobKeys[0].name).toBe("Bob's key");
});

test("revoke is owner-only and sets revokedAt", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});

  const { id } = await asAda.mutation(api.apiKeys.create, { name: "Ada's key" });

  await expect(asBob.mutation(api.apiKeys.revoke, { keyId: id })).rejects.toThrow();
  await expect(t.mutation(api.apiKeys.revoke, { keyId: id })).rejects.toThrow();

  const before = await t.run((ctx) => ctx.db.get(id));
  expect(before!.revokedAt).toBeUndefined();

  await asAda.mutation(api.apiKeys.revoke, { keyId: id });

  const after = await t.run((ctx) => ctx.db.get(id));
  expect(after!.revokedAt).toBeTypeOf("number");
});

test("internalResolve returns the organizer for an active key, and null for revoked/unknown keys", async () => {
  const t = convexTest(schema, modules);
  const { as, userId } = await asOrganizer(t, "ada@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});
  void userId;

  const { id, secret } = await as.mutation(api.apiKeys.create, { name: "Ada's key" });
  const keyHash = await sha256Hex(secret);

  const active = await t.query(internal.apiKeys.internalResolve, { keyHash });
  expect(active).toEqual({ organizerId, keyId: id });

  const unknown = await t.query(internal.apiKeys.internalResolve, { keyHash: "0".repeat(64) });
  expect(unknown).toBeNull();

  await as.mutation(api.apiKeys.revoke, { keyId: id });
  const revoked = await t.query(internal.apiKeys.internalResolve, { keyHash });
  expect(revoked).toBeNull();
});

test("internalTouch sets lastUsedAt", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const { id } = await as.mutation(api.apiKeys.create, { name: "Ada's key" });
  const before = await t.run((ctx) => ctx.db.get(id));
  expect(before!.lastUsedAt).toBeUndefined();

  await t.mutation(internal.apiKeys.internalTouch, { keyId: id });

  const after = await t.run((ctx) => ctx.db.get(id));
  expect(after!.lastUsedAt).toBeTypeOf("number");
});
