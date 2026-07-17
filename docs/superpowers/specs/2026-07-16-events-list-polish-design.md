# Events list polish — design

**Date:** 2026-07-16
**Branch:** `feat/headless-ticketing-f22`
**Surface:** `/events` (`src/routes/events/index.tsx`)

## Problem

The events **list** page is a bare shadcn table — Title / Status / Capacity, one flat
list, no dates, no fill, no charts, no controls. It has not caught up to the recently
polished dashboard (KPI stat cards with sparklines + trend deltas, gradient area-chart
metric cards, capacity bars). This makes the operator's home for their events feel a
tier below the rest of the product.

Goal: rebuild `/events` into a premium, chart-forward operator cockpit that is the
dashboard's sibling, on real data, without regressing the dashboard.

## Decisions (locked with the user)

1. **Target:** the events list `/events` (not the `$id` builder, not the public page).
2. **Layout:** premium **data table** (dense, scannable, operator-focused), not a card grid.
3. **Interactivity:** **full operator table** — search + status filter + sortable columns
   + an Upcoming / Past split.
4. **Per-row chart:** a **pace-to-capacity** performance chart — cumulative registrations
   climbing toward the event's `capacity`.
5. **Sales column:** **yes** — per-row tickets sold + revenue.
6. **Header "Sign out" button:** **drop it** (the sidebar already has sign-out).

## Architecture

Three units, each independently understandable and testable:

1. **Backend query** — `events.listMyEventsWithStats` enriches each event with the stats
   the UI needs. Owner-scoped, reactive.
2. **Shared presentational components** — `Sparkline` and `StatCard` extracted from
   `dashboard.tsx` so both pages render identically. A new `PaceChart` row component.
3. **Events page** — `src/routes/events/index.tsx` rebuilt: KPI strip, controls,
   grouped/sortable/filterable table. All list interaction is client-side over the loaded
   data (no refetch on type/sort/filter).

### Data flow

```
listMyEventsWithStats (Convex, reactive)
        │  per-event: fields + seatsTaken + ticketsSold + revenueCents + spark[] + deltaPct
        ▼
EventsListContent (useSuspenseQuery)
        │  derive KPI aggregates + apply search/filter/sort + split upcoming/past (client-side, useMemo)
        ▼
KPI strip (StatCard×4)   +   Upcoming table   +   Past table   (rows: Event · Date · Trend · Fill · Sales · Status)
```

## Unit 1 — Backend: `events.listMyEventsWithStats`

New reactive query in `convex/events.ts`, owner-scoped (returns `[]` when unauthenticated,
mirroring `listMyEvents`). For each of the organizer's events it returns:

| field | source | drives |
|---|---|---|
| `_id, title, slug, location, startsAt, endsAt, status, capacity, currency` | event doc | columns / links |
| `seatsTaken` | `countSeatsTaken(ctx, e._id)` (`convex/lib/capacity.ts`) | fill bar numerator |
| `ticketsSold` | count of that event's sold tickets | sales column |
| `revenueCents` | sum of `payoutCents` over that event's **paid** orders | sales column + KPI |
| `spark: number[]` | cumulative registrations per bucket, trailing 30d (see below) | row pace chart |
| `deltaPct: number \| null` | regs last 30d vs prior 30d (`null` when prior == 0) | optional row trend badge |

