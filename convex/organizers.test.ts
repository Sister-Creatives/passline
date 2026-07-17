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
