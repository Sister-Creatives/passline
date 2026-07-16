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
