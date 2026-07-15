import { useId } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { PlusIcon } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";

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
    <DashboardLayout>
      <OverviewContent />
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
 * A "big number + trend badge + gradient area chart" card, mirroring the
 * dashboard-5 VisitorsChart aesthetic, but wired to real 30-day data.
 */
function TrendCard({
  headline,
  description,
  deltaPct,
  data,
  dataKey,
  color,
  className,
}: {
  headline: string;
  description: string;
  deltaPct: number | null;
  data: Array<Record<string, number | string>>;
  dataKey: string;
  color: string;
  className?: string;
}) {
  const gradientId = `trend-${useId().replace(/:/g, "")}`;
  const config: ChartConfig = { [dataKey]: { label: description, color } };
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-start justify-between">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="font-mono text-2xl tabular-nums">{headline}</CardTitle>
          <CardDescription className="text-pretty">{description}</CardDescription>
        </div>
        {deltaPct !== null && (
          <Delta value={Math.round(deltaPct)} variant="badge">
            <DeltaIcon variant="trend" />
            <DeltaValue suffix="%" />
            <span>vs prior 30 days</span>
          </Delta>
        )}
      </CardHeader>
      <CardContent>
        <ChartContainer className="aspect-auto h-56 w-full" config={config}>
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
              minTickGap={28}
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
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
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

  const { events, attendance, sales, timeseries, deltas, upcomingEvents, recentActivity } = data;
  const totalRegistrations = timeseries.reduce((sum, d) => sum + d.registrations, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Overview</h1>
        <Button asChild>
          <Link to="/events/new">
            <PlusIcon /> Create event
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Events"
          value={events.total}
          sub={`${events.published} published · ${events.draft} draft`}
        />
        <Stat label="Upcoming" value={events.upcoming} />
        <Stat label="Attendees" value={attendance.attendees} />
        <Stat label="Check-ins" value={attendance.checkedIn} />
      </div>

      {totalRegistrations > 0 ? (
        <TrendCard
          headline={formatInteger(deltas.registrations.current)}
          description="Registrations in the last 30 days"
          deltaPct={deltas.registrations.pct}
          data={timeseries}
          dataKey="registrations"
          color="var(--chart-1)"
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-2xl tabular-nums">0</CardTitle>
            <CardDescription>Registrations in the last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-center text-sm text-muted-foreground">
              No registrations yet — the trend will appear here as people sign up.
            </div>
          </CardContent>
        </Card>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Sales</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Stat label="Revenue" value={formatMoney(sales.revenueCents, sales.currency)} />
          <Stat label="Orders" value={sales.orders} />
          <Stat label="Tickets sold" value={sales.ticketsSold} />
        </div>
        {sales.revenueCents > 0 ? (
          <TrendCard
            headline={formatMoney(deltas.revenue.current, sales.currency)}
            description="Revenue in the last 30 days"
            deltaPct={deltas.revenue.pct}
            data={timeseries.map((d) => ({
              date: d.date,
              revenue: Math.round(d.revenueCents / 100),
            }))}
            dataKey="revenue"
            color="var(--chart-2)"
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            No sales yet &mdash; online payments are coming soon.
          </p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
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

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-mono text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {sub && <CardContent className="text-xs text-muted-foreground">{sub}</CardContent>}
    </Card>
  );
}
