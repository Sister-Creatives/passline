import { v } from "convex/values";
import { httpAction, internalQuery, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { api, internal } from "./_generated/api";
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
      .filter((t) => t.status === "active" && t.visibility === "visible")
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

/**
 * Org-scoped ownership check for the checkout endpoint: returns the event's
 * `organizerId`, or `null` if the event doesn't exist. The httpAction
 * compares this against the authenticated key's organizer itself (rather
 * than taking `organizerId` as an arg here) so a caller can't spoof
 * ownership through the query's arguments.
 */
export const eventOrganizerId = internalQuery({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    return event ? event.organizerId : null;
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
const badRequest = (message: string) => jsonResponse({ error: message }, 400);

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Parse `Authorization: Bearer <secret>`, resolve it to an organizer via
 * `internalResolve`, and touch the key's `lastUsedAt` on success. Returns
 * `null` for a missing header, malformed header, or an unknown/revoked key —
 * callers respond 401 in every one of those cases without distinguishing
 * why, so a bad guess never reveals anything about real keys.
 *
 * The touch write is throttled to once per `TOUCH_INTERVAL_MS` per key, so a
 * hot key under load doesn't OCC-contend on its own `apiKeys` row every
 * request.
 */
async function authenticate(ctx: ActionCtx, request: Request): Promise<Id<"organizers"> | null> {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const secret = header.slice("Bearer ".length).trim();
  if (!secret) return null;

  const keyHash = await sha256Hex(secret);
  const resolved = await ctx.runQuery(internal.apiKeys.internalResolve, { keyHash });
  if (!resolved) return null;

  if (Date.now() - (resolved.lastUsedAt ?? 0) > TOUCH_INTERVAL_MS) {
    await ctx.runMutation(internal.apiKeys.internalTouch, { keyId: resolved.keyId });
  }
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
const QUESTIONS_PATH = /^\/v1\/events\/([^/]+)\/questions\/?$/;

/** GET /v1/events/{eventId}/ticket-types — that event's ticket types, if it's the caller's. */
async function handleListTicketTypes(
  ctx: ActionCtx,
  organizerId: Id<"organizers">,
  eventId: string,
): Promise<Response> {
  try {
    const ticketTypes = await ctx.runQuery(internal.apiHttp.ticketTypesForOrganizerEvent, {
      organizerId,
      eventId: eventId as Id<"events">,
    });
    if (ticketTypes === null) return notFound();
    return jsonResponse({ data: ticketTypes });
  } catch {
    // Malformed id segment (not a valid Convex id at all) — same 404 as a
    // well-formed id that doesn't resolve to the caller's event.
    return notFound();
  }
}

/**
 * GET /v1/events/{eventId}/questions — that event's active checkout
 * questions (F5), if it's the caller's. Ownership is checked first (via the
 * same `eventOrganizerId` lookup `createOrder` uses below) so a foreign or
 * missing event 404s before we ever read questions; the data itself reuses
 * the public `checkoutQuestions.listForEvent` query, so this endpoint's
 * shape always matches what a checkout would render.
 */
async function handleListQuestions(
  ctx: ActionCtx,
  organizerId: Id<"organizers">,
  eventId: string,
): Promise<Response> {
  try {
    const typedEventId = eventId as Id<"events">;
    const ownerId = await ctx.runQuery(internal.apiHttp.eventOrganizerId, { eventId: typedEventId });
    if (ownerId === null || ownerId !== organizerId) return notFound();
    const questions = await ctx.runQuery(api.checkoutQuestions.listForEvent, { eventId: typedEventId });
    return jsonResponse({ data: questions });
  } catch {
    // Malformed id segment (not a valid Convex id at all) — same 404 as a
    // well-formed id that doesn't resolve to the caller's event.
    return notFound();
  }
}

/**
 * GET /v1/events/{eventId}/ticket-types and GET /v1/events/{eventId}/questions
 * both live under this single httpAction: Convex's httpRouter allows only one
 * handler per (method, pathPrefix), and both endpoints share the
 * "/v1/events/" prefix, so they dispatch here by matching the URL's suffix
 * rather than each registering their own route in convex/http.ts.
 */
export const listEventSubResource = httpAction(async (ctx, request) => {
  const organizerId = await authenticate(ctx, request);
  if (!organizerId) return unauthorized();

  const pathname = new URL(request.url).pathname;

  const ticketTypesMatch = pathname.match(TICKET_TYPES_PATH);
  if (ticketTypesMatch) return handleListTicketTypes(ctx, organizerId, ticketTypesMatch[1]);

  const questionsMatch = pathname.match(QUESTIONS_PATH);
  if (questionsMatch) return handleListQuestions(ctx, organizerId, questionsMatch[1]);

  return notFound();
});

type CreateOrderBody = {
  eventId?: unknown;
  items?: unknown;
  buyerName?: unknown;
  buyerEmail?: unknown;
  promoCode?: unknown;
  answers?: unknown;
  accessCode?: unknown;
};

/**
 * POST /v1/orders — headless checkout. Bearer-authenticated; the key's
 * organizer must own `eventId` (404 otherwise — same "not found" a foreign
 * or missing event gets from listEventSubResource, so a bad guess never
 * reveals which case it was). Delegates to the same public
 * `orders.createOrder` mutation the buyer-facing app would call, so HTTP
 * callers get identical validation/fee/capacity behavior; any Error it
 * throws (sold out, bad quantity, unpublished event, a missing required
 * checkout-question answer, ...) is mapped to a 400. An optional `answers`
 * array (F5) is passed through unvalidated here — `orders.createOrder`
 * itself validates it via `validateAndSnapshotAnswers`. An optional
 * `accessCode` (F4b) is likewise passed through unvalidated — `createOrder`
 * resolves it and enforces it against any `hidden` ticket types in the cart.
 */
export const createOrder = httpAction(async (ctx, request) => {
  const organizerId = await authenticate(ctx, request);
  if (!organizerId) return unauthorized();

  let body: CreateOrderBody;
  try {
    body = (await request.json()) as CreateOrderBody;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const { eventId, items, buyerName, buyerEmail, promoCode, answers, accessCode } = body;
  if (typeof eventId !== "string") return badRequest("eventId is required");
  if (typeof buyerName !== "string") return badRequest("buyerName is required");
  if (typeof buyerEmail !== "string") return badRequest("buyerEmail is required");
  if (!Array.isArray(items)) return badRequest("items must be an array");
  if (promoCode !== undefined && typeof promoCode !== "string") {
    return badRequest("promoCode must be a string");
  }
  if (answers !== undefined && !Array.isArray(answers)) {
    return badRequest("answers must be an array");
  }
  if (accessCode !== undefined && typeof accessCode !== "string") {
    return badRequest("accessCode must be a string");
  }

  let ownerId: Id<"organizers"> | null;
  try {
    ownerId = await ctx.runQuery(internal.apiHttp.eventOrganizerId, {
      eventId: eventId as Id<"events">,
    });
  } catch {
    // Malformed id (not a valid Convex id at all) — same 404 as a
    // well-formed id that doesn't resolve to the caller's event.
    return notFound();
  }
  if (ownerId === null || ownerId !== organizerId) return notFound();

  try {
    const result = await ctx.runMutation(api.orders.createOrder, {
      eventId: eventId as Id<"events">,
      items: items as { ticketTypeId: Id<"ticketTypes">; quantity: number }[],
      buyerName,
      buyerEmail,
      promoCode: promoCode as string | undefined,
      answers: answers as { questionId: Id<"checkoutQuestions">; value: string }[] | undefined,
      accessCode: accessCode as string | undefined,
    });
    return jsonResponse({ data: result }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid request";
    return badRequest(message);
  }
});
