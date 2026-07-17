# Events Pagination — Phase B (Numbered Pagination UX) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/events` client-side list with server-side, in-memory numbered pagination — a `listMyEventsPage` query (filter/sort/search over the denormalized event docs, slice page N, enrich only that page's rows), a cheap `getMyEventsKpis`, and a frontend with tabs, clickable numbered pages, and sort + search on every tab.

**Architecture:** Phase A denormalized `seatsTaken`/`ticketsSold`/`revenueCents` onto the event doc, so the server can load an organizer's event docs (no children), filter/sort/search them in memory, and enrich only the current page's ~10 rows with their pace chart. No new indexes, no search index, no cursors.

**Tech Stack:** Convex (queries), TanStack Router + React Query (`convexQuery` + `useQuery`), React, shadcn/ui (Tabs/Pagination/Table/Card/Input/ToggleGroup/Select), Tailwind v4, Vitest + convex-test.

## Global Constraints

- **Reads treat the denormalized counters as `?? 0`** (they are `v.optional(v.number())`).
- **Tab boundary is `endsAt`**: Upcoming = `endsAt >= now`, Past = `endsAt < now`, All = no time filter. `now` is a query **arg** (queries can't use `Date.now()` for a reactive boundary).
- **Sort**: date = `startsAt` (Upcoming ascending / Past+All descending), fill = `seatsTaken/capacity` descending, name = `title.localeCompare` ascending. Available on **every** tab.
- **Search**: case-insensitive substring over `title` + `location`; combines with tab + sort.
- **Owner-scoped**: queries return an empty page / zeroed KPIs when unauthenticated.
- **Root tsconfig `noUnusedLocals` + `noUnusedParameters` ON** — `npx tsc --noEmit` must exit 0.
- **No em/en dashes in user-facing copy** — hyphen `-` or middle dot `·`.
- Package manager pnpm. Tests `pnpm test`. Typecheck `npx tsc --noEmit`. Build `pnpm build`.

---

## File Structure

**Create:**
- `convex/lib/pace.ts` — `buildPaceSpark(rsvps, now)` (extracted from `listMyEventsWithStats`).
- `src/components/ui/pagination.tsx` — shadcn pagination component (via CLI).

**Modify:**
- `convex/events.ts` — add `getMyEventsKpis` + `listMyEventsPage`; refactor `listMyEventsWithStats` onto `buildPaceSpark` (Task 2); remove `listMyEventsWithStats` (Task 3).
- `convex/events.test.ts` — add KPI + page tests; remove the obsolete `listMyEventsWithStats` tests (Task 3).
- `src/routes/events/index.tsx` — full rebuild (Task 3).

---

## Task 1: `getMyEventsKpis` query

**Files:**
- Modify: `convex/events.ts` (add the query after `listMyEventsWithStats`)
- Test: `convex/events.test.ts` (append)

**Interfaces:**
- Produces: `api.events.getMyEventsKpis({ now: number })` → `{ total, published, draft, upcoming, attendees, revenueCents, ticketsSold, currency }` (all numbers except `currency: string`). Zeroed when unauthenticated.

- [ ] **Step 1: Write the failing test**

Append to `convex/events.test.ts`:

```ts
test("getMyEventsKpis sums denormalized counters over all events", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const now = 1_000_000_000_000;
  // One upcoming published, one past draft. Set counters directly.
  const e1 = await as.mutation(api.events.createEvent, {
    title: "Upcoming", description: "x", startsAt: now + 1000, endsAt: now + 2000, location: "H", capacity: 100,
  });
  await as.mutation(api.events.publishEvent, { eventId: e1 });
  const e2 = await as.mutation(api.events.createEvent, {
    title: "Past", description: "x", startsAt: now - 2000, endsAt: now - 1000, location: "H", capacity: 50,
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(e1, { seatsTaken: 30, ticketsSold: 10, revenueCents: 20000 });
    await ctx.db.patch(e2, { seatsTaken: 5, ticketsSold: 2, revenueCents: 4000 });
  });

  const k = await as.query(api.events.getMyEventsKpis, { now });
  expect(k.total).toBe(2);
  expect(k.published).toBe(1);
  expect(k.draft).toBe(1);
  expect(k.upcoming).toBe(1); // only e1 has endsAt >= now
  expect(k.attendees).toBe(35);
  expect(k.ticketsSold).toBe(12);
  expect(k.revenueCents).toBe(24000);
});

test("getMyEventsKpis returns zeros when unauthenticated", async () => {
  const t = convexTest(schema, modules);
  const k = await t.query(api.events.getMyEventsKpis, { now: 1 });
  expect(k).toEqual({ total: 0, published: 0, draft: 0, upcoming: 0, attendees: 0, revenueCents: 0, ticketsSold: 0, currency: "USD" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test convex/events.test.ts`
Expected: FAIL — `api.events.getMyEventsKpis` is not a function.

- [ ] **Step 3: Implement the query**

In `convex/events.ts`, after the `listMyEventsWithStats` query:

```ts
/**
 * Owner-scoped KPI totals for the `/events` cockpit, summed from the
 * denormalized event counters (O(events), no child reads). Numbers only;
 * 30-day trend charts live on `/dashboard`. `now` is a client arg so the
 * upcoming/past boundary is reactive. Zeroed when unauthenticated.
 */
export const getMyEventsKpis = query({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) {
      return { total: 0, published: 0, draft: 0, upcoming: 0, attendees: 0, revenueCents: 0, ticketsSold: 0, currency: "USD" };
    }
    const events = await ctx.db
      .query("events")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .collect();
    const published = events.filter((e) => e.status === "published").length;
    return {
      total: events.length,
      published,
      draft: events.length - published,
      upcoming: events.filter((e) => e.endsAt >= now).length,
      attendees: events.reduce((s, e) => s + (e.seatsTaken ?? 0), 0),
      revenueCents: events.reduce((s, e) => s + (e.revenueCents ?? 0), 0),
      ticketsSold: events.reduce((s, e) => s + (e.ticketsSold ?? 0), 0),
      currency: events[0]?.currency ?? "USD",
    };
  },
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test convex/events.test.ts`
Expected: PASS (2 new + existing). Then `npx tsc --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add convex/events.ts convex/events.test.ts
git commit -m "feat(events): getMyEventsKpis aggregate over denormalized counters"
```

---

## Task 2: `buildPaceSpark` helper + `listMyEventsPage` query

**Files:**
- Create: `convex/lib/pace.ts`
- Modify: `convex/events.ts` (add `listMyEventsPage`; refactor `listMyEventsWithStats`'s inline spark/delta onto `buildPaceSpark`)
- Test: `convex/events.test.ts` (append page tests)

**Interfaces:**
- Consumes: Phase A denormalized fields; `buildDateWindow`/`fromUtcDateString`/`toUtcDateString`/`MS_PER_DAY` from `./lib/timeseries`; `SEAT_HOLDING_STATUSES`.
- Produces: `buildPaceSpark(rsvps: Doc<"rsvps">[], now: number): { spark: number[]; deltaPct: number | null }`.
- Produces: `api.events.listMyEventsPage({ tab, status, sort, search, page, pageSize, now })` → `{ rows: EnrichedRow[]; page: number; pageCount: number; total: number }`. `EnrichedRow` = `{ _id, title, slug, location, startsAt, endsAt, status, capacity, currency, seatsTaken, ticketsSold, revenueCents, spark, deltaPct }`. `page` is clamped to `[1, max(1, pageCount)]`; `pageCount = ceil(total/pageSize)` (0 when empty); `spark`'s final element equals `seatsTaken`.

- [ ] **Step 1: Extract `buildPaceSpark` (refactor, behavior-preserving)**

Create `convex/lib/pace.ts`:

```ts
import type { Doc } from "../_generated/dataModel";
import { SEAT_HOLDING_STATUSES } from "./constants";
import { buildDateWindow, fromUtcDateString, toUtcDateString, MS_PER_DAY } from "./timeseries";

/**
 * Cumulative "pace to capacity" spark (seat-holding registrations, right edge ==
 * seatsTaken) plus a 30d-vs-prior-30d registration delta, for one event's rsvps.
 * Registrations older than the 30-day window seed the baseline so the final
 * point still equals the total seat-holding count.
 */
export function buildPaceSpark(
  rsvps: Doc<"rsvps">[],
  now: number,
): { spark: number[]; deltaPct: number | null } {
  const window = buildDateWindow(now);
  const windowStartMs = fromUtcDateString(window[0]);
  const seatHolding = (s: string) => (SEAT_HOLDING_STATUSES as readonly string[]).includes(s);
  const seats = rsvps.filter((r) => seatHolding(r.status));
  const regTime = (r: Doc<"rsvps">) => r.createdAt ?? r._creationTime;

  const dayCounts = new Map(window.map((d) => [d, 0]));
  let baseline = 0;
  for (const r of seats) {
    const t = regTime(r);
    const key = toUtcDateString(t);
    if (t < windowStartMs || !dayCounts.has(key)) baseline += 1;
    else dayCounts.set(key, dayCounts.get(key)! + 1);
  }
  let running = baseline;
  const spark = window.map((d) => (running += dayCounts.get(d)!));

  const windowMs = 30 * MS_PER_DAY;
  const curStart = now - windowMs;
  const prevStart = now - 2 * windowMs;
  const cur = seats.filter((r) => regTime(r) >= curStart).length;
  const prev = seats.filter((r) => {
    const t = regTime(r);
    return t >= prevStart && t < curStart;
  }).length;
  const deltaPct = prev === 0 ? null : ((cur - prev) / prev) * 100;

  return { spark, deltaPct };
}
```

Then in `convex/events.ts`, refactor `listMyEventsWithStats` to use it: replace its inline seat-holding filter + `dayCounts`/`regBaseline`/`spark` + `deltaPct` computation (the block computing `seats`, `spark`, and `deltaPct`) with:

```ts
        const { spark, deltaPct } = buildPaceSpark(rsvps, now);
        const seatsTaken = rsvps.filter((r) =>
          (SEAT_HOLDING_STATUSES as readonly string[]).includes(r.status),
        ).length;
```

Keep the `revenueSpark` computation and the rest of `listMyEventsWithStats` unchanged (its existing tests must still pass, proving the extraction is behavior-preserving). Add `import { buildPaceSpark } from "./lib/pace";`. Remove now-unused local timeseries imports **only if** they become unused (verify with tsc; `revenueSpark` still uses `buildDateWindow`/`toUtcDateString`/`fromUtcDateString`, so they stay).

- [ ] **Step 2: Write the failing page tests**

Append to `convex/events.test.ts`:

```ts
test("listMyEventsPage: tab filter, sort, search, and numbered slicing", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const now = 1_000_000_000_000;
  const mk = async (title: string, startsAt: number, endsAt: number, seatsTaken: number, capacity: number) => {
    const id = await as.mutation(api.events.createEvent, {
      title, description: "x", startsAt, endsAt, location: "Town Hall", capacity,
    });
    await t.run((ctx) => ctx.db.patch(id, { seatsTaken }));
    return id;
  };
  // 3 upcoming, 1 past.
  await mk("Alpha", now + 3000, now + 4000, 10, 100); // fill 0.10
  await mk("Bravo", now + 1000, now + 2000, 90, 100); // fill 0.90, soonest
  await mk("Charlie", now + 5000, now + 6000, 50, 100);
  await mk("Delta Past", now - 4000, now - 3000, 25, 100);

  // Upcoming tab, date sort (soonest first), page 1 of 2.
  const p1 = await as.query(api.events.listMyEventsPage, {
    tab: "upcoming", status: "all", sort: "date", search: "", page: 1, pageSize: 2, now,
  });
  expect(p1.total).toBe(3);
  expect(p1.pageCount).toBe(2);
  expect(p1.rows.map((r) => r.title)).toEqual(["Bravo", "Alpha"]); // soonest-first
  const p2 = await as.query(api.events.listMyEventsPage, {
    tab: "upcoming", status: "all", sort: "date", search: "", page: 2, pageSize: 2, now,
  });
  expect(p2.rows.map((r) => r.title)).toEqual(["Charlie"]);

  // Fill sort (fullest first) across all upcoming.
  const byFill = await as.query(api.events.listMyEventsPage, {
    tab: "upcoming", status: "all", sort: "fill", search: "", page: 1, pageSize: 10, now,
  });
  expect(byFill.rows.map((r) => r.title)).toEqual(["Bravo", "Charlie", "Alpha"]);

  // Past tab.
  const past = await as.query(api.events.listMyEventsPage, {
    tab: "past", status: "all", sort: "date", search: "", page: 1, pageSize: 10, now,
  });
  expect(past.rows.map((r) => r.title)).toEqual(["Delta Past"]);

  // Search matches location on the All tab (all four share "Town Hall").
  const search = await as.query(api.events.listMyEventsPage, {
    tab: "all", status: "all", sort: "name", search: "town hall", page: 1, pageSize: 10, now,
  });
  expect(search.total).toBe(4);
  expect(search.rows.map((r) => r.title)).toEqual(["Alpha", "Bravo", "Charlie", "Delta Past"]);

  // Page clamps beyond the end.
  const clamped = await as.query(api.events.listMyEventsPage, {
    tab: "upcoming", status: "all", sort: "date", search: "", page: 99, pageSize: 2, now,
  });
  expect(clamped.page).toBe(2);
});

test("listMyEventsPage: status filter + per-row spark endpoint, empty when unauth", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const now = 1_000_000_000_000;
  const pub = await as.mutation(api.events.createEvent, {
    title: "Pub", description: "x", startsAt: now + 1000, endsAt: now + 2000, location: "H", capacity: 10,
  });
  await as.mutation(api.events.publishEvent, { eventId: pub });
  await as.mutation(api.events.createEvent, {
    title: "Draft", description: "x", startsAt: now + 1000, endsAt: now + 2000, location: "H", capacity: 10,
  });
  // Give the published event 2 seat-holding rsvps.
  await t.run(async (ctx) => {
    await ctx.db.insert("rsvps", { eventId: pub, name: "A", email: "a@x.co", token: "t1", status: "confirmed" });
    await ctx.db.insert("rsvps", { eventId: pub, name: "B", email: "b@x.co", token: "t2", status: "checked_in" });
    await ctx.db.patch(pub, { seatsTaken: 2 });
  });

  const onlyPub = await as.query(api.events.listMyEventsPage, {
    tab: "all", status: "published", sort: "date", search: "", page: 1, pageSize: 10, now,
  });
  expect(onlyPub.rows.map((r) => r.title)).toEqual(["Pub"]);
  const row = onlyPub.rows[0];
  expect(row.spark[row.spark.length - 1]).toBe(row.seatsTaken); // spark endpoint == seatsTaken
  expect(row.seatsTaken).toBe(2);

  const unauth = await t.query(api.events.listMyEventsPage, {
    tab: "all", status: "all", sort: "date", search: "", page: 1, pageSize: 10, now,
  });
  expect(unauth).toEqual({ rows: [], page: 1, pageCount: 0, total: 0 });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm test convex/events.test.ts`
Expected: FAIL — `listMyEventsPage` is not a function (and the refactored `listMyEventsWithStats` tests still pass).

- [ ] **Step 4: Implement `listMyEventsPage`**

In `convex/events.ts`, after `getMyEventsKpis`:

```ts
/**
 * Server-side, in-memory paginated events list for the `/events` cockpit.
 *
 * Loads the organizer's event docs (cheap -- stats are denormalized), filters
 * by tab (endsAt vs now) + status + case-insensitive title/location search,
 * sorts by the chosen key, slices out page `page`, and enriches ONLY that
 * page's rows with their pace `spark` + `deltaPct` (per-row rsvps read). Returns
 * an empty page when unauthenticated. `now` is a client arg for the tab boundary.
 */
export const listMyEventsPage = query({
  args: {
    tab: v.union(v.literal("upcoming"), v.literal("past"), v.literal("all")),
    status: v.union(v.literal("all"), v.literal("published"), v.literal("draft")),
    sort: v.union(v.literal("date"), v.literal("fill"), v.literal("name")),
    search: v.string(),
    page: v.number(),
    pageSize: v.number(),
    now: v.number(),
  },
  handler: async (ctx, { tab, status, sort, search, page, pageSize, now }) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return { rows: [], page: 1, pageCount: 0, total: 0 };

    const all = await ctx.db
      .query("events")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .collect();

    const q = search.trim().toLowerCase();
    const filtered = all.filter((e) => {
      const inTab =
        tab === "all" ? true : tab === "upcoming" ? e.endsAt >= now : e.endsAt < now;
      const inStatus = status === "all" || e.status === status;
      const inSearch =
        q === "" || e.title.toLowerCase().includes(q) || e.location.toLowerCase().includes(q);
      return inTab && inStatus && inSearch;
    });

    const fillOf = (e: (typeof all)[number]) =>
      e.capacity > 0 ? (e.seatsTaken ?? 0) / e.capacity : 0;
    filtered.sort((a, b) => {
      if (sort === "name") return a.title.localeCompare(b.title);
      if (sort === "fill") return fillOf(b) - fillOf(a);
      // date: upcoming soonest-first (asc); past/all most-recent-first (desc)
      return tab === "upcoming" ? a.startsAt - b.startsAt : b.startsAt - a.startsAt;
    });

    const total = filtered.length;
    const pageCount = Math.ceil(total / pageSize);
    const clampedPage = Math.min(Math.max(1, page), Math.max(1, pageCount));
    const slice = filtered.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);

    const rows = await Promise.all(
      slice.map(async (e) => {
        const rsvps = await ctx.db
          .query("rsvps")
          .withIndex("by_event", (qq) => qq.eq("eventId", e._id))
          .collect();
        const { spark, deltaPct } = buildPaceSpark(rsvps, now);
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
          seatsTaken: e.seatsTaken ?? 0,
          ticketsSold: e.ticketsSold ?? 0,
          revenueCents: e.revenueCents ?? 0,
          spark,
          deltaPct,
        };
      }),
    );

    return { rows, page: clampedPage, pageCount, total };
  },
});
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm test convex/events.test.ts`
Expected: PASS (new page tests + KPI + refactored `listMyEventsWithStats` tests). Then `npx tsc --noEmit` → no errors, and `pnpm test` (full) green.

- [ ] **Step 6: Commit**

```bash
git add convex/lib/pace.ts convex/events.ts convex/events.test.ts
git commit -m "feat(events): listMyEventsPage in-memory numbered pagination + buildPaceSpark"
```

---

## Task 3: Frontend rebuild + retire the old query

**Files:**
- Create: `src/components/ui/pagination.tsx` (shadcn CLI)
- Modify: `src/routes/events/index.tsx` (full rebuild)
- Modify: `convex/events.ts` (remove `listMyEventsWithStats`), `convex/events.test.ts` (remove its now-obsolete tests)

**Interfaces:**
- Consumes: `api.events.getMyEventsKpis`, `api.events.listMyEventsPage`; `StatCard`, `PaceChart`, `Delta*`, `formatShortDate`/`formatRelative`, `formatMoney`, `formatInteger`; shadcn `Tabs`, `Pagination` family, `Input`, `ToggleGroup`, `Select`, `Table`, `Badge`, `Button`, `Skeleton`, `Empty`.

- [ ] **Step 1: Install the shadcn pagination component**

Run: `pnpm dlx shadcn@latest add pagination`
Expected: creates `src/components/ui/pagination.tsx`. Then read it and confirm the exports: `Pagination`, `PaginationContent`, `PaginationItem`, `PaginationLink`, `PaginationPrevious`, `PaginationNext`, `PaginationEllipsis`. (If any name differs, use the actual export in Step 3.)

- [ ] **Step 2: Confirm Tabs is available**

Run: `ls src/components/ui/tabs.tsx`
Expected: exists (it does). Confirm exports `Tabs`, `TabsList`, `TabsTrigger` via `sed -n '1,40p' src/components/ui/tabs.tsx`. Use `TabsList`/`TabsTrigger` for the Upcoming/Past/All control (value-controlled).

- [ ] **Step 3: Rewrite `src/routes/events/index.tsx`**

Replace the entire file with:

```tsx
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

export const Route = createFileRoute("/events/")({ component: EventsIndexPage });

type PageResult = FunctionReturnType<typeof api.events.listMyEventsPage>;
type EventRow = PageResult["rows"][number];
type Tab = "upcoming" | "past" | "all";
type StatusFilter = "all" | "published" | "draft";
type SortKey = "date" | "fill" | "name";

const PAGE_SIZE = 10;

function EventsIndexPage() {
  return (
    <DashboardLayout wide>
      <div className="p-4 md:p-6">
        <EventsListContent />
      </div>
    </DashboardLayout>
  );
}

function EventsListContent() {
  const [tab, setTab] = useState<Tab>("upcoming");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("date");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // A stable-ish clock for the tab boundary; recomputed on mount.
  const [now] = useState(() => Date.now());

  // Reset to page 1 whenever the filter/sort/search changes.
  useEffect(() => setPage(1), [tab, status, sort, search]);

  const kpisQuery = useQuery(convexQuery(api.events.getMyEventsKpis, { now }));
  const pageQuery = useQuery({
    ...convexQuery(api.events.listMyEventsPage, {
      tab,
      status,
      sort,
      search,
      page,
      pageSize: PAGE_SIZE,
      now,
    }),
    placeholderData: (prev) => prev, // keep the current page visible while the next loads
  });

  const kpis = kpisQuery.data;
  const result = pageQuery.data;

  if (kpisQuery.isPending || !kpis) return <EventsSkeleton />;

  // The org has no events at all -> the create-your-first empty state.
  if (kpis.total === 0) {
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
        <StatCard label="Events" value={kpis.total} sub={`${kpis.published} published · ${kpis.draft} draft`} />
        <StatCard label="Upcoming" value={kpis.upcoming} sub={kpis.upcoming > 0 ? "Scheduled or in progress" : "None scheduled"} />
        <StatCard label="Attendees" value={formatInteger(kpis.attendees)} sub={`across ${kpis.total} events`} />
        <StatCard
          label="Revenue"
          value={formatMoney(kpis.revenueCents, kpis.currency)}
          sub={kpis.ticketsSold > 0 ? `${formatInteger(kpis.ticketsSold)} tickets sold` : "No sales yet"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="past">Past</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
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

      {!result ? (
        <Skeleton className="h-64 w-full" />
      ) : result.total === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          No events match your filters.
        </div>
      ) : (
        <>
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
                {result.rows.map((e) => (
                  <EventRowView key={e._id} e={e} />
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">
              {result.total} events
            </span>
            <NumberedPagination
              page={result.page}
              pageCount={result.pageCount}
              onPage={setPage}
            />
          </div>
        </>
      )}
    </div>
  );
}

/** The page numbers to show: 1, current-1..current+1, last, with ellipses. */
function pageWindow(page: number, pageCount: number): (number | "...")[] {
  const set = new Set<number>([1, pageCount, page - 1, page, page + 1]);
  const pages = [...set].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const out: (number | "...")[] = [];
  for (let i = 0; i < pages.length; i++) {
    if (i > 0 && pages[i] - pages[i - 1] > 1) out.push("...");
    out.push(pages[i]);
  }
  return out;
}

function NumberedPagination({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
}) {
  if (pageCount <= 1) return null;
  const go = (p: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    onPage(Math.min(Math.max(1, p), pageCount));
  };
  return (
    <Pagination className="mx-0 w-auto justify-end">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href="#"
            onClick={go(page - 1)}
            aria-disabled={page <= 1}
            className={page <= 1 ? "pointer-events-none opacity-50" : undefined}
          />
        </PaginationItem>
        {pageWindow(page, pageCount).map((p, i) =>
          p === "..." ? (
            <PaginationItem key={`e${i}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={p}>
              <PaginationLink href="#" isActive={p === page} onClick={go(p)}>
                {p}
              </PaginationLink>
            </PaginationItem>
          ),
        )}
        <PaginationItem>
          <PaginationNext
            href="#"
            onClick={go(page + 1)}
            aria-disabled={page >= pageCount}
            className={page >= pageCount ? "pointer-events-none opacity-50" : undefined}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
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

