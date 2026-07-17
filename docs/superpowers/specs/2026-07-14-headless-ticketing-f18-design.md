# Passline → Headless Ticketing — F18: Scanning extras (check-out + box office)

- **Date:** 2026-07-14
- **Status:** Approved design (autonomous loop)
- **Slice:** F18 — scan guests out (live occupancy) + sell tickets at the door (Humanitix §8).
  Builds on F7 scanning + F3a orders.

## 1. Goal

Two door-day capabilities: (a) **check-out** — scan a guest out so the organizer sees live
in-venue occupancy; (b) **box office** — an organizer sells tickets at the door (payment collected
externally as cash or card), issuing tickets immediately, with **cash sales incurring zero booking
fee**.

## 2. Scope

**In:** `tickets.checkedOutAt`; `checkOutTicket` + `currentlyInside` in `getScanState`;
`orders.paymentMethod` + `source` fields; `createBoxOfficeOrder` (organizer-auth'd, paid inline,
cash → zero fee) built on a **shared order-building helper extracted from `createOrder`**; check-out
on the scan screen + a box-office sell form.

**Out:** a real card-reader integration (Stripe Terminal); offline caching / multi-device sync;
box-office refunds beyond the existing `refundOrder`.

## 3. Data model (additive)

- `tickets`: add `checkedOutAt: v.optional(v.number())`.
- `orders`: add `paymentMethod: v.optional(v.union(v.literal("cash"), v.literal("card"), v.literal("online")))`
  and `source: v.optional(v.union(v.literal("online"), v.literal("box_office")))`.

## 4. Check-out — `convex/ticketCheckin.ts`

- `checkOutTicket({ code })` — organizer-auth'd + ownership (mirrors `checkInTicket`'s structured
  result): a `checked_in` ticket → set `status "valid"` + `checkedOutAt = Date.now()`, result
  `{ result: "ok", ... }`; a `valid` (already out / never in) ticket → `{ result: "not_in" }`; a
  `cancelled`/not-found → the corresponding result. (Semantics: `checked_in` = currently inside;
  checking out returns them to `valid` so they may re-enter.)
- `getScanState({ eventId })` — add `currentlyInside` = count of `checked_in` tickets (already the
  `checkedIn` field — expose it explicitly as `currentlyInside` too, or keep `checkedIn` as the
  live-inside count and add a cumulative `checkedInEver` if easy; at minimum `currentlyInside` is
  the `checked_in` count).

## 5. Box office — `convex/orders.ts`

**Refactor first (DRY, no behavior change):** extract the shared core of `createOrder` — cart
aggregation (tickets + add-ons), validation (published event, active/visible types, access-code
gate for hidden, min/max, capacity per-type + event + add-on), promo resolution, answer
validation, amounts computation, and the order + items + `orderAddOns` + `orderResponses` inserts +
capacity reservation — into an internal helper `buildOrder(ctx, { eventId, items, addOnItems, buyerName,
buyerEmail, promoCode, accessCode, answers, feeOverrideZero })` returning `{ orderId, totalCents }`.
`createOrder` becomes a thin public wrapper around it (unchanged behavior — **all existing order
tests must still pass**).

`createBoxOfficeOrder({ eventId, items, addOnItems?, buyerName, buyerEmail?, paymentMethod })` —
organizer-auth'd + event ownership:
- `feeOverrideZero = paymentMethod === "cash"` (cash sales incur zero platform fee — the order's
  `feeCents` is 0 and `totalCents` = subtotal). `card`/otherwise → normal fees.
- Call `buildOrder(...)`, set `source: "box_office"` + `paymentMethod` on the order, then
  **mark it paid inline** (`issueTicketsAndMarkPaid`) so tickets are issued immediately.
- Record an audit entry (`"order.box_office"`, F17). Return `{ orderId, token, totalCents }`.

(`feeOverrideZero` threads into `computeOrderAmounts` by passing `feeMode: "absorb"` with a
zero-fee short-circuit, or by post-zeroing `feeCents`/recomputing `totalCents = subtotalCents`;
implement cleanly so the stored amounts are internally consistent.)

## 6. UI

- **Scan screen** (`/events/$id/scan`): add a **mode toggle** (Check in / Check out) — in check-out
  mode the code entry calls `checkOutTicket` and the result card reflects it; show
  `currentlyInside` in the live header.
- **Box office**: a "Sell at the door" `Dialog` (on the scan screen or the event page) — pick ticket
  types + quantities + optional add-ons, buyer name, a `paymentMethod` `ToggleGroup` (Cash / Card),
  submit → `createBoxOfficeOrder`; toast the total and note cash = no fee.

## 7. Testing (TDD)

- `ticketCheckin.test.ts`: `checkOutTicket` on a checked-in ticket → valid + `checkedOutAt`;
  on a not-checked-in ticket → `not_in`; owner-only; `getScanState.currentlyInside` reflects
  check-in then drops after check-out.
- `orders.test.ts`: the `createOrder` refactor keeps every existing test green (this is the safety
  net); `createBoxOfficeOrder` issues tickets immediately (order `paid`, tickets `valid`), a **cash**
  order has `feeCents === 0` and `totalCents === subtotalCents`, a **card** order has the normal fee,
  respects capacity, and is organizer-owner-only.
- Frontend verified by `tsc` + `build`.

## 8. Constraints

Carried: shadcn/ui, `Skeleton`, plain `Error`, per-file test helpers, integer cents. **The
`createOrder` refactor is the risk** — it MUST be pure extraction with identical behavior; run the
full suite and confirm the pre-F18 order tests are unchanged and green.

## 9. Delivery

TDD → `pnpm test` + `tsc` + `build` green → push (stacked on F17) → PR → the two big remaining
slices: **F13 multi-date/recurring**, then **F10 reserved seating**.
