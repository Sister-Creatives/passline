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

/**
 * Public checkout mutation -- no account required (buyers have no account,
 * mirroring the public RSVP flow in convex/rsvps.ts). Validates every item
 * against its ticket type and the event's overall capacity, reserves that
 * capacity by incrementing each type's `sold`, computes totals/fees, and
 * inserts the order + its items. A $0 total (an all-free cart) is fulfilled
 * inline -- tickets are issued and the order is marked `paid` in the same
 * mutation, so a free "checkout" needs no payment step at all.
 */
export const createOrder = mutation({
  args: {
    eventId: v.id("events"),
    items: v.array(orderItemInput),
    buyerName: v.string(),
    buyerEmail: v.string(),
  },
  handler: async (ctx, { eventId, items, buyerName, buyerEmail }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "published") throw new Error("Event not found");
    if (items.length === 0) throw new Error("Cart is empty");

    const ticketTypes = await ctx.db
      .query("ticketTypes")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    const ticketTypesById = new Map(ticketTypes.map((t) => [t._id, t]));
    const alreadySold = ticketTypes.reduce((sum, t) => sum + t.sold, 0);

    // Tracks cumulative quantity reserved per type across this cart (so a
    // cart that lists the same ticket type more than once still respects its
    // per-type capacity), seeded from each type's current `sold`.
    const reservedSoFar = new Map<Id<"ticketTypes">, number>();
    const lineItems: (OrderLineItem & { ticketTypeId: Id<"ticketTypes"> })[] = [];
    let totalRequested = 0;

    for (const item of items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        throw new Error("Quantity must be a whole number of at least 1");
      }
      const ticketType = ticketTypesById.get(item.ticketTypeId);
      if (!ticketType) throw new Error("Ticket type not found");
      if (ticketType.status !== "active" || ticketType.visibility !== "visible") {
        throw new Error(`${ticketType.name} is not available for purchase`);
      }
      if (ticketType.minPerOrder !== undefined && item.quantity < ticketType.minPerOrder) {
        throw new Error(`Minimum order quantity for ${ticketType.name} is ${ticketType.minPerOrder}`);
      }
      if (ticketType.maxPerOrder !== undefined && item.quantity > ticketType.maxPerOrder) {
        throw new Error(`Maximum order quantity for ${ticketType.name} is ${ticketType.maxPerOrder}`);
      }
      const reserved = reservedSoFar.get(item.ticketTypeId) ?? ticketType.sold;
      const nextReserved = reserved + item.quantity;
      if (ticketType.capacity !== undefined && nextReserved > ticketType.capacity) {
        throw new Error(`Not enough remaining capacity for ${ticketType.name}`);
      }
      reservedSoFar.set(item.ticketTypeId, nextReserved);

      totalRequested += item.quantity;
      lineItems.push({
        ticketTypeId: item.ticketTypeId,
        unitPriceCents: ticketType.priceCents,
        quantity: item.quantity,
      });
    }

    if (alreadySold + totalRequested > event.capacity) {
      throw new Error("Not enough remaining event capacity");
    }

    const feeMode = event.feeMode ?? "pass";
    const amounts = computeOrderAmounts(lineItems, feeMode);
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
    // Reserve capacity: patch each distinct ticket type once with its final
    // tally (current `sold` + everything reserved for it in this cart).
    for (const [ticketTypeId, finalSold] of reservedSoFar) {
      await ctx.db.patch(ticketTypeId, { sold: finalSold });
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
 * a retried/duplicate webhook delivery never double-issues tickets.
 */
export const markOrderPaid = internalMutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.db.get(orderId);
    if (!order) throw new Error("Order not found");
    if (order.status === "paid") return null;
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
    await ctx.db.patch(orderId, { status: "cancelled" });
    return null;
  },
});

/**
 * Public order lookup by token, for a buyer's checkout confirmation page.
 * Mirrors rsvps.getRsvpByToken: the token is an unguessable secret minted by
 * `createOrder` and handed only to the buyer who owns it, so an
 * unauthenticated lookup-by-token is the intended design. Returns null (not
 * a throw) when no order has that token.
 */
export const getOrder = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const order = await ctx.db
      .query("orders")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!order) return null;
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .collect();
    const tickets = await ctx.db
      .query("tickets")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .collect();
    return { order, items, tickets };
  },
});

/** Owner-only: an event's orders, newest first, for the dashboard Orders tab. */
export const listOrdersForEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireOwnedEvent(ctx, eventId);
    return ctx.db
      .query("orders")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .order("desc")
      .collect();
  },
});
