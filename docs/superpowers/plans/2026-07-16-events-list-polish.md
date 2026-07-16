# Events List Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/events` from a bare table into a premium, chart-forward operator cockpit (KPI strip, search/filter/sort, Upcoming/Past split, per-row pace-to-capacity charts), on real data.

**Architecture:** One new reactive Convex query (`events.listMyEventsWithStats`) enriches each event with seat/sales stats plus cumulative registration and revenue series. The dashboard's timeseries primitives and its `Sparkline`/`StatCard` are extracted to shared modules so both pages render identically. The page derives KPI aggregates and applies all search/filter/sort/split client-side over the loaded list (no refetch).

**Tech Stack:** Convex (queries), TanStack Router + React Query, React, recharts, shadcn/ui (Table, Card, Input, ToggleGroup, Select, Badge), Tailwind v4, Vitest (+ convex-test).

## Global Constraints

- **House editorial rules:** Australian English, no em/en dashes, no exclamation marks in info copy, sentence case.
- **Owner-scoped queries return `[]` (not throw) when unauthenticated** — mirror `events.listMyEvents`.
- **The dashboard must not regress** — after any extraction, `dashboard.getOverview` output and the `/dashboard` render are unchanged.
- **Seats are RSVP-derived** — `seatsTaken` and the pace chart count seat-holding RSVPs only (confirmed / confirmed_pending_claim / checked_in), matching `countSeatsTaken`. Tickets/orders are the separate paid channel feeding `ticketsSold` / `revenueCents`.
- **Package manager:** pnpm. Tests: `pnpm test` (vitest run). Build: `pnpm build`. Typecheck: `npx tsc --noEmit`.
- **tsconfig has `noUnusedLocals` + `noUnusedParameters` ON** — `npx tsc --noEmit` fails on any unused import, variable, or parameter. After deleting inline code (Task 3) prune the now-dangling imports; in Task 5 import only what you use. `tsc` must exit 0.
- **No em/en dashes anywhere the user sees** — use a plain hyphen `-` or a middle dot `·` for separators/placeholders. (Existing code comments that already use `—` may be moved verbatim.)

---

## File Structure

**Create:**
- `convex/lib/timeseries.ts` — shared UTC-day bucketing primitives (`MS_PER_DAY`, `TIMESERIES_DAYS`, `toUtcDateString`, `fromUtcDateString`, `buildDateWindow`).
- `convex/lib/timeseries.test.ts` — unit test for `buildDateWindow`.
- `src/components/sparkline.tsx` — the axis-less gradient area spark (moved from dashboard).
- `src/components/stat-card.tsx` — the KPI card (moved from dashboard; `spark` made optional).
- `src/components/pace-chart.tsx` — cumulative pace-to-capacity row chart (y-domain `[0, capacity]`).
- `src/lib/format-date.ts` — `formatShortDate`, `formatRelative` (moved from dashboard).

**Modify:**
- `convex/dashboard.ts` — import the shared timeseries primitives; delete the local copies.
- `convex/events.ts` — add `listMyEventsWithStats`.
- `convex/events.test.ts` — add query tests.
- `src/routes/dashboard.tsx` — import `Sparkline`/`StatCard`/date helpers from the new modules; delete the inline copies.
- `src/routes/events/index.tsx` — full rebuild.

---

## Task 1: Extract shared timeseries primitives (dashboard-neutral refactor)

**Files:**
- Create: `convex/lib/timeseries.ts`
- Create: `convex/lib/timeseries.test.ts`
- Modify: `convex/dashboard.ts:5-19,29-41` (constants + `toUtcDateString`/`fromUtcDateString`/`buildEmptyTimeseries`)

**Interfaces:**
- Produces: `MS_PER_DAY: number`, `TIMESERIES_DAYS: number`, `toUtcDateString(ms: number): string`, `fromUtcDateString(dateStr: string): number`, `buildDateWindow(now: number, days?: number): string[]` (last `days` UTC-day date strings incl. today, oldest first).

- [ ] **Step 1: Write the failing test**

Create `convex/lib/timeseries.test.ts`:

