import {
  mutation,
  query,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthOrganizerId } from "./auth";
import { computeOrderAmounts, type OrderLineItem } from "./lib/fees";
import { resolveAndComputeDiscount } from "./promoCodes";
import { validateAndSnapshotAnswers } from "./checkoutQuestions";
import { unlockedTicketTypeIds } from "./accessCodes";

/** 16 random bytes -> 32 lowercase hex chars, prefixed to form an opaque token/code. */
function randomToken(prefix: string): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}${hex}`;
}

/** Load an event and enforce that it belongs to the authenticated organizer. */
async function requireOwnedEvent(ctx: QueryCtx | MutationCtx, eventId: Id<"events">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const event = await ctx.db.get(eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return event;
}

/** Load an order and enforce that its event belongs to the authenticated organizer. */
async function requireOwnedOrder(ctx: QueryCtx | MutationCtx, orderId: Id<"orders">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const order = await ctx.db.get(orderId);
  if (!order) throw new Error("Not found");
  const event = await ctx.db.get(order.eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return order;
}

/**
 * Issue one `tickets` row per unit across the order's items and mark the
 * order `paid`. Plain helper (not a Convex function) shared by `createOrder`'s
 * free ($0 total) path and `markOrderPaid`, so both fulfill orders exactly
 * the same way.
 */
async function issueTicketsAndMarkPaid(ctx: MutationCtx, order: Doc<"orders">) {
  const items = await ctx.db
    .query("orderItems")
    .withIndex("by_order", (q) => q.eq("orderId", order._id))
    .collect();
  for (const item of items) {
    for (let i = 0; i < item.quantity; i++) {
      await ctx.db.insert("tickets", {
        orderId: order._id,
        eventId: order.eventId,
        ticketTypeId: item.ticketTypeId,
        code: randomToken("tkt_"),
        status: "valid",
        createdAt: Date.now(),
      });
    }
  }
  await ctx.db.patch(order._id, { status: "paid", paidAt: Date.now() });
}

const orderItemInput = v.object({
  ticketTypeId: v.id("ticketTypes"),
  quantity: v.number(),
});

const answerInput = v.object({
  questionId: v.id("checkoutQuestions"),
  value: v.string(),
});

/**
 * Public checkout mutation -- no account required (buyers have no account,
 * mirroring the public RSVP flow in convex/rsvps.ts). Validates every item
 * against its ticket type and the event's overall capacity, reserves that
 * capacity by incrementing each type's `sold`, computes totals/fees, and
 * inserts the order + its items. A $0 total (an all-free cart) is fulfilled
 * inline -- tickets are issued and the order is marked `paid` in the same
 * mutation, so a free "checkout" needs no payment step at all. Optional
 * `answers` to the event's checkout questions (F5) are validated via
 * `validateAndSnapshotAnswers` and stored as `orderResponses` rows. Optional
 * `accessCode` (F4b) unlocks `hidden` ticket types for this checkout only --
 * this is the real gate, since a hidden type can never be bought without its
 * code even via the raw HTTP API.
 */
export const createOrder = mutation({
  args: {
    eventId: v.id("events"),
    items: v.array(orderItemInput),
    buyerName: v.string(),
    buyerEmail: v.string(),
    promoCode: v.optional(v.string()),
    answers: v.optional(v.array(answerInput)),
    accessCode: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, items, buyerName, buyerEmail, promoCode, answers, accessCode }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "published") throw new Error("Event not found");
    if (items.length === 0) throw new Error("Cart is empty");

    const unlocked = accessCode
      ? await unlockedTicketTypeIds(ctx, eventId, accessCode)
      : new Set<Id<"ticketTypes">>();

    // Validate before any capacity/promo side effects, so a rejected answer
    // (missing required question, invalid select value) leaves no partial
    // state behind -- mirrors how min/maxPerOrder checks below run before
    // any `sold` counters are patched.
    const answerSnapshots = await validateAndSnapshotAnswers(ctx, eventId, answers ?? []);

    const ticketTypes = await ctx.db
      .query("ticketTypes")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    const ticketTypesById = new Map(ticketTypes.map((t) => [t._id, t]));
    const alreadySold = ticketTypes.reduce((sum, t) => sum + t.sold, 0);

    // Aggregate the cart by ticketTypeId first, so a cart that lists the same
    // ticket type across multiple line items is validated (min/max/capacity)
    // against its combined quantity rather than bypassing per-type limits.
    const quantityByTicketType = new Map<Id<"ticketTypes">, number>();
    for (const item of items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        throw new Error("Quantity must be a whole number of at least 1");
      }
      quantityByTicketType.set(
        item.ticketTypeId,
        (quantityByTicketType.get(item.ticketTypeId) ?? 0) + item.quantity,
      );
    }

    const lineItems: (OrderLineItem & { ticketTypeId: Id<"ticketTypes"> })[] = [];
    let totalRequested = 0;

    for (const [ticketTypeId, totalQuantity] of quantityByTicketType) {
      const ticketType = ticketTypesById.get(ticketTypeId);
      if (!ticketType) throw new Error("Ticket type not found");
      if (ticketType.status !== "active") {
        throw new Error(`${ticketType.name} is not available for purchase`);
      }
      // `visible` types are always allowed; a `hidden` type requires its id
      // to be among those unlocked by a valid, active accessCode.
      if (ticketType.visibility === "hidden" && !unlocked.has(ticketTypeId)) {
        throw new Error("This ticket requires a valid access code");
      }
      if (ticketType.minPerOrder !== undefined && totalQuantity < ticketType.minPerOrder) {
        throw new Error(`Minimum order quantity for ${ticketType.name} is ${ticketType.minPerOrder}`);
      }
      if (ticketType.maxPerOrder !== undefined && totalQuantity > ticketType.maxPerOrder) {
        throw new Error(`Maximum order quantity for ${ticketType.name} is ${ticketType.maxPerOrder}`);
      }
      if (ticketType.capacity !== undefined && ticketType.sold + totalQuantity > ticketType.capacity) {
        throw new Error(`Not enough remaining capacity for ${ticketType.name}`);
      }

      totalRequested += totalQuantity;
      lineItems.push({
        ticketTypeId,
        unitPriceCents: ticketType.priceCents,
        quantity: totalQuantity,
      });
    }

    if (alreadySold + totalRequested > event.capacity) {
      throw new Error("Not enough remaining event capacity");
    }

    const grossSubtotalCents = lineItems.reduce(
      (sum, item) => sum + item.unitPriceCents * item.quantity,
      0,
    );

    let promoCodeId: Id<"promoCodes"> | undefined;
    let discountCents = 0;
    const normalizedPromoCode = promoCode?.trim().toUpperCase();
    if (normalizedPromoCode) {
      const resolved = await resolveAndComputeDiscount(ctx, eventId, normalizedPromoCode, grossSubtotalCents);
      promoCodeId = resolved.promoCodeId;
      discountCents = resolved.discountCents;
    }

    const feeMode = event.feeMode ?? "pass";
    const amounts = computeOrderAmounts(lineItems, feeMode, discountCents);
    const currency = event.currency ?? "USD";
    const token = randomToken("ord_");

    const orderId = await ctx.db.insert("orders", {
      eventId,
      organizerId: event.organizerId,
      buyerName,
      buyerEmail,
      status: "pending",
      currency,
      feeMode,
      subtotalCents: amounts.subtotalCents,
      feeCents: amounts.feeCents,
      totalCents: amounts.totalCents,
      payoutCents: amounts.payoutCents,
      grossSubtotalCents: amounts.grossSubtotalCents,
      discountCents: amounts.discountCents,
      promoCode: normalizedPromoCode,
      token,
      createdAt: Date.now(),
    });

    for (const item of lineItems) {
      await ctx.db.insert("orderItems", {
        orderId,
        ticketTypeId: item.ticketTypeId,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
      });
    }

    for (const snapshot of answerSnapshots) {
      await ctx.db.insert("orderResponses", {
        orderId,
        eventId,
        questionId: snapshot.questionId,
        label: snapshot.label,
        value: snapshot.value,
      });
    }

    // Atomically record the redemption: re-read the promo row in this same
    // mutation (rather than trusting the count from resolveAndComputeDiscount
    // above) and reject if incrementing would exceed maxRedemptions. Because
    // the resolve-check and this increment both read+write the same row
    // within one mutation, Convex's OCC serializes concurrent redemptions of
    // the same code -- a losing concurrent mutation retries, re-reads the
    // now-updated count, and throws here instead of overselling the cap.
    if (promoCodeId) {
      const promoCodeRow = await ctx.db.get(promoCodeId);
      if (!promoCodeRow) throw new Error("Invalid promo code");
      if (
        promoCodeRow.maxRedemptions !== undefined &&
        promoCodeRow.timesRedeemed >= promoCodeRow.maxRedemptions
      ) {
        throw new Error("Promo code has been fully redeemed");
      }
      await ctx.db.patch(promoCodeId, { timesRedeemed: promoCodeRow.timesRedeemed + 1 });
    }

    // Reserve capacity: patch each distinct ticket type once with its final
    // tally (current `sold` + the aggregate quantity reserved for it in this cart).
    for (const item of lineItems) {
      const ticketType = ticketTypesById.get(item.ticketTypeId);
      if (!ticketType) throw new Error("Ticket type not found");
      await ctx.db.patch(item.ticketTypeId, { sold: ticketType.sold + item.quantity });
    }

    let status: "pending" | "paid" = "pending";
    if (amounts.totalCents === 0) {
      const order = await ctx.db.get(orderId);
      if (!order) throw new Error("Order not found");
      await issueTicketsAndMarkPaid(ctx, order);
      status = "paid";
    }

    return { orderId, token, totalCents: amounts.totalCents, currency, status };
  },
});

/**
 * F3b's payment-confirmation seam: called once a payment processor confirms
 * an order's charge succeeded, to issue tickets and mark the order paid.
 * Idempotent -- a second call against an already-`paid` order is a no-op, so
 * a retried/duplicate webhook delivery never double-issues tickets. Also a
 * no-op against a `cancelled` order: its reserved capacity was already
 * released by `cancelOrder`, so resurrecting it here would oversell.
 */
export const markOrderPaid = internalMutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.db.get(orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "pending") return null; // idempotent: paid → no-op; cancelled → no-op (capacity already released)
    await issueTicketsAndMarkPaid(ctx, order);
    return null;
  },
});

/**
 * Cancel a `pending` order (owner-only, via the order's event) and release
 * the capacity it had reserved. Cancelling a `paid` order is a refund, out of
 * scope here (F6) -- only a `pending` order may be cancelled this way.
 */
export const cancelOrder = mutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const order = await requireOwnedOrder(ctx, orderId);
    if (order.status !== "pending") throw new Error("Only a pending order can be cancelled");

    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .collect();
    for (const item of items) {
      const ticketType = await ctx.db.get(item.ticketTypeId);
      if (ticketType) {
        await ctx.db.patch(item.ticketTypeId, { sold: Math.max(0, ticketType.sold - item.quantity) });
      }
    }

    // Restore the promo redemption consumed at createOrder, so a cancelled
    // pending order doesn't permanently burn a limited-use code without a sale.
    if (order.promoCode) {
      const promo = await ctx.db
        .query("promoCodes")
        .withIndex("by_event_and_code", (q) => q.eq("eventId", order.eventId).eq("code", order.promoCode!))
        .unique();
      if (promo && promo.timesRedeemed > 0) {
        await ctx.db.patch(promo._id, { timesRedeemed: promo.timesRedeemed - 1 });
      }
    }

    await ctx.db.patch(orderId, { status: "cancelled" });
    return null;
  },
});

/**
 * Public order lookup by token, for a buyer's checkout confirmation page and
 * the self-service order page (F6). Mirrors rsvps.getRsvpByToken: the token
 * is an unguessable secret minted by `createOrder` and handed only to the
 * buyer who owns it, so an unauthenticated lookup-by-token is the intended
 * design. Returns null (not a throw) when no order has that token. Also
 * returns the order's `orderResponses` (F5 checkout question answers) and
 * its `event` (nullable -- an organizer can delete an event without deleting
 * its past orders, so an order can outlive its event), so a self-service
 * page can show the event title without a second round trip.
 */
export const getOrder = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const order = await ctx.db
      .query("orders")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!order) return null;
    const event = await ctx.db.get(order.eventId);
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .collect();
    const tickets = await ctx.db
      .query("tickets")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .collect();
    const orderResponses = await ctx.db
      .query("orderResponses")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .collect();
    return { order, event, items, tickets, orderResponses };
  },
});

/**
 * Refund a `paid` order (owner-only, via the order's event): cancels every
 * non-cancelled ticket, releases the capacity reserved by the order's items
 * (mirroring `cancelOrder`'s release), restores a used promo code's
 * `timesRedeemed`, and marks the order `refunded`. Idempotent -- a
 * `cancelled`/already-`refunded` order returns early with no further effect,
 * so a retried call never double-releases capacity. A `pending` order is
 * rejected -- it was never fulfilled, so `cancelOrder` (not a refund) is the
 * right call for it.
 *
 * F3b: issue the Stripe refund for a nonzero order here (money-back) -- F6
 * does the inventory/record only.
 */
export const refundOrder = mutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const order = await requireOwnedOrder(ctx, orderId);
    if (order.status === "cancelled" || order.status === "refunded") return null; // idempotent no-op
    if (order.status === "pending") throw new Error("Use cancelOrder for a pending order");

    const tickets = await ctx.db
      .query("tickets")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .collect();
    for (const ticket of tickets) {
      if (ticket.status !== "cancelled") {
        await ctx.db.patch(ticket._id, { status: "cancelled" });
      }
    }

    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .collect();
    for (const item of items) {
      const ticketType = await ctx.db.get(item.ticketTypeId);
      if (ticketType) {
        await ctx.db.patch(item.ticketTypeId, { sold: Math.max(0, ticketType.sold - item.quantity) });
      }
    }

    // Restore the promo redemption consumed at createOrder, mirroring cancelOrder.
    if (order.promoCode) {
      const promo = await ctx.db
        .query("promoCodes")
        .withIndex("by_event_and_code", (q) => q.eq("eventId", order.eventId).eq("code", order.promoCode!))
        .unique();
      if (promo && promo.timesRedeemed > 0) {
        await ctx.db.patch(promo._id, { timesRedeemed: promo.timesRedeemed - 1 });
      }
    }

    await ctx.db.patch(orderId, { status: "refunded", refundedAt: Date.now() });
    return null;
  },
});

/**
 * Owner-only: an event's orders, newest first, for the dashboard Orders tab.
 * Each order is annotated with `itemCount` (the sum of its order items'
 * quantities) so the dashboard can show item counts without an N+1 query per
 * row.
 */
export const listOrdersForEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireOwnedEvent(ctx, eventId);
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .order("desc")
      .collect();

    return Promise.all(
      orders.map(async (order) => {
        const items = await ctx.db
          .query("orderItems")
          .withIndex("by_order", (q) => q.eq("orderId", order._id))
          .collect();
        const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
        return { ...order, itemCount };
      }),
    );
  },
});