**Aggregation:** load `rsvps` / `tickets` / `orders` per event via the `by_event` index
(same pattern as `dashboard.getOverview`, but kept per-event rather than flattened). Cost
is O(the organizer's rsvps + tickets + orders), same order as the dashboard.

**Pace spark (`spark[]`):**
- Bucket registrations into the trailing 30-day daily window (reuse the dashboard's
  `buildEmptyTimeseries` / `toUtcDateString`).
- Count the **same registrations `countSeatsTaken` counts** (confirmed + pending-claim +
  checked-in RSVPs, plus sold tickets), so the curve's right edge equals `seatsTaken` and
  agrees with the fill bar.
- Return the **cumulative running total**, seeded with the count of qualifying
  registrations older than the window, so the final point == `seatsTaken` even when the
  event has pre-window history (seed data spreads ~50 days).
- The row chart fixes its y-domain to `[0, capacity]`, so curve height reads as fullness
  and a near-sold-out event visibly approaches the top.

### Shared timeseries helpers

`dashboard.ts` currently owns `buildEmptyTimeseries`, `toUtcDateString`,
`fromUtcDateString`, `MS_PER_DAY`, `TIMESERIES_DAYS`. Extract these into
`convex/lib/timeseries.ts` and import from both `dashboard.ts` and `events.ts`. Pure move,
no behaviour change — dashboard output must be byte-identical after the extraction.

## Unit 2 — Shared components

- **Extract** `Sparkline` (`dashboard.tsx:382`) → `src/components/sparkline.tsx`.
- **Extract** `StatCard` (`dashboard.tsx:410`) → `src/components/stat-card.tsx`.
  Dashboard imports them; its render is unchanged.
- **New** `PaceChart` (row performance chart) in `src/components/pace-chart.tsx`: a small
  recharts area, no axes/grid/tooltip at rest, y-domain `[0, capacity]`, cumulative series.
  A light dashed cap reference is optional; height reads fullness on its own. Kept separate
  from `Sparkline` because its semantics (cumulative, capacity-bounded) differ.

## Unit 3 — Events page (`src/routes/events/index.tsx`)

Rendered in `DashboardLayout wide`. `useSuspenseQuery(listMyEventsWithStats)` with a table
skeleton fallback.

- **KPI strip** — 4 `StatCard`s: **Events** (`n`, `p published · d draft`), **Upcoming**
  (`n`, `Next in Xd`), **Attendees** (Σ seatsTaken), **Revenue** (Σ revenueCents in the
  organizer's majority currency). Sparkline footers where a series is meaningful (Attendees
  and Revenue from summed per-event series); count-type cards may omit the spark.
- **Controls row** — search input (matches title + location), status filter
  (All / Published / Draft) as a segmented control, sort dropdown (Date · Fill · Name).
  All client-side via `useMemo` over the loaded list; no refetch.
- **Grouped table** — `Upcoming (n)` (endsAt ≥ now) then `Past (n)`, each a section with
  a heading + count. Columns:
  **Event** (title + muted location) · **Date** (`formatShortDate(startsAt)`) ·
  **Trend** (`PaceChart`, with the `deltaPct` up/down badge beside it when `deltaPct` is
  non-null) · **Fill** (bar + `seatsTaken/capacity`) ·
  **Sales** (ticketsSold + `formatMoney(revenueCents)`) · **Status** badge · chevron.
  The whole row links to `/events/$id`.
- **Default sort** — within each group, Date sort orders **Upcoming soonest-first** and
  **Past most-recent-first**; Fill sorts fullest-first; Name sorts A–Z. The sort control
  reorders within both groups; the Upcoming/Past split itself is fixed.
- **`New event`** button stays in the header; **`Sign out` removed**.
- **Responsive** — at `< md` the Trend + Sales + location columns drop and the row stacks
  to title / date / fill / status; the full grid returns at `md`/`lg`. Page never scrolls
  horizontally.

## Error / edge cases

- **Zero events** → existing `Empty` state ("No events yet" + Create).
- **Event with no registrations** → `PaceChart` renders a flat baseline at 0 (no per-row
  dashed placeholder — too noisy at row scale).
- **Search/filter yields nothing** → inline "No events match" row within the affected section.
- **Only past (or only upcoming) events** → the empty group's section header is hidden.
- **Free / RSVP-only event** → `revenueCents == 0`; sales cell shows `—`, not `$0.00`.
- **Unauthenticated** → query returns `[]`, same as `listMyEvents`.

## Testing

- Convex unit test for `listMyEventsWithStats` in `convex/events.test.ts` style:
  - empty organizer → `[]`;
  - `seatsTaken` == qualifying registrations and == `spark` final value;
  - `spark` is monotonic non-decreasing (cumulative) and length == window size;
  - `revenueCents` counts only paid orders; free event → `0`;
  - `deltaPct` is `null` when the prior window is empty.
- Confirm `dashboard.getOverview` output is unchanged after the timeseries-helper extraction
  (existing dashboard tests must still pass).
- Verify end-to-end against seed data: dev server, `/events` renders KPI strip, both groups,
  per-row pace charts, and search/filter/sort behave.

## Out of scope (YAGNI)

- Pagination / virtualization (fine until the list is large; revisit past ~100 events).
- Bulk actions (multi-select, bulk publish/delete).
- Saved views / column customization.
- Card-grid view toggle.
