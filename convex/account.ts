import { v } from "convex/values";
import {
  getAuthUserId,
  getAuthSessionId,
  retrieveAccount,
  modifyAccountCredentials,
  invalidateSessions,
} from "@convex-dev/auth/server";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

const PASSWORD_MIN = 8;

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
