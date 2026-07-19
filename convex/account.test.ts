// @vitest-environment edge-runtime
import { convexTest as rawConvexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { getAuthOrganizerId } from "./auth";

const modules = import.meta.glob("./**/*.*s");

// `upsertEmailChangeRequest` calls the rate limiter component (see
// convex/rateLimits.ts and convex/account.ts), so every test instance needs
// that component registered. Mirrors the same wrapper in rsvps.test.ts.
function convexTest(schemaArg: typeof schema, modulesArg: typeof modules) {
  const t = rawConvexTest(schemaArg, modulesArg);
  registerRateLimiter(t);
  return t;
}

// Reproduces the Convex Auth JWT subject `${userId}|${sessionId}` (see auth.test.ts).
async function asUser(t: TestConvex<typeof schema>, email: string) {
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, name: email });
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 3600_000,
    });
    return { userId, sessionId };
  });
  return { as: t.withIdentity({ subject: `${userId}|${sessionId}` }), userId, sessionId };
}

test("changePassword rejects a wrong current password", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asUser(t, "pw@example.com");
  await expect(
    as.action(api.account.changePassword, {
      currentPassword: "definitely-wrong",
      newPassword: "brandnewpass1",
    }),
  ).rejects.toThrow(/incorrect|not authenticated/i);
});

test("changePassword rejects a too-short new password", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asUser(t, "pw2@example.com");
  await expect(
    as.action(api.account.changePassword, { currentPassword: "x", newPassword: "short" }),
  ).rejects.toThrow(/8 characters|incorrect/i);
});

test("signOutOtherSessions removes other sessions, keeps the current one", async () => {
  const t = convexTest(schema, modules);
  const { as, userId, sessionId } = await asUser(t, "sess@example.com");
  const otherSessionId = await t.run((ctx) =>
    ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3600_000 }),
  );
  await as.action(api.account.signOutOtherSessions, {});
  const remaining = await t.run((ctx) =>
    ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId)).collect(),
  );
  const ids = remaining.map((s) => s._id);
  expect(ids).toContain(sessionId);
  expect(ids).not.toContain(otherSessionId);
});

test("confirmEmailChange migrates every email-keyed record and keeps the organizer", async () => {
  const t = convexTest(schema, modules);
  const { as, userId } = await asUser(t, "old@example.com");

  // Seed the identity graph: password account + membership + organizer.
  const organizerId = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizers", { name: "Org", email: "old@example.com" });
    await ctx.db.insert("authAccounts", {
      userId,
      provider: "password",
      providerAccountId: "old@example.com",
    } as any);
    await ctx.db.insert("memberships", {
      organizerId: orgId,
      email: "old@example.com",
      userId,
      role: "owner",
      createdAt: Date.now(),
    });
    return orgId;
  });

  const before = await as.run((ctx) => getAuthOrganizerId(ctx));
  expect(before).toEqual(organizerId);

  // Insert a known request directly (bypass password re-auth), then confirm.
  const code = "123456";
  const codeHash = await t.run(async () => {
    const bytes = new TextEncoder().encode(code);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  });
  await t.run((ctx) =>
    ctx.db.insert("emailChangeRequests", {
      userId,
      newEmail: "new@example.com",
      codeHash,
      expiresAt: Date.now() + 600_000,
      attempts: 0,
    }),
  );

  const result = await as.action(api.account.confirmEmailChange, { code });
  expect(result).toMatchObject({ ok: true, email: "new@example.com" });

  const user = await t.run((ctx) => ctx.db.get(userId));
  expect(user?.email).toEqual("new@example.com");
  const after = await as.run((ctx) => getAuthOrganizerId(ctx));
  expect(after).toEqual(organizerId); // no lock-out
  const leftover = await t.run((ctx) =>
    ctx.db.query("emailChangeRequests").withIndex("by_user", (q) => q.eq("userId", userId)).first(),
  );
  expect(leftover).toBeNull();

  const acct = await t.run((ctx) =>
    ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId).eq("provider", "password"))
      .first(),
  );
  expect(acct?.providerAccountId).toEqual("new@example.com");

  const org = await t.run((ctx) => ctx.db.get(organizerId));
  expect(org?.email).toEqual("new@example.com");
});

test("confirmEmailChange rejects a wrong code and increments attempts", async () => {
  const t = convexTest(schema, modules);
  const { as, userId } = await asUser(t, "wc@example.com");
  await t.run((ctx) =>
    ctx.db.insert("emailChangeRequests", {
      userId,
      newEmail: "wc-new@example.com",
      codeHash: "deadbeef",
      expiresAt: Date.now() + 600_000,
      attempts: 0,
    }),
  );
  await expect(as.action(api.account.confirmEmailChange, { code: "000000" })).rejects.toThrow(/incorrect code/i);
  const req = await t.run((ctx) =>
    ctx.db.query("emailChangeRequests").withIndex("by_user", (q) => q.eq("userId", userId)).first(),
  );
  expect(req?.attempts).toEqual(1);
});

test("confirmEmailChange rejects an expired code", async () => {
  const t = convexTest(schema, modules);
  const { as, userId } = await asUser(t, "exp@example.com");
  await t.run((ctx) =>
    ctx.db.insert("emailChangeRequests", {
      userId,
      newEmail: "exp-new@example.com",
      codeHash: "deadbeef",
      expiresAt: Date.now() - 1,
      attempts: 0,
    }),
  );
  await expect(as.action(api.account.confirmEmailChange, { code: "000000" })).rejects.toThrow(/expired/i);
  const leftover = await t.run((ctx) =>
    ctx.db.query("emailChangeRequests").withIndex("by_user", (q) => q.eq("userId", userId)).first(),
  );
  expect(leftover).toBeNull();
});

test("checkEmailAvailable rejects an email that already has a pending-invite membership", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizers", { name: "Org", email: "owner@example.com" });
    await ctx.db.insert("memberships", {
      organizerId: orgId,
      email: "invited@example.com",
      // userId unset: a pending invite, not yet linked to a signed-in user.
      role: "member",
      createdAt: Date.now(),
    });
  });

  const invited = await t.query(internal.account.checkEmailAvailable, { email: "invited@example.com" });
  expect(invited).toBe(false);

  const unused = await t.query(internal.account.checkEmailAvailable, { email: "unused@example.com" });
  expect(unused).toBe(true);
});

// Token bucket capacity 5, keyed by userId (see convex/rateLimits.ts), so 5
// calls succeed and the 6th is rejected -- mirrors the rsvp rate-limit tests
// in rsvps.test.ts.
test("upsertEmailChangeRequest rate-limits repeated requests for the same user", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "rl@example.com" }));

  for (let i = 0; i < 5; i++) {
    await t.mutation(internal.account.upsertEmailChangeRequest, {
      userId,
      newEmail: `rl-new-${i}@example.com`,
      codeHash: "deadbeef",
      expiresAt: Date.now() + 600_000,
    });
  }

  await expect(
    t.mutation(internal.account.upsertEmailChangeRequest, {
      userId,
      newEmail: "rl-new-overflow@example.com",
      codeHash: "deadbeef",
      expiresAt: Date.now() + 600_000,
    }),
  ).rejects.toThrow(/too many/i);
});