```ts
import { expect, test } from "vitest";
import { buildDateWindow, toUtcDateString, fromUtcDateString, TIMESERIES_DAYS } from "./timeseries";

test("buildDateWindow returns `days` UTC date strings, oldest first, ending today", () => {
  const now = Date.UTC(2026, 6, 16, 9, 30); // 2026-07-16T09:30Z
  const window = buildDateWindow(now, 30);
  expect(window).toHaveLength(30);
  expect(window[29]).toBe("2026-07-16");
  expect(window[0]).toBe("2026-06-17");
  // strictly increasing, one UTC day apart
  for (let i = 1; i < window.length; i++) {
    expect(fromUtcDateString(window[i]) - fromUtcDateString(window[i - 1])).toBe(24 * 60 * 60 * 1000);
  }
});

test("buildDateWindow defaults to TIMESERIES_DAYS", () => {
  const window = buildDateWindow(Date.UTC(2026, 0, 1));
  expect(window).toHaveLength(TIMESERIES_DAYS);
});

test("toUtcDateString/fromUtcDateString round-trip at UTC midnight", () => {
  expect(toUtcDateString(fromUtcDateString("2026-07-16"))).toBe("2026-07-16");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test convex/lib/timeseries.test.ts`
Expected: FAIL — cannot resolve `./timeseries`.

- [ ] **Step 3: Create the shared module**

Create `convex/lib/timeseries.ts`:

```ts
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const TIMESERIES_DAYS = 30;

/** UTC "YYYY-MM-DD" for a given epoch-ms timestamp. */
export function toUtcDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Epoch-ms (UTC midnight) for a "YYYY-MM-DD" date string. */
export function fromUtcDateString(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** The last `days` UTC-day date strings (including today), oldest first. */
export function buildDateWindow(now: number, days: number = TIMESERIES_DAYS): string[] {
  const todayMs = fromUtcDateString(toUtcDateString(now));
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(toUtcDateString(todayMs - i * MS_PER_DAY));
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test convex/lib/timeseries.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Rewire `dashboard.ts` onto the shared module**

In `convex/dashboard.ts`:
- Add to the imports at the top:

```ts
import { MS_PER_DAY, TIMESERIES_DAYS, toUtcDateString, fromUtcDateString, buildDateWindow } from "./lib/timeseries";
```

- Delete the now-duplicated local declarations: `const MS_PER_DAY = ...` (line 5), `const TIMESERIES_DAYS = ...` (line 6), `function toUtcDateString(...)` (lines 10-13), `function fromUtcDateString(...)` (lines 15-19). Keep `UPCOMING_LIMIT` and `ACTIVITY_LIMIT`.
- Replace the body of `buildEmptyTimeseries` (lines 29-41) with a map over `buildDateWindow`, keeping the local `TimeseriesBucket` type:

```ts
/** The last 30 UTC-day buckets (including today), zero-filled, oldest first. */
function buildEmptyTimeseries(now: number): TimeseriesBucket[] {
  return buildDateWindow(now).map((date) => ({
    date,
    registrations: 0,
    checkIns: 0,
    revenueCents: 0,
  }));
}
```

- [ ] **Step 6: Run the full suite (dashboard must be unchanged)**

Run: `pnpm test`
Expected: PASS — all existing tests (incl. any dashboard tests) plus the 3 new timeseries tests. Then `npx tsc --noEmit` → no new errors.

- [ ] **Step 7: Commit**

```bash
git add convex/lib/timeseries.ts convex/lib/timeseries.test.ts convex/dashboard.ts
git commit -m "refactor(convex): extract shared timeseries primitives"
```

---

## Task 2: `events.listMyEventsWithStats` query

**Files:**
- Modify: `convex/events.ts` (add query after `listMyEvents`, ~line 310; add one import)
- Test: `convex/events.test.ts` (append tests)

**Interfaces:**
- Consumes: `buildDateWindow`, `fromUtcDateString`, `toUtcDateString`, `MS_PER_DAY` from `./lib/timeseries`; `SEAT_HOLDING_STATUSES` from `./lib/constants`; `getAuthOrganizerId` from `./auth`.
- Produces: `api.events.listMyEventsWithStats` → `Array<{ _id: Id<"events">; title: string; slug: string; location: string; startsAt: number; endsAt: number; status: "draft" | "published"; capacity: number; currency: string; seatsTaken: number; ticketsSold: number; revenueCents: number; spark: number[]; revenueSpark: number[]; deltaPct: number | null }>` (empty array when unauthenticated). `spark` is cumulative seat-holding registrations (length 30, monotonic non-decreasing, final element === `seatsTaken`); `revenueSpark` is cumulative paid revenue in cents (final element === `revenueCents`).

- [ ] **Step 1: Write the failing tests**

Append to `convex/events.test.ts`:

```ts
test("listMyEventsWithStats returns [] when unauthenticated", async () => {
  const t = convexTest(schema, modules);
  const rows = await t.query(api.events.listMyEventsWithStats, {});
  expect(rows).toEqual([]);
});

