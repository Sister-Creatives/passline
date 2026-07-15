import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { PlusIcon } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";

import { api } from "../../convex/_generated/api";
import { DashboardLayout } from "@/components/DashboardLayout";
import { formatMoney } from "@/lib/format-money";
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

/** "Jul 20" tick label from a "YYYY-MM-DD" bucket date. */
function formatDayTick(date: string): string {
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** A 30-day area trend chart (shadcn Chart + Recharts) keyed on `date`. */
function TrendChart({
  data,
  dataKey,
  label,
  color,
}: {
  data: Array<Record<string, number | string>>;
  dataKey: string;
  label: string;
  color: string;
}) {
  const config: ChartConfig = { [dataKey]: { label, color } };
  return (
    <ChartContainer config={config} className="h-[220px] w-full">
      <AreaChart data={data} margin={{ left: 12, right: 12, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={28}
          tickFormatter={(value) => formatDayTick(String(value))}
        />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent labelFormatter={(value) => formatDayTick(String(value))} />}
        />
        <Area
          dataKey={dataKey}
          type="natural"
          stroke={`var(--color-${dataKey})`}
          fill={`var(--color-${dataKey})`}
          fillOpacity={0.25}
        />
      </AreaChart>
    </ChartContainer>
  );
}

function OverviewContent() {
  const { data, isPending } = useQuery(convexQuery(api.dashboard.getOverview, {}));

  if (isPending || !data) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
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

  const { events, attendance, sales, timeseries, upcomingEvents, recentActivity } = data;
  const totalRegistrations = timeseries.reduce((sum, d) => sum + d.registrations, 0);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Overview</h1>
        <Button asChild>
          <Link to="/events/new">
            <PlusIcon /> Create event
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Events"
          value={events.total}
          sub={`${events.published} published · ${events.draft} draft`}
        />
        <Stat label="Upcoming" value={events.upcoming} />
        <Stat label="Attendees" value={attendance.attendees} />
        <Stat label="Check-ins" value={attendance.checkedIn} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registrations</CardTitle>
          <CardDescription>New registrations in the last 30 days.</CardDescription>
        </CardHeader>
        <CardContent>
          {totalRegistrations === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No registrations yet.</p>
          ) : (
            <TrendChart
              data={timeseries}
              dataKey="registrations"
              label="Registrations"
              color="var(--chart-1)"
            />
          )}
        </CardContent>
      </Card>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Sales</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Revenue" value={formatMoney(sales.revenueCents, sales.currency)} />
          <Stat label="Orders" value={sales.orders} />
          <Stat label="Tickets sold" value={sales.ticketsSold} />
        </div>
        {sales.revenueCents > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Revenue</CardTitle>
              <CardDescription>Revenue in the last 30 days.</CardDescription>
            </CardHeader>
            <CardContent>
              <TrendChart
                data={timeseries.map((d) => ({
                  date: d.date,
                  revenue: Math.round(d.revenueCents / 100),
                }))}
                dataKey="revenue"
                label="Revenue"
                color="var(--chart-2)"
              />
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground">
            No sales yet &mdash; online payments are coming soon.
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
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
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {sub && <CardContent className="text-xs text-muted-foreground">{sub}</CardContent>}
    </Card>
  );
}
