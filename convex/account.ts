import { v } from "convex/values";
import {
  getAuthUserId,
  getAuthSessionId,
  retrieveAccount,
  modifyAccountCredentials,
  invalidateSessions,
} from "@convex-dev/auth/server";
import { action, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

const PASSWORD_MIN = 8;
const CODE_TTL_MS = 600_000;
const MAX_CODE_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sixDigitCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

/** The signed-in user's stored email, or null. Actions read the DB through this. */
export const getUserEmail = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    return user?.email ?? null;
  },
});

export const changePassword = action({
  args: { currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, { currentPassword, newPassword }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const email = await ctx.runQuery(internal.account.getUserEmail, { userId });
    if (!email) throw new Error("Not authenticated");
    if (newPassword.length < PASSWORD_MIN) {
      throw new Error("Password must be at least 8 characters");
    }
    try {
      await retrieveAccount(ctx, {
        provider: "password",
        account: { id: email, secret: currentPassword },
      });
    } catch {
      throw new Error("Current password is incorrect");
    }
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: email, secret: newPassword },
    });
    return { ok: true as const };
  },
});

export const signOutOtherSessions = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const sessionId = await getAuthSessionId(ctx);
    await invalidateSessions(ctx, {
      userId,
      except: sessionId ? [sessionId] : [],
    });
    return { ok: true as const };
  },
});

/** True when no user/account already owns this (lowercased) email. */
export const checkEmailAvailable = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }): Promise<boolean> => {
    const byUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (byUser) return false;
    const byAccount = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", email),
      )
      .first();
    return !byAccount;
  },
});

export const upsertEmailChangeRequest = internalMutation({
  args: {
    userId: v.id("users"),
    newEmail: v.string(),
    codeHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query("emailChangeRequests")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.insert("emailChangeRequests", { ...args, attempts: 0 });
    return null;
  },
});

export const readEmailChangeRequest = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<Doc<"emailChangeRequests"> | null> => {
    return await ctx.db
      .query("emailChangeRequests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
  },
});

export const bumpEmailChangeAttempts = internalMutation({
  args: { requestId: v.id("emailChangeRequests") },
  handler: async (ctx, { requestId }): Promise<null> => {
    const r = await ctx.db.get(requestId);
    if (r) await ctx.db.patch(requestId, { attempts: r.attempts + 1 });
    return null;
  },
});

/**
 * The identity-key migration. Re-checks availability, then updates every
 * email-keyed record in one transaction and deletes the request.
 */
export const applyEmailChange = internalMutation({
  args: { userId: v.id("users"), newEmail: v.string() },
  handler: async (ctx, { userId, newEmail }): Promise<null> => {
    const user = await ctx.db.get(userId);
    if (!user?.email) throw new Error("Not authenticated");
    const oldEmail = user.email.toLowerCase();

    // Race guard: someone may have taken the email since startEmailChange.
    const taken = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", newEmail))
      .first();
    if (taken && taken._id !== userId) throw new Error("That email is already in use");

    // 1. Password account providerAccountId (found by user + provider, not old email).
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId).eq("provider", "password"))
      .first();
    if (account) await ctx.db.patch(account._id, { providerAccountId: newEmail });

    // 2. users.email
    await ctx.db.patch(userId, { email: newEmail });

    // 3. memberships.email (stored lowercase)
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_email", (q) => q.eq("email", oldEmail))
      .first();
    if (membership) await ctx.db.patch(membership._id, { email: newEmail });

    // 4. legacy organizers.email
    const legacyOrg = await ctx.db
      .query("organizers")
      .withIndex("by_email", (q) => q.eq("email", oldEmail))
      .unique()
      .catch(() => null);
    if (legacyOrg) await ctx.db.patch(legacyOrg._id, { email: newEmail });

    // 5. delete the request
    const request = await ctx.db
      .query("emailChangeRequests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (request) await ctx.db.delete(request._id);
    return null;
  },
});

export const startEmailChange = action({
  args: { currentPassword: v.string(), newEmail: v.string() },
  handler: async (ctx, { currentPassword, newEmail }): Promise<{ ok: true }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const email = await ctx.runQuery(internal.account.getUserEmail, { userId });
    if (!email) throw new Error("Not authenticated");

    const next = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(next)) throw new Error("Enter a valid email address");
    if (next === email.toLowerCase()) throw new Error("That's already your email");

    try {
      await retrieveAccount(ctx, {
        provider: "password",
        account: { id: email, secret: currentPassword },
      });
    } catch {
      throw new Error("Current password is incorrect");
    }

    const available = await ctx.runQuery(internal.account.checkEmailAvailable, { email: next });
    if (!available) throw new Error("That email is already in use");

    const code = sixDigitCode();
    const codeHash = await sha256Hex(code);
    await ctx.runMutation(internal.account.upsertEmailChangeRequest, {
      userId,
      newEmail: next,
      codeHash,
      expiresAt: Date.now() + CODE_TTL_MS,
    });
    await ctx.scheduler.runAfter(0, internal.email.sendEmailChangeCode, { to: next, code });
    return { ok: true as const };
  },
});

export const confirmEmailChange = action({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<{ ok: true; email: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const request = await ctx.runQuery(internal.account.readEmailChangeRequest, { userId });
    if (!request) throw new Error("No pending email change");
    if (Date.now() > request.expiresAt) throw new Error("Verification code expired");
    if (request.attempts >= MAX_CODE_ATTEMPTS) throw new Error("Too many attempts");

    const codeHash = await sha256Hex(code.trim());
    if (codeHash !== request.codeHash) {
      await ctx.runMutation(internal.account.bumpEmailChangeAttempts, { requestId: request._id });
      throw new Error("Incorrect code");
    }
    await ctx.runMutation(internal.account.applyEmailChange, {
      userId,
      newEmail: request.newEmail,
    });
    return { ok: true as const, email: request.newEmail };
  },
});
