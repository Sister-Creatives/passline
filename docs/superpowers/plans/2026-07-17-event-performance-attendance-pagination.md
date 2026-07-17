# Event performance, attendance fix, and attendees pagination — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-event performance overview to the event Details view (published events only), replace the dashboard's aggregate attendee count with a check-in rate, and turn the attendees section into one filterable, paginated table.

**Architecture:** Three front-end changes plus one shared-component extraction and one pure helper. All data comes from existing Convex queries (`analytics.getEventSummary`, `analytics.getSalesTimeseries`, `events.getMyEventWithRsvps`, `dashboard.getOverview`); no backend changes.

**Tech Stack:** TanStack Start + React 19, Convex via `@convex-dev/react-query`, shadcn/ui + Tailwind v4, Recharts (via `@/components/ui/chart`), vitest.

## Global Constraints

- No backend / Convex query changes. Read-only reuse of existing queries.
- Match existing patterns: `useQuery(convexQuery(...))`, shadcn `Card`/`Table`/`ToggleGroup`, `formatMoney`/`formatInteger`, `tabular-nums`.
- Australian English in copy; sentence case; no em/en dashes; no exclamation marks.
- Verify each task with `pnpm exec tsc --noEmit`; run `pnpm test` for tasks touching `src/lib`; `pnpm build` before final sign-off.
- Client-side pagination, `PAGE_SIZE = 10`.

---

### Task 1: Extract NumberedPagination into a shared component

**Files:**
- Create: `src/components/numbered-pagination.tsx`
- Modify: `src/routes/events/index.tsx` (remove local `NumberedPagination` + `pageWindow`, import the shared one)

**Interfaces:**
- Produces: `NumberedPagination({ page: number, pageCount: number, onPage: (p: number) => void }): JSX.Element | null`

- [ ] **Step 1: Create the shared component** — move the existing `pageWindow` and `NumberedPagination` verbatim from `events/index.tsx` (currently lines ~233-294) into the new file, with the `Pagination*` imports it needs.

```tsx
// src/components/numbered-pagination.tsx
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";

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

export function NumberedPagination({
  page, pageCount, onPage,
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
          <PaginationPrevious href="#" onClick={go(page - 1)} aria-disabled={page <= 1}
            className={page <= 1 ? "pointer-events-none opacity-50" : undefined} />
        </PaginationItem>
        {pageWindow(page, pageCount).map((p, i) =>
          p === "..." ? (
            <PaginationItem key={`e${i}`}><PaginationEllipsis /></PaginationItem>
          ) : (
            <PaginationItem key={p}>
              <PaginationLink href="#" isActive={p === page} onClick={go(p)}>{p}</PaginationLink>
            </PaginationItem>
          ),
        )}
        <PaginationItem>
          <PaginationNext href="#" onClick={go(page + 1)} aria-disabled={page >= pageCount}
            className={page >= pageCount ? "pointer-events-none opacity-50" : undefined} />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
```

- [ ] **Step 2: Update `events/index.tsx`** — delete the local `pageWindow` and `NumberedPagination` definitions and the now-unused `Pagination*` imports; add `import { NumberedPagination } from "@/components/numbered-pagination";`. Leave the JSX usage (`<NumberedPagination page={result.page} pageCount={result.pageCount} onPage={setPage} />`) unchanged.

- [ ] **Step 3: Verify** — `pnpm exec tsc --noEmit` (expect no errors). The events list page still paginates identically.

- [ ] **Step 4: Commit** — `git commit -m "refactor(events): extract NumberedPagination into a shared component"`

---

### Task 2: Attendee filter/paginate pure helper (TDD)

**Files:**
- Create: `src/lib/attendees.ts`
- Test: `src/lib/attendees.test.ts`

**Interfaces:**
- Produces:
  - `type AttendeeBucket = "confirmed" | "pending" | "waitlist" | "checkedIn"`
  - `type AttendeeStatusFilter = "all" | AttendeeBucket`
  - `interface MergedAttendee { _id: string; name: string; email: string; token: string; bucket: AttendeeBucket; checkedInAt?: number }`
  - `interface AttendeePage { rows: MergedAttendee[]; page: number; pageCount: number; total: number }`
  - `filterAndPaginate(list: MergedAttendee[], opts: { status: AttendeeStatusFilter; search: string; page: number; pageSize: number }): AttendeePage`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/attendees.test.ts
