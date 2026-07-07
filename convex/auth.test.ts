// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { getAuthOrganizerId } from "./auth";

// Passed explicitly for the same pnpm module-resolution reason documented in
// schema.test.ts.
const modules = import.meta.glob("./**/*.*s");

// Convex Auth mints a JWT whose `sub` claim is `${userId}|${sessionId}` with the
// divider "|" (see `sub: args.userId + TOKEN_SUB_CLAIM_DIVIDER + args.sessionId`
// in @convex-dev/auth/dist/server/implementation/tokens.js, and
// TOKEN_SUB_CLAIM_DIVIDER = "|" in utils.js). `getAuthUserId` reads the part
// before the divider back into an `Id<"users">`. To authenticate as an organizer
// under convexTest we therefore insert a real `users` row (plus a session for
// fidelity), then hand `withIdentity` a subject reproducing that exact format so
// it resolves through `ctx.db.get(userId)`. Later authed-mutation tests reuse
// this helper.
async function asOrganizer(t: TestConvex<typeof schema>, email: string) {
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, name: email });
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 1000 * 60 * 60,
    });
    return { userId, sessionId };
  });
  const subject = `${userId}|${sessionId}`;
  return { as: t.withIdentity({ subject }), userId };
}

test("ensureOrganizer creates exactly one organizer for the authed identity", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");

  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});
  expect(organizerId).toBeTruthy();

  const rows = await t.run((ctx) =>
    ctx.db
      .query("organizers")
      .withIndex("by_email", (q) => q.eq("email", "ada@example.com"))
      .collect(),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]._id).toEqual(organizerId);
  expect(rows[0].email).toEqual("ada@example.com");
});

test("ensureOrganizer is idempotent (no duplicate on second call)", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "grace@example.com");

  const first = await as.mutation(api.organizers.ensureOrganizer, {});
  const second = await as.mutation(api.organizers.ensureOrganizer, {});
  expect(second).toEqual(first);

  const all = await t.run((ctx) => ctx.db.query("organizers").collect());
  expect(all).toHaveLength(1);
});

test("getAuthOrganizerId returns the authed organizer id, null when anonymous", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "lin@example.com");

  const created = await as.mutation(api.organizers.ensureOrganizer, {});
  const resolved = await as.run((ctx) => getAuthOrganizerId(ctx));
  expect(resolved).toEqual(created);

  const anonymous = await t.run((ctx) => getAuthOrganizerId(ctx));
  expect(anonymous).toBeNull();
});
