import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Download } from "lucide-react";
import { toast } from "sonner";

import type { FunctionReturnType } from "convex/server";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatMoney } from "@/lib/format-money";
import { csvField } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

const chartConfig = {
  revenue: {
    label: "Revenue",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  paid: "Paid",
  cancelled: "Cancelled",
};

/** "YYYY-MM-DD" -> "Jul 10" for chart ticks/tooltips. */
function formatDayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Analytics tab (F8): revenue/sales/check-in stat tiles, a daily-revenue
 * sales-over-time chart, a by-ticket-type breakdown table, and an orders CSV
 * export -- all read-only over `analytics.getEventSummary` /
 * `analytics.getSalesTimeseries` / `orders.listOrdersForEvent`. Mirrors
 * OrdersPanel/TicketTypesPanel's Skeleton/Empty/Card shape.
 */
export function AnalyticsPanel({ eventId }: { eventId: Id<"events"> }) {
  const gradientId = `analytics-revenue-${useId().replace(/:/g, "")}`;

  const { data: summary, isPending: summaryPending } = useQuery(
    convexQuery(api.analytics.getEventSummary, { eventId }),
  );
  const { data: timeseries, isPending: timeseriesPending } = useQuery(
    convexQuery(api.analytics.getSalesTimeseries, { eventId }),
  );
  const { data: orders } = useQuery(convexQuery(api.orders.listOrdersForEvent, { eventId }));

  function handleExportCsv() {
    try {
      const header = [
        "Order token",
        "Buyer name",
        "Email",
        "Status",
        "Gross",
        "Discount",
        "Fee",
        "Net",
        "Total",
        "Promo code",
        "Created",
      ];
      const rows = (orders ?? []).map((order) => [
        order.token,
        order.buyerName,
        order.buyerEmail,
        ORDER_STATUS_LABEL[order.status] ?? order.status,
        (order.subtotalCents / 100).toFixed(2),
        ((order.discountCents ?? 0) / 100).toFixed(2),
        (order.feeCents / 100).toFixed(2),
        (order.payoutCents / 100).toFixed(2),
        (order.totalCents / 100).toFixed(2),
        order.promoCode ?? "",
        new Date(order.createdAt).toLocaleString(),
      ]);
      const csv = [header, ...rows]
        .map((row) => row.map((field) => csvField(String(field))).join(","))
        .join("\r\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `orders-${eventId}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export CSV");
    }
  }

  const isLoading = summaryPending || timeseriesPending;
  const hasSales = !!summary && summary.orders.paid > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium">Analytics</h2>
          <p className="text-sm text-muted-foreground">
            Revenue, sales, and check-in activity for this event.
          </p>
        </div>
        <Button variant="outline" onClick={handleExportCsv}>
          <Download /> Export CSV
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : !summary || !timeseries || !hasSales ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No sales yet</EmptyTitle>
            <EmptyDescription>
              Revenue, sales, and check-in charts will appear here once orders are paid.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <AnalyticsContent summary={summary} timeseries={timeseries} gradientId={gradientId} />
      )}
    </div>
  );
}

type EventSummary = FunctionReturnType<typeof api.analytics.getEventSummary>;
type SalesTimeseries = FunctionReturnType<typeof api.analytics.getSalesTimeseries>;

function AnalyticsContent({
  summary,
  timeseries,
  gradientId,
}: {
  summary: EventSummary;
  timeseries: SalesTimeseries;
  gradientId: string;
}) {
  const { revenue, orders, ticketsSold, checkedIn, capacity, byTicketType, currency } = summary;
  const capacityPercent = capacity > 0 ? Math.min(100, (ticketsSold / capacity) * 100) : 0;
  const checkedInPercent = ticketsSold > 0 ? Math.min(100, (checkedIn / ticketsSold) * 100) : 0;

  const chartData = timeseries.map((day) => ({ date: day.date, revenue: day.revenueCents }));

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Net revenue</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {formatMoney(revenue.netPayoutCents, currency)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Tickets sold</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {ticketsSold} / {capacity}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${capacityPercent}%` }}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Checked in</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {checkedIn} / {ticketsSold}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${checkedInPercent}%` }}
              />
            </div>
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

      <Card>
        <CardHeader>
          <CardTitle>Sales over time</CardTitle>
          <CardDescription>Daily revenue from paid orders.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full max-h-72">
            <AreaChart accessibilityLayer data={chartData} margin={{ left: 12, right: 12 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-revenue)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--color-revenue)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="date"
                tickFormatter={formatDayLabel}
                tickLine={false}
                tickMargin={8}
                label={{ value: "Date", position: "insideBottom", offset: -4 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tickMargin={8}
                width={72}
                tickFormatter={(value: number) => formatMoney(value, currency)}
                label={{ value: "Revenue", angle: -90, position: "insideLeft" }}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    labelFormatter={(value) => formatDayLabel(String(value))}
                    formatter={(value, name) => (
                      <div className="flex w-full items-center justify-between gap-4">
                        <span className="text-muted-foreground">{name}</span>
                        <span className="font-mono font-medium tabular-nums text-foreground">
                          {formatMoney(Number(value), currency)}
                        </span>
                      </div>
                    )}
                  />
                }
                cursor={{
                  stroke: "var(--color-revenue)",
                  strokeDasharray: "3 3",
                  strokeLinecap: "round",
                }}
                wrapperStyle={{ outline: "none" }}
              />
              <Area
                dataKey="revenue"
                dot={{ fill: "var(--color-revenue)", r: 2.5, strokeWidth: 2 }}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
                name={chartConfig.revenue.label}
                stroke="var(--color-revenue)"
                strokeWidth={2}
                type="linear"
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>By ticket type</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket type</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byTicketType.map((row) => (
                <TableRow key={row.ticketTypeId}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.sold}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(row.revenueCents, currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