test("listMyEventsWithStats: seatsTaken and cumulative pace spark", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Rooftop Jazz", description: "x", startsAt: 100, endsAt: 200, location: "Rooftop", capacity: 80,
  });

  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  // 3 seat-holding rsvps in the window, 1 waitlisted (does NOT hold a seat).
  await t.run(async (ctx) => {
    await ctx.db.insert("rsvps", { eventId, name: "A", email: "a@x.co", token: "t1", status: "confirmed", createdAt: now - 5 * DAY });
    await ctx.db.insert("rsvps", { eventId, name: "B", email: "b@x.co", token: "t2", status: "checked_in", createdAt: now - 2 * DAY });
    await ctx.db.insert("rsvps", { eventId, name: "C", email: "c@x.co", token: "t3", status: "confirmed_pending_claim", createdAt: now - 1 * DAY });
    await ctx.db.insert("rsvps", { eventId, name: "D", email: "d@x.co", token: "t4", status: "waitlisted", waitlistPosition: 1, createdAt: now - 1 * DAY });
  });

  const [row] = await as.query(api.events.listMyEventsWithStats, {});
  expect(row.seatsTaken).toBe(3);
  expect(row.spark).toHaveLength(30);
  // cumulative: non-decreasing, ends at seatsTaken
  for (let i = 1; i < row.spark.length; i++) expect(row.spark[i]).toBeGreaterThanOrEqual(row.spark[i - 1]);
  expect(row.spark[row.spark.length - 1]).toBe(3);
  // prior window empty -> deltaPct is null
  expect(row.deltaPct).toBeNull();
});

test("listMyEventsWithStats: revenue and ticketsSold count only paid orders", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Paid Gig", description: "x", startsAt: 100, endsAt: 200, location: "Hall", capacity: 50,
  });
  const organizerId = (await t.run((ctx) => ctx.db.get(eventId)))!.organizerId;

  await t.run(async (ctx) => {
    const ticketTypeId = await ctx.db.insert("ticketTypes", {
      eventId, name: "GA", kind: "paid", priceCents: 2000, sold: 0,
      visibility: "visible", sortOrder: 0, status: "active",
    });
    const base = { eventId, organizerId, buyerName: "Bo", buyerEmail: "bo@x.co", currency: "USD",
      feeMode: "absorb" as const, subtotalCents: 2000, feeCents: 0, totalCents: 2000, createdAt: Date.now() };
    const paid = await ctx.db.insert("orders", { ...base, status: "paid", payoutCents: 2000, token: "o1", paidAt: Date.now() });
    await ctx.db.insert("orders", { ...base, status: "pending", payoutCents: 2000, token: "o2" });
    await ctx.db.insert("tickets", { orderId: paid, eventId, ticketTypeId, code: "TK1", status: "valid", createdAt: Date.now() });
  });

  const [row] = await as.query(api.events.listMyEventsWithStats, {});
  expect(row.revenueCents).toBe(2000);
  expect(row.ticketsSold).toBe(1);
  expect(row.revenueSpark[row.revenueSpark.length - 1]).toBe(2000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test convex/events.test.ts`
Expected: FAIL — `api.events.listMyEventsWithStats` is not a function.

- [ ] **Step 3: Add the imports**

In `convex/events.ts`, extend the existing imports:

```ts
import { SEAT_HOLDING_STATUSES } from "./lib/constants";
import { MS_PER_DAY, buildDateWindow, fromUtcDateString, toUtcDateString } from "./lib/timeseries";
```

- [ ] **Step 4: Implement the query**

Insert into `convex/events.ts` immediately after the `listMyEvents` query (after its closing `});`, ~line 310):

```ts
/**
 * Owner-scoped events list enriched for the `/events` cockpit.
 *
 * Per event: raw display fields plus a live `seatsTaken` (seat-holding RSVPs,
 * matching `countSeatsTaken`), the paid-channel `ticketsSold` / `revenueCents`,
 * a cumulative "pace to capacity" registration series (`spark`, right edge ==
 * `seatsTaken`), a cumulative paid-revenue series (`revenueSpark`, right edge ==
 * `revenueCents`), and a 30d-vs-prior-30d registration `deltaPct` (null when the
 * prior window is empty). Fans out over `by_event` like `dashboard.getOverview`,
 * kept per-event rather than flattened. Returns [] when unauthenticated.
 */
