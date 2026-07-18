# Passline → Payments settings page

- **Date:** 2026-07-18
- **Status:** Approved design
- **Slice:** Build the `settings/payments` page (currently a "Coming soon" stub) as an
  earnings overview plus fee settings. Builds on the settings-enhance branch.

## 1. Goal

Replace the empty Payments stub with an honest, useful page: a real cross-event
earnings summary from orders, plus a default fee-mode setting. No fabricated
payment-processor connection and no bank/card credential fields — there is no live
processor (Stripe is a future seam), and payouts are not yet connected.

## 2. Scope

**In:** a `payments.getEarnings` aggregation query; the Payments page (earnings tiles,
payout-by-method + status breakdown, fee-settings card, honest payouts note); a
`defaultFeeMode` organizer setting prefilled onto new events.

**Out:** any processor connect flow, bank account / payout destination fields, real
payout execution, per-order refund UI. An honest "payouts not yet connected" note stands
in for the missing processor.

## 3. Payment model (as-is)

- Orders (`by_organizer` index) carry `status` (pending/paid/cancelled/refunded),
  `currency`, `feeMode`, `subtotalCents`, `feeCents`, `totalCents`, `payoutCents`,
  `paymentMethod` (cash/card/online), `source`.
- Platform fee is `FEE_BPS = 300` (3%), applied at order creation from the event's
  `feeMode` (`?? "pass"`). `pass` → buyer pays the fee, org payout = subtotal; `absorb`
  → org payout = subtotal − fee.
- `payoutCents` is the money the organizer keeps. There is no payout destination config.

## 4. Server

### `convex/payments.ts` (new) — `getEarnings`
Auth'd organizer; `[]`/zeros when unauthenticated. Query orders `by_organizer`, aggregate:
- `paid`: `grossCents` = Σ`totalCents`, `feeCents` = Σ`feeCents`, `netPayoutCents` =
  Σ`payoutCents`, `count`.
- `pending`: `count`, `amountCents` = Σ`totalCents`.
- `refunded`: `count`, `amountCents` = Σ`totalCents`.
- `cancelled`: `count`.
- `byMethod` (paid orders only): `{ cash, card, online }`, each `{ count, payoutCents }`.
  Bucket by `paymentMethod ?? "online"` (online orders may leave it unset).
- `currency`: first paid order's `currency` ?? `"USD"`.
Return a single object with those groups.

### `convex/schema.ts`
`organizers` gains `defaultFeeMode: v.optional(v.union(v.literal("pass"), v.literal("absorb")))`.

### `convex/organizers.ts` — extend `updatePreferences`
Add `defaultFeeMode: v.optional(v.union(v.literal("pass"), v.literal("absorb")))`. When
provided, patch it. (Enum — no empty-string clearing path; a provided value sets it.)

### `convex/events.ts` — extend `createEvent`
Add `feeMode: v.optional(v.union(v.literal("pass"), v.literal("absorb")))`. When provided,
set `feeMode` on the inserted event; when absent, leave it unset (orders then default to
`"pass"`, unchanged behavior).

## 5. Client

### `src/components/EventForm.tsx`
`defaults` prop gains `feeMode?: "pass" | "absorb"`. Create-mode submit passes
`feeMode: defaults?.feeMode` to `createEvent` (omit/undefined leaves it unset). No new
visible field — applied silently like currency.

### `src/routes/events/new.tsx`
Pass `feeMode: me?.defaultFeeMode` into the `defaults` object it already builds.

### `src/routes/settings/payments.tsx` (rewrite)
H1 "Payments" + subtitle. Sections:
1. **Earnings** — four stat tiles (house idiom): Net payout, Gross collected, Platform
   fees, Pending (with count). Reads `getEarnings`.
2. **Payout by method** — a small table (cash/card/online → count, payout), plus a
   status line (paid/pending/refunded/cancelled counts). Empty state when no orders.
3. **Fees** — default fee mode (pass/absorb) as a segmented control + Save
   (`updatePreferences`); shows the platform fee (`FEE_BPS/100`%) and a one-line
   explainer of pass vs absorb.
4. **Payouts** — an honest info note: payouts to a bank account aren't connected yet;
   figures above are what you've collected/kept in-app.

## 6. Testing

- `convex/payments.test.ts`: seed paid + pending + refunded orders across two events for
  one org (and an order for a *different* org that must be excluded); assert `grossCents`,
  `feeCents`, `netPayoutCents`, the pending/refunded groups, and `byMethod` bucketing
  (including a paid order with `paymentMethod` unset → counted as `online`).
- `convex/organizers.test.ts`: `updatePreferences` stores `defaultFeeMode`.
- `convex/events.test.ts`: `createEvent` with `feeMode: "absorb"` stores it; without it,
  `feeMode` is unset.

## 7. Risks

- **Money accuracy.** The tiles show real money; `getEarnings` must reuse the order
  fields verbatim (`payoutCents` for net, `totalCents` for gross, `feeCents` for fees) and
  count only `paid` orders for earnings — pending/refunded are separate groups, never
  folded into net. Tests pin this.
- **Multi-currency.** `getEarnings` reports a single `currency` (first paid order's). If an
  org runs events in mixed currencies the totals would blend — acceptable for now
  (mirrors `reports.getEventBreakdown`), noted so it isn't mistaken for per-currency
  accounting.
