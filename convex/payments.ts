import { query } from "./_generated/server";
import { getAuthOrganizerId } from "./auth";

/**
 * Cross-event earnings roll-up for the Payments settings page. Queries the
 * organizer's orders once via `by_organizer` and buckets them by status.
 *
 * Only `paid` orders feed the earnings figures (`grossCents`/`feeCents`/
 * `netPayoutCents`) -- `pending` and `refunded` are reported as separate
 * groups and never folded into the paid/net totals, so the headline numbers
 * always reflect money actually collected and kept.
 */
export const getEarnings = query({
  args: {},
  handler: async (ctx) => {
    const zero = {
      currency: "USD",
      paid: { count: 0, grossCents: 0, feeCents: 0, netPayoutCents: 0 },
      pending: { count: 0, amountCents: 0 },
      refunded: { count: 0, amountCents: 0 },
      cancelled: { count: 0 },
      byMethod: {
        cash: { count: 0, payoutCents: 0 },
        card: { count: 0, payoutCents: 0 },
        online: { count: 0, payoutCents: 0 },
      },
    };

    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return zero;

    const orders = await ctx.db
      .query("orders")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .collect();

    const paidOrders = orders.filter((o) => o.status === "paid");
    const pendingOrders = orders.filter((o) => o.status === "pending");
    const refundedOrders = orders.filter((o) => o.status === "refunded");
    const cancelledOrders = orders.filter((o) => o.status === "cancelled");

    const byMethod = {
      cash: { count: 0, payoutCents: 0 },
      card: { count: 0, payoutCents: 0 },
      online: { count: 0, payoutCents: 0 },
    };
    for (const order of paidOrders) {
      const method = order.paymentMethod ?? "online";
      byMethod[method].count += 1;
      byMethod[method].payoutCents += order.payoutCents;
    }

    return {
      currency: paidOrders[0]?.currency ?? "USD",
      paid: {
        count: paidOrders.length,
        grossCents: paidOrders.reduce((sum, o) => sum + o.totalCents, 0),
        feeCents: paidOrders.reduce((sum, o) => sum + o.feeCents, 0),
        netPayoutCents: paidOrders.reduce((sum, o) => sum + o.payoutCents, 0),
      },
      pending: {
        count: pendingOrders.length,
        amountCents: pendingOrders.reduce((sum, o) => sum + o.totalCents, 0),
      },
      refunded: {
        count: refundedOrders.length,
        amountCents: refundedOrders.reduce((sum, o) => sum + o.totalCents, 0),
      },
      cancelled: { count: cancelledOrders.length },
      byMethod,
    };
  },
});
