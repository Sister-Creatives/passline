# Passline → Headless Ticketing — F4: Promo codes

- **Date:** 2026-07-13
- **Status:** Approved design (autonomous loop)
- **Slice:** F4 — discount codes applied at checkout. Builds on F3a orders.

## 1. Goal

Let organizers create percentage or fixed-amount discount codes that buyers apply at checkout,
with an optional redemption cap. (Access codes for hidden ticket types are a separate slice,
**F4b**, together with the F1-deferred visibility UI.)

## 2. Scope

**In:** `promoCodes` table; `promoCodes.create/list/remove` (organizer); an optional `promoCode`
arg on `createOrder` and `POST /v1/orders` that validates + applies the discount, adjusts the
fee (fee is charged on the **discounted** subtotal), and atomically records a redemption
(respecting `maxRedemptions`); a Promo-codes dashboard tab.

**Out:** access codes / hidden-ticket unlocking + visibility UI → **F4b**; per-ticket-type code
restrictions; scheduled code windows.

## 3. Data model

```ts
promoCodes: defineTable({
  eventId: v.id("events"),
  organizerId: v.id("organizers"),
  code: v.string(),                                  // stored UPPERCASE; matched case-insensitively
  discountKind: v.union(v.literal("percent"), v.literal("fixed")),
  percentBps: v.optional(v.number()),                // when kind "percent": 1000 = 10%
  fixedCents: v.optional(v.number()),                // when kind "fixed": flat cents off the subtotal
  maxRedemptions: v.optional(v.number()),            // undefined = unlimited
  timesRedeemed: v.number(),
  active: v.boolean(),
  createdAt: v.number(),
})
  .index("by_event", ["eventId"])
  .index("by_event_and_code", ["eventId", "code"]),
```

## 4. Fee interaction

Update `computeOrderAmounts(lineItems, feeMode, discountCents = 0)` (convex/lib/fees.ts):
- `grossSubtotalCents = Σ unitPriceCents*quantity`
- `discountCents` is clamped to `[0, grossSubtotalCents]` by the caller.
- `subtotalCents = grossSubtotalCents - discountCents` (the discounted price the buyer pays for tickets)
- `feeCents = Math.round(subtotalCents * FEE_BPS / 10000)` (fee on the discounted subtotal)
- `totalCents` / `payoutCents` as before, using the discounted `subtotalCents`.
- Also return `grossSubtotalCents` and `discountCents` so the order can record them.

Add `discountCents` (default 0) + `promoCode` (optional string) + `grossSubtotalCents` columns to
the `orders` table (all additive/optional; existing orders default fine).

## 5. Promo functions — `convex/promoCodes.ts`

- `create({ eventId, code, discountKind, percentBps?, fixedCents?, maxRedemptions? })` — organizer-auth'd
  + event-ownership. Validates: non-empty code (uppercased) unique per event (`by_event_and_code`);
  `percent` ⇒ `percentBps` in `1..10000`; `fixed` ⇒ `fixedCents >= 1`. `timesRedeemed = 0`, `active = true`.
- `list({ eventId })` — organizer-auth'd + ownership.
- `remove({ promoCodeId })` — organizer-auth'd + ownership.
- Internal helper `resolveAndComputeDiscount(ctx, eventId, code, grossSubtotalCents)` →
  `{ promoCodeId, discountCents }` or throws: looks up the code (uppercased) by
  `by_event_and_code`, rejects if missing / inactive / `timesRedeemed >= maxRedemptions`;
  computes `discountCents = kind==="percent" ? Math.round(gross*percentBps/10000) : min(fixedCents, gross)`;
  clamps to `[0, gross]`.

## 6. Checkout integration (`convex/orders.ts`)

`createOrder` gains an optional `promoCode?: string`:
- After computing `grossSubtotalCents` from the aggregated cart and before amounts: if `promoCode`
  is provided, call `resolveAndComputeDiscount` → `discountCents` + `promoCodeId`; else
  `discountCents = 0`.
- `computeOrderAmounts(items, feeMode, discountCents)`; persist `grossSubtotalCents`,
  `discountCents`, and the `promoCode` (uppercased) on the order.
- On a **successful** order (after the order + items are inserted), atomically increment the promo
  code's `timesRedeemed` (re-read within the same mutation and reject if it would exceed
  `maxRedemptions` — the resolve check + increment are in one mutation, so OCC serializes
  concurrent redemptions and the cap holds).
- A free-after-discount order (total 0) still fulfills inline as in F3a.

`POST /v1/orders` (convex/apiHttp.ts): accept optional `promoCode` in the body and pass it
through; an invalid/exhausted code maps to `400 {error}`.

## 7. Dashboard UI

Add a **Promo codes** tab to the event page (alongside Details / Ticket types / Orders): a `Table`
(code, discount [`10%` or `formatMoney(fixedCents)`], redeemed `x/max`, status `Badge`), a create
`Dialog` (code + kind `ToggleGroup` + amount + optional max), and `AlertDialog` remove.
`Skeleton`/`Empty` states. Read via `promoCodes.list`.

## 8. Testing (TDD)

- `fees.test.ts`: `computeOrderAmounts` with a discount — percent and fixed; fee is on the
  discounted subtotal; discount clamped to the gross (never negative subtotal); `discountCents=0`
  path unchanged (existing tests still pass).
- `promoCodes.test.ts`: create validates kind/amount + unique code; list/remove owner-only;
  `resolveAndComputeDiscount` rejects missing/inactive/exhausted and computes percent/fixed/clamped.
- `orders.test.ts`: `createOrder` with a valid percent code discounts the total and increments
  `timesRedeemed`; an exhausted code is rejected; a fixed code larger than the subtotal clamps to
  a $0 subtotal and fulfills as free.
- `apiHttp.test.ts`: `POST /v1/orders` with a bad promo code → 400.

## 9. Constraints

Carried: shadcn/ui, `Skeleton`, plain `Error`, per-file test helpers, integer cents, additive
(existing 121 tests still pass; the `computeOrderAmounts` signature gains a defaulted 3rd arg so
existing callers are unaffected).

## 10. Delivery

TDD → `pnpm test` + `tsc` + `build` green → push (stacked on F3a) → PR → next loop slice
(**F7 scanning** — validate/check-in the F3a `tickets` by `code`; also Stripe-independent).
