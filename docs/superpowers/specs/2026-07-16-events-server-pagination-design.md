# Server-side events pagination — design

**Date:** 2026-07-16
**Branch:** `feat/headless-ticketing-f22`
**Surface:** `/events` (`src/routes/events/index.tsx`) + Convex backend

## Problem

The `/events` list (just rebuilt) loads **all** of an organizer's events and computes
per-event stats by fanning out over every event's rsvps/tickets/orders — O(all the
organizer's activity) per query. Search / filter / sort / the Upcoming-Past split are all
client-side over the full set. This does not scale to organizers with many hundreds-plus
events. Warren chose **full server-side pagination**, accepting the re-architecture.

## Decisions (locked with the user)

1. **Server-side pagination**, scaling to thousands of events.
2. **Denormalize** per-event stats onto the `events` doc (the real bottleneck is the
   per-event child fan-out, not row count).
3. **Sort model:** the **All** tab offers Date / Fill / Name (index-backed); **Upcoming**
   and **Past** tabs are chronological only.
4. **Search:** server-side, over a combined **title + location** field; a relevance-ranked
   paginated mode that overrides tab/sort while active.
5. **KPI strip:** numbers only (totals from denormalized event docs). The two sparklines
   are dropped here; 30-day trends live on `/dashboard`.
