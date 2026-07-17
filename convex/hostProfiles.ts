import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getAuthOrganizerId } from "./auth";

const MAX_BIO_LENGTH = 600;

/** Trim a string; an empty (or omitted) value normalizes to `undefined` (i.e. "clear this field"), matching the `eventContent.ts`/`virtualHub.ts` idiom. */
function normalizeOptionalString(s: string | undefined): string | undefined {
  const trimmed = s?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Trim and validate the optional fields shared by `create`/`update`: `bio`
 * must be <= MAX_BIO_LENGTH characters after trim, and `websiteUrl`, when
 * present, must start with `https://` (mirrors `virtualHub.ts`'s `meetingUrl`
 * guard -- blocks `http://`, `javascript:`, `data:`, etc). These are direct
 * create/update args (not a clear-or-set patch), so every value the caller
 * actually passed is validated as given, not silently dropped.
 *
 * The logo is no longer a URL -- it's an uploaded file (`logoId`), so there is
 * nothing to validate: the id's existence is enforced by the storage type.
 */
function validateFields(args: { bio?: string; websiteUrl?: string }) {
  const bio = normalizeOptionalString(args.bio);
  if (bio !== undefined && bio.length > MAX_BIO_LENGTH) {
    throw new Error(`Bio must be ${MAX_BIO_LENGTH} characters or fewer`);
  }

  const websiteUrl = normalizeOptionalString(args.websiteUrl);
  if (websiteUrl !== undefined && !websiteUrl.startsWith("https://")) {
    throw new Error("Website URL must start with https://");
  }

  return { bio, websiteUrl };
}

/** Load a host profile and enforce that it belongs to the authenticated organizer. */
async function requireOwnedHostProfile(ctx: QueryCtx | MutationCtx, hostProfileId: Id<"hostProfiles">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const profile = await ctx.db.get(hostProfileId);
  if (!profile || profile.organizerId !== organizerId) throw new Error("Not found");
  return profile;
}

/**
 * Create a reusable host profile for the authenticated organizer. `name`
 * must be non-empty after trim; `bio`/`websiteUrl` are validated (see
 * `validateFields`). Stamps `organizerId` (from auth) + `createdAt`.
 */
export const create = mutation({
  args: {
    name: v.string(),
    bio: v.optional(v.string()),
    logoId: v.optional(v.id("_storage")),
    websiteUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");

    const name = args.name.trim();
    if (name.length === 0) throw new Error("Name is required");

    const { bio, websiteUrl } = validateFields(args);

    return ctx.db.insert("hostProfiles", {
      organizerId,
      name,
      bio,
      logoId: args.logoId,
      websiteUrl,
      createdAt: Date.now(),
    });
  },
});

/** Owner-only: the caller's host profiles, newest first. `[]` when unauthenticated (mirrors `listMyEvents`).
 *  `logoUrl` is resolved: the uploaded file when present, else the legacy URL. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return [];
    const rows = await ctx.db
      .query("hostProfiles")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .order("desc")
      .collect();
    return await Promise.all(
      rows.map(async (row) => ({
        ...row,
        logoUrl: row.logoId ? ((await ctx.storage.getUrl(row.logoId)) ?? undefined) : row.logoUrl,
      })),
    );
  },
});

/**
 * Owner-only: re-validate and patch every field of an existing host profile.
 *
 * Deletes the logo blob it replaces so storage doesn't accumulate orphans. The
 * legacy `logoUrl` is only cleared when a `logoId` is supplied -- a name-only
 * edit on a pre-upload profile must not wipe out its existing logo.
 */
export const update = mutation({
  args: {
    hostProfileId: v.id("hostProfiles"),
    name: v.string(),
    bio: v.optional(v.string()),
    logoId: v.optional(v.id("_storage")),
    websiteUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await requireOwnedHostProfile(ctx, args.hostProfileId);

    const name = args.name.trim();
    if (name.length === 0) throw new Error("Name is required");

    const { bio, websiteUrl } = validateFields(args);

    const prev = profile.logoId;
    if (prev && prev !== args.logoId) await ctx.storage.delete(prev);

    await ctx.db.patch(args.hostProfileId, {
      name,
      bio,
      logoId: args.logoId,
      logoUrl: args.logoId ? undefined : profile.logoUrl,
      websiteUrl,
    });
    return null;
  },
});

/**
 * Owner-only: delete a host profile. Before deleting, clears `hostProfileId`
 * on any of the organizer's events that reference it (queried via `events`'
 * `by_organizer` index), so no event is left pointing at a deleted profile.
 */
export const remove = mutation({
  args: { hostProfileId: v.id("hostProfiles") },
  handler: async (ctx, { hostProfileId }) => {
    const profile = await requireOwnedHostProfile(ctx, hostProfileId);

    const events = await ctx.db
      .query("events")
      .withIndex("by_organizer", (q) => q.eq("organizerId", profile.organizerId))
      .collect();
    for (const event of events) {
      if (event.hostProfileId === hostProfileId) {
        await ctx.db.patch(event._id, { hostProfileId: undefined });
      }
    }

    // Mirrors events.deleteEvent, which deletes coverImageId + gallery blobs on
    // delete: without this the logo file outlives every reference to it.
    if (profile.logoId) await ctx.storage.delete(profile.logoId);

    await ctx.db.delete(hostProfileId);
    return null;
  },
});

/**
 * Public: the "Hosted by" projection for a published event's attached host
 * profile (mirrors `checkoutQuestions.listForEvent`'s published gate). Never
 * throws: returns `null` when the event is missing or not `published`, when
 * the event has no `hostProfileId`, or when the referenced profile no longer
 * exists (deleted). The result is an explicit object literal -- never
 * `_id`/`_creationTime`/`organizerId`/`createdAt` -- so no internal id ever
 * leaks to attendees.
 */
export const getForEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "published") return null;
    if (!event.hostProfileId) return null;

    const profile = await ctx.db.get(event.hostProfileId);
    if (!profile) return null;

    return {
      name: profile.name,
      bio: profile.bio,
      logoUrl: profile.logoId
        ? ((await ctx.storage.getUrl(profile.logoId)) ?? undefined)
        : profile.logoUrl,
      websiteUrl: profile.websiteUrl,
    };
  },
});
