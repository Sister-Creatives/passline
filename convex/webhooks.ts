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
import { internal } from "./_generated/api";

const SECRET_PREFIX = "whsec_";

/** Event types a webhook may subscribe to. F2b only emits ticket-type events. */
export const KNOWN_EVENT_TYPES = [
  "ticket_type.created",
  "ticket_type.updated",
  "ticket_type.deleted",
] as const;

export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];

/**
 * Lowercase-hex HMAC-SHA256 of `body` keyed by `secret`, via Web Crypto
 * (available in both Convex functions and actions). Used to sign delivery
 * payloads (`X-Passline-Signature`) and, by the receiving end, to verify them.
 */
export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature))
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

/** Load a webhooks row and enforce that it belongs to the authenticated organizer. */
async function requireOwnedWebhook(
  ctx: QueryCtx | MutationCtx,
  organizerId: Id<"organizers">,
  webhookId: Id<"webhooks">,
) {
  const webhook = await ctx.db.get(webhookId);
  if (!webhook || webhook.organizerId !== organizerId) throw new Error("Not found");
  return webhook;
}

export const create = mutation({
  args: { url: v.string(), subscribedEvents: v.array(v.string()) },
  handler: async (ctx, { url, subscribedEvents }) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");

    if (!url.startsWith("https://")) {
      throw new Error("url must start with https://");
    }
    if (subscribedEvents.length === 0) {
      throw new Error("subscribedEvents must not be empty");
    }
    const known = new Set<string>(KNOWN_EVENT_TYPES);
    if (!subscribedEvents.every((eventType) => known.has(eventType))) {
      throw new Error("subscribedEvents must be a subset of the known event types");
    }

    const secret = generateSecret();
    const id = await ctx.db.insert("webhooks", {
      organizerId,
      url,
      secret,
      subscribedEvents,
      active: true,
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

    const webhooks = await ctx.db
      .query("webhooks")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .collect();

    // Metadata only — never the secret.
    return webhooks.map((webhook) => ({
      id: webhook._id,
      url: webhook.url,
      subscribedEvents: webhook.subscribedEvents,
      active: webhook.active,
      createdAt: webhook.createdAt,
    }));
  },
});

export const remove = mutation({
  args: { webhookId: v.id("webhooks") },
  handler: async (ctx, { webhookId }) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");
    await requireOwnedWebhook(ctx, organizerId, webhookId);
    await ctx.db.delete(webhookId);
    return null;
  },
});

/**
 * Plain helper (not a Convex function) called from `ticketTypes` mutations
 * after a write commits. Finds the organizer's active webhooks subscribed to
 * `eventType`, inserts a `pending` delivery row per webhook, and schedules
 * the delivery action for each. Only inserts + schedules — it does not
 * throw in the course of normal operation, so callers can invoke it without
 * risking the parent mutation.
 */
export async function emitTicketTypeEvent(
  ctx: MutationCtx,
  organizerId: Id<"organizers">,
  eventType: KnownEventType,
  payload: string,
): Promise<void> {
  const webhooks = await ctx.db
    .query("webhooks")
    .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
    .collect();

  const targets = webhooks.filter(
    (webhook) => webhook.active && webhook.subscribedEvents.includes(eventType),
  );

  for (const webhook of targets) {
    const deliveryId = await ctx.db.insert("webhookDeliveries", {
      webhookId: webhook._id,
      organizerId,
      eventType,
      payload,
      status: "pending",
      attempts: 0,
    });
    await ctx.scheduler.runAfter(0, internal.webhookDelivery.deliver, { deliveryId });
  }
}

/** Loads a delivery + its webhook for the delivery action. actions can't touch ctx.db directly. */
export const getDeliveryWithWebhook = internalQuery({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    const delivery = await ctx.db.get(deliveryId);
    if (!delivery) return null;
    const webhook = await ctx.db.get(delivery.webhookId);
    if (!webhook) return null;
    return { delivery, webhook };
  },
});

export const markDelivered = internalMutation({
  args: { deliveryId: v.id("webhookDeliveries"), responseStatus: v.number() },
  handler: async (ctx, { deliveryId, responseStatus }) => {
    await ctx.db.patch(deliveryId, {
      status: "delivered",
      responseStatus,
      lastAttemptAt: Date.now(),
    });
    return null;
  },
});

export const markFailedAttempt = internalMutation({
  args: { deliveryId: v.id("webhookDeliveries"), responseStatus: v.optional(v.number()) },
  handler: async (ctx, { deliveryId, responseStatus }) => {
    const delivery = await ctx.db.get(deliveryId);
    if (!delivery) throw new Error("Not found");

    const attempts = delivery.attempts + 1;
    const status: "pending" | "failed" = attempts >= 5 ? "failed" : "pending";

    const patch: {
      attempts: number;
      lastAttemptAt: number;
      status: "pending" | "failed";
      responseStatus?: number;
    } = { attempts, lastAttemptAt: Date.now(), status };
    if (responseStatus !== undefined) patch.responseStatus = responseStatus;

    await ctx.db.patch(deliveryId, patch);
    return { attempts, status };
  },
});