import { expect, test } from "vitest";
import { filterAndPaginate, type MergedAttendee } from "./attendees";

function make(n: number): MergedAttendee[] {
  return Array.from({ length: n }, (_, i) => ({
    _id: String(i), name: `Person ${i}`, email: `p${i}@example.com`, token: `t${i}`,
    bucket: i % 2 === 0 ? ("confirmed" as const) : ("waitlist" as const),
  }));
}

test("paginates with page size and reports page count", () => {
  const res = filterAndPaginate(make(25), { status: "all", search: "", page: 1, pageSize: 10 });
  expect(res.total).toBe(25);
  expect(res.pageCount).toBe(3);
  expect(res.rows).toHaveLength(10);
});

test("filters by bucket", () => {
  const res = filterAndPaginate(make(10), { status: "waitlist", search: "", page: 1, pageSize: 10 });
  expect(res.total).toBe(5);
  expect(res.rows.every((r) => r.bucket === "waitlist")).toBe(true);
});

test("search matches name or email, case-insensitive", () => {
  const res = filterAndPaginate(make(10), { status: "all", search: "PERSON 3", page: 1, pageSize: 10 });
  expect(res.total).toBe(1);
  expect(res.rows[0]?.name).toBe("Person 3");
});

test("clamps an out-of-range page to the last page", () => {
  const res = filterAndPaginate(make(25), { status: "all", search: "", page: 99, pageSize: 10 });
  expect(res.page).toBe(3);
  expect(res.rows).toHaveLength(5);
});

test("empty result yields pageCount 1 and no rows", () => {
  const res = filterAndPaginate(make(10), { status: "all", search: "nobody", page: 1, pageSize: 10 });
  expect(res.total).toBe(0);
  expect(res.pageCount).toBe(1);
  expect(res.rows).toHaveLength(0);
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm exec vitest run src/lib/attendees.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/lib/attendees.ts
export type AttendeeBucket = "confirmed" | "pending" | "waitlist" | "checkedIn";
export type AttendeeStatusFilter = "all" | AttendeeBucket;

export interface MergedAttendee {
  _id: string;
  name: string;
  email: string;
  token: string;
  bucket: AttendeeBucket;
  checkedInAt?: number;
}

export interface AttendeePage {
  rows: MergedAttendee[];
  page: number;
  pageCount: number;
  total: number;
}

/** Filter by status bucket + name/email search, then slice to a page. Pure. */
export function filterAndPaginate(
  attendees: MergedAttendee[],
  opts: { status: AttendeeStatusFilter; search: string; page: number; pageSize: number },
): AttendeePage {
  const search = opts.search.trim().toLowerCase();
  const filtered = attendees.filter((a) => {
    if (opts.status !== "all" && a.bucket !== opts.status) return false;
    if (search && !`${a.name} ${a.email}`.toLowerCase().includes(search)) return false;
    return true;
  });
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / opts.pageSize));
  const page = Math.min(Math.max(1, opts.page), pageCount);
  const start = (page - 1) * opts.pageSize;
  return { rows: filtered.slice(start, start + opts.pageSize), page, pageCount, total };
}
```

- [ ] **Step 4: Run to verify it passes** — `pnpm exec vitest run src/lib/attendees.test.ts` → PASS (5 tests).

- [ ] **Step 5: Commit** — `git commit -m "feat(attendees): filterAndPaginate helper"`

---

### Task 3: EventPerformanceOverview component

**Files:**
- Create: `src/components/EventPerformanceOverview.tsx`

**Interfaces:**
- Consumes: `api.analytics.getEventSummary` (`{ revenue: { netPayoutCents }, orders: { paid, pending, cancelled }, ticketsSold, checkedIn, capacity, currency }`), `api.analytics.getSalesTimeseries` (`Array<{ date: string; revenueCents: number }>`).
- Produces: `EventPerformanceOverview({ eventId: Id<"events"> }): JSX.Element`

- [ ] **Step 1: Implement the component.** Four `Card` tiles (mirroring `AnalyticsPanel`) + a compact sparkline + a link to the Analytics section. Show honest zeros while data is loading or when there are no sales; guard divide-by-zero.

```tsx
// src/components/EventPerformanceOverview.tsx
import { useId } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { Area, AreaChart } from "recharts";
import { ArrowUpRight } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatMoney } from "@/lib/format-money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";

