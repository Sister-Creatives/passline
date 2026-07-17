# Passline → Headless Ticketing — F13: Multi-date / recurring events

- **Date:** 2026-07-14
- **Status:** Approved design (autonomous loop)
- **Slice:** F13 — events that happen across multiple sessions/dates (Humanitix §3). Builds on the
  F18 `buildOrder` helper.

## 1. Goal

Let an event have multiple **sessions** (e.g. daily tours, a weekly class, a theatrical run). A
buyer picks a session; capacity is tracked per session; tickets and orders record which session
they're for.

## 2. Capacity model (the key decision — implement exactly this)

- An event is **multi-session** iff it has ≥ 1 `eventSessions` row; otherwise **single** (today's
  behavior, unchanged).
- For a **multi-session** event, the **session is the inventory unit**: each order MUST target a
  `sessionId`, and capacity is enforced ONLY at the session level (`session.sold + qty ≤
  session.capacity`). The event-level `event.capacity` and per-ticket-type `capacity` checks are
  **skipped** for multi-session events (ticket types are pure pricing tiers across sessions). Reserve
  = increment `session.sold`.
- For a **single** event, everything is exactly as today (no `sessionId`; event + per-type caps).

## 3. Data model

```ts
eventSessions: defineTable({
  eventId: v.id("events"),
  organizerId: v.id("organizers"),
  startsAt: v.number(),
  endsAt: v.number(),
  capacity: v.number(),          // per-session capacity (integer ≥ 1)
  sold: v.number(),              // reserved seats for this session
  label: v.optional(v.string()), // e.g. "Matinee"
  sortOrder: v.number(),
}).index("by_event", ["eventId"]),
```
Add `sessionId: v.optional(v.id("eventSessions"))` to both `orders` and `tickets` (additive).

## 4. Sessions — `convex/eventSessions.ts`

- `create({ eventId, startsAt, endsAt, capacity, label? })` — organizer-auth'd + ownership; `endsAt
  > startsAt`; `capacity` integer ≥ 1; append `sortOrder`; `sold: 0`.
- `list({ eventId })` (organizer) · `listForEvent({ eventId })` (public: sessions of a published
  event, sorted by `startsAt`, with remaining = `capacity - sold`) · `update({ sessionId, ... })`
  (capacity may not drop below `sold`) · `remove({ sessionId })` (reject if `sold > 0`) ·
  `reorder({ eventId, orderedIds })`.

## 5. Order integration — `convex/orders.ts` (extend `buildOrder`)

`buildOrder` gains an optional `sessionId`:
- Load the event's sessions (`by_event`). If the event **has sessions**: require a `sessionId`
  belonging to the event; validate `session.sold + totalTicketQty ≤ session.capacity`; **skip** the
  event-capacity and per-type-capacity checks; after inserting the order, increment `session.sold`
  and set `order.sessionId` + every issued/ to-be-issued ticket's `sessionId` to it. If the event
  has **no sessions**: reject a provided `sessionId` ("event has no sessions") and behave exactly as
  today.
- `createOrder`, `createBoxOfficeOrder`, and `POST /v1/orders` all accept optional `sessionId` and
  pass it through.
- `cancelOrder` / `refundOrder`: if `order.sessionId` is set, **release** `session.sold` (decrement
  by the order's ticket quantity, clamp ≥ 0) in addition to the existing per-type release (which,
  for a multi-session order, reserved nothing on the ticket types — so guard: only decrement the
  channel that was actually reserved. Simplest: for a multi-session order the reservation lived on
  the session; release the session. For a single order, release the ticket types as today. Branch on
  `order.sessionId`).
- `getOrder` returns the `sessionId` + its session (date/label) when set.
- `ticketCheckin.getScanState` unaffected (event-wide) this slice; a `sessionId` filter is a nicety.

`GET /v1/events/{eventId}/sessions` (Bearer, org-scoped) via the `listEventSubResource` dispatcher.

## 6. Dashboard UI

A **Sessions** tab: a `Table` (date range, capacity, sold, remaining), a create `Dialog`
(`DateTimePicker` for start/end, capacity, optional label), up/down reorder, `AlertDialog` remove
(disabled when `sold > 0`). `Skeleton`/`Empty`. The box-office "Sell at the door" dialog gains a
session `Select` when the event has sessions. (The headless buyer checkout picks the session via the
API — the developer's UI.)

## 7. Testing (TDD)

- The **`buildOrder` change must keep every existing single-event order test green** (single events
  don't set `sessionId`, so the new branch is skipped) — the safety net.
- `eventSessions.test.ts`: create/list/listForEvent/update/remove/reorder validation + owner-only;
  `remove` rejects a session with `sold > 0`; `update` can't drop capacity below `sold`.
- `orders.test.ts`: for a multi-session event, `createOrder` without a `sessionId` is rejected; with
  a valid `sessionId` it reserves `session.sold` (NOT the event/type caps) and tags the order +
  tickets; oversell of the session is rejected; `cancelOrder`/`refundOrder` release `session.sold`;
  a `sessionId` on a single (session-less) event is rejected.
- `apiHttp.test.ts`: `GET /v1/events/{id}/sessions`; `POST /v1/orders` with `sessionId`.

## 8. Constraints

Carried: shadcn/ui, `Skeleton`, plain `Error`, per-file test helpers, integer cents. **The
`buildOrder` extension is the risk** — single-event behavior must be byte-identical; branch cleanly
on "event has sessions".

## 9. Delivery

TDD → `pnpm test` + `tsc` + `build` green (+ `pnpm generate-routes` if a route is added — none) →
push (stacked on F18) → PR → the final slice: **F10 reserved seating**.
