# Server-side events pagination — design

**Date:** 2026-07-16
**Branch:** `feat/headless-ticketing-f22`
**Surface:** `/events` (`src/routes/events/index.tsx`) + Convex backend

## Problem

The `/events` list (just rebuilt) loads **all** of an organizer's events and computes
per-event stats by fanning out over every event's rsvps/tickets/orders — O(all the
organizer's activity) per query. Search / filter / sort / the Upcoming-Past split are all
client-side over the full set. This does not scale, and there is no pagination. Warren
wants **server-side pagination with true numbered pages**.

## Key insight

The expensive part of this page is never the event rows — it is fanning out over each
event's **children** (rsvps/tickets/orders). Once per-event stats are **denormalized onto
the event doc**, the event docs are small and cheap. So the server can load an organizer's
event docs (no children), filter / sort / search them **in memory**, slice out page N, and
enrich **only that page's ~10 rows** with their pace chart. This yields true numbered
pagination with an accurate total, needs **no sort indexes and no search index**, and lets
sort + search work on **every** tab.

Cost: each page load re-reads all of that organizer's event docs (not their children).
Fine into the low thousands of events; only a concern in the tens of thousands, which no
single organizer will hit. (Optimization if ever needed: a stable-args "ordered ids" query
that Convex caches across page navigation, with a light per-page enrichment query.)

## Decisions (locked with the user)

1. **Server-side pagination** with **true numbered pages** (`‹ 1 2 3 … 12 ›`, jump anywhere)
   plus an accurate total page count.
2. **Denormalize** per-event stats onto the `events` doc — the real bottleneck is the
   per-event child fan-out.
3. **Sort (Date / Fill / Name) works on every tab** (in-memory, no index constraint).
4. **Search works on every tab** and combines with tab + sort (in-memory substring over
   title + location, case-insensitive).
