# Passline → Headless Ticketing — F8: Analytics dashboard

- **Date:** 2026-07-13
- **Status:** Approved design (autonomous loop)
- **Slice:** F8 — real revenue/sales/check-in analytics over the F3a orders + tickets.

## 1. Goal

Give organizers a real-time per-event analytics view: revenue (gross / fees / net payout),
tickets sold, orders by status, check-in pacing, sales over time, and a per-ticket-type
breakdown — all computed from real order/ticket data (no mock data), plus a financial CSV export.

## 2. Scope

**In:** organizer-scoped Convex analytics queries (`getEventSummary`, `getSalesTimeseries`); an
**Analytics** tab on the event page with stat tiles + a sales-over-time chart (shadcn `Chart`) +
a per-ticket-type table; an orders CSV export.

**Out:** org-wide (multi-event) dashboards; funnels/retention/cohorts; live-visitor tracking;
scheduled report emails; the headless HTTP analytics endpoint (a later slice can expose these
over `/v1`).

## 3. Functions — `convex/analytics.ts` (all organizer-auth'd + event-ownership-checked)

- `getEventSummary({ eventId })` → aggregates over the event's orders + tickets:
  ```
  {
    revenue: { grossCents, feeCents, netPayoutCents },   // over PAID orders only
    orders:  { paid, pending, cancelled },
    ticketsSold,          // tickets rows (status != cancelled) — i.e. issued
    checkedIn,            // tickets status "checked_in"
    capacity,             // event.capacity
    byTicketType: [{ ticketTypeId, name, sold, revenueCents }],  // sold = tickets per type; revenue over paid orders' items
    currency,
  }
  ```
  (Paid-order revenue uses each order's `subtotalCents`/`feeCents`/`payoutCents`; `ticketsSold`
  counts issued `tickets`; per-type `sold` counts `tickets` grouped by `ticketTypeId`.)
- `getSalesTimeseries({ eventId })` → daily buckets over paid orders:
  `[{ date: "YYYY-MM-DD", orders, revenueCents }]` sorted ascending, covering the range from the
  first paid order to today (dense — zero-filled days), in the event's local sense (UTC date of
  `paidAt` is fine for F8). Cap at the last 90 days to bound the payload.

Both read via the existing `by_event` indexes (`orders`, `tickets`, `orderItems`); keep the
aggregation O(orders+tickets) — no per-row extra queries.

## 4. Dashboard UI — Analytics tab on `events/$id.index.tsx`

Add an **Analytics** tab. `AnalyticsPanel.tsx`:
- **Stat tiles** (shadcn `Card`): Net revenue (`formatMoney(netPayoutCents)`), Tickets sold
  (`ticketsSold / capacity`), Checked in (`checkedIn / ticketsSold`), Paid orders. `Skeleton`
  while loading; a small `Empty`/"No sales yet" state when there are zero paid orders.
- **Sales over time**: shadcn `Chart` (`ChartContainer` + Recharts area/bar) of daily
  `revenueCents` (formatted) from `getSalesTimeseries`. Use `ChartConfig` + the theme's chart CSS
  vars (semantic `--chart-1` etc.) — no raw hex. Tooltip via `ChartTooltip`/`ChartTooltipContent`.
- **By ticket type**: a `Table` (name, sold, revenue via `formatMoney`).
- **Export CSV**: a button that downloads an orders CSV (order token, buyer, status, gross,
  fee, net, promo, created) built client-side from a `listOrdersForEvent`-style read (extend
  that query to include the money columns if needed, or add `analytics.listOrdersForExport`).

Charts must follow good dataviz hygiene: semantic chart tokens, axis labels, a legend only if >1
series, currency-formatted values, and a `max-h`/responsive container.

## 5. Testing (TDD)

`convex/analytics.test.ts` (seed via real free + (simulated-paid) orders — for paid revenue,
create an order then call the internal `markOrderPaid`, or seed paid orders directly with items;
free orders are already `paid`):
- `getEventSummary`: revenue sums only paid orders (pending/cancelled excluded); `ticketsSold`
  counts issued tickets and excludes cancelled; `checkedIn` counts checked-in; `byTicketType`
  groups correctly; owner-only (foreign organizer rejected).
- `getSalesTimeseries`: buckets paid orders by day, zero-fills gaps, sorted; owner-only.
- Frontend verified by `tsc` + `build`.

## 6. Constraints

Carried: shadcn/ui + shadcn `Chart` (already installed), `Skeleton` loaders (no "Loading…"
text), semantic color tokens (incl. chart tokens — no raw hex), plain `Error`, per-file test
helpers, integer cents, additive (existing 188 tests pass; read-only — no schema change unless a
minor money-column addition to an existing query is needed, which stays additive).

## 7. Delivery

TDD → `pnpm test` + `tsc` + `build` green → push (stacked on F5) → PR → next loop slice
(**F4b access codes + visibility UI**, or **F6 refunds**).
