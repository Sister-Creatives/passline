# Passline → Headless Ticketing — F22: Organizer Overview (dashboard home)

- **Date:** 2026-07-15
- **Status:** Approved design (scope: registration + sales, with a shadcn chart)
- **Slice:** F22 — replace the placeholder `/dashboard` with a real organizer home: org-level KPIs, a
  registrations chart, a sales section (ready for F3b), upcoming events, and recent activity.

## 1. Goal

Give the organizer a genuine at-a-glance home page. Because payments (F3b) aren't wired yet, the page
leads with **registration/attendance** (real data — RSVPs + free tickets + check-ins) and includes a
**sales** section that stays honest ("no sales yet") until Stripe lands. Uses one real **shadcn
chart** (Recharts) for registrations over time.

## 2. Scope

**In:** one owner-scoped aggregate `dashboard.getOverview()` (counts, attendance, sales totals, a
30-day timeseries, next-5 upcoming events, recent activity); an additive `by_organizer` index on
`auditLogs`; a rebuilt `/dashboard` route with KPI cards, a registrations area chart (shadcn
`ChartContainer` + Recharts), a sales section (KPI cards + a revenue chart when sales exist, else an
empty note), an upcoming-events card, a recent-activity feed, a Create-event CTA, and a first-run
empty state.

**Out (follow-ups):** period-over-period deltas (no historical comparison stored); per-event
drill-down from the overview (Events page already exists); denormalized counters (aggregate live for
now); any payment work; a separate sales *chart* while revenue is $0 (the section degrades to a note).

## 3. Data model

**No new tables.** One additive index: `auditLogs.index("by_organizer", ["organizerId"])` (the
`organizerId` field already exists) so the recent-activity feed is a bounded query, not a scan.

## 4. Backend — `convex/dashboard.ts` → `getOverview()`

Owner-scoped (via `getAuthOrganizerId`; returns a zeroed shape when unauthenticated). Loads the
organizer's `events` (`by_organizer`), then aggregates their `rsvps`/`tickets`/`orders` (`by_event`)
and `auditLogs` (`by_organizer`) in memory. `now` is read once at the top for the windows.

```ts
getOverview() -> {
  events: { total: number; published: number; draft: number; upcoming: number },
  attendance: {
    attendees: number;   // confirmed+checked_in RSVPs  +  valid+checked_in tickets, across all events
    checkedIn: number;   // checked_in RSVPs + checked_in tickets
  },
  sales: {
    revenueCents: number; // Σ payoutCents over PAID orders
    orders: number;       // count of PAID orders
    ticketsSold: number;  // tickets belonging to paid orders
    currency: string;     // the most common event currency, default "USD"
  },
  timeseries: Array<{ date: string; registrations: number; revenueCents: number }>, // last 30 UTC days, zero-filled
  upcomingEvents: Array<{ id: Id<"events">; title: string; slug: string; startsAt: number; status: "draft"|"published"; seatsTaken: number; capacity: number }>, // next 5 by startsAt where endsAt >= now
  recentActivity: Array<{ id: Id<"auditLogs">; action: string; summary: string; createdAt: number; eventTitle: string | null }>, // latest 8
}
```

- **timeseries.registrations** per UTC day = `rsvps` created that day (by `_creationTime`) + `tickets`
  created that day; **revenueCents** per day = Σ `payoutCents` of paid orders whose `paidAt` (fallback
  `createdAt`) falls that day. Build 30 zero-filled UTC-date buckets (mirror `analytics.ts`'s
  `toUtcDateString`/`fromUtcDateString`), so the chart always has a continuous x-axis.
- **upcomingEvents.seatsTaken** = the event's seat-holding RSVP count (reuse `countSeatsTaken` from
  `lib/capacity`) — matches the editor's capacity meter.
- **recentActivity** = `auditLogs` `by_organizer` desc, take 8, resolve each `eventId` to a title
  (bounded to 8 gets).
