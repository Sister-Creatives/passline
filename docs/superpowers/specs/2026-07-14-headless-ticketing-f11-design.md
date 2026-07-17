# Passline → Headless Ticketing — F11: Merch & add-ons

- **Date:** 2026-07-14
- **Status:** Approved design (autonomous loop — "build all features, payment later")
- **Slice:** F11 — sell non-ticket add-ons (VIP upgrades, t-shirts, parking, workshop access) in
  the same checkout. Builds on F3a orders + F4 fees.

## 1. Goal

Let organizers sell **add-ons** alongside tickets — priced items that do NOT issue a scannable
ticket (no check-in, no seat). A buyer adds them to the same order; they contribute to the
subtotal (and thus the booking fee) and reserve their own capacity.

## 2. Scope

**In:** `addOns` table + `orderAddOns` line items; `addOns.create/list/remove/reorder`
(organizer) + public `listForEvent`; `createOrder` + `POST /v1/orders` accept `addOnItems`
(validate, reserve add-on capacity, include in the fee/total math); `getOrder` returns add-ons;
`GET /v1/events/{id}/add-ons`; an Add-ons dashboard tab.

**Out:** add-ons tied to a specific ticket type (all add-ons are event-level); add-on-only orders
without a ticket are allowed (an add-on can be bought alone). Inventory transfer/refund of
add-ons reuses the order-level `refundOrder` (cancel releases add-on capacity too).

## 3. Data model

```ts
addOns: defineTable({
  eventId: v.id("events"),
  organizerId: v.id("organizers"),
  name: v.string(),
  priceCents: v.number(),            // integer cents, > 0 (add-ons are paid; free "add-ons" make no sense here)
  capacity: v.optional(v.number()),  // per-add-on cap; undefined = uncapped
  sold: v.number(),
  sortOrder: v.number(),
  active: v.boolean(),
}).index("by_event", ["eventId"]),

orderAddOns: defineTable({
  orderId: v.id("orders"),
  addOnId: v.id("addOns"),
  quantity: v.number(),
  unitPriceCents: v.number(),        // snapshot at purchase
}).index("by_order", ["orderId"]),
```

## 4. Functions — `convex/addOns.ts`

- `create({ eventId, name, priceCents, capacity? })` — organizer-auth'd + ownership. Non-empty
  name; `priceCents` integer > 0; capacity (if set) integer ≥ 1. Append `sortOrder`, `active`.
- `list({ eventId })` (organizer, all) · `listForEvent({ eventId })` (public: active add-ons of a
  published event, sorted) · `remove({ addOnId })` · `reorder({ eventId, orderedIds })`
  (permutation-checked) — all organizer-owner-scoped except the public read.

## 5. Checkout integration (`convex/orders.ts`)

`createOrder` gains optional `addOnItems?: { addOnId, quantity }[]`:
- Aggregate add-on items by `addOnId` (like tickets). For each: load the add-on, assert it belongs
  to the event + is `active`, `quantity ≥ 1`, and `sold + quantity ≤ capacity` when capped;
  snapshot `unitPriceCents`.
- The cart may now be tickets, add-ons, or both — reject only a **fully empty** cart (no tickets
  AND no add-ons).
- `grossSubtotalCents` = ticket gross + add-on gross. `computeOrderAmounts` runs on the combined
  gross (discount applies to the combined subtotal exactly as today). Insert `orderAddOns` rows
  and **reserve** add-on capacity (increment each add-on's `sold`). Add-ons do NOT issue `tickets`.
- `cancelOrder` / `refundOrder` also **release add-on capacity** (decrement `sold`) for the order's
  `orderAddOns`.
- `getOrder` additionally returns `addOns` (the order's `orderAddOns` joined with names).

`POST /v1/orders`: accept optional `addOnItems` in the body, pass through. Add
`GET /v1/events/{eventId}/add-ons` (Bearer, org-scoped) via the existing `/v1/events/` dispatcher,
returning `listForEvent`.

## 6. Dashboard UI

Add an **Add-ons** tab to the event page: a `Table` (name, price via `formatMoney`, cap, sold), a
create `Dialog` (name, price, optional capacity — react-hook-form + zod like `TicketTypesPanel`),
up/down reorder, `AlertDialog` remove. `Skeleton`/`Empty`.

## 7. Testing (TDD)

- `addOns.test.ts`: create validates name/price>0/capacity; list/remove/reorder owner-only;
  `listForEvent` active+published only, sorted.
- `orders.test.ts`: `createOrder` with add-on items reserves add-on `sold` and includes them in
  `subtotalCents`/`totalCents`; an add-on-only order (no tickets) succeeds; over-cap add-on
  rejected; `cancelOrder`/`refundOrder` release add-on capacity; `getOrder` returns add-ons.
- `apiHttp.test.ts`: `GET /v1/events/{id}/add-ons` returns active add-ons; `POST /v1/orders` with
  add-on items → 201; over-cap → 400.

## 8. Constraints

Carried: shadcn/ui, `Skeleton`, plain `Error`, per-file test helpers, integer cents, additive
(existing 241 tests pass; `computeOrderAmounts` unchanged — the caller sums ticket + add-on gross;
`createOrder`/`POST /v1/orders` gain a defaulted optional `addOnItems`).

## 9. Delivery

TDD → `pnpm test` + `tsc` + `build` green → push (stacked on F9) → PR → next slice (**F12 event
page builder / branding**).
