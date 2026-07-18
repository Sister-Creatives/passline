// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

// Mirrors convex/team_auth.test.ts's asUser helper.
const modules = import.meta.glob("./**/*.*s");

async function asUser(t: TestConvex<typeof schema>, email: string) {
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, name: email });
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 });
    return { userId, sessionId };
  });
  return { as: t.withIdentity({ subject: `${userId}|${sessionId}` }), userId };
}

test("owner adds a member: listTeam shows both, owner first, member pending", async () => {
  const t = convexTest(schema, modules);
  const { as: owner } = await asUser(t, "owner@example.com");
  await owner.mutation(api.organizers.ensureOrganizer, {});

  await owner.mutation(api.team.addMember, { email: "m@x.com", role: "member" });

  const team = await owner.query(api.team.listTeam, {});
  expect(team.myRole).toBe("owner");
  expect(team.members.length).toBe(2);
  expect(team.members[0].email).toBe("owner@example.com");
  expect(team.members[0].role).toBe("owner");
  expect(team.members[0].pending).toBe(false);
  expect(team.members[1].email).toBe("m@x.com");
  expect(team.members[1].role).toBe("member");
  expect(team.members[1].pending).toBe(true);
});

test("addMember rejects an email that already has a membership", async () => {
  const t = convexTest(schema, modules);
  const { as: owner } = await asUser(t, "owner2@example.com");
  await owner.mutation(api.organizers.ensureOrganizer, {});
  await owner.mutation(api.team.addMember, { email: "dup@x.com", role: "member" });

  await expect(
    owner.mutation(api.team.addMember, { email: "dup@x.com", role: "member" }),
  ).rejects.toThrow(/already belongs/i);
});

test("addMember rejects an email belonging to a member of another org", async () => {
  const t = convexTest(schema, modules);
  const { as: ownerA } = await asUser(t, "ownerA@example.com");
  await ownerA.mutation(api.organizers.ensureOrganizer, {});
  await ownerA.mutation(api.team.addMember, { email: "shared@x.com", role: "member" });

  const { as: ownerB } = await asUser(t, "ownerB@example.com");
  await ownerB.mutation(api.organizers.ensureOrganizer, {});

  await expect(
    ownerB.mutation(api.team.addMember, { email: "shared@x.com", role: "member" }),
  ).rejects.toThrow(/already belongs/i);
});

test("addMember by a non-owner throws", async () => {
  const t = convexTest(schema, modules);
  const { as: owner } = await asUser(t, "owner3@example.com");
  await owner.mutation(api.organizers.ensureOrganizer, {});
  await owner.mutation(api.team.addMember, { email: "member3@x.com", role: "member" });

  const { as: member } = await asUser(t, "member3@x.com");
  await member.mutation(api.organizers.ensureOrganizer, {}); // joins the org as a member

  await expect(
    member.mutation(api.team.addMember, { email: "other@x.com", role: "member" }),
  ).rejects.toThrow(/only an owner/i);
});

test("removeMember and updateRole block removing/demoting the last owner", async () => {
  const t = convexTest(schema, modules);
  const { as: owner } = await asUser(t, "sole-owner@example.com");
  await owner.mutation(api.organizers.ensureOrganizer, {});

  const team = await owner.query(api.team.listTeam, {});
  const ownerMembershipId = team.members[0]._id;

  await expect(
    owner.mutation(api.team.updateRole, { membershipId: ownerMembershipId, role: "member" }),
  ).rejects.toThrow(/at least one owner/i);

  await expect(
    owner.mutation(api.team.removeMember, { membershipId: ownerMembershipId }),
  ).rejects.toThrow(/at least one owner/i);
});

test("updateRole member->owner works, then the original owner can be demoted", async () => {
  const t = convexTest(schema, modules);
  const { as: owner } = await asUser(t, "owner4@example.com");
  await owner.mutation(api.organizers.ensureOrganizer, {});
  const memberId = await owner.mutation(api.team.addMember, { email: "promote@x.com", role: "member" });

  await owner.mutation(api.team.updateRole, { membershipId: memberId, role: "owner" });

  const team = await owner.query(api.team.listTeam, {});
  const ownerMembership = team.members.find((m) => m.email === "owner4@example.com")!;
  expect(team.members.find((m) => m.email === "promote@x.com")?.role).toBe("owner");

  // Two owners now exist, so the original owner can be demoted.
  await owner.mutation(api.team.updateRole, { membershipId: ownerMembership._id, role: "member" });
  const after = await owner.query(api.team.listTeam, {});
  expect(after.members.find((m) => m.email === "owner4@example.com")?.role).toBe("member");
});

test("a member calling owner-only mutations throws", async () => {
  const t = convexTest(schema, modules);
  const { as: owner } = await asUser(t, "owner5@example.com");
  await owner.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await owner.mutation(api.events.createEvent, {
    title: "Team Event",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 5,
  });

  await owner.mutation(api.team.addMember, { email: "member5@x.com", role: "member" });
  const { as: member } = await asUser(t, "member5@x.com");
  await member.mutation(api.organizers.ensureOrganizer, {});

  await expect(member.mutation(api.organizers.updateProfile, { name: "New Name" })).rejects.toThrow(
    /only an owner/i,
  );
  await expect(member.mutation(api.organizers.setImage, { storageId: null })).rejects.toThrow(
    /only an owner/i,
  );
  await expect(member.mutation(api.events.deleteEvent, { eventId })).rejects.toThrow(/only an owner/i);
});

test("unauthenticated updateProfile still throws Not authenticated", async () => {
  const t = convexTest(schema, modules);
  await expect(t.mutation(api.organizers.updateProfile, { name: "Nope" })).rejects.toThrow(
    /not authenticated/i,
  );
});

test("getMyIdentity returns the signed-in user's own email, distinct from the org", async () => {
  const t = convexTest(schema, modules);
  const { as: owner } = await asUser(t, "owner6@example.com");
  await owner.mutation(api.organizers.ensureOrganizer, {});
  await owner.mutation(api.team.addMember, { email: "member6@x.com", role: "member" });

  const { as: member } = await asUser(t, "member6@x.com");
  await member.mutation(api.organizers.ensureOrganizer, {});

  const identity = await member.query(api.team.getMyIdentity, {});
  expect(identity?.email).toBe("member6@x.com");

  const org = await member.query(api.organizers.getMe, {});
  expect(org?.email).toBe("owner6@example.com"); // org identity stays the owner's
  expect(identity?.email).not.toBe(org?.email);
});

test("getMyIdentity returns null when unauthenticated", async () => {
  const t = convexTest(schema, modules);
  const identity = await t.query(api.team.getMyIdentity, {});
  expect(identity).toBeNull();
});
