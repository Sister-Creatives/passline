import { FEE_BPS } from "./constants";

export type OrderLineItem = {
  unitPriceCents: number;
  quantity: number;
};

export type FeeMode = "pass" | "absorb";

export type OrderAmounts = {
  subtotalCents: number;
  feeCents: number;
  totalCents: number;
  payoutCents: number;
};

/**
 * Compute an order's subtotal, platform booking fee, buyer-facing total, and
 * organizer payout from a cart of line items.
 *
 * The fee is always calculated off the subtotal (so a $0 subtotal is always
 * a $0 fee — "free is free"), but whether the buyer pays it on top or the
 * organizer absorbs it out of their payout depends on `feeMode`:
 *  - "pass":   totalCents = subtotal + fee,  payoutCents = subtotal
 *  - "absorb": totalCents = subtotal,        payoutCents = subtotal - fee
 */
export function computeOrderAmounts(
  lineItems: OrderLineItem[],
  feeMode: FeeMode,
): OrderAmounts {
  const subtotalCents = lineItems.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0,
  );
  const feeCents = Math.round((subtotalCents * FEE_BPS) / 10000);
  const passToBuyer = feeMode === "pass";
  const totalCents = subtotalCents + (passToBuyer ? feeCents : 0);
  const payoutCents = subtotalCents - (passToBuyer ? 0 : feeCents);
  return { subtotalCents, feeCents, totalCents, payoutCents };
}
