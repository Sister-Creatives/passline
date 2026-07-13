import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * Delivers a pending webhook delivery: signs the payload, POSTs it to the
 * webhook's URL, and records the outcome (delivered, or a failed attempt
 * that retries with backoff up to 5 attempts). Placeholder — the full
 * fetch/retry/backoff implementation (spec §4) lands in the next slice. This
 * stub exists so `emitTicketTypeEvent` (convex/webhooks.ts) has a valid
 * `internal.webhookDelivery.deliver` reference to schedule against.
 */
export const deliver = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async () => {
    return null;
  },
});
