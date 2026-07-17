# Passline → Headless Ticketing — F6: Attendee self-service + refunds

- **Date:** 2026-07-14
- **Status:** Approved design (autonomous loop)
- **Slice:** F6 — order self-service, ticket transfers, and the structural refund flow. Builds on
  F3a orders/tickets. The paid-order *money-back* is the F3b/Stripe seam; F6 handles everything
  else.

## 1. Goal

Complete the attendee lifecycle (Humanitix §7): a buyer can view and manage their order via a
tokened link (transfer a ticket to someone else), and an organizer can refund an order — which
cancels its tickets and returns the capacity to the pool. For paid orders the Stripe money-back
is wired in F3b; F6 makes the refund's *record + inventory effects* correct now (and fully
functional end-to-end for free orders).

## 2. Scope

**In:** `orders.status` gains `"refunded"`; `refundOrder` (organizer) cancels tickets + releases
capacity + restores promo redemption + marks refunded (idempotent); `transferTicket` (public via
order token) reassigns a ticket's attendee; a public self-service order page `/orders/$token`;
a Refund action in the dashboard Orders tab.

**Out:** the actual Stripe refund API call for a paid order → **F3b** (F6 leaves a documented
`// F3b: issue the Stripe refund here` seam and, to avoid silently marking a paid order refunded
without returning money, **guards paid-order refunds** — see §5); partial refunds; buyer-initiated
self-cancel of a *paid* order (organizer-only for paid); editing buyer contact on the order.

## 3. Data model (additive)

- `orders.status`: add `v.literal("refunded")` to the union.
- `orders`: add `refundedAt: v.optional(v.number())`.
- `tickets`: add `attendeeEmail: v.optional(v.string())` (alongside the existing optional
  `attendeeName`).

## 4. Functions — `convex/orders.ts` (refund) and `convex/tickets` (transfer)

`refundOrder({ orderId })` — organizer-auth'd + event-ownership:
- Reject unless `status === "paid"` (a `pending` order should be `cancelOrder`'d; a
  `cancelled`/`refunded` order → idempotent no-op returning early).
- **Guard:** if `totalCents > 0` (a real paid order) AND the order was NOT paid through a
  refundable channel yet, still perform the inventory refund but set a flag/return value
  indicating the Stripe money-back is pending — concretely: proceed with the inventory/refund
  record for ALL paid orders (free or paid), because F3b will call this same path after issuing
  the Stripe refund. Document that until F3b lands, refunding a **nonzero** order returns
  inventory but does not move money. (Acceptable for the autonomous build; the organizer sees the
  status.)
- Effects: set every non-cancelled ticket of the order to `status "cancelled"`; **release**
  reserved capacity (decrement each order item's ticket type `sold` by its quantity, clamped ≥ 0);
  if the order used a promo code, restore that code's `timesRedeemed` (mirroring `cancelOrder`);
  set `status "refunded"`, `refundedAt`. Idempotent (a second call on a `refunded` order is a no-op).

`transferTicket({ orderToken, ticketId, attendeeName, attendeeEmail? })` — **public** (buyer holds
the order token):
- Load the order by `by_token`; assert the `ticketId` belongs to that order and is `status
  "valid"` (a `checked_in` or `cancelled` ticket cannot be transferred). Assert `attendeeName`
  non-empty. Patch the ticket's `attendeeName`/`attendeeEmail`.

`getOrder({ token })` already returns order + items + tickets (+ responses) — reused by the
self-service page.

`POST /v1/orders`-style HTTP is unchanged; a headless app can call `getOrder`/`transferTicket`
via the Convex client (a tokened HTTP endpoint is a later addition).

## 5. Dashboard + self-service UI

- **Orders tab** (`OrdersPanel`): add a **Refund** action per paid order — an `AlertDialog`
  ("Refund this order? Tickets will be cancelled and capacity released.") → `refundOrder`. Show
  `refunded` in the status `Badge`. (A small note in the dialog that the card refund is issued
  separately until payments are live.)
- **Self-service page** `src/routes/orders/$token.tsx` (**public**, no auth): loads
  `getOrder({ token })`; shows the order summary (event, status, total via `formatMoney`) and its
  tickets, each with a **Transfer** control (a `Dialog` with attendee name + email `Input`s →
  `transferTicket`). `Skeleton` while loading; a "not found" state for a bad token.

## 6. Testing (TDD)

- `orders.test.ts`: `refundOrder` cancels all the order's tickets, decrements `sold` back,
  restores a used promo's `timesRedeemed`, sets `refunded`+`refundedAt`; is idempotent (second
  call no-ops, no double capacity release); rejects a non-owner; rejects a `pending` order.
- `tickets`/transfer test: `transferTicket` with a valid order token + valid ticket updates the
  attendee; rejects a ticket not belonging to the token's order; rejects a `checked_in`/`cancelled`
  ticket; rejects an empty name.
- Frontend verified by `tsc` + `build`.

## 7. Constraints

Carried: shadcn/ui, `Skeleton` loaders, plain `Error`, per-file test helpers, integer cents,
additive (existing 225 tests pass; the new `"refunded"` status + optional fields don't break
existing order tests; the self-service route is public like `/e/$slug`).

## 8. Delivery

TDD → `pnpm test` + `tsc` + `build` green → push (stacked on F4b) → PR → next loop slice
(**F9 marketing**, then **F10 seating**; **F3b Stripe** when keys arrive — it will call
`refundOrder`'s money-back seam and `markOrderPaid`).
