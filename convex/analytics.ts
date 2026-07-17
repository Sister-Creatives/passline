import { query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getAuthOrganizerId } from "./auth";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_TIMESERIES_DAYS = 90;

/** Load an event and enforce that it belongs to the authenticated organizer. */
async function requireOwnedEvent(ctx: QueryCtx | MutationCtx, eventId: Id<"events">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const event = await ctx.db.get(eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return event;
}

/** UTC "YYYY-MM-DD" for a given epoch-ms timestamp. */
function toUtcDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Epoch-ms (UTC midnight) for a "YYYY-MM-DD" date string. */
function fromUtcDateString(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/**
 * Owner-only per-event analytics summary (F8): revenue over PAID orders only
 * (read off each order's already-computed `subtotalCents`/`feeCents`/
 * `payoutCents` -- see `lib/fees.ts` -- rather than recomputed from items),
 * order counts by status, issued/checked-in ticket counts, and a
 * per-ticket-type sold+revenue breakdown. Aggregates in memory over the
 * event's `orders`, `tickets`, and `ticketTypes` (`by_event` indexes) --
 * O(orders+tickets). `byTicketType` revenue additionally reads each *paid*
 * order's `orderItems` (there's no `by_event` index on `orderItems`, so this
 * is bounded by the number of paid orders, mirroring the same per-order fan
 * out `orders.listOrdersForEvent` already does for `itemCount`).
 */
export const getEventSummary = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await requireOwnedEvent(ctx, eventId);

    const [orders, tickets, ticketTypes] = await Promise.all([
      ctx.db.query("orders").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
      ctx.db.query("tickets").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
      ctx.db.query("ticketTypes").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
    ]);

    const paidOrders = orders.filter((o) => o.status === "paid");
    const pendingCount = orders.filter((o) => o.status === "pending").length;
    const cancelledCount = orders.filter((o) => o.status === "cancelled").length;

    const revenue = paidOrders.reduce(
      (acc, o) => {
        acc.grossCents += o.subtotalCents;
        acc.feeCents += o.feeCents;
        acc.netPayoutCents += o.payoutCents;
        return acc;
      },
      { grossCents: 0, feeCents: 0, netPayoutCents: 0 },
    );

    const issuedTickets = tickets.filter((t) => t.status !== "cancelled");
    const checkedIn = tickets.filter((t) => t.status === "checked_in").length;

    const soldByTicketType = new Map<Id<"ticketTypes">, number>();
    for (const t of issuedTickets) {
      soldByTicketType.set(t.ticketTypeId, (soldByTicketType.get(t.ticketTypeId) ?? 0) + 1);
    }

    const orderItemsByPaidOrder = await Promise.all(
      paidOrders.map((o) =>
        ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", o._id)).collect(),
      ),
    );
    // Scale each item's gross (unitPriceCents * quantity) by its order's
    // discount ratio (subtotalCents / grossSubtotalCents) so per-type revenue
    // is net of any promo discount and reconciles with `revenue.grossCents`
    // (which reads the already-discounted `subtotalCents`) -- to within at
    // most a rounding cent per item, which is acceptable for a breakdown.
    // `grossSubtotalCents` falls back to `subtotalCents` for orders predating
    // the F4 column, making the ratio 1 (identity, exact) for those.
    const revenueByTicketType = new Map<Id<"ticketTypes">, number>();
    for (let i = 0; i < paidOrders.length; i++) {
      const order = paidOrders[i];
      const items = orderItemsByPaidOrder[i];
      const orderGross = order.grossSubtotalCents ?? order.subtotalCents;
      const orderNet = order.subtotalCents;
      for (const item of items) {
        const itemGrossCents = item.unitPriceCents * item.quantity;
        const itemRevenueCents =
          orderGross === 0 ? 0 : Math.round((itemGrossCents * orderNet) / orderGross);
        revenueByTicketType.set(
          item.ticketTypeId,
          (revenueByTicketType.get(item.ticketTypeId) ?? 0) + itemRevenueCents,
        );
      }
    }

    const byTicketType = [...ticketTypes]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((tt) => ({
        ticketTypeId: tt._id,
        name: tt.name,
        sold: soldByTicketType.get(tt._id) ?? 0,
        revenueCents: revenueByTicketType.get(tt._id) ?? 0,
      }));

    return {
      revenue,
      orders: { paid: paidOrders.length, pending: pendingCount, cancelled: cancelledCount },
      ticketsSold: issuedTickets.length,
      checkedIn,
      capacity: event.capacity,
      byTicketType,
      currency: event.currency ?? "USD",
    };
  },
});

/**
 * Owner-only daily sales timeseries (F8): buckets PAID orders by the UTC date
 * of `paidAt`, dense/zero-filled from the first paid order's date through
 * today, sorted ascending, capped to the last 90 days to bound the payload.
 * Returns `[]` when the event has no paid orders yet.
 */
export const getSalesTimeseries = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireOwnedEvent(ctx, eventId);

    const orders = await ctx.db
      .query("orders")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    const paidOrders = orders.filter(
      (o): o is typeof o & { paidAt: number } => o.status === "paid" && o.paidAt !== undefined,
    );
    if (paidOrders.length === 0) return [];

    const byDate = new Map<string, { orders: number; revenueCents: number }>();
    for (const o of paidOrders) {
      const date = toUtcDateString(o.paidAt);
      const bucket = byDate.get(date) ?? { orders: 0, revenueCents: 0 };
      bucket.orders += 1;
      bucket.revenueCents += o.subtotalCents;
      byDate.set(date, bucket);
    }

    const firstMs = fromUtcDateString(toUtcDateString(Math.min(...paidOrders.map((o) => o.paidAt))));
    const todayMs = fromUtcDateString(toUtcDateString(Date.now()));
    const totalDays = Math.round((todayMs - firstMs) / MS_PER_DAY) + 1;
    const cappedDays = Math.min(totalDays, MAX_TIMESERIES_DAYS);
    const startMs = todayMs - (cappedDays - 1) * MS_PER_DAY;

    const series: { date: string; orders: number; revenueCents: number }[] = [];
    for (let ms = startMs; ms <= todayMs; ms += MS_PER_DAY) {
      const date = toUtcDateString(ms);
      const bucket = byDate.get(date) ?? { orders: 0, revenueCents: 0 };
      series.push({ date, orders: bucket.orders, revenueCents: bucket.revenueCents });
    }
    return series;
  },
});
