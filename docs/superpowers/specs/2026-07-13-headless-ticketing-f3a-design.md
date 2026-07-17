# Passline → Headless Ticketing — F3a: Orders & checkout core (payment-independent)

- **Date:** 2026-07-13
- **Status:** Approved design (autonomous loop)
- **Slice:** F3a — the order/ticket model + checkout logic that does NOT need a payment
  processor. Live card charging (Stripe) is **F3b**, gated on the user's Stripe test keys.

## 1. Goal

Turn ticket types into a real purchase flow: a buyer selects quantities, an **order** is created
with correct totals and booking fees, capacity is reserved, and — for **free** orders — tickets
are issued immediately end-to-end (no Stripe needed). Paid orders are created `pending` behind a
clean `markOrderPaid` seam that F3b fills once Stripe is wired.

## 2. Scope

**In:** `orders` / `orderItems` / `tickets` tables; `events.feeMode`; a fee helper; a **public**
`createOrder` (validates availability, reserves capacity, computes totals/fees, issues tickets
immediately for a $0 total); `cancelOrder` (releases capacity); organizer `listOrdersForEvent` +
`getOrder`; an internal `markOrderPaid` (the F3b seam) that issues tickets for a paid order; a
public HTTP `POST /v1/orders` checkout endpoint; a dashboard **Orders** tab.

