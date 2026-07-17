# Event performance overview, per-event attendance, and attendees pagination

Date: 2026-07-17
Branch: feat/headless-ticketing-f22
Status: approved (design)

## Goal

Give organizers per-event performance at a glance on the event detail page, stop
the dashboard from mixing attendance across all events into one useless number,
and make the per-event attendees list scale by paginating it.

Three linked, entirely front-end changes. Every value already exists in current
Convex queries, so there are no backend changes.

## Current state

- `src/routes/events/$id.index.tsx` renders the event management page. Its default
  section is `details` (`DetailsSection`), which today shows only a capacity bar
  plus the `EventForm`. A separate `analytics` section renders the full
  `AnalyticsPanel` (net revenue, sales-over-time chart, checked-in, by-ticket-type,
  CSV export), backed by `api.analytics.getEventSummary` and
  `api.analytics.getSalesTimeseries`.
- The `attendees` section (`AttendeesSection`) stacks four separate `AttendeeTable`
  components (Confirmed, Pending claim, Waitlist, Checked in), each rendering every
  row from `api.events.getMyEventWithRsvps`, which returns the full arrays
  (`confirmed`, `pendingClaim`, `waitlisted`, `checkedIn`) to the client.
- `src/routes/dashboard.tsx` shows a 5-up KPI row (Events, Upcoming, **Attendees**,
  Orders, Tickets sold). The "Attendees" tile is `attendance.attendees` — attendance
  summed across all of the organizer's events — with a blended check-in rate, from
  `api.dashboard.getOverview` (`convex/dashboard.ts`).
- `NumberedPagination` is defined locally inside `src/routes/events/index.tsx:245`
  and used only there, alongside `listMyEventsPage`, `PAGE_SIZE = 10`, and
  `placeholderData: (prev) => prev`.

## Decisions

1. Performance overview lands on the **Details view** (default section), shown only
   for **published** events. Reuses the existing analytics queries.
2. The dashboard's aggregate **"Attendees"** tile is **replaced** with a
   **"Check-in rate"** tile. Per-event attendance moves to the Details overview.
3. The attendees section becomes **one unified table** with a status filter, search,
   and a single numbered pager (client-side).

## Design

### 1. EventPerformanceOverview (Details view, published only)

New component `src/components/EventPerformanceOverview.tsx`:

- Props: `{ eventId: Id<"events">; currency: string }`.
- Reads `api.analytics.getEventSummary` and `api.analytics.getSalesTimeseries`
  (the same queries `AnalyticsPanel` uses).
- Renders a 4-tile row mirroring `AnalyticsPanel`'s card style:
  - **Net revenue** — `formatMoney(revenue.netPayoutCents, currency)`.
  - **Tickets sold** — `ticketsSold / capacity` with a progress bar.
  - **Attendance** — `checkedIn` checked in of `ticketsSold`, with a rate% and a bar.
    This is the per-event attendance figure.
  - **Paid orders** — `orders.paid`, sub `orders.pending pending / orders.cancelled cancelled`.
- A compact sales sparkline: a small area chart of the last 14 days of
  `getSalesTimeseries` revenue (reuse the chart primitives already used in
  `AnalyticsPanel`, `isAnimationActive={false}`).
- A "View full analytics" link that routes to the same page with `search.section = "analytics"`.
- Zero-sales published events render honest zero tiles (revenue $0, 0/capacity,
  0 checked in, 0 orders) rather than an empty placeholder — the overview is always
  present once the event is live.
- Guards divide-by-zero exactly as `AnalyticsPanel` does (`capacity > 0`,
  `ticketsSold > 0`).

`DetailsSection` in `events/$id.index.tsx` branches on `event.status`:

- Published: render `EventPerformanceOverview` at the top (it subsumes the capacity
  display via its Tickets-sold tile — the standalone capacity bar is not rendered).
- Draft: keep the current standalone capacity bar (nothing to report pre-publish).
- Both: render `EventForm` below, unchanged.

### 2. Dashboard "Check-in rate" tile

In `src/routes/dashboard.tsx`, replace the `Attendees` `StatCard` with:

- `label="Check-in rate"`, `value={`${checkInRate}%`}` (the `checkInRate` value is
  already computed in the component from `attendance`).
