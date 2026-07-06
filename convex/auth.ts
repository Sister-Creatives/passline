import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import type { QueryCtx, MutationCtx } from "./_generated/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
});

/**
 * Resolve the current authenticated user to their organizers row id.
 *
 * Convex Auth stores identity in the `users` table; we mirror each user into an
 * `organizers` row by email (see `organizers.ensureOrganizer`). This helper is
 * the single source of truth every later backend task uses to scope data to the
 * signed-in organizer. Returns `null` when unauthenticated or unmapped.
 */
export async function getAuthOrganizerId(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  if (!user?.email) return null;
  const existing = await ctx.db
    .query("organizers")
    .withIndex("by_email", (q) => q.eq("email", user.email!))
    .unique();
  return existing?._id ?? null;
}
