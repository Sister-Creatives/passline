import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { SEAT_HOLDING_STATUSES } from "./constants";

/**
 * Recompute an event's denormalized stats from its children and patch the doc.
 *
 * `seatsTaken` = rsvps in a seat-holding status; `revenueCents` = sum of
 * payoutCents over paid orders; `ticketsSold` = non-cancelled tickets on those
 * paid orders. Idempotent (recompute-from-children, never incremental), so it
 * is safe to call after any write, more than once, and from the backfill. A
 * no-op if the event has been deleted.
 */
export async function recomputeEventStats(
  ctx: MutationCtx,
  eventId: Id<"events">,
): Promise<void> {
  const event = await ctx.db.get(eventId);
  if (!event) return;

  const rsvps = await ctx.db
    .query("rsvps")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  const seatsTaken = rsvps.filter((r) =>
    (SEAT_HOLDING_STATUSES as readonly string[]).includes(r.status),
  ).length;

  const orders = await ctx.db
    .query("orders")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  const paidOrders = orders.filter((o) => o.status === "paid");
  const paidOrderIds = new Set(paidOrders.map((o) => o._id));
  const revenueCents = paidOrders.reduce((sum, o) => sum + o.payoutCents, 0);

  const tickets = await ctx.db
    .query("tickets")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  const ticketsSold = tickets.filter(
    (t) => t.status !== "cancelled" && paidOrderIds.has(t.orderId),
  ).length;

  await ctx.db.patch(eventId, { seatsTaken, ticketsSold, revenueCents });
}