- `sub={`${formatInteger(attendance.checkedIn)} of ${formatInteger(attendance.attendees)} checked in`}`.
- Omit `deltaPct` and `spark` on this tile: the existing `cards.attendees.spark`/
  `deltaPct` track the attendee *count* trend and would mislabel a *rate*. (`StatCard`
  must render cleanly without `deltaPct`/`spark`; verify and, if needed, make those
  props optional.)

No backend change: `convex/dashboard.ts` still returns `attendance` and `cards`;
the frontend simply stops rendering the raw count and renders the rate instead.

### 3. Unified attendees table with pagination

Refactor `AttendeesSection` (in `events/$id.index.tsx`) to a single table:

- Merge the four arrays from `getMyEventWithRsvps` into one list, each row tagged
  with a bucket derived from *which array it came from* (`confirmed` | `pending` |
  `waitlist` | `checkedIn`) rather than trusting a per-row status field. Display the
  bucket via a small label map (reuse/extend the existing `STATUS_LABEL` styling).
- **Status filter**: a segmented `ToggleGroup` (matching the scan page's toggle
  style) with options All / Confirmed / Pending / Waitlist / Checked-in, each showing
  its count. Default All.
- **Search**: a text input filtering by name or email (case-insensitive), client-side.
- **Table columns**: Name, Email, Status, Action. The Cancel action (existing
  `cancelRsvp` alert-dialog flow) is rendered only for `confirmed` rows.
- **Pagination**: a single `NumberedPagination` (client-side), `PAGE_SIZE = 10`.
  Reset to page 1 whenever the filter or search changes.
- **Export CSV**: unchanged behaviour — exports all attendees across all statuses
  (not just the current filter/page).
- Empty states: distinguish "no attendees at all" from "no rows match this
  filter/search".

### Shared: NumberedPagination + filter/paginate helper

- Extract `NumberedPagination` from `events/index.tsx` into
  `src/components/numbered-pagination.tsx` (unchanged behaviour) and import it in
  both `events/index.tsx` and the attendees table. This removes duplication and is
  the single pager for both surfaces.
- Add a small pure helper (e.g. in `src/lib/`) that takes the merged attendee list,
  a status filter, a search string, a page, and a page size, and returns
  `{ rows, page, totalPages, total }`. Pure and unit-testable.

## Data sources (no backend changes)

- `api.analytics.getEventSummary` — revenue, orders (paid/pending/cancelled),
  ticketsSold, checkedIn, capacity, byTicketType, currency.
- `api.analytics.getSalesTimeseries` — daily revenueCents.
- `api.events.getMyEventWithRsvps` — event + the four attendee arrays.
- `api.dashboard.getOverview` — attendance + cards (unchanged).

## Isolation

- `EventPerformanceOverview`: self-contained, read-only, depends only on the two
  analytics queries. Testable/understandable on its own.
- `NumberedPagination`: shared presentational component, no data dependency.
- Attendee filter/paginate helper: pure function, unit-testable.
- `DetailsSection` / `AttendeesSection`: local branching and composition only.
- Dashboard: a one-tile prop swap.

## Testing

- No backend changes, so all existing tests (including `convex/dashboard.test.ts`,
  which asserts `attendance.attendees`) remain valid and must stay green.
- Add a unit test for the attendee filter/paginate helper: status filtering, search
  matching, page slicing, and page-count math, including empty-result cases.
- Verify `tsc`, `pnpm build`, and `pnpm test` after implementation.

## Edge cases

- Published event with no sales: overview shows zero tiles, not an empty state.
- Capacity 0 / unlimited: guard divide-by-zero (mirror `AnalyticsPanel`).
- Attendees filter/search yielding zero rows: show a "no matching attendees" empty
  state, distinct from the "no attendees yet" state.
- Changing filter or search resets pagination to page 1.
- Cancel action only appears on confirmed rows in the unified table.

## Out of scope

- Server-side attendee pagination (current data already loads fully client-side;
  revisit only if events reach very large attendee counts).
- Any backend query changes, including a check-in-rate delta/sparkline for the
  dashboard tile (would require new backend aggregation).
- Changes to the standalone global `/attendees` route.
