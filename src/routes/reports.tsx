import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { format } from "date-fns";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download } from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { FunctionReturnType } from "convex/server";

import { api } from "../../convex/_generated/api";
import { DashboardLayout } from "@/components/DashboardLayout";
import { formatMoney } from "@/lib/format-money";
import { csvField } from "@/lib/csv";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

export const Route = createFileRoute("/reports")({ component: ReportsPage });

type Row = FunctionReturnType<typeof api.reports.getEventBreakdown>[number];
type SortKey = "title" | "startsAt" | "registrations" | "checkedIn" | "sellThrough" | "revenueCents";
type Metric = "revenueCents" | "registrations";

const chartConfig = {
  value: { label: "Value", color: "var(--chart-1)" },
} satisfies ChartConfig;

const METRIC_LABEL: Record<Metric, string> = {
  revenueCents: "Revenue",
  registrations: "Registrations",
};

/** Sell-through ratio; capacity 0 (uncapped) sorts last and renders as a dash. */
function sellThrough(row: Row): number {
  return row.capacity > 0 ? row.registrations / row.capacity : -1;
}

/** A thin capacity/rate meter, matching the AnalyticsPanel stat tiles. */
function Meter({ percent }: { percent: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

function ReportsPage() {
  const { data: rows } = useQuery(convexQuery(api.reports.getEventBreakdown, {}));
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "startsAt",
    dir: "desc",
  });
  const [metric, setMetric] = useState<Metric>("revenueCents");

  const totals = useMemo(() => {
    const list = rows ?? [];
    return {
      events: list.length,
      published: list.filter((r) => r.status === "published").length,
      registrations: list.reduce((s, r) => s + r.registrations, 0),
      checkedIn: list.reduce((s, r) => s + r.checkedIn, 0),
      revenueCents: list.reduce((s, r) => s + r.revenueCents, 0),
      capacity: list.reduce((s, r) => s + Math.max(0, r.capacity), 0),
    };
  }, [rows]);
  const currency = rows?.[0]?.currency ?? "USD";
  const checkInRate = totals.registrations > 0 ? (totals.checkedIn / totals.registrations) * 100 : 0;
  const overallSellThrough =
    totals.capacity > 0 ? (totals.registrations / totals.capacity) * 100 : 0;

  const sorted = useMemo(() => {
    if (!rows) return [];
    const dir = sort.dir === "asc" ? 1 : -1;
    const value = (r: Row): number | string =>
      sort.key === "title" ? r.title.toLowerCase()
      : sort.key === "sellThrough" ? sellThrough(r)
      : r[sort.key];
    return [...rows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [rows, sort]);

  // Top 8 by the toggled metric keeps the bar chart readable regardless of how
  // many events an organizer has.
  const chartData = useMemo(() => {
    if (!rows) return [];
    return [...rows]
      .sort((a, b) => b[metric] - a[metric])
      .slice(0, 8)
      .map((r) => ({ title: r.title, value: metric === "revenueCents" ? r.revenueCents / 100 : r.registrations }));
  }, [rows, metric]);

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "title" ? "asc" : "desc" },
    );
  }

  function exportCsv() {
    try {
      const header = ["Event", "Date", "Status", "Registrations", "Check-ins", "Sell-through", "Revenue"];
      const body = (rows ?? []).map((r) => [
        r.title,
        format(new Date(r.startsAt), "yyyy-MM-dd"),
        r.status,
        String(r.registrations),
        String(r.checkedIn),
        r.capacity > 0 ? `${Math.round((r.registrations / r.capacity) * 100)}%` : "",
        (r.revenueCents / 100).toFixed(2),
      ]);
      const csv = [header, ...body].map((row) => row.map((f) => csvField(f)).join(",")).join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "passline-report.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export CSV");
    }
  }

  const hasRows = rows !== undefined && rows.length > 0;

  return (
    <DashboardLayout wide>
      <div className="p-4 md:p-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sales, check-ins, and attendance across all your events.
            </p>
          </div>
          <Button variant="outline" onClick={exportCsv} disabled={!hasRows}>
            <Download /> Export CSV
          </Button>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {rows === undefined ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="mt-2 h-7 w-24" />
                </CardHeader>
              </Card>
            ))
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardDescription>Revenue</CardDescription>
                  <CardTitle className="text-2xl tabular-nums tracking-tight">
                    {formatMoney(totals.revenueCents, currency)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  across {totals.events} {totals.events === 1 ? "event" : "events"}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Registrations</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">{totals.registrations}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  <Meter percent={overallSellThrough} />
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {totals.capacity > 0
                      ? `${Math.round(overallSellThrough)}% of ${totals.capacity} capacity`
                      : "No capacity set"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Check-ins</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">{totals.checkedIn}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  <Meter percent={checkInRate} />
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {Math.round(checkInRate)}% of registrations
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Events</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">{totals.events}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground tabular-nums">
                  {totals.published} published &middot; {totals.events - totals.published} draft
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {rows === undefined ? (
          <Card className="mb-6">
            <CardContent className="pt-6">
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        ) : hasRows ? (
          <Card className="mb-6">
            <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
              <div>
                <CardTitle>{METRIC_LABEL[metric]} by event</CardTitle>
                <CardDescription>
                  Top {Math.min(8, rows.length)} of {rows.length}{" "}
                  {rows.length === 1 ? "event" : "events"} by {METRIC_LABEL[metric].toLowerCase()}.
                </CardDescription>
              </div>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={metric}
                onValueChange={(v) => v && setMetric(v as Metric)}
              >
                <ToggleGroupItem value="revenueCents" className="h-8 px-3">Revenue</ToggleGroupItem>
                <ToggleGroupItem value="registrations" className="h-8 px-3">Registrations</ToggleGroupItem>
              </ToggleGroup>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
                <BarChart accessibilityLayer data={chartData} margin={{ left: 12, right: 12, top: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="title"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    interval={0}
                    tickFormatter={(v: string) => (v.length > 10 ? `${v.slice(0, 10)}…` : v)}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    tickFormatter={(v: number) =>
                      metric === "revenueCents"
                        ? formatMoney(v * 100, currency)
                        : String(v)
                    }
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelKey="title"
                        formatter={(value) => (
                          <span className="tabular-nums">
                            {metric === "revenueCents"
                              ? formatMoney(Number(value) * 100, currency)
                              : `${value} registrations`}
                          </span>
                        )}
                      />
                    }
                  />
                  <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <div className="overflow-x-auto">
            {rows === undefined ? (
              <div className="space-y-3 p-6">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <Empty className="mt-12">
                <EmptyHeader>
                  <EmptyTitle>No events yet</EmptyTitle>
                  <EmptyDescription>Create an event to see performance here.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead label="Event" sortKey="title" sort={sort} onSort={toggleSort} />
                    <SortHead label="Date" sortKey="startsAt" sort={sort} onSort={toggleSort} />
                    <TableHead>Status</TableHead>
                    <SortHead label="Registrations" sortKey="registrations" sort={sort} onSort={toggleSort} align="right" />
                    <SortHead label="Check-ins" sortKey="checkedIn" sort={sort} onSort={toggleSort} align="right" />
                    <SortHead label="Sell-through" sortKey="sellThrough" sort={sort} onSort={toggleSort} align="right" />
                    <SortHead label="Revenue" sortKey="revenueCents" sort={sort} onSort={toggleSort} align="right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((row) => {
                    const pct = row.capacity > 0 ? Math.round((row.registrations / row.capacity) * 100) : null;
                    return (
                      <TableRow key={row._id}>
                        <TableCell className="font-medium">{row.title}</TableCell>
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {format(new Date(row.startsAt), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell>
                          <Badge variant={row.status === "published" ? "secondary" : "outline"}>
                            {row.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.registrations}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.checkedIn}</TableCell>
                        <TableCell className="text-right">
                          {pct === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <div className="ml-auto flex w-28 items-center gap-2">
                              <Meter percent={pct} />
                              <span className="w-9 shrink-0 text-right tabular-nums text-muted-foreground">
                                {pct}%
                              </span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.revenueCents, row.currency)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-medium">Total</TableCell>
                    <TableCell colSpan={2} />
                    <TableCell className="text-right tabular-nums">{totals.registrations}</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.checkedIn}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {totals.capacity > 0 ? `${Math.round(overallSellThrough)}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(totals.revenueCents, currency)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function SortHead({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`group inline-flex items-center gap-1 hover:text-foreground ${
          align === "right" ? "flex-row-reverse" : ""
        } ${active ? "text-foreground" : ""}`}
      >
        {label}
        <Icon className={`size-3.5 ${active ? "" : "text-muted-foreground/50"}`} />
      </button>
    </TableHead>
  );
}
