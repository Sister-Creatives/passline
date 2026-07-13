import { v } from "convex/values";
import { httpAction, internalQuery, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { sha256Hex } from "./apiKeys";

/**
 * Org-scoped read of an organizer's events, for the HTTP API. httpActions
 * can't use `getAuthOrganizerId` (they authenticate by API key, not Convex
 * Auth identity), so `organizerId` is resolved by the caller and passed in
 * explicitly.
 */
export const eventsForOrganizer = internalQuery({
  args: { organizerId: v.id("organizers") },
  handler: async (ctx, { organizerId }) => {
    const events = await ctx.db
      .query("events")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .collect();
    return events.map((event) => ({
      id: event._id,
      title: event.title,
      slug: event.slug,
      status: event.status,
      capacity: event.capacity,
      currency: event.currency ?? "USD",
      startsAt: event.startsAt,
      endsAt: event.endsAt,
    }));
  },
});

/**
 * Org-scoped read of one event's ticket types, for the HTTP API. Returns
 * `null` (not an empty list) when the event doesn't exist or belongs to a
 * different organizer than `organizerId`, so the httpAction can turn that
 * into a 404 without leaking which case it was.
 */
export const ticketTypesForOrganizerEvent = internalQuery({
  args: { organizerId: v.id("organizers"), eventId: v.id("events") },
  handler: async (ctx, { organizerId, eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.organizerId !== organizerId) return null;

    const currency = event.currency ?? "USD";
    const ticketTypes = await ctx.db
      .query("ticketTypes")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();

    return ticketTypes
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((ticketType) => ({
        id: ticketType._id,
        name: ticketType.name,
        kind: ticketType.kind,
        priceCents: ticketType.priceCents,
        currency,
        capacity: ticketType.capacity,
        sold: ticketType.sold,
        badge: ticketType.badge,
        sortOrder: ticketType.sortOrder,
      }));
  },
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const unauthorized = () => jsonResponse({ error: "unauthorized" }, 401);
const notFound = () => jsonResponse({ error: "not found" }, 404);

/**
 * Parse `Authorization: Bearer <secret>`, resolve it to an organizer via
 * `internalResolve`, and touch the key's `lastUsedAt` on success. Returns
 * `null` for a missing header, malformed header, or an unknown/revoked key —
 * callers respond 401 in every one of those cases without distinguishing
 * why, so a bad guess never reveals anything about real keys.
 */
async function authenticate(ctx: ActionCtx, request: Request): Promise<Id<"organizers"> | null> {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const secret = header.slice("Bearer ".length).trim();
  if (!secret) return null;

  const keyHash = await sha256Hex(secret);
  const resolved = await ctx.runQuery(internal.apiKeys.internalResolve, { keyHash });
  if (!resolved) return null;

  await ctx.runMutation(internal.apiKeys.internalTouch, { keyId: resolved.keyId });
  return resolved.organizerId;
}

/** GET /v1/events — the authenticated organizer's events. */
export const listEvents = httpAction(async (ctx, request) => {
  const organizerId = await authenticate(ctx, request);
  if (!organizerId) return unauthorized();

  const events = await ctx.runQuery(internal.apiHttp.eventsForOrganizer, { organizerId });
  return jsonResponse({ data: events });
});

const TICKET_TYPES_PATH = /^\/v1\/events\/([^/]+)\/ticket-types\/?$/;

/** GET /v1/events/{eventId}/ticket-types — that event's ticket types, if it's the caller's. */
export const listTicketTypes = httpAction(async (ctx, request) => {
  const organizerId = await authenticate(ctx, request);
  if (!organizerId) return unauthorized();

  const match = new URL(request.url).pathname.match(TICKET_TYPES_PATH);
  if (!match) return notFound();

  try {
    const ticketTypes = await ctx.runQuery(internal.apiHttp.ticketTypesForOrganizerEvent, {
      organizerId,
      eventId: match[1] as Id<"events">,
    });
    if (ticketTypes === null) return notFound();
    return jsonResponse({ data: ticketTypes });
  } catch {
    // Malformed id segment (not a valid Convex id at all) — same 404 as a
    // well-formed id that doesn't resolve to the caller's event.
    return notFound();
  }
});