6. **Tabs ordered by `endsAt`** — Upcoming = ending soonest first, Past = ended most
   recently first. (Cleanly indexable; slight change from today's start-time order.)
7. **Paginator:** shadcn Pagination as **Prev / Next + "Page N"** (Convex pagination is
   cursor-based; no jump-to-arbitrary-page).

## Write-path map (from the mapping workflow — the denormalization surface)

Counters maintained: `seatsTaken` (seat-holding rsvps: confirmed / confirmed_pending_claim
/ checked_in), `ticketsSold` (non-cancelled tickets on **paid** orders), `revenueCents`
(sum `payoutCents` over **paid** orders). Maintained by one idempotent
`recomputeEventStats(ctx, eventId)` called after any write that can move them:

| File | Function | When | eventId source |
|---|---|---|---|
| `rsvps.ts` | `rsvp` | after insert (confirmed or waitlisted branch) | `event._id` (slug lookup) |
| `rsvps.ts` | `cancelRsvp` | after `promoteNext` (net effect) | `row.eventId` |
| `waitlist.ts` | `sweep` (used by `sweepExpiredClaims` + cron `sweepExpiredClaimsNow`) | per **distinct** affected `hold.eventId` | `hold.eventId` |
| `orders.ts` | `createOrder` | end of handler (covers $0 inline fulfilment) | arg `eventId` |
| `orders.ts` | `createBoxOfficeOrder` | end of handler | arg `eventId` |
| `orders.ts` | `markOrderPaid` | after fulfilment (guard the idempotent no-op) | `order.eventId` |
| `orders.ts` | `refundOrder` | after status/ticket patches | `order.eventId` |
| `events.ts` | `createEvent`, `duplicateEvent` | init counters to 0 on insert | new `_id` |
| `seed.ts` | `seed` | per seeded event (recompute or set directly) | loop `eventId` |

**Confirmed no-ops (do NOT recompute):** `checkIn`, `claimSpot`, `checkInTicket`,
`checkOutTicket`, `undoCheckIn`, `transferTicket` (status stays within the counted set);
`cancelOrder` (pending only, never counted); `deleteEvent` (doc removed). `promoteNext`,
`buildOrder`, `issueTicketsAndMarkPaid` are helpers — recompute is the **calling
mutation's** responsibility, once, after all its writes.

**Tooling gaps:** no migrations framework (add `@convex-dev/migrations`), no existing
`.paginate()` / search indexes anywhere — all net-new.

---

## Phase A — denormalization foundation (backend only, no UX change)

Independently shippable and verifiable; also makes the current list query cheaper.

### A1. Schema (`convex/schema.ts`, `events`)
Add optional fields (optional so the schema deploys before backfill):
- `seatsTaken: v.optional(v.number())`
- `ticketsSold: v.optional(v.number())`
- `revenueCents: v.optional(v.number())`
- `fillPermille: v.optional(v.number())` — `capacity > 0 ? round(seatsTaken * 1000 / capacity) : 0`; **not** clamped, so oversold sorts highest.
- `searchText: v.optional(v.string())` — `\`${title} ${location}\`` (Convex search tokenizes and is case-insensitive; no manual lowercasing needed).
- `titleLower: v.optional(v.string())` — `title.toLowerCase()` for case-insensitive name sort.

(Indexes + search index are Phase B, since nothing reads them until then. Adding them in
A is also fine, but they are only exercised in B.)

### A2. `recomputeEventStats` helper (`convex/lib/eventStats.ts`)
```ts
export async function recomputeEventStats(ctx: MutationCtx, eventId: Id<"events">): Promise<void>
```
- `get` the event; if missing, return (deleted).
- rsvps `by_event` → count seat-holding (`SEAT_HOLDING_STATUSES`) → `seatsTaken`.
- orders `by_event` → paid → `revenueCents = Σ payoutCents`, collect `paidOrderIds`.
- tickets `by_event` → count non-cancelled tickets whose `orderId ∈ paidOrderIds` → `ticketsSold`.
- `fillPermille = capacity > 0 ? Math.round(seatsTaken * 1000 / capacity) : 0`.
- `patch` the event with the four numeric fields.
Cost = one event's children per call (same as one slice of the old query), on writes only.

Also a small `eventSearchFields(title, location)` returning `{ searchText, titleLower }`,
used by create/update so title/location edits keep the search + name-sort fields fresh.

### A3. Wire recompute + field maintenance into mutations
Per the write-path table. Specifics:
- `sweep` (waitlist.ts): accumulate a `Set<Id<"events">>` of every `hold.eventId` touched
  (and any promoted), then recompute each once after the loop.
- `markOrderPaid` / `refundOrder`: only recompute on the real transition (respect their
  early-return idempotency).
- `createEvent` / `duplicateEvent`: set `seatsTaken/ticketsSold/revenueCents = 0`,
  `fillPermille = 0`, and `searchText/titleLower` on insert.
- The event **update** mutation(s) that patch `title` / `location`: refresh
  `searchText/titleLower`. Any patch to `capacity`: refresh `fillPermille` (recompute, or
  recompute-stats). (Plan pins the exact function names.)
- `seed`: recompute per seeded event at the end (simplest: call `recomputeEventStats`).

### A4. Backfill migration
- Install `@convex-dev/migrations`; register in `convex/convex.config.ts`.
- Migration `backfillEventStats`: for every event, `recomputeEventStats` + set
  `searchText/titleLower`. Idempotent; runnable via the migrations runner.

### A5. Make the existing list query read denormalized fields
`listMyEventsWithStats` (current) keeps working but now reads `seatsTaken/ticketsSold/
revenueCents` from the doc instead of recomputing — dropping most child reads (it still
reads each event's rsvps for the per-row pace spark; that moves to per-page in Phase B).
This proves the counters are correct end-to-end before the UX change.

### A6. Testing (Phase A)
convex-test coverage that the counters stay correct across the real flows:
- RSVP confirmed → `seatsTaken` +1; waitlisted → no change.
- `cancelRsvp` frees a seat; with a waitlister present, `promoteNext` backfills → net 0.
- `sweep` expiry across two events updates **both** events' `seatsTaken`.
- paid order (`createBoxOfficeOrder` / `markOrderPaid`) → `ticketsSold` + `revenueCents`;
  `refundOrder` reverses both; pending/cancelled never count.
- `fillPermille` tracks `seatsTaken`/`capacity` (incl. capacity edit).
- `recomputeEventStats` equals the live `countSeatsTaken` / paid-order aggregation.
- backfill migration produces the same values as recompute on seeded data.

---

## Phase B — pagination UX (built on Phase A)

### B1. Indexes + search (`convex/schema.ts`, `events`)
- `by_organizer_and_endsAt` `["organizerId", "endsAt"]` — Upcoming (`gte(endsAt, now)` asc) / Past (`lt(endsAt, now)` desc).
- `by_organizer_and_startsAt` `["organizerId", "startsAt"]` — All + Date sort.
- `by_organizer_and_fillPermille` `["organizerId", "fillPermille"]` — All + Fill sort (desc).
- `by_organizer_and_titleLower` `["organizerId", "titleLower"]` — All + Name sort (asc).
- `search_events = searchIndex("search_events", { searchField: "searchText", filterFields: ["organizerId"] })`.

### B2. Paginated queries (`convex/events.ts`)
- `listMyEventsPage({ tab: "upcoming"|"past"|"all", sort: "date"|"fill"|"name", paginationOpts })`
  → `{ page, isDone, continueCursor }` via `.withIndex(...).order(...).paginate(opts)`.
  Chooses the index per (tab, sort): upcoming/past → `by_organizer_and_endsAt` with the
  time range; all+date → `by_organizer_and_startsAt` desc; all+fill →
  `by_organizer_and_fillPermille` desc; all+name → `by_organizer_and_titleLower` asc.
  Enriches **only the page's rows**: for each, read its rsvps `by_event` to build the pace
  `spark` + `deltaPct`; `seatsTaken/ticketsSold/revenueCents/fillPermille/capacity/status`
  come from the doc. Returns the same `EventRow` shape the page already consumes (minus
  `revenueSpark`, which was KPI-only).
- `searchMyEventsPage({ query, paginationOpts })` → same enriched shape, via
  `.withSearchIndex("search_events", q => q.search("searchText", query).eq("organizerId", id)).paginate(opts)`.
- `getMyEventsKpis()` → `{ total, published, draft, upcoming, attendees, revenueCents,
  ticketsSold, currency }` summed from the denormalized event docs (`by_organizer`,
  O(events), no child reads). Numbers only.

`now` is passed from the client (queries can't call `Date.now()` deterministically for the
tab boundary; pass it as an arg, as the dashboard/analytics already do).

### B3. Frontend (`src/routes/events/index.tsx`)
- **KPI strip**: `useQuery(getMyEventsKpis)` → 4 `StatCard`s, **no** `spark` prop (numbers only).
- **Tabs**: shadcn `Tabs` (or the existing `ToggleGroup`) — Upcoming | Past | All. Changing
  tab resets pagination.
- **Sort Select**: shown only on the **All** tab (Date / Fill / Name); Upcoming/Past are
  chronological, so the control is hidden there.
- **Search**: an `Input`; when non-empty (debounced), switch to `searchMyEventsPage` and
  render a single "search results" list, hiding tabs/sort. Clearing search restores tabs.
- **Pagination (Prev / Next)**: keep a client cursor **stack**. Each page calls
  `listMyEventsPage`/`searchMyEventsPage` with the current cursor via `useQuery`; "Next"
  pushes `continueCursor` and advances (disabled when `isDone`); "Previous" pops (disabled
  on page 1); show "Page N". Render with shadcn `Pagination` primitives
  (`PaginationPrevious` / `PaginationNext` as buttons + a page indicator). Reset the stack
  to page 1 whenever tab / sort / search changes.
- **Rows**: unchanged — per-row `PaceChart`, fill bar, sales column, status badge, links.
- **Empty states**: zero events → existing `Empty`; empty page/search → inline message.

### B4. Testing (Phase B)
- `listMyEventsPage`: each (tab, sort) uses the right index and returns correctly ordered,
  correctly bounded pages; cursor round-trips; upcoming/past boundary by `endsAt`.
- `searchMyEventsPage`: matches title and location; scoped to the organizer; unauth → empty.
- `getMyEventsKpis`: totals equal the denormalized sums; unauth → zeros.
- Frontend: manual/browser — tabs switch, Prev/Next paginate, sort (All only), search mode,
  no horizontal scroll.

---

## Rollout / ordering

1. Ship **Phase A** (schema fields + helper + wiring + migration), run the backfill, verify
   counters correct in the running app (dashboard + current list unaffected).
2. Then **Phase B** (indexes + queries + frontend). Indexes build on deploy; queries and UI
   land together.

Deploying new **optional** schema fields and new indexes is additive and backward
compatible; the backfill is idempotent and re-runnable.

## Out of scope (YAGNI)

- Jump-to-arbitrary-page numbered pagination (Convex is cursor-based).
- Fill/Name sort inside the Upcoming/Past tabs (chronological only, by decision 3).
- KPI sparklines on this page (decision 5).
- Reconciling `convex/analytics.ts`'s separate date-bucketing (tracked follow-up).
