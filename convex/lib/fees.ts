import { FEE_BPS } from "./constants";

export type OrderLineItem = {
  unitPriceCents: number;
  quantity: number;
};

export type FeeMode = "pass" | "absorb";

export type OrderAmounts = {
  grossSubtotalCents: number;
  discountCents: number;
  subtotalCents: number;
  feeCents: number;
  totalCents: number;
  payoutCents: number;
};

/**
 * Compute an order's subtotal, platform booking fee, buyer-facing total, and
 * organizer payout from a cart of line items.
 *
 * `discountCents` (default 0) is a promo-code discount off the gross
 * subtotal; it is defensively clamped to `[0, grossSubtotalCents]` here (the
 * caller is expected to have already computed a clamped value, but we never
 * trust a negative subtotal into existence). The fee is calculated off the
 * *discounted* subtotal (so a $0 subtotal — free, or discounted to free — is
 * always a $0 fee), but whether the buyer pays it on top or the organizer
 * absorbs it out of their payout depends on `feeMode`:
 *  - "pass":   totalCents = subtotal + fee,  payoutCents = subtotal
 *  - "absorb": totalCents = subtotal,        payoutCents = subtotal - fee
 */
export function computeOrderAmounts(
  lineItems: OrderLineItem[],
  feeMode: FeeMode,
  discountCents = 0,
): OrderAmounts {
  const grossSubtotalCents = lineItems.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0,
  );
  const clampedDiscountCents = Math.min(Math.max(discountCents, 0), grossSubtotalCents);
  const subtotalCents = grossSubtotalCents - clampedDiscountCents;
  const feeCents = Math.round((subtotalCents * FEE_BPS) / 10000);
  const passToBuyer = feeMode === "pass";
  const totalCents = subtotalCents + (passToBuyer ? feeCents : 0);
  const payoutCents = subtotalCents - (passToBuyer ? 0 : feeCents);
  return {
    grossSubtotalCents,
    discountCents: clampedDiscountCents,
    subtotalCents,
    feeCents,
    totalCents,
    payoutCents,
  };
}