function EventRowView({ e }: { e: EventRow }) {
  const pct = e.capacity > 0 ? Math.min(100, (e.seatsTaken / e.capacity) * 100) : 0;
  const hasSales = e.revenueCents > 0 || e.ticketsSold > 0;
  return (
    <TableRow className="group">
      <TableCell className="max-w-[16rem]">
        <Link to="/events/$id" params={{ id: e._id }} className="font-medium hover:underline">
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

- [ ] **Step 4: Remove the now-dead `listMyEventsWithStats`**

The page no longer uses `listMyEventsWithStats` (nothing else does either). In `convex/events.ts`, delete the `listMyEventsWithStats` query. In `convex/events.test.ts`, delete its tests (the `listMyEventsWithStats ...` test blocks). The pace/delta logic stays covered by `buildPaceSpark`'s use in `listMyEventsPage` tests; seat/sales counters are covered by the Phase A eventStats tests. Remove any imports in `events.ts`/`events.test.ts` left unused by the deletion (tsc will flag them).

- [ ] **Step 5: Typecheck, build, verify**

Run: `npx tsc --noEmit` → no errors (fix any leftover unused imports).
Run: `pnpm build` → succeeds.
Run: `pnpm test` → full suite green.
Then verify in a browser against seed data (`pnpm dev`, `http://localhost:3000/events`): tabs switch (Upcoming/Past/All), numbered pages appear when > 10 events and jump correctly, Prev/Next disable at the ends, sort works on every tab, the status toggle and search filter (and combine), page resets to 1 on filter/sort/search change, KPI cards show numbers (no sparklines), rows show the pace chart/fill/sales, no horizontal page scroll at a narrow width. Use the `superpowers:verification-before-completion` skill and report exactly what was observed.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/pagination.tsx src/routes/events/index.tsx convex/events.ts convex/events.test.ts
git commit -m "feat(events): server-side numbered pagination UI; retire listMyEventsWithStats"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** `getMyEventsKpis` (T1), `buildPaceSpark` + `listMyEventsPage` in-memory filter/sort/search/paginate + per-row enrichment (T2), frontend tabs + numbered pages + sort/search-on-every-tab + KPI numbers + pagination component + retire old query (T3). All Phase B spec items covered.
- **Sort/search on every tab:** the query filters and sorts independently of the tab, so all sorts work on all tabs (in-memory) — reverses the earlier index-driven compromise, per the locked decision.
- **`now` handling:** passed as an arg to both queries (reactive tab boundary); captured once on the client via `useState(() => Date.now())` so it's stable across re-renders (the events-list-polish memoization bug does not recur).
- **Empty states:** `getMyEventsKpis.total === 0` → "No events yet" (create); `listMyEventsPage.total === 0` with an org that has events → "No events match".
- **No flicker on paging:** `placeholderData: (prev) => prev` keeps the current page visible while the next loads; the paginator is hidden when `pageCount <= 1`.
- **Type consistency:** `EventRow = FunctionReturnType<typeof api.events.listMyEventsPage>["rows"][number]`; `buildPaceSpark(rsvps, now) -> { spark, deltaPct }` matches both `listMyEventsPage` and the refactored `listMyEventsWithStats` (until it is deleted in T3).
- **Deferred (from Phase A):** the childless-seed-event counter-init nit and the analytics.ts date-bucketing consolidation remain out of scope.
```
