// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");

// Reproduces the Convex Auth JWT subject `${userId}|${sessionId}` (see auth.test.ts).
async function asUser(t: any, email: string) {
  const { userId, sessionId } = await t.run(async (ctx: any) => {
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
