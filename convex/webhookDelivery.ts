import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { hmacSha256Hex } from "./webhooks";

/** Exponential backoff (ms) indexed by attempt number (1-based). */
const BACKOFF_MS = [1000, 5000, 30000, 120000, 600000];

function backoffMs(attempts: number): number {
  return BACKOFF_MS[attempts - 1] ?? 600000;
}

/**
 * Delivers a pending webhook delivery: signs the payload, POSTs it to the
 * webhook's URL, and records the outcome (delivered, or a failed attempt
 * that retries with backoff up to 5 attempts).
 */
export const deliver = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    const result = await ctx.runQuery(internal.webhooks.getDeliveryWithWebhook, { deliveryId });
    if (!result) return null;
    const { delivery, webhook } = result;

    let responseStatus: number | undefined;
    let ok = false;
    try {
      const signature = await hmacSha256Hex(webhook.secret, delivery.payload);
      const response = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Passline-Event": delivery.eventType,
          "X-Passline-Signature": signature,
        },
        body: delivery.payload,
        // Don't follow redirects: a 3xx response is treated as a failed
        // (retriable) attempt rather than transparently following an
        // https -> internal-http redirect (SSRF bypass).
        redirect: "manual",
      });
      responseStatus = response.status;
      ok = response.status >= 200 && response.status < 300;
    } catch {
      ok = false;
      responseStatus = undefined;
    }

    if (ok) {
      await ctx.runMutation(internal.webhooks.markDelivered, {
        deliveryId,
        responseStatus: responseStatus as number,
      });
      return null;
    }

    const { attempts, status } = await ctx.runMutation(internal.webhooks.markFailedAttempt, {
      deliveryId,
      responseStatus,
    });

    if (status === "pending") {
      await ctx.scheduler.runAfter(backoffMs(attempts), internal.webhookDelivery.deliver, {
        deliveryId,
      });
    }

    return null;
  },
});
