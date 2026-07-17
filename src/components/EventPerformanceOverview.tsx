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
