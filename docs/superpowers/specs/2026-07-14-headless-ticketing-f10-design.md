# Passline → Headless Ticketing — F10: Reserved seating

- **Date:** 2026-07-14
- **Status:** Approved design (autonomous loop — final non-payment slice)
- **Slice:** F10 — assigned seats (Humanitix §3). Builds on the F18/F13 `buildOrder` helper.

## 1. Goal

Let organizers lay out a seated venue (sections of rows × seats, each section priced by a ticket
type) and let buyers pick specific available seats at checkout, with seat-tied tickets.

## 2. Scope

**In:** a `seats` inventory; a **section generator** (rows × seats for a ticket type) + a visual
grid; a public seat map; seat selection in `buildOrder` (`seatIds` per cart item) with seat-tied
ticket issuance and seat release on cancel/refund; a Seating dashboard tab + a seat-picker in the
box-office dialog; `GET /v1/events/{id}/seats`.

**Out (explicit):** a free-form drag-and-drop canvas editor (the generator + grid is the MVP —
note the canvas as future work); tables/GA-mixed-with-assigned within one section; combining
**seated ticket types with multi-date sessions** (F13) — a seated type on a session order is
rejected this slice; seat holds with timers (seats go straight available→sold; abandoned-cart
release is the existing order cancel).

## 3. Data model

```ts
seats: defineTable({
  eventId: v.id("events"),
  organizerId: v.id("organizers"),
  ticketTypeId: v.id("ticketTypes"),   // the pricing tier for this seat
  section: v.string(),
  row: v.string(),                     // "A", "B", …
  number: v.number(),                  // 1..seatsPerRow
  status: v.union(v.literal("available"), v.literal("sold")),
  sortOrder: v.number(),               // stable ordering across a section
}).index("by_event", ["eventId"]).index("by_ticketType", ["ticketTypeId"]),
```
Add `seatId: v.optional(v.id("seats"))` and `seatLabel: v.optional(v.string())` to `tickets`
(additive). A ticket type is **seated** iff it has ≥ 1 `seats` row (by the `by_ticketType` index).

## 4. Seat functions — `convex/seats.ts`

- `generateSection({ eventId, ticketTypeId, section, rows, seatsPerRow })` — organizer-auth'd +
  ownership (ticket type belongs to event); `rows`/`seatsPerRow` integers 1..100; reject a duplicate
  `section` name for the event; insert `rows × seatsPerRow` `available` seats (row labels A, B, …,
  numbers 1..seatsPerRow, `sortOrder` = rowIndex*1000 + number). Reject if any seat in that section
  is already `sold` (only relevant on regenerate). Returns the count created.
- `list({ eventId })` (organizer, all seats + status) · `listForEvent({ eventId })` (public: for a
  published event, seats with `{ id, ticketTypeId, section, row, number, status }`, sorted) ·
  `removeSection({ eventId, section })` (organizer; reject if any seat in it is `sold`).

## 5. Order integration — `convex/orders.ts` (extend `buildOrder`)

Cart items become `{ ticketTypeId, quantity?, seatIds? }`:
- A ticket type that **has seats** (seated): the item MUST provide `seatIds` (non-empty; `quantity`
  is derived = `seatIds.length`). Validate each seat exists, belongs to this `ticketTypeId` +
  `eventId`, and is `available`; de-dupe seatIds; the per-type numeric capacity check is skipped
  (seat inventory is the capacity). Reserve = set each seat `status:"sold"` (+ increment
  `ticketType.sold` for the issued count, as F13 does). Issue **one ticket per seat**, stamped with
  `seatId` + `seatLabel` = `"<section> <row><number>"`.
- A **GA** ticket type (no seats): `quantity` exactly as today; a provided `seatIds` on a GA item is
  rejected.
- **Reject** a seated ticket type when the order also targets a session (`sessionId` set) — seated
  events aren't multi-session this slice ("Seated tickets can't be combined with sessions").
- `cancelOrder` / `refundOrder`: in addition to the existing `ticketType.sold` (and session)
  release, set each of the order's tickets' `seatId` back to `status:"available"` (for tickets that
  have a `seatId`).
- `createOrder`, `createBoxOfficeOrder`, `POST /v1/orders` accept the extended item shape.
- `getOrder` returns each ticket's `seatLabel`. `GET /v1/events/{eventId}/seats` (Bearer, org-scoped)
  via the `listEventSubResource` dispatcher (public `listForEvent`).

## 6. UI

- **Seating dashboard tab**: a section generator `Dialog` (ticket type `Select`, section name, rows
  + seats-per-row) → `generateSection`; a **grid preview** per section (seats coloured by status:
  available / sold), and a `removeSection` action (disabled if any seat sold). `Skeleton`/`Empty`.
- **Box-office dialog**: for a seated ticket type, replace the quantity stepper with a **seat-picker
  grid** (click available seats to select; sold seats disabled) sourced from `seats.listForEvent`,
  passing `seatIds` to `createBoxOfficeOrder`. (The headless buyer checkout renders the seat map from
  `GET /v1/events/{id}/seats` — the developer's UI.)

## 7. Testing (TDD)

- **The `buildOrder` change must keep every existing GA/session order test green** (GA items are
  unchanged when a type has no seats) — the safety net.
- `seats.test.ts`: `generateSection` creates rows×seats available, validates bounds + duplicate
  section + ticket-type ownership; `listForEvent` published-only + sorted; `removeSection` rejects a
  section with a sold seat; owner-only.
- `orders.test.ts`: buying a seated type requires `seatIds`; valid seatIds mark those seats `sold`,
  issue one seat-tied ticket each (with `seatLabel`), and skip the numeric type cap; a seatId that is
  already `sold` / belongs to another type / another event is rejected (no partial mutation); a GA
  item with `seatIds` is rejected; a seated type + `sessionId` is rejected; `cancelOrder`/`refundOrder`
  set the seats back to `available`.
- `apiHttp.test.ts`: `GET /v1/events/{id}/seats`; `POST /v1/orders` with `seatIds`.

## 8. Constraints

Carried: shadcn/ui, `Skeleton`, plain `Error`, per-file test helpers, integer cents. **`buildOrder`
now handles GA + add-ons + sessions + seats — the GA and session paths must stay behavior-identical;
branch cleanly on "ticket type has seats". Concurrent seat-buy is OCC-safe** (two orders selecting
the same seat: the read-of-status → write-sold conflicts, the loser retries and sees `sold` → rejects).

## 9. Delivery

TDD → `pnpm test` + `tsc` + `build` green → push (stacked on F13) → PR → **the full non-payment
Humanitix feature set is complete.** (Payment: F3b Stripe + BNPL/wallets/invoice remain, gated on
the user's Stripe keys.)
