// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.*s");

async function asUser(t: TestConvex<typeof schema>, email: string) {
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, name: email });
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 });
    return { userId, sessionId };
  });
  return { as: t.withIdentity({ subject: `${userId}|${sessionId}` }), userId };
}

test("ensureOrganizer: new solo user creates one org and one owner membership", async () => {
  const t = convexTest(schema, modules);
  const { as, userId } = await asUser(t, "solo@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});

  const orgs = await t.run((ctx) => ctx.db.query("organizers").collect());
  expect(orgs.length).toBe(1);
  expect(orgs[0]._id).toBe(organizerId);

  const memberships = await t.run((ctx) => ctx.db.query("memberships").collect());
  expect(memberships.length).toBe(1);
  expect(memberships[0].organizerId).toBe(organizerId);
  expect(memberships[0].role).toBe("owner");
  expect(memberships[0].userId).toBe(userId);
  expect(memberships[0].email).toBe("solo@example.com");
});

test("ensureOrganizer: returning user gets the same org, no duplicates", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asUser(t, "returning@example.com");
  const first = await as.mutation(api.organizers.ensureOrganizer, {});
  const second = await as.mutation(api.organizers.ensureOrganizer, {});
  expect(second).toBe(first);

  const orgs = await t.run((ctx) => ctx.db.query("organizers").collect());
  expect(orgs.length).toBe(1);
  const memberships = await t.run((ctx) => ctx.db.query("memberships").collect());
  expect(memberships.length).toBe(1);
});

test("ensureOrganizer: pending-invite membership joins the existing org and links userId", async () => {
  const t = convexTest(schema, modules);
  // A pre-existing org with an owner, to which a member is invited.
  const { as: owner } = await asUser(t, "owner@example.com");
  const orgId = await owner.mutation(api.organizers.ensureOrganizer, {});

  // Owner "adds" a teammate by email: a pending membership with no userId.
  await t.run((ctx) =>
    ctx.db.insert("memberships", {
      organizerId: orgId,
      email: "b@x.com",
      role: "member",
      createdAt: Date.now(),
    }),
  );

  const { as: member, userId: memberUserId } = await asUser(t, "b@x.com");
  const result = await member.mutation(api.organizers.ensureOrganizer, {});
  expect(result).toBe(orgId);

  // No new org was created for the invited member.
  const orgs = await t.run((ctx) => ctx.db.query("organizers").collect());
  expect(orgs.length).toBe(1);

  const membership = await t.run((ctx) =>
    ctx.db
      .query("memberships")
      .withIndex("by_email", (q) => q.eq("email", "b@x.com"))
      .first(),
  );
  expect(membership?.userId).toBe(memberUserId);
  expect(membership?.organizerId).toBe(orgId);
});

test("getAuthOrganizerId resolves via membership for a member with no organizers-by-email row", async () => {
  const t = convexTest(schema, modules);
  const { as: owner } = await asUser(t, "owner2@example.com");
  const orgId = await owner.mutation(api.organizers.ensureOrganizer, {});

  await t.run((ctx) =>
    ctx.db.insert("memberships", {
      organizerId: orgId,
      email: "member2@x.com",
      role: "member",
      createdAt: Date.now(),
    }),
  );

  const { as: member } = await asUser(t, "member2@x.com");
  // getMe internally uses getAuthOrganizerId; a member with no organizers row
  // under their own email should still resolve to the shared org.
  const me = await member.query(api.organizers.getMe, {});
  expect(me?._id).toBe(orgId);

  // Confirm there truly is no organizers row for the member's own email.
  const legacy = await t.run((ctx) =>
    ctx.db
      .query("organizers")
      .withIndex("by_email", (q) => q.eq("email", "member2@x.com"))
      .unique(),
  );
  expect(legacy).toBeNull();
});

test("ensureOrganizer: the creator's own membership role is owner", async () => {
  const t = convexTest(schema, modules);
  const { as, userId } = await asUser(t, "creator@example.com");
  const orgId = await as.mutation(api.organizers.ensureOrganizer, {});

  const membership = await t.run((ctx) =>
    ctx.db
      .query("memberships")
      .withIndex("by_email", (q) => q.eq("email", "creator@example.com"))
      .first(),
  );
  expect(membership?.role).toBe("owner");
  expect(membership?.organizerId).toBe(orgId);
  expect(membership?.userId).toBe(userId);
});

test("ensureOrganizer: legacy organizers-by-email row self-heals into an owner membership", async () => {
  const t = convexTest(schema, modules);
  // Simulate a pre-migration organizer row with no membership at all.
  const legacyOrgId: Id<"organizers"> = await t.run((ctx) =>
    ctx.db.insert("organizers", {
      name: "Legacy Org",
      email: "legacy@example.com",
      image: undefined,
    }),
  );

  const before = await t.run((ctx) => ctx.db.query("memberships").collect());
  expect(before.length).toBe(0);

  const { as, userId } = await asUser(t, "legacy@example.com");
  const result = await as.mutation(api.organizers.ensureOrganizer, {});
  expect(result).toBe(legacyOrgId);

  // No duplicate org was created.
  const orgs = await t.run((ctx) => ctx.db.query("organizers").collect());
  expect(orgs.length).toBe(1);

  const membership = await t.run((ctx) =>
    ctx.db
      .query("memberships")
      .withIndex("by_organizer", (q) => q.eq("organizerId", legacyOrgId))
      .first(),
  );
  expect(membership?.role).toBe("owner");
  expect(membership?.userId).toBe(userId);
  expect(membership?.email).toBe("legacy@example.com");
});

// Note: `backfillOwnerMemberships` (convex/migrations.ts) mirrors this exact
// self-heal logic but runs it in bulk over all `organizers` rows via the
// @convex-dev/migrations runner. Invoking the runner itself isn't exercised
// here -- convex-test doesn't run the migrations component's scheduled/runner
// machinery -- so this test covers the equivalent self-heal path through
// `ensureOrganizer`, which uses the same "legacy org -> insert owner
// membership" logic the migration performs.
