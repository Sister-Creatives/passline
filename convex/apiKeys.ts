import {
  mutation,
  query,
  internalQuery,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getAuthOrganizerId } from "./auth";

const SECRET_PREFIX = "pl_live_";

/** Lowercase-hex SHA-256 of `input`, via Web Crypto (available in Convex functions). */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** 20 random bytes -> 40 lowercase hex chars, prefixed to form the full secret. */
function generateSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${SECRET_PREFIX}${hex}`;
}

/** Load an apiKeys row and enforce that it belongs to the authenticated organizer. */
async function requireOwnedKey(
  ctx: QueryCtx | MutationCtx,
  organizerId: Id<"organizers">,
  keyId: Id<"apiKeys">,
) {
  const key = await ctx.db.get(keyId);
  if (!key || key.organizerId !== organizerId) throw new Error("Not found");
  return key;
}

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");

    const secret = generateSecret();
    const keyHash = await sha256Hex(secret);

    const id = await ctx.db.insert("apiKeys", {
      organizerId,
      name,
      keyHash,
      prefix: SECRET_PREFIX,
      lastFour: secret.slice(-4),
      createdAt: Date.now(),
    });

    // The only place the full secret is ever returned.
    return { id, secret };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");

    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .collect();

    // Metadata only — never keyHash/secret.
    return keys.map((key) => ({
      id: key._id,
      name: key.name,
      prefix: key.prefix,
      lastFour: key.lastFour,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
    }));
  },
});

export const revoke = mutation({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, { keyId }) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");
    await requireOwnedKey(ctx, organizerId, keyId);
    await ctx.db.patch(keyId, { revokedAt: Date.now() });
    return null;
  },
});

export const internalResolve = internalQuery({
  args: { keyHash: v.string() },
  handler: async (ctx, { keyHash }) => {
    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_hash", (q) => q.eq("keyHash", keyHash))
      .unique();
    if (!key || key.revokedAt !== undefined) return null;
    return { organizerId: key.organizerId, keyId: key._id, lastUsedAt: key.lastUsedAt };
  },
});

export const internalTouch = internalMutation({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, { keyId }) => {
    await ctx.db.patch(keyId, { lastUsedAt: Date.now() });
    return null;
  },
});
