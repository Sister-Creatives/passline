import { expect, test } from "vitest";
import { computeOrderAmounts } from "./lib/fees";

test("feeMode 'pass': fee is added to the buyer's total, payout is the full subtotal", () => {
  const amounts = computeOrderAmounts([{ unitPriceCents: 2000, quantity: 3 }], "pass");
  // subtotal = 6000, fee = 6000 * 300 / 10000 = 180
  expect(amounts.subtotalCents).toBe(6000);
  expect(amounts.feeCents).toBe(180);
  expect(amounts.totalCents).toBe(6180);
  expect(amounts.payoutCents).toBe(6000);
});

test("feeMode 'absorb': buyer's total is just the subtotal, fee is deducted from payout", () => {
  const amounts = computeOrderAmounts([{ unitPriceCents: 2000, quantity: 3 }], "absorb");
  expect(amounts.subtotalCents).toBe(6000);
  expect(amounts.feeCents).toBe(180);
  expect(amounts.totalCents).toBe(6000);
  expect(amounts.payoutCents).toBe(5820);
});

test("$0 subtotal produces $0 fee and $0 total regardless of feeMode", () => {
  const passAmounts = computeOrderAmounts([{ unitPriceCents: 0, quantity: 2 }], "pass");
  expect(passAmounts.subtotalCents).toBe(0);
  expect(passAmounts.feeCents).toBe(0);
  expect(passAmounts.totalCents).toBe(0);
  expect(passAmounts.payoutCents).toBe(0);

  const absorbAmounts = computeOrderAmounts([{ unitPriceCents: 0, quantity: 2 }], "absorb");
  expect(absorbAmounts.subtotalCents).toBe(0);
  expect(absorbAmounts.feeCents).toBe(0);
  expect(absorbAmounts.totalCents).toBe(0);
  expect(absorbAmounts.payoutCents).toBe(0);
});

test("a mixed free + paid cart computes the fee on the paid amount only", () => {
  const lineItems = [
    { unitPriceCents: 0, quantity: 2 }, // free tickets
    { unitPriceCents: 1500, quantity: 2 }, // paid tickets
  ];
  const amounts = computeOrderAmounts(lineItems, "pass");
  // subtotal = 0*2 + 1500*2 = 3000, fee = 3000 * 300 / 10000 = 90
  expect(amounts.subtotalCents).toBe(3000);
  expect(amounts.feeCents).toBe(90);
  expect(amounts.totalCents).toBe(3090);
  expect(amounts.payoutCents).toBe(3000);
});

test("rounds the fee to the nearest cent", () => {
  // subtotal = 999, fee = 999 * 300 / 10000 = 29.97 -> rounds to 30
  const amounts = computeOrderAmounts([{ unitPriceCents: 999, quantity: 1 }], "pass");
  expect(amounts.feeCents).toBe(30);
  expect(amounts.totalCents).toBe(1029);
});

test("an empty cart is all zeros", () => {
  const amounts = computeOrderAmounts([], "pass");
  expect(amounts).toEqual({
    subtotalCents: 0,
    feeCents: 0,
    totalCents: 0,
    payoutCents: 0,
  });
});