**Out (F3b and later):** Stripe PaymentIntent + payment-confirmation webhook (F3b); buyer
self-service order management (F6); refunds (F6); a hosted checkout UI (developers build their
own via `POST /v1/orders`, per "headless"); "pay-what-you-want" donation amount input (later —
F3a uses the donation type's `priceCents` as the amount).

## 3. Fees

`convex/lib/fees.ts`:
- Platform booking fee: `FEE_BPS = 300` (3%). Add to `convex/lib/constants.ts`.
- Per-event `feeMode: "pass" | "absorb"` (new optional `events.feeMode`, code default `"pass"`).
- `computeOrderAmounts(lineItems, feeMode)` where each line item is `{ unitPriceCents, quantity }`:
  - `subtotalCents = Σ unitPriceCents * quantity`
  - `feeCents = Math.round(subtotalCents * FEE_BPS / 10000)` (so a $0 subtotal ⇒ $0 fee — "free is free")
  - `passToBuyer = feeMode === "pass"`
  - `totalCents = subtotalCents + (passToBuyer ? feeCents : 0)` (what the buyer pays)
  - `payoutCents = subtotalCents - (passToBuyer ? 0 : feeCents)` (what the organizer receives)
  - returns `{ subtotalCents, feeCents, totalCents, payoutCents }`

## 4. Data model

```ts
orders: defineTable({
  eventId: v.id("events"),
  organizerId: v.id("organizers"),      // denormalized from the event for org-scoped queries
  buyerName: v.string(),
  buyerEmail: v.string(),
  status: v.union(v.literal("pending"), v.literal("paid"), v.literal("cancelled")),
  currency: v.string(),
  feeMode: v.union(v.literal("pass"), v.literal("absorb")),
  subtotalCents: v.number(),
  feeCents: v.number(),
  totalCents: v.number(),
  payoutCents: v.number(),
  token: v.string(),                    // opaque order token for buyer-facing lookup
  createdAt: v.number(),
  paidAt: v.optional(v.number()),
})
  .index("by_event", ["eventId"])
  .index("by_organizer", ["organizerId"])
  .index("by_token", ["token"]),

orderItems: defineTable({
  orderId: v.id("orders"),
  ticketTypeId: v.id("ticketTypes"),
  quantity: v.number(),
  unitPriceCents: v.number(),           // snapshot of the price at purchase time
}).index("by_order", ["orderId"]),

tickets: defineTable({
  orderId: v.id("orders"),
  eventId: v.id("events"),
  ticketTypeId: v.id("ticketTypes"),
  code: v.string(),                     // unique QR/scan code
  status: v.union(v.literal("valid"), v.literal("checked_in"), v.literal("cancelled")),
  attendeeName: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_order", ["orderId"])
  .index("by_event", ["eventId"])
  .index("by_code", ["code"]),
```

## 5. Functions — `convex/orders.ts`

- `createOrder({ eventId, items: [{ ticketTypeId, quantity }], buyerName, buyerEmail })` —
  **public** mutation (buyers have no account, mirroring the public RSVP flow). Steps:
  1. Load the event; reject unless `status === "published"`.
  2. For each item: load the ticket type, assert it belongs to the event and is `active` and
     `visibility === "visible"`; assert `quantity >= 1`, and within `minPerOrder`/`maxPerOrder`
     if set; assert `sold + quantity <= capacity` when the type has a `capacity`. Snapshot
     `unitPriceCents`.
  3. Reject an empty cart. Assert total requested quantity fits remaining `event.capacity`
     (sum of all types' `sold` + requested ≤ `event.capacity`).
  4. `computeOrderAmounts` → amounts. Insert the `orders` row (`feeMode = event.feeMode ?? "pass"`,
     `currency = event.currency ?? "USD"`, `token = "ord_" + 32 hex`, status `pending`),
     insert `orderItems`, and **reserve** capacity by incrementing each ticket type's `sold`.
  5. If `totalCents === 0` → call `markOrderPaidInternal(ctx, orderId)` inline (issues tickets,
     sets `paid`). Return `{ orderId, token, totalCents, currency, status }`.
- `markOrderPaid({ orderId })` — **internal** mutation (F3b's payment-confirmation seam;
  idempotent — a no-op if already `paid`): sets `status "paid"`, `paidAt`, and issues one
  `tickets` row per unit across the order's items, each with a unique `code = "tkt_" + 32 hex`,
  status `valid`. (Extract the shared logic into a plain `issueTicketsAndMarkPaid(ctx, order)`
  helper used by both `createOrder`'s free path and this mutation.)
- `cancelOrder({ orderId })` — organizer-auth'd + ownership (via the order's event). Only a
  `pending` order may be cancelled here; **releases** reserved capacity (decrement each item's
  `sold`) and sets `status "cancelled"`. (Cancelling a paid order = refund = F6.)
- `getOrder({ token })` — public read by token: the order + its items + issued tickets
  (buyer-facing confirmation).
- `listOrdersForEvent({ eventId })` — organizer-auth'd + ownership; returns the event's orders
  (newest first) for the dashboard.

## 6. HTTP checkout endpoint — `convex/apiHttp.ts` + `convex/http.ts`

`POST /v1/orders` — Bearer API-key authenticated (reuse F2's `authenticate`). Body:
`{ eventId, items:[{ticketTypeId, quantity}], buyerName, buyerEmail }`. The key's organizer MUST
own the event (404 otherwise). Calls the same order-creation logic via an internal mutation and
returns `{ data: { orderId, token, totalCents, currency, status } }` (201), or `400` with
`{ error }` on a validation failure (sold out, bad quantity, etc.).

## 7. Dashboard UI

Add an **Orders** tab to the event page (`events/$id.index.tsx`, alongside Details / Ticket
types): a `Table` of orders (buyer, status `Badge`, item count, total via `formatMoney`, date),
`Skeleton` while loading, `Empty` when none. Read via `listOrdersForEvent`.

## 8. Testing (TDD)

`convex/orders.test.ts` + `convex/fees.test.ts`:
- `computeOrderAmounts`: pass vs absorb totals/payout; $0 subtotal ⇒ $0 fee; a mixed free+paid cart.
- `createOrder`: reserves capacity (`sold` increments); rejects overselling a type cap and the
  event cap; rejects an unpublished event, an archived/hidden/foreign ticket type, quantity below
  `minPerOrder` / above `maxPerOrder`; a **free** cart is `paid` immediately with one ticket per
  unit issued; a **paid** cart stays `pending` with no tickets.
- `markOrderPaid`: issues tickets + sets paid; idempotent (second call is a no-op, no duplicate
  tickets).
- `cancelOrder`: releases capacity (`sold` decrements), owner-only, rejects a paid order.
- HTTP `POST /v1/orders`: 201 for a valid free order (via `t.fetch` + a real API key); 400 on
  oversell; 404 for a foreign event; 401 without a key.

## 9. Constraints

Carried: shadcn/ui, `Skeleton` loaders, plain `Error`, per-file test helpers, integer cents,
additive (F1 `ticketTypes.sold` is now actually maintained — its create still starts at 0; RSVP
path untouched).

## 10. Delivery

TDD → `pnpm test` + `tsc` + `build` green → push (stacked on F2c) → PR → **F3b**: Stripe
PaymentIntent + payment-confirmation webhook calling `markOrderPaid` (needs Stripe **test** keys
from the user + the deployed HTTP endpoint).
