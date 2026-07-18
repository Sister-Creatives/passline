import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
});

/**
 * Resolve the current authenticated user to their organizers row id.
 *
 * Convex Auth stores identity in the `users` table; each user's email maps to
 * an org via a `memberships` row (see `organizers.ensureOrganizer`), which is
 * what lets several users share one org. A legacy fallback (a pre-migration
 * owner's `organizers` row, matched by email) keeps this safe to ship without
 * a hard ordering dependency on the backfill migration -- see
 * `convex/migrations.ts` `backfillOwnerMemberships`. This helper is the single
 * source of truth every later backend task uses to scope data to the
 * signed-in organizer. Returns `null` when unauthenticated or unmapped.
 */
export async function getAuthOrganizerId(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  if (!user?.email) return null;
  const email = user.email.toLowerCase();
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_email", (q) => q.eq("email", email))
    .first();
  if (membership) return membership.organizerId;
  // Legacy fallback: a pre-migration owner still has an organizers row by email.
  const legacy = await ctx.db
    .query("organizers")
    .withIndex("by_email", (q) => q.eq("email", user.email!))
    .unique();
  return legacy?._id ?? null;
}

/**
 * The current user's membership (org + role), or null. Prefer this over
 * `getAuthOrganizerId` when you need the role.
 */
export async function getMyMembership(
  ctx: QueryCtx | MutationCtx,
): Promise<{ organizerId: Id<"organizers">; role: "owner" | "member" } | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  if (!user?.email) return null;
  const email = user.email.toLowerCase();
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_email", (q) => q.eq("email", email))
    .first();
  if (membership) return { organizerId: membership.organizerId, role: membership.role };
  // Legacy fallback: a pre-migration creator is an owner.
  const legacy = await ctx.db
    .query("organizers")
    .withIndex("by_email", (q) => q.eq("email", user.email!))
    .unique();
  if (legacy) return { organizerId: legacy._id, role: "owner" };
  return null;
}

/** Throws unless the current user is an owner; returns their organizerId. */
export async function requireOwner(ctx: QueryCtx | MutationCtx): Promise<Id<"organizers">> {
  const membership = await getMyMembership(ctx);
  if (!membership || membership.role !== "owner") {
    throw new Error("Only an owner can do this");
  }
  return membership.organizerId;
}