export const listMyEventsWithStats = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return [];

    const events = await ctx.db
      .query("events")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .order("desc")
      .collect();

    const window = buildDateWindow(now);
    const windowStartMs = fromUtcDateString(window[0]);
    const seatHolding = (status: string) =>
      (SEAT_HOLDING_STATUSES as readonly string[]).includes(status);

    return Promise.all(
      events.map(async (e) => {
        const [rsvps, tickets, orders] = await Promise.all([
          ctx.db.query("rsvps").withIndex("by_event", (q) => q.eq("eventId", e._id)).collect(),
          ctx.db.query("tickets").withIndex("by_event", (q) => q.eq("eventId", e._id)).collect(),
          ctx.db.query("orders").withIndex("by_event", (q) => q.eq("eventId", e._id)).collect(),
        ]);

        // Seat-holding registrations (the capacity source of truth).
        const seats = rsvps.filter((r) => seatHolding(r.status));
        const seatsTaken = seats.length;

        // Cumulative pace-to-capacity spark. Registrations older than the
        // window seed the baseline so the final point still equals seatsTaken.
        const regTime = (r: (typeof seats)[number]) => r.createdAt ?? r._creationTime;
        const dayCounts = new Map(window.map((d) => [d, 0]));
        let regBaseline = 0;
        for (const r of seats) {
          const t = regTime(r);
          const key = toUtcDateString(t);
          if (t < windowStartMs || !dayCounts.has(key)) regBaseline += 1;
          else dayCounts.set(key, dayCounts.get(key)! + 1);
        }
        let regRunning = regBaseline;
        const spark = window.map((d) => (regRunning += dayCounts.get(d)!));

        // Paid channel: revenue + tickets sold, and a cumulative revenue spark.
        const paidOrders = orders.filter((o) => o.status === "paid");
        const paidOrderIds = new Set(paidOrders.map((o) => o._id));
        const revenueCents = paidOrders.reduce((sum, o) => sum + o.payoutCents, 0);
        const ticketsSold = tickets.filter((t) => paidOrderIds.has(t.orderId)).length;

        const revByDay = new Map(window.map((d) => [d, 0]));
        let revBaseline = 0;
        for (const o of paidOrders) {
          const t = o.paidAt ?? o.createdAt;
          const key = toUtcDateString(t);
          if (t < windowStartMs || !revByDay.has(key)) revBaseline += o.payoutCents;
          else revByDay.set(key, revByDay.get(key)! + o.payoutCents);
        }
        let revRunning = revBaseline;
        const revenueSpark = window.map((d) => (revRunning += revByDay.get(d)!));

        // Registrations last 30d vs the prior 30d.
        const windowMs = 30 * MS_PER_DAY;
        const curStart = now - windowMs;
        const prevStart = now - 2 * windowMs;
        const cur = seats.filter((r) => regTime(r) >= curStart).length;
        const prev = seats.filter((r) => {
          const t = regTime(r);
          return t >= prevStart && t < curStart;
        }).length;
        const deltaPct = prev === 0 ? null : ((cur - prev) / prev) * 100;

        return {
          _id: e._id,
          title: e.title,
          slug: e.slug,
          location: e.location,
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          status: e.status,
          capacity: e.capacity,
          currency: e.currency ?? "USD",
          seatsTaken,
          ticketsSold,
          revenueCents,
          spark,
          revenueSpark,
          deltaPct,
        };
      }),
    );
  },
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test convex/events.test.ts`
Expected: PASS — the 3 new tests plus all pre-existing `events.test.ts` tests. Then `npx tsc --noEmit` → no new errors.

- [ ] **Step 6: Commit**

```bash
git add convex/events.ts convex/events.test.ts
git commit -m "feat(events): listMyEventsWithStats with pace + sales stats"
```

---

## Task 3: Extract shared `Sparkline`, `StatCard`, and date helpers

**Files:**
- Create: `src/components/sparkline.tsx`
- Create: `src/components/stat-card.tsx`
- Create: `src/lib/format-date.ts`
- Modify: `src/routes/dashboard.tsx` (remove inline `Sparkline`, `StatCard`, `formatShortDate`, `formatRelative`, `RELATIVE_UNITS`; import them instead)

**Interfaces:**
- Produces: `Sparkline({ data: number[] })`; `StatCard({ label: string; value: string | number; sub?: string; deltaPct?: number | null; spark?: number[] })` (renders the sparkline footer only when `spark` is provided; renders the delta badge only when `deltaPct` is non-null); `formatShortDate(ms: number): string`; `formatRelative(ms: number): string`.

- [ ] **Step 1: Create `src/lib/format-date.ts`**

```ts
/** "Sat, Jul 20, 3:00 PM" — a compact local date+time. */
export function formatShortDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 1000 * 60 * 60 * 24 * 365],
  ["month", 1000 * 60 * 60 * 24 * 30],
  ["day", 1000 * 60 * 60 * 24],
  ["hour", 1000 * 60 * 60],
  ["minute", 1000 * 60],
];