5. **KPI strip:** numbers only (totals over all the organizer's event docs). No sparklines
   here; 30-day trends live on `/dashboard`.
6. **Tabs by `endsAt`:** Upcoming = `endsAt >= now`, Past = `endsAt < now`, plus **All**.
   Default order within a tab is chronological (Upcoming soonest-first, Past most-recent),
   overridden by the sort control.
7. **Paginator:** shadcn Pagination with real clickable page numbers (Prev / Next + numbered
   links + ellipses), served by an in-memory paginating query.

## Write-path map (from the mapping workflow — the denormalization surface)

Counters maintained: `seatsTaken` (seat-holding rsvps: confirmed / confirmed_pending_claim
/ checked_in), `ticketsSold` (non-cancelled tickets on **paid** orders), `revenueCents`
(sum `payoutCents` over **paid** orders). Maintained by one idempotent
`recomputeEventStats(ctx, eventId)` called after any write that can move them:

| File | Function | When | eventId source |
|---|---|---|---|
| `rsvps.ts` | `rsvp` | after insert (confirmed or waitlist branch) | `event._id` (slug lookup) |
| `rsvps.ts` | `cancelRsvp` | after `promoteNext` (net effect) | `row.eventId` |
| `waitlist.ts` | `sweep` (used by `sweepExpiredClaims` + cron `sweepExpiredClaimsNow`) | per **distinct** affected `hold.eventId` | `hold.eventId` |
| `orders.ts` | `createOrder` | end of handler (covers $0 inline fulfilment) | arg `eventId` |
| `orders.ts` | `createBoxOfficeOrder` | end of handler | arg `eventId` |
| `orders.ts` | `markOrderPaid` | after fulfilment (guard the idempotent no-op) | `order.eventId` |
| `orders.ts` | `refundOrder` | after status/ticket patches | `order.eventId` |
| `events.ts` | `createEvent`, `duplicateEvent` | init counters to 0 on insert | new `_id` |
| `seed.ts` | `seed` | per seeded event (recompute at end) | loop `eventId` |

**Confirmed no-ops (do NOT recompute):** `checkIn`, `claimSpot`, `checkInTicket`,
`checkOutTicket`, `undoCheckIn`, `transferTicket` (status stays within the counted set);
`cancelOrder` (pending only, never counted); `deleteEvent` (doc removed). `promoteNext`,
`buildOrder`, `issueTicketsAndMarkPaid` are helpers — recompute is the **calling
mutation's** responsibility, once, after all its writes.

Capacity edits need **no** counter update (fill is computed in memory from
`seatsTaken`/`capacity` at read time). Title/location edits need no denormalized field
either (search is in-memory over the live `title`/`location`).

**Tooling gaps:** no migrations framework (add `@convex-dev/migrations`), no existing
`.paginate()` / search indexes — none of which this design needs except the migration.

---

## Phase A — denormalization foundation (backend only, no UX change)

Independently shippable and verifiable; also makes the current list query cheaper.

### A1. Schema (`convex/schema.ts`, `events`)
Add three optional numeric fields (optional so the schema deploys before backfill; reads
treat `undefined` as `0`):
- `seatsTaken: v.optional(v.number())`
- `ticketsSold: v.optional(v.number())`
- `revenueCents: v.optional(v.number())`

No new indexes, no search index — Phase B filters/sorts/searches in memory.

### A2. `recomputeEventStats` helper (`convex/lib/eventStats.ts`)
```ts
export async function recomputeEventStats(ctx: MutationCtx, eventId: Id<"events">): Promise<void>
```
- `get` the event; if missing, return (deleted).
- rsvps `by_event` → count seat-holding (`SEAT_HOLDING_STATUSES`) → `seatsTaken`.
- orders `by_event` → paid → `revenueCents = Σ payoutCents`; collect `paidOrderIds`.
- tickets `by_event` → count non-cancelled tickets whose `orderId ∈ paidOrderIds` → `ticketsSold`.
- `patch` the event with the three numbers.
Cost = one event's children per call (same as one slice of the old query), on writes only.

### A3. Wire recompute into mutations
Per the write-path table. Specifics:
- `sweep` (waitlist.ts): accumulate a `Set<Id<"events">>` of every `hold.eventId` touched
  (and any promoted), then recompute each once after the loop.
- `markOrderPaid` / `refundOrder`: recompute only on the real transition (respect their
  early-return idempotency).
- `createEvent` / `duplicateEvent`: set `seatsTaken/ticketsSold/revenueCents = 0` on insert.
- `seed`: recompute per seeded event at the end.

### A4. Backfill migration
- Install `@convex-dev/migrations`; register in `convex/convex.config.ts`.
- Migration `backfillEventStats`: for every event, `recomputeEventStats`. Idempotent;
  runnable via the migrations runner.

### A5. Point the current list query at the denormalized fields
`listMyEventsWithStats` keeps working but reads `seatsTaken/ticketsSold/revenueCents` from
the doc instead of recomputing — dropping most child reads (it still reads each event's
rsvps for the per-row pace spark; that becomes per-page in Phase B). This proves the
counters are correct end-to-end, in the live app, before the UX change. (Do this after the
backfill has run.)

### A6. Testing (Phase A)
convex-test coverage that counters stay correct across the real flows:
- RSVP confirmed → `seatsTaken` +1; waitlisted → no change.
- `cancelRsvp` frees a seat; with a waitlister present, `promoteNext` backfills → net 0.
- `sweep` expiry across **two** events updates **both** events' `seatsTaken`.
- paid order (`createBoxOfficeOrder` / `markOrderPaid`) → `ticketsSold` + `revenueCents`;
  `refundOrder` reverses both; pending / cancelled never count.
- `recomputeEventStats` equals the live `countSeatsTaken` / paid-order aggregation.
- backfill migration produces the same values as recompute on seeded data.

---

## Phase B — numbered pagination UX (built on Phase A)

No new indexes, no search index, no cursors.

### B1. Paginating query (`convex/events.ts`)
```ts
listMyEventsPage({
  tab: "upcoming" | "past" | "all",
  sort: "date" | "fill" | "name",
  search: string,          // "" = no search
  page: number,            // 1-based
  pageSize: number,        // e.g. 10
  now: number,             // client clock for the tab boundary
}) => {
  rows: EnrichedEventRow[]; // the page, enriched
  page: number;            // clamped to [1, pageCount]
  pageCount: number;
  total: number;           // filtered/searched total
}
```
Handler: auth → organizerId (`[]`/empty page when unauthenticated); load all events
`by_organizer`; **filter** by tab (`endsAt >= now` / `< now` / all) and by search
(case-insensitive substring over `title` + `location`); **sort** by the chosen key (date =
`startsAt`, with Upcoming ascending / Past+All descending; fill = `seatsTaken/capacity`
descending; name = `title` `localeCompare` ascending); compute `total`/`pageCount`; clamp
`page`; slice `pageSize`; **enrich only the page's rows** — read each row's rsvps `by_event`
to build the pace `spark` + `deltaPct`; `seatsTaken/ticketsSold/revenueCents/capacity/
status/...` come from the doc. `EnrichedEventRow` is the current `EventRow` minus
`revenueSpark` (KPI-only, now dropped).

### B2. KPI query (`convex/events.ts`)
```ts
getMyEventsKpis({ now }) => {
  total, published, draft, upcoming, attendees, revenueCents, ticketsSold, currency
}
```
Sums the denormalized fields over all the organizer's event docs (`by_organizer`,
O(events), no child reads). Stable args → Convex caches it across page navigation. Numbers
only, over **all** events (independent of the current tab/search/page).

