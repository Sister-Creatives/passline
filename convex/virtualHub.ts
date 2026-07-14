import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthOrganizerId } from "./auth";
import { parseVideoEmbed } from "./lib/eventContent";

/** Load an event and enforce that it belongs to the authenticated organizer. */
async function requireOwnedEvent(ctx: QueryCtx | MutationCtx, eventId: Id<"events">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const event = await ctx.db.get(eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return event;
}

type ResourceRow = { title: string; url: string };

const resourceRowValidator = v.object({ title: v.string(), url: v.string() });

const MAX_RESOURCES = 50;

/** The shape returned in place of a real doc when no `virtualHubs` row exists yet. */
function emptyHub(): { enabled: boolean; resources: ResourceRow[] } {
  return { enabled: false, resources: [] };
}

/** Trim a string; an empty (or omitted) value normalizes to `undefined` (i.e. "clear this field"). */
function normalizeOptionalString(s: string | undefined): string | undefined {
  const trimmed = s?.trim();
  return trimmed ? trimmed : undefined;
}

/** Trim both fields, drop rows where either the title or the url is blank, cap at MAX_RESOURCES. */
function normalizeResources(rows: ResourceRow[]): ResourceRow[] {
  return rows
    .map((row) => ({ title: row.title.trim(), url: row.url.trim() }))
    .filter((row) => row.title.length > 0 && row.url.length > 0)
    .slice(0, MAX_RESOURCES);
}

/**
 * The public hub view shared by `getForOrder` and `getWithPassword`: the raw
 * `virtualHubs` doc minus `accessPassword` (the shared lobby-gate secret) and
 * the internal `organizerId`/`eventId` foreign keys -- neither ticket holders
 * nor password-gated visitors need (or should see) any of the three.
 */
function toPublicHubView(hub: Doc<"virtualHubs">) {
  const { accessPassword: _accessPassword, organizerId: _organizerId, eventId: _eventId, ...rest } = hub;
  return rest;
}

/** Owner-only: an event's virtual hub config, or an empty default if none has been saved yet. */
export const get = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireOwnedEvent(ctx, eventId);
    const hub = await ctx.db
      .query("virtualHubs")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .unique();
    return hub ?? emptyHub();
  },
});

/**
 * Owner-only: upsert an event's virtual hub config (patch the existing
 * `by_event` row, or insert one if this is the first save). `videoUrl` is
 * validated via `parseVideoEmbed` when non-empty (it's later interpolated
 * into an iframe `src`, mirroring eventContent.update); `meetingUrl`, when
 * set, must start with `https://` (it's rendered as a plain `href`, never
 * script/iframe -- see F14 spec §7). Every string is trimmed, resource rows
 * missing a title or url are dropped, and the resources array is capped at
 * MAX_RESOURCES.
 */
export const update = mutation({
  args: {
    eventId: v.id("events"),
    enabled: v.boolean(),
    heading: v.optional(v.string()),
    description: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    meetingUrl: v.optional(v.string()),
    resources: v.array(resourceRowValidator),
    accessPassword: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const event = await requireOwnedEvent(ctx, args.eventId);

    const videoUrl = normalizeOptionalString(args.videoUrl);
    if (videoUrl !== undefined && !parseVideoEmbed(videoUrl)) {
      throw new Error("Video URL must be a YouTube or Vimeo link");
    }

    const meetingUrl = normalizeOptionalString(args.meetingUrl);
    if (meetingUrl !== undefined && !meetingUrl.startsWith("https://")) {
      throw new Error("Meeting URL must start with https://");
    }

    const patch = {
      enabled: args.enabled,
      heading: normalizeOptionalString(args.heading),
      description: normalizeOptionalString(args.description),
      videoUrl,
      meetingUrl,
      resources: normalizeResources(args.resources),
      accessPassword: normalizeOptionalString(args.accessPassword),
    };

    const existing = await ctx.db
      .query("virtualHubs")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("virtualHubs", {
      eventId: args.eventId,
      organizerId: event.organizerId,
      ...patch,
    });
  },
});

/**
 * Public: the virtual hub view for a ticket holder, proven by holding their
 * order's opaque token (mirrors `orders.getOrder`'s by-token lookup -- no
 * account required). Returns null (never throws) for an unknown token, a
 * cancelled order, an event with no hub config, or a hub that isn't
 * `enabled`. Never includes `accessPassword` (see `toPublicHubView`).
 */
export const getForOrder = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const order = await ctx.db
      .query("orders")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!order || order.status === "cancelled") return null;

    const hub = await ctx.db
      .query("virtualHubs")
      .withIndex("by_event", (q) => q.eq("eventId", order.eventId))
      .unique();
    if (!hub || !hub.enabled) return null;

    return toPublicHubView(hub);
  },
});

/**
 * Public: the virtual hub view for a non-ticket-holder who supplies the
 * event's shared access password (the F14 spec's "simple shared gate" --
 * stored plaintext, not a user credential). Requires the event to be
 * `published`, the hub to be `enabled`, and `accessPassword` to be set and
 * match exactly; otherwise returns null without distinguishing which
 * condition failed. Never includes `accessPassword` (see `toPublicHubView`).
 */
export const getWithPassword = query({
  args: { slug: v.string(), password: v.string() },
  handler: async (ctx, { slug, password }) => {
    const event = await ctx.db
      .query("events")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!event || event.status !== "published") return null;

    const hub = await ctx.db
      .query("virtualHubs")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .unique();
    if (!hub || !hub.enabled || !hub.accessPassword) return null;
    if (hub.accessPassword !== password) return null;

    return toPublicHubView(hub);
  },
});