- Cost note: this is O(the organizer's rsvps+tickets+orders). Acceptable at normal scale and mirrors
  `getEventSummary`'s existing per-event fan-out; denormalized counters are a future optimization.

## 5. Frontend — `src/routes/dashboard.tsx`

Rebuild inside `DashboardLayout`. One `useQuery(convexQuery(api.dashboard.getOverview, {}))`; `Skeleton`
grid while pending; if `events.total === 0`, a shadcn `Empty` ("Create your first event" + a Create
CTA). Otherwise:

- **Header:** `<h1>Overview</h1>` + a primary **Create event** `Button` (→ `/events/new`).
- **KPI row** (`grid gap-4 sm:grid-cols-2 lg:grid-cols-4`), each a `Card` with `CardDescription` +
  a `text-3xl tabular-nums` value: **Events** (value `total`, subtext `{published} published · {draft}
  draft`) · **Upcoming** · **Attendees** · **Check-ins**.
- **Registrations chart** — a `Card` spanning full width: shadcn `ChartContainer` + Recharts
  `AreaChart` over `timeseries` (x = `date`, y = `registrations`), colored `var(--chart-1)`,
  `ChartTooltip`/`ChartTooltipContent`, following `src/components/visitors-chart.tsx`'s pattern
  (`ChartConfig`, gradient fill, `CartesianGrid`, `XAxis` with a short date tick). Title "Registrations",
  description "New registrations in the last 30 days." If `Σ registrations === 0`, render an inline
  empty note instead of a flat chart.
- **Sales section** — a labeled block: KPI cards **Revenue** (`formatMoney(revenueCents, currency)`) ·
  **Orders** · **Tickets sold**. When `revenueCents > 0`, also render a revenue `AreaChart`/`BarChart`
  over `timeseries` (`revenueCents`, `var(--chart-2)`); when `0`, a muted note "No sales yet — online
  payments are coming soon."
- **Upcoming events** — a `Card`: the 5 `upcomingEvents` as rows (title link → `/events/$id`, formatted
  date via `formatEventDateRange`/`format-event-date`, a status `Badge`, and a slim capacity progress
  bar `seatsTaken/capacity`). Empty note when none.
- **Recent activity** — a `Card`: the 8 `recentActivity` rows (action `Badge` or icon, `summary`,
  `eventTitle`, relative time). Empty note when none.

Reuse `formatMoney` (`@/lib/format-money`), the event-date formatter, `Badge`, `Card`, `Empty`,
`Skeleton`. New chart components live inline in the route or as small `src/components/overview/*`
components — do NOT resurrect the fake-data template widgets (`visitors-chart`, `online-now`, etc.).

## 6. Testing

- **`convex/dashboard.test.ts`** (new): `getOverview` is owner-scoped (a second organizer sees only
  their own data; unauthenticated gets zeros); event counts split total/published/draft/upcoming
  correctly; attendance counts confirmed/checked-in RSVPs + valid/checked-in tickets; sales sums only
  PAID orders; the timeseries has exactly 30 zero-filled buckets and lands a registration/revenue on
  the right UTC day; `upcomingEvents` returns future events sorted ascending, capped at 5, with the
  right `seatsTaken`; `recentActivity` returns newest-first, capped at 8, with resolved titles. Seed
  via the existing `asOrganizer`/`makeEvent` helpers; inject deterministic timestamps where the day
  bucket matters (patch `_creationTime`/`paidAt` via `t.run`).
- **Frontend** by `pnpm exec tsc --noEmit` + `pnpm build` + a manual drive: an organizer with events/
  RSVPs sees populated KPIs + a registrations chart; a brand-new organizer sees the first-run empty
  state; the sales section shows the "no sales yet" note.

## 7. Constraints

Carried: pnpm only; shadcn/ui for all UI (`Chart`/`ChartContainer` for graphs, `Skeleton` loading,
`Empty` zero-states, no spinners); Recharts via the shadcn `chart` wrapper only; lucide icons; integer
cents + `formatMoney`; plain `Error`; English, no emojis; Conventional Commits; root `tsconfig`
`noUnusedLocals`/`noUnusedParameters` (tsc clean). Additive backend (one index + one query); no
existing query/route/panel changed except the `/dashboard` rebuild. TDD the backend before the UI.

## 8. Delivery

Three tasks: (1) `auditLogs` index + `dashboard.getOverview()` + tests (TDD); (2) the `/dashboard`
rebuild — KPI cards, upcoming/activity lists, empty/loading states; (3) the shadcn registrations chart
(+ conditional sales chart). `pnpm test` + `tsc` + `build` green → drive-verify.
