import { useId } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { PlusIcon } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis } from "recharts";

import { api } from "../../convex/_generated/api";
import { DashboardLayout } from "@/components/DashboardLayout";
import { formatMoney } from "@/lib/format-money";
import { formatInteger } from "@/lib/formater";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

export const Route = createFileRoute("/dashboard")({ component: OverviewPage });

function OverviewPage() {
  return (
    <DashboardLayout wide>
      <div className="p-4 md:p-6">
        <OverviewContent />
      </div>
    </DashboardLayout>
  );
}

/** "Sat, Jul 20, 3:00 PM" — a compact local date+time for an event start. */
function formatShortDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Jul 20" tick label from a "YYYY-MM-DD" bucket date. */
function formatDayTick(date: string): string {
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 1000 * 60 * 60 * 24 * 365],
  ["month", 1000 * 60 * 60 * 24 * 30],
  ["day", 1000 * 60 * 60 * 24],
  ["hour", 1000 * 60 * 60],
  ["minute", 1000 * 60],
];

/** "2h ago" / "3d ago" for an audit-log timestamp. */
function formatRelative(ms: number): string {
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

/**
 * A "big number + trend badge + gradient area chart" metric card (the
 * dashboard-5 aesthetic), wired to real 30-day data. Falls back to a dashed
 * placeholder when the metric has no activity in the window.
 */
function MetricChartCard({
  headline,
  description,
  deltaPct,
  data,
  dataKey,
  color,
  isEmpty,
  emptyLabel,
  heightClass = "h-40",
}: {
  headline: string;
  description: string;
  deltaPct: number | null;
  data: Array<Record<string, number | string>>;
  dataKey: string;
  color: string;
  isEmpty: boolean;
  emptyLabel: string;
  heightClass?: string;
}) {
  const gradientId = `trend-${useId().replace(/:/g, "")}`;
  const config: ChartConfig = { [dataKey]: { label: description, color } };
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle className="font-mono text-2xl tabular-nums">{headline}</CardTitle>
          <CardDescription className="text-pretty">{description}</CardDescription>
        </div>
        {!isEmpty && deltaPct !== null && (
          <Delta value={Math.round(deltaPct)} variant="badge">
            <DeltaIcon variant="trend" />
            <DeltaValue suffix="%" />
          </Delta>
        )}
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div
            className={`flex ${heightClass} items-center justify-center rounded-lg border border-dashed px-4 text-center text-sm text-muted-foreground`}
          >
            {emptyLabel}
          </div>
        ) : (
          <ChartContainer className={`aspect-auto ${heightClass} w-full`} config={config}>
            <AreaChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={`var(--color-${dataKey})`} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={`var(--color-${dataKey})`} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value) => formatDayTick(String(value))}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    indicator="dashed"
                    labelFormatter={(value) => formatDayTick(String(value))}
                  />
                }
                cursor={{
                  stroke: `var(--color-${dataKey})`,
                  strokeDasharray: "3 3",
                  strokeLinecap: "round",
                }}
                wrapperStyle={{ outline: "none" }}
              />
              <Area
                dataKey={dataKey}
                type="natural"
                fill={`url(#${gradientId})`}
                stroke={`var(--color-${dataKey})`}
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function OverviewContent() {
  const { data, isPending } = useQuery(convexQuery(api.dashboard.getOverview, {}));

  if (isPending || !data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-3 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (data.events.total === 0) {
    return (
      <Empty className="mt-12">
        <EmptyHeader>
          <EmptyTitle>No events yet</EmptyTitle>
          <EmptyDescription>Create your first event to get started.</EmptyDescription>
        </EmptyHeader>
        <Button asChild className="mt-4">
          <Link to="/events/new">
            <PlusIcon /> Create event
          </Link>
        </Button>
      </Empty>
    );
  }

  const { events, attendance, sales, timeseries, deltas, upcomingEvents, recentActivity, cards } =
    data;
  const totalRegistrations = timeseries.reduce((sum, d) => sum + d.registrations, 0);
  const totalCheckIns = timeseries.reduce((sum, d) => sum + d.checkIns, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Overview</h1>
        <Button asChild>
          <Link to="/events/new">
            <PlusIcon /> Create event
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard
          label="Events"
          value={events.total}
          sub={`${events.published} published · ${events.draft} draft`}
          deltaPct={cards.events.deltaPct}
          spark={cards.events.spark}
        />
        <StatCard
          label="Upcoming"
          value={events.upcoming}
          deltaPct={cards.upcoming.deltaPct}
          spark={cards.upcoming.spark}
        />
        <StatCard
          label="Attendees"
          value={attendance.attendees}
          deltaPct={cards.attendees.deltaPct}
          spark={cards.attendees.spark}
        />
        <StatCard
          label="Orders"
          value={sales.orders}
          deltaPct={cards.orders.deltaPct}
          spark={cards.orders.spark}
        />
        <StatCard
          label="Tickets sold"
          value={sales.ticketsSold}
          deltaPct={cards.ticketsSold.deltaPct}
          spark={cards.ticketsSold.spark}
        />
      </div>

      <MetricChartCard
        headline={formatInteger(deltas.registrations.current)}
        description="Registrations · last 30 days"
        deltaPct={deltas.registrations.pct}
        data={timeseries}
        dataKey="registrations"
        color="var(--chart-1)"
        isEmpty={totalRegistrations === 0}
        emptyLabel="No registrations yet."
        heightClass="h-72"
      />

      <div className="grid gap-3 md:grid-cols-2">
        <MetricChartCard
          headline={formatInteger(deltas.checkIns.current)}
          description="Check-ins · last 30 days"
          deltaPct={deltas.checkIns.pct}
          data={timeseries}
          dataKey="checkIns"
          color="var(--chart-4)"
          isEmpty={totalCheckIns === 0}
          emptyLabel="No check-ins yet."
        />
        <MetricChartCard
          headline={formatMoney(deltas.revenue.current, sales.currency)}
          description="Revenue · last 30 days"
          deltaPct={deltas.revenue.pct}
          data={timeseries.map((d) => ({ date: d.date, revenue: Math.round(d.revenueCents / 100) }))}
          dataKey="revenue"
          color="var(--chart-2)"
          isEmpty={sales.revenueCents === 0}
          emptyLabel="No sales yet."
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upcoming events</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {upcomingEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming events.</p>
            ) : (
              upcomingEvents.map((e) => {
                const pct = e.capacity > 0 ? Math.min(100, (e.seatsTaken / e.capacity) * 100) : 0;
                return (
                  <div key={e.id} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        to="/events/$id"
                        params={{ id: e.id }}
                        className="truncate font-medium hover:underline"
                      >
                        {e.title}
                      </Link>
                      <Badge variant={e.status === "published" ? "default" : "secondary"}>
                        {e.status === "published" ? "Published" : "Draft"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{formatShortDate(e.startsAt)}</div>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {e.seatsTaken}/{e.capacity}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              recentActivity.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm">{a.summary}</p>
                    {a.eventTitle && (
                      <p className="truncate text-xs text-muted-foreground">{a.eventTitle}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRelative(a.createdAt)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** A tiny gradient area chart with no axes/grid/tooltip, for a stat card footer. */
function Sparkline({ data }: { data: number[] }) {
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

function StatCard({
  label,
  value,
  sub,
  deltaPct,
  spark,
}: {
  label: string;
  value: string | number;
  sub?: string;
  deltaPct: number | null;
  spark: number[];
}) {
  return (
    <Card className="gap-0 overflow-hidden pb-0">
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
      <Sparkline data={spark} />
    </Card>
  );
}