/** "2h ago" / "in 3 days" for a timestamp, relative to now. */
export function formatRelative(ms: number): string {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  for (const [unit, unitMs] of RELATIVE_UNITS) {
    if (abs >= unitMs) {
      const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
      return rtf.format(Math.round(diff / unitMs), unit);
    }
  }
  return "just now";
}
```

- [ ] **Step 2: Create `src/components/sparkline.tsx`**

Move the `Sparkline` function from `dashboard.tsx` verbatim, exported:

```tsx
import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

/** A tiny gradient area chart with no axes/grid/tooltip, for a stat card footer. */
export function Sparkline({ data }: { data: number[] }) {
  const gradientId = `spark-${useId().replace(/:/g, "")}`;
  const points = data.map((v, i) => ({ i, v }));
  return (
    <div className="h-12 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            dataKey="v"
            type="monotone"
            stroke="var(--primary)"
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/components/stat-card.tsx`** (spark + delta made optional)

```tsx
import { cn } from "@/lib/utils";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkline } from "@/components/sparkline";

export function StatCard({
  label,
  value,
  sub,
  deltaPct = null,
  spark,
}: {
  label: string;
  value: string | number;
  sub?: string;
  deltaPct?: number | null;
  spark?: number[];
}) {
  return (
    <Card className={cn("gap-0 overflow-hidden", spark ? "pb-0" : undefined)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardDescription>{label}</CardDescription>
          {deltaPct !== null && (
            <Delta value={Math.round(deltaPct)} variant="badge">
              <DeltaIcon variant="trend" />
              <DeltaValue suffix="%" />
            </Delta>
          )}
        </div>
        <CardTitle className="font-mono text-3xl tabular-nums">{value}</CardTitle>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardHeader>
      {spark && <Sparkline data={spark} />}
    </Card>
  );
}
```

- [ ] **Step 4: Rewire `dashboard.tsx`**

In `src/routes/dashboard.tsx`:
- Add imports:

```ts
import { Sparkline } from "@/components/sparkline";
import { StatCard } from "@/components/stat-card";
import { formatShortDate, formatRelative } from "@/lib/format-date";
```

- Delete the inline `function Sparkline(...)` (lines ~382-408), `function StatCard(...)` (lines ~410-441), `function formatShortDate(...)` (lines ~43-52), `function formatRelative(...)` + `const RELATIVE_UNITS` (lines ~59-78). Keep `formatDayTick` (chart-axis-specific, stays local).
- Remove now-unused imports from `dashboard.tsx` if the extraction leaves them dangling: `useId` (still used by `MetricChartCard` — keep), `ResponsiveContainer`/`Area`/`AreaChart` (still used by `MetricChartCard` — keep). `Delta`/`DeltaIcon`/`DeltaValue` are still used by `MetricChartCard` — keep. `CardDescription`/`Card`/`CardHeader`/`CardTitle` still used — keep. (No import removals expected; verify with tsc.)

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit`
Expected: no new errors.
Run: `pnpm build`
Expected: builds clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/sparkline.tsx src/components/stat-card.tsx src/lib/format-date.ts src/routes/dashboard.tsx
git commit -m "refactor(ui): extract Sparkline, StatCard, and date helpers"
```

---

## Task 4: `PaceChart` row component

**Files:**
- Create: `src/components/pace-chart.tsx`

**Interfaces:**
- Produces: `PaceChart({ data: number[]; capacity: number })` — a fixed-size (`h-10 w-28`) cumulative area chart with y-domain `[0, max(capacity, ...data, 1)]`, so curve height reads as fullness and over-capacity never clips.

- [ ] **Step 1: Create the component**

```tsx
import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";

/**
 * Cumulative "pace to capacity" spark for an events-list row. The y-domain is
 * pinned to the event capacity, so a near-sold-out event visibly climbs toward
 * the top and a quiet one stays low. No axes/grid/tooltip at row scale.
 */
export function PaceChart({ data, capacity }: { data: number[]; capacity: number }) {
  const gradientId = `pace-${useId().replace(/:/g, "")}`;
  const points = data.map((v, i) => ({ i, v }));
  const domainMax = Math.max(capacity, 1, ...data);
  return (
    <div className="h-10 w-28">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[0, domainMax]} />
          <Area
            dataKey="v"
            type="monotone"
            stroke="var(--primary)"
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/pace-chart.tsx
git commit -m "feat(events): PaceChart row component"
```

---

## Task 5: Rebuild the `/events` page

**Files:**
- Modify: `src/routes/events/index.tsx` (full rewrite)

**Interfaces:**
- Consumes: `api.events.listMyEventsWithStats`; `StatCard`, `PaceChart`, `Delta`/`DeltaIcon`/`DeltaValue`; `formatShortDate`, `formatRelative`; `formatMoney` (`@/lib/format-money`), `formatInteger` (`@/lib/formater`); shadcn `Input`, `ToggleGroup`/`ToggleGroupItem`, `Select` family, `Table` family, `Badge`, `Button`, `Skeleton`, `Empty` family.

- [ ] **Step 1: Confirm the UI primitives' export names**

Run: `sed -n '1,40p' src/components/ui/toggle-group.tsx src/components/ui/select.tsx src/components/ui/input.tsx`
Expected: confirms `ToggleGroup`, `ToggleGroupItem`; `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`; `Input`. If any name differs, use the actual export in Step 2.

- [ ] **Step 2: Rewrite `src/routes/events/index.tsx`**

Replace the entire file with:

```tsx
import { Suspense, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import type { FunctionReturnType } from "convex/server";
import { ChevronRight, Plus, Search } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/stat-card";
import { PaceChart } from "@/components/pace-chart";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import { formatShortDate, formatRelative } from "@/lib/format-date";
import { formatMoney } from "@/lib/format-money";
import { formatInteger } from "@/lib/formater";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

export const Route = createFileRoute("/events/")({ component: EventsIndexPage });

type EventRow = FunctionReturnType<typeof api.events.listMyEventsWithStats>[number];
type StatusFilter = "all" | "published" | "draft";
type SortKey = "date" | "fill" | "name";

const fillOf = (e: EventRow) => (e.capacity > 0 ? e.seatsTaken / e.capacity : 0);

/** Elementwise sum of equal-length per-event series (for KPI aggregate sparks). */
function sumSeries(rows: EventRow[], pick: (e: EventRow) => number[]): number[] {
  const len = rows[0] ? pick(rows[0]).length : 0;
  const out = new Array(len).fill(0);
  for (const r of rows) pick(r).forEach((v, i) => (out[i] += v));
  return out;
}

function EventsIndexPage() {
  return (
    <DashboardLayout wide>
      <div className="p-4 md:p-6">
        <Suspense fallback={<EventsSkeleton />}>
          <EventsListContent />
        </Suspense>
      </div>
    </DashboardLayout>
  );
}

function EventsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-40" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function EventsListContent() {
  const { data: events } = useSuspenseQuery(convexQuery(api.events.listMyEventsWithStats, {}));
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("date");

  const now = Date.now();

  const kpis = useMemo(() => {
    const published = events.filter((e) => e.status === "published").length;
    const upcoming = events.filter((e) => e.endsAt >= now);
    const nextUpcoming = upcoming.slice().sort((a, b) => a.startsAt - b.startsAt)[0];
    return {
      total: events.length,
      published,
      draft: events.length - published,
      upcomingCount: upcoming.length,
      nextUpcoming,
      attendees: events.reduce((s, e) => s + e.seatsTaken, 0),
      revenueCents: events.reduce((s, e) => s + e.revenueCents, 0),
      ticketsSold: events.reduce((s, e) => s + e.ticketsSold, 0),
      currency: events[0]?.currency ?? "USD",
      attendeeSpark: sumSeries(events, (e) => e.spark),
      revenueSpark: sumSeries(events, (e) => e.revenueSpark),
    };
  }, [events, now]);

  const { upcoming, past, matched } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = events.filter((e) => {
      const matchesStatus = status === "all" || e.status === status;
      const matchesSearch =
        q === "" ||
        e.title.toLowerCase().includes(q) ||
        e.location.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });

    const sortGroup = (rows: EventRow[], future: boolean) =>
      rows.slice().sort((a, b) => {
        if (sort === "name") return a.title.localeCompare(b.title);
        if (sort === "fill") return fillOf(b) - fillOf(a);
        // date: upcoming soonest-first, past most-recent-first
        return future ? a.startsAt - b.startsAt : b.startsAt - a.startsAt;
      });

    const up = sortGroup(filtered.filter((e) => e.endsAt >= now), true);
    const pa = sortGroup(filtered.filter((e) => e.endsAt < now), false);
    return { upcoming: up, past: pa, matched: filtered.length };
  }, [events, search, status, sort, now]);

  if (events.length === 0) {
    return (
      <Empty className="mt-12">
        <EmptyHeader>
          <EmptyTitle>No events yet</EmptyTitle>
          <EmptyDescription>Create your first event to get started.</EmptyDescription>
        </EmptyHeader>
        <Button asChild className="mt-4">
          <Link to="/events/new">
            <Plus /> New event
          </Link>
        </Button>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Your events</h1>
        <Button asChild>
          <Link to="/events/new">
            <Plus /> New event
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Events"
          value={kpis.total}
          sub={`${kpis.published} published · ${kpis.draft} draft`}
        />
        <StatCard
          label="Upcoming"
          value={kpis.upcomingCount}
          sub={kpis.nextUpcoming ? `Next ${formatRelative(kpis.nextUpcoming.startsAt)}` : "None scheduled"}
        />
        <StatCard
          label="Attendees"
          value={formatInteger(kpis.attendees)}
          sub={`across ${kpis.total} events`}
          spark={kpis.attendeeSpark}
        />
        <StatCard
          label="Revenue"
          value={formatMoney(kpis.revenueCents, kpis.currency)}
          sub={kpis.ticketsSold > 0 ? `${formatInteger(kpis.ticketsSold)} tickets sold` : "No sales yet"}
          spark={kpis.revenueSpark}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events"
            className="pl-9"
            aria-label="Search events"
          />
        </div>
        <ToggleGroup
          type="single"
          value={status}
          onValueChange={(v) => v && setStatus(v as StatusFilter)}
          variant="outline"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="published">Published</ToggleGroupItem>
          <ToggleGroupItem value="draft">Draft</ToggleGroupItem>
        </ToggleGroup>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-36" aria-label="Sort events">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date">Sort: Date</SelectItem>
            <SelectItem value="fill">Sort: Fill</SelectItem>
            <SelectItem value="name">Sort: Name</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {matched === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          No events match your filters.
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <EventsGroup title="Upcoming" rows={upcoming} />
          <EventsGroup title="Past" rows={past} />
        </div>
      )}
    </div>
  );
}

function EventsGroup({ title, rows }: { title: string; rows: EventRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">
        {title} ({rows.length})
      </h2>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="hidden md:table-cell">Trend</TableHead>
              <TableHead>Fill</TableHead>
              <TableHead className="hidden md:table-cell text-right">Sales</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => (
              <EventRowView key={e._id} e={e} />
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function EventRowView({ e }: { e: EventRow }) {
  const pct = e.capacity > 0 ? Math.min(100, (e.seatsTaken / e.capacity) * 100) : 0;
  const hasSales = e.revenueCents > 0 || e.ticketsSold > 0;
  return (
    <TableRow className="group">
      <TableCell className="max-w-[16rem]">
        <Link
          to="/events/$id"
          params={{ id: e._id }}
          className="font-medium hover:underline"
        >
          {e.title}
        </Link>
        {e.location && <div className="truncate text-xs text-muted-foreground">{e.location}</div>}
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {formatShortDate(e.startsAt)}
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <div className="flex items-center gap-2">
          <PaceChart data={e.spark} capacity={e.capacity} />
          {e.deltaPct !== null && (
            <Delta value={Math.round(e.deltaPct)} variant="badge">
              <DeltaIcon variant="trend" />
              <DeltaValue suffix="%" />
            </Delta>
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {e.seatsTaken}/{e.capacity}
          </span>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell text-right text-sm tabular-nums">
        {hasSales ? (
          <div>
            <div>{formatMoney(e.revenueCents, e.currency)}</div>
            <div className="text-xs text-muted-foreground">{formatInteger(e.ticketsSold)} sold</div>
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant={e.status === "published" ? "default" : "secondary"}>
          {e.status === "published" ? "Published" : "Draft"}
        </Badge>
      </TableCell>
      <TableCell>
        <Link to="/events/$id" params={{ id: e._id }} aria-label={`Open ${e.title}`}>
          <ChevronRight className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
        </Link>
      </TableCell>
    </TableRow>
  );
}
```

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit`
Expected: no new errors. If `ToggleGroup`/`Select`/`Input` prop names differ from Step 1's findings, adjust.
Run: `pnpm build`
Expected: builds clean.

- [ ] **Step 4: Verify end-to-end against seed data**

Ensure seed data exists (the repo's dev sample-data mutation, per recent commits). Start the app:

Run: `pnpm dev` (then load `http://localhost:3000/events`)
Confirm: KPI strip shows Events / Upcoming / Attendees (with spark) / Revenue (with spark); the table splits into Upcoming and Past; each row shows a pace chart, a fill bar with `seatsTaken/capacity`, sales or a `-` placeholder, and a status badge; typing in Search filters live; the status toggle filters; the sort select reorders; clicking a title or chevron opens `/events/$id`. Verify no horizontal page scroll at a narrow width (Trend/Sales/location collapse).

Use the `superpowers:verification-before-completion` skill (or the `/verify` skill) to drive this and capture evidence.

- [ ] **Step 5: Commit**

```bash
git add src/routes/events/index.tsx
git commit -m "feat(events): premium operator cockpit for the events list"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** KPI strip (T5), search/filter/sort (T5), Upcoming/Past split (T5), per-row pace chart (T4+T5), sales column (T2+T5), backend enrichment + timeseries extraction (T1+T2), shared components (T3), drop Sign out (T5, absent from the rewrite), empty/edge states (T5). All covered.
- **Deviation from spec, deliberate:** the spec floated a per-row `deltaPct` badge and Revenue-KPI sparkline "if cheap". Both are included (Revenue KPI gets a real cumulative `revenueSpark`; count-type KPI cards Events/Upcoming carry no spark, which is the judgment call the user approved).
- **`seatsTaken` semantics reconciled:** spark and fill both count seat-holding RSVPs only (not tickets), so the pace curve's endpoint equals the fill numerator. Tickets/orders feed only `ticketsSold`/`revenueCents`.
- **Type consistency:** query return fields (`spark`, `revenueSpark`, `deltaPct`, `seatsTaken`, `ticketsSold`, `revenueCents`, `currency`) are consumed under the same names in `EventRow`; `StatCard` optional `spark`/`deltaPct` match both dashboard and events callsites; `PaceChart({ data, capacity })` matches its callsite.
```
