import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import { getMyMembership, requireOwner } from "./auth";

/**
 * The signed-in user's team: every membership on their org, owners first then
 * by join order. `pending` mirrors the membership model's only status signal
 * (no `userId` yet = added by email but never signed in). Any member may view
 * -- team visibility isn't gated, only team *management* is (see the
 * mutations below). `myRole` lets the client show/hide owner-only controls
 * without a second round trip.
 */
export const listTeam = query({
  args: {},
  handler: async (ctx) => {
    const m = await getMyMembership(ctx);
    if (!m) return { members: [], myRole: null };

    const rows = await ctx.db
      .query("memberships")
      .withIndex("by_organizer", (q) => q.eq("organizerId", m.organizerId))
      .collect();

    const members = rows
      .map((row) => ({
        _id: row._id,
        email: row.email,
        role: row.role,
        pending: row.userId === undefined,
        createdAt: row.createdAt,
      }))
      .sort((a, b) => {
        if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
        return a.createdAt - b.createdAt;
      })
      .map(({ createdAt: _createdAt, ...rest }) => rest);

    return { members, myRole: m.role };
  },
});

/**
 * Owner-only: add a teammate by email. Creates a pending membership (no
 * `userId`) that links up automatically on that person's first sign-in --
 * see `organizers.ensureOrganizer`. Rejects an email that already belongs to
 * a membership in *any* org (v1 is one org per person, per the design doc),
 * so this doubles as the cross-org guard.
 */
export const addMember = mutation({
  args: { email: v.string(), role: v.union(v.literal("owner"), v.literal("member")) },
  handler: async (ctx, args) => {
    const organizerId = await requireOwner(ctx);

    const email = args.email.trim().toLowerCase();
    if (!email || !email.includes("@")) throw new Error("Enter a valid email");

    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (existing) throw new Error("That email already belongs to a team");

    return ctx.db.insert("memberships", {
      organizerId,
      email,
      role: args.role,
      createdAt: Date.now(),
    });
  },
});

/** Count owners on an org -- used to block leaving a team without one. */
async function countOwners(ctx: QueryCtx | MutationCtx, organizerId: Id<"organizers">) {
  const rows = await ctx.db
    .query("memberships")
    .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
    .collect();
  return rows.filter((r) => r.role === "owner").length;
}

/**
 * Owner-only: change a teammate's role. Demoting the org's last owner is
 * rejected -- a team must always have at least one owner able to manage it.
 */
export const updateRole = mutation({
  args: { membershipId: v.id("memberships"), role: v.union(v.literal("owner"), v.literal("member")) },
  handler: async (ctx, args) => {
    const organizerId = await requireOwner(ctx);

    const target = await ctx.db.get(args.membershipId);
    if (!target || target.organizerId !== organizerId) throw new Error("Not found");

    if (target.role === "owner" && args.role === "member") {
      const ownerCount = await countOwners(ctx, organizerId);
      if (ownerCount <= 1) throw new Error("The team must have at least one owner");
    }

    await ctx.db.patch(args.membershipId, { role: args.role });
    return null;
  },
});

/**
 * Owner-only: remove a teammate. Blocked when the target is the org's last
 * owner -- this also covers a sole owner trying to remove themselves, since
 * that would leave the team without one.
 */
export const removeMember = mutation({
  args: { membershipId: v.id("memberships") },
  handler: async (ctx, args) => {
    const organizerId = await requireOwner(ctx);

    const target = await ctx.db.get(args.membershipId);
    if (!target || target.organizerId !== organizerId) throw new Error("Not found");

    if (target.role === "owner") {
      const ownerCount = await countOwners(ctx, organizerId);
      if (ownerCount <= 1) throw new Error("The team must have at least one owner");
    }

    await ctx.db.delete(args.membershipId);
    return null;
  },
});

/**
 * The signed-in user's own identity (email/name from `users`), distinct from
 * `organizers.getMe` which returns the *org*. Used by the Account section and
 * to highlight "you" in the team list -- a member's org identity isn't their
 * personal one.
 */
export const getMyIdentity = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return { email: user.email ?? "", name: user.name ?? undefined };
  },
});
