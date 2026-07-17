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
        <StatCard
          label="Upcoming"
          value={kpis.upcoming}
          sub={
            kpis.nextStartsAt !== null
              ? `Next ${formatRelative(kpis.nextStartsAt)}`
              : kpis.upcoming > 0
                ? "In progress"
                : "None scheduled"
          }
        />
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