const chartConfig = { revenue: { label: "Revenue", color: "var(--chart-1)" } } satisfies ChartConfig;

function Bar({ percent }: { percent: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export function EventPerformanceOverview({ eventId }: { eventId: Id<"events"> }) {
  const gradientId = `perf-${useId().replace(/:/g, "")}`;
  const { data: summary, isPending } = useQuery(convexQuery(api.analytics.getEventSummary, { eventId }));
  const { data: timeseries } = useQuery(convexQuery(api.analytics.getSalesTimeseries, { eventId }));

  if (isPending || !summary) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  const { revenue, orders, ticketsSold, checkedIn, capacity, currency } = summary;
  const soldPct = capacity > 0 ? Math.min(100, (ticketsSold / capacity) * 100) : 0;
  const checkedInPct = ticketsSold > 0 ? Math.min(100, (checkedIn / ticketsSold) * 100) : 0;
  const checkInRate = ticketsSold > 0 ? Math.round((checkedIn / ticketsSold) * 100) : 0;
  const chartData = (timeseries ?? []).slice(-14).map((d) => ({ date: d.date, revenue: d.revenueCents }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Performance</h2>
        <Link
          to="/events/$id"
          params={{ id: eventId }}
          search={{ section: "analytics" }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          View full analytics <ArrowUpRight className="size-3.5" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Net revenue</CardDescription>
            <CardTitle className="text-2xl tabular-nums tracking-tight">
              {formatMoney(revenue.netPayoutCents, currency)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Tickets sold</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{ticketsSold} / {capacity}</CardTitle>
          </CardHeader>
          <CardContent><Bar percent={soldPct} /></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Attendance</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{checkedIn} / {ticketsSold}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            <Bar percent={checkedInPct} />
            <span className="text-xs text-muted-foreground tabular-nums">{checkInRate}% checked in</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Paid orders</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{orders.paid}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {orders.pending} pending &middot; {orders.cancelled} cancelled
          </CardContent>
        </Card>
      </div>

      {chartData.length > 1 && (
        <Card>
          <CardHeader className="pb-0">
            <CardDescription>Sales, last 14 days</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="aspect-auto h-24 w-full">
              <AreaChart data={chartData} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-revenue)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-revenue)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  dataKey="revenue" type="natural" stroke="var(--color-revenue)" strokeWidth={2}
                  fill={`url(#${gradientId})`} isAnimationActive={false} dot={false}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify** — `pnpm exec tsc --noEmit` (expect no errors).

- [ ] **Step 3: Commit** — `git commit -m "feat(events): EventPerformanceOverview component"`

---

### Task 4: Show the overview on the Details view (published only)

**Files:**
- Modify: `src/routes/events/$id.index.tsx` (`DetailsSection`, ~lines 240-264)

**Interfaces:**
- Consumes: `EventPerformanceOverview` (Task 3).

- [ ] **Step 1: Import** at the top of `events/$id.index.tsx`:
`import { EventPerformanceOverview } from "@/components/EventPerformanceOverview";`

- [ ] **Step 2: Branch `DetailsSection` on published status.** Published events get the overview instead of the standalone capacity bar; drafts keep the bar. `EventForm` stays below in both cases.

```tsx
function DetailsSection({ event, seatsTaken }: { event: EventWithRsvps["event"]; seatsTaken: number }) {
  const isPublished = event.status === "published";
  const capacityPercent = Math.min(100, (seatsTaken / event.capacity) * 100);
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      {isPublished ? (
        <EventPerformanceOverview eventId={event._id} />
      ) : (
        <>
          <h2 className="text-lg font-medium">Event information</h2>
          <div>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Capacity</span>
              <span className="text-muted-foreground">{seatsTaken} / {event.capacity} seats taken</span>
            </div>
            <div
              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar" aria-valuenow={Math.round(capacityPercent)}
              aria-valuemin={0} aria-valuemax={100} aria-label="Capacity"
            >
              <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${capacityPercent}%` }} />
            </div>
          </div>
        </>
      )}
      <div className="max-w-2xl">
        <EventForm event={event} />
      </div>
    </div>
  );
}
```

Note: the wrapper widens to `max-w-5xl` so the 4-tile overview has room; the form is constrained to `max-w-2xl` as before.

- [ ] **Step 3: Verify** — `pnpm exec tsc --noEmit`.

- [ ] **Step 4: Commit** — `git commit -m "feat(events): performance overview on the Details view for published events"`

---

### Task 5: Unified filterable, paginated attendees table

**Files:**
- Modify: `src/routes/events/$id.index.tsx` (`AttendeesSection`, ~lines 266-343)

**Interfaces:**
- Consumes: `filterAndPaginate`, `MergedAttendee`, `AttendeeStatusFilter` (Task 2); `NumberedPagination` (Task 1).

- [ ] **Step 1: Add imports** to `events/$id.index.tsx`:

```tsx
import { useMemo, useState } from "react";
import { filterAndPaginate, type AttendeeBucket, type AttendeeStatusFilter, type MergedAttendee } from "@/lib/attendees";
import { NumberedPagination } from "@/components/numbered-pagination";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
```

- [ ] **Step 2: Replace `AttendeesSection`** with the unified table. Merge the four arrays into `MergedAttendee[]` tagged by source bucket; keep the CSV export (all attendees) and the confirmed-row Cancel action.

```tsx
const BUCKET_LABEL: Record<AttendeeBucket, string> = {
  confirmed: "Confirmed", pending: "Pending claim", waitlist: "Waitlist", checkedIn: "Checked in",
};
const FILTERS: { value: AttendeeStatusFilter; label: string }[] = [
  { value: "all", label: "All" }, { value: "confirmed", label: "Confirmed" },
  { value: "pending", label: "Pending" }, { value: "waitlist", label: "Waitlist" },
  { value: "checkedIn", label: "Checked in" },
];
const ATTENDEES_PAGE_SIZE = 10;

function AttendeesSection({ event, rsvps }: { event: EventWithRsvps["event"]; rsvps: EventWithRsvps }) {
  const cancelRsvp = useMutation(api.rsvps.cancelRsvp);
  const { confirmed, pendingClaim, waitlisted, checkedIn } = rsvps;
  const [status, setStatus] = useState<AttendeeStatusFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const all = useMemo<MergedAttendee[]>(() => {
    const tag = (list: EventWithRsvps["confirmed"], bucket: AttendeeBucket): MergedAttendee[] =>
      list.map((a) => ({ _id: a._id, name: a.name, email: a.email, token: a.token, bucket, checkedInAt: a.checkedInAt }));
    return [
      ...tag(confirmed, "confirmed"), ...tag(pendingClaim, "pending"),
      ...tag(waitlisted, "waitlist"), ...tag(checkedIn, "checkedIn"),
    ];
  }, [confirmed, pendingClaim, waitlisted, checkedIn]);

  const counts = useMemo(() => {
    const c: Record<AttendeeStatusFilter, number> = { all: all.length, confirmed: 0, pending: 0, waitlist: 0, checkedIn: 0 };
    for (const a of all) c[a.bucket]++;
    return c;
  }, [all]);

  const result = filterAndPaginate(all, { status, search, page, pageSize: ATTENDEES_PAGE_SIZE });

  async function handleCancel(token: string) {
    try { await cancelRsvp({ token }); toast.success("RSVP cancelled"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Failed to cancel RSVP"); }
  }

  function handleExportCsv() {
    try {
      const header = ["Name", "Email", "Status", "Checked in at"];
      const rows = all.map((a) => [
        a.name, a.email, BUCKET_LABEL[a.bucket],
        a.checkedInAt ? new Date(a.checkedInAt).toLocaleString() : "",
      ]);
      const csv = [header, ...rows].map((row) => row.map((f) => csvField(f)).join(",")).join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `${event.slug}-attendees.csv`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Failed to export CSV"); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          type="single" variant="outline" value={status}
          onValueChange={(v) => { if (v) { setStatus(v as AttendeeStatusFilter); setPage(1); } }}
        >
          {FILTERS.map((f) => (
            <ToggleGroupItem key={f.value} value={f.value}>
              {f.label} <span className="ml-1 tabular-nums text-muted-foreground">{counts[f.value]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex items-center gap-2">
          <Input
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search name or email" className="w-56"
          />
          <Button variant="outline" size="sm" onClick={handleExportCsv}><Download /> Export CSV</Button>
        </div>
      </div>

      {result.total === 0 ? (
        <Empty className="mt-2">
          <EmptyHeader>
            <EmptyTitle>{all.length === 0 ? "No attendees yet" : "No matching attendees"}</EmptyTitle>
            <EmptyDescription>
              {all.length === 0 ? "Registrations will appear here." : "Try a different filter or search."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((a) => (
                <TableRow key={a._id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell>{a.email}</TableCell>
                  <TableCell><Badge variant="outline">{BUCKET_LABEL[a.bucket]}</Badge></TableCell>
                  <TableCell className="text-right">
                    {a.bucket === "confirmed" && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm">Cancel</Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Cancel this RSVP?</AlertDialogTitle>
                            <AlertDialogDescription>This frees the seat and cannot be undone.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={() => handleCancel(a.token)}>
                              Cancel RSVP
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">{result.total} attendees</span>
            <NumberedPagination page={result.page} pageCount={result.pageCount} onPage={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
```

Note: remove the now-unused `AttendeeTable` import from this file if nothing else in the file uses it (leave the `AttendeeTable` component file in place — it may have other consumers). Confirm `getMyEventWithRsvps` rows expose `_id`, `name`, `email`, `token`, `checkedInAt` (they do — the old code read `a.token`/`a.checkedInAt`).

- [ ] **Step 3: Verify** — `pnpm exec tsc --noEmit` and `pnpm test`.

- [ ] **Step 4: Commit** — `git commit -m "feat(events): unified filterable, paginated attendees table"`

---

### Task 6: Dashboard "Check-in rate" tile

**Files:**
- Modify: `src/routes/dashboard.tsx` (~lines 227-233)

- [ ] **Step 1: Replace the Attendees StatCard** with a Check-in rate tile. `checkInRate` is already computed at ~line 196. `StatCard` already treats `deltaPct`/`spark` as optional, so omit them.

```tsx
<StatCard
  label="Check-in rate"
  value={`${checkInRate}%`}
  sub={`${formatInteger(attendance.checkedIn)} of ${formatInteger(attendance.attendees)} checked in`}
/>
```

- [ ] **Step 2: Verify** — `pnpm exec tsc --noEmit`; `pnpm test` (expect `convex/dashboard.test.ts` still green — backend unchanged).

- [ ] **Step 3: Commit** — `git commit -m "feat(dashboard): replace aggregate attendees with check-in rate"`

---

### Task 7: Final verification

- [ ] **Step 1:** `pnpm exec tsc --noEmit` → no errors.
- [ ] **Step 2:** `pnpm test` → all pass (previous 475 + the new attendees tests).
- [ ] **Step 3:** `pnpm build` → succeeds.
- [ ] **Step 4:** Manual smoke (dev server): a published event's Details view shows the performance overview; a draft shows the capacity bar; the attendees section filters/searches/paginates; the dashboard shows Check-in rate.

## Self-review notes

- Spec coverage: overview (Tasks 3-4), per-event attendance tile inside the overview (Task 3), dashboard swap (Task 6), unified attendees table + pagination (Tasks 1, 2, 5), shared pager extraction (Task 1), pure helper + tests (Task 2). All spec sections covered.
- Types consistent across tasks: `MergedAttendee`, `AttendeeStatusFilter`, `AttendeeBucket`, `filterAndPaginate`, `NumberedPagination({ page, pageCount, onPage })` used identically in Tasks 1/2/5.
- No backend changes; `dashboard.test.ts` stays valid.
