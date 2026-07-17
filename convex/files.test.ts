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

test("generateUploadUrl requires an authenticated organizer", async () => {
  const t = convexTest(schema, modules);
  await expect(t.mutation(api.files.generateUploadUrl, {})).rejects.toThrow(/not authenticated/i);
});

test("generateUploadUrl returns an upload url for an authenticated organizer", async () => {
  const t = convexTest(schema, modules);
  const as = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const url = await as.mutation(api.files.generateUploadUrl, {});
  expect(typeof url).toBe("string");
  expect(url.length).toBeGreaterThan(0);
});