### B3. Frontend (`src/routes/events/index.tsx`)
- **KPI strip**: `useQuery(getMyEventsKpis)` → 4 `StatCard`s with **no** `spark` prop.
- **Tabs**: Upcoming | Past | All (shadcn `Tabs` or the existing `ToggleGroup`). Changing
  tab resets `page` to 1.
- **Sort Select**: Date / Fill / Name, available on **all** tabs. Changing sort resets page.
- **Search `Input`**: debounced; feeds `search`. Non-empty search still respects the active
  tab and sort. Changing search resets page.
- **List**: `useQuery(listMyEventsPage, { tab, sort, search, page, pageSize, now })` →
  render the page's rows (unchanged row: `PaceChart`, fill bar, sales, status, links). The
  Upcoming/Past *sections* collapse into a single paged list per tab (the tab now carries
  the split).
- **Numbered paginator**: shadcn `Pagination` with `PaginationPrevious`, numbered
  `PaginationLink`s (windowed with `PaginationEllipsis` when `pageCount` is large),
  `PaginationNext`; `isActive` on the current page; Prev disabled on page 1, Next on the
  last page; wired to `setPage` (buttons, no navigation). Hidden when `pageCount <= 1`.
- **Empty states**: zero events → existing `Empty`; a search/tab with no matches → inline
  "No events match" message; `total === 0` hides the paginator.
- Install the shadcn `pagination` component (standard registry, `radix-nova` style).

### B4. Testing (Phase B)
- `listMyEventsPage`: tab boundary by `endsAt`; each sort orders correctly; search matches
  title **and** location, case-insensitive; `page` clamps; `pageCount`/`total` correct;
  page slice size honored; unauth → empty page; per-row `spark` still ends at `seatsTaken`.
- `getMyEventsKpis`: totals equal the denormalized sums; unauth → zeros.
- Frontend (browser): tabs switch, numbered pages jump, sort on every tab, search combines,
  no horizontal scroll.

---

## Rollout / ordering

1. Ship **Phase A** (schema fields + helper + wiring + migration), run the backfill, verify
   counters correct in the running app (dashboard + current list unaffected).
2. Then **Phase B** (paginating query + KPI query + numbered-pagination frontend).

New **optional** schema fields are additive and backward compatible; the backfill is
idempotent and re-runnable. Point the current list query at the denormalized fields (A5)
only after the backfill has run.

## Out of scope (YAGNI)

- Cursor pagination / infinite scroll (numbered pages chosen).
- Sort/search indexes and a Convex search index (in-memory over denormalized docs instead).
- The "cached ordered-ids + light per-page enrichment" read optimization (note it, apply
  only if per-page event-doc reads ever become a cost concern).
- KPI sparklines on this page (decision 5).
- Reconciling `convex/analytics.ts`'s separate date-bucketing (tracked follow-up).
