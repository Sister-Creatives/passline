import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { format } from "date-fns";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download } from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { FunctionReturnType } from "convex/server";

import { api } from "../../convex/_generated/api";
import { DashboardLayout } from "@/components/DashboardLayout";
import { csvField } from "@/lib/csv";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

export const Route = createFileRoute("/marketing")({ component: MarketingPage });

type Campaign = FunctionReturnType<typeof api.marketing.listAllCampaigns>[number];
type SortKey = "subject" | "eventTitle" | "recipientCount" | "createdAt";

const chartConfig = {
  value: { label: "Recipients", color: "var(--chart-1)" },
} satisfies ChartConfig;

// Below this, a bar chart is a lonelier read than the table itself.
const MIN_CAMPAIGNS_FOR_CHART = 3;

function MarketingPage() {
  const { data: campaigns } = useQuery(convexQuery(api.marketing.listAllCampaigns, {}));
  const { data: counts } = useQuery(convexQuery(api.organizers.getSidebarCounts, {}));
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "createdAt",
    dir: "desc",
  });

  const stats = useMemo(() => {
    const list = campaigns ?? [];
    return {
      count: list.length,
      emails: list.reduce((s, c) => s + c.recipientCount, 0),
      events: new Set(list.map((c) => c.eventId)).size,
    };
  }, [campaigns]);

  const sorted = useMemo(() => {
    if (!campaigns) return [];
    const dir = sort.dir === "asc" ? 1 : -1;
    const value = (c: Campaign): number | string =>
      sort.key === "subject" ? c.subject.toLowerCase()
      : sort.key === "eventTitle" ? c.eventTitle.toLowerCase()
      : c[sort.key];
    return [...campaigns].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [campaigns, sort]);

  // Most recent up-to-8 campaigns, oldest-to-newest so the chart reads left-to-right.
  const chartData = useMemo(() => {
    if (!campaigns) return [];
    return campaigns
      .slice(0, 8)
      .map((c) => ({ subject: c.subject, value: c.recipientCount }))
      .reverse();
  }, [campaigns]);

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "recipientCount" || key === "createdAt" ? "desc" : "asc" },
    );
  }

  function exportCsv() {
    try {
      const header = ["Subject", "Event", "Recipients", "Sent"];
      const body = (campaigns ?? []).map((c) => [
        c.subject,
        c.eventTitle,
        String(c.recipientCount),
        format(new Date(c.createdAt), "yyyy-MM-dd"),
      ]);
      const csv = [header, ...body].map((row) => row.map((f) => csvField(f)).join(",")).join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "passline-campaigns.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export CSV");
    }
  }

  const hasCampaigns = campaigns !== undefined && campaigns.length > 0;
  const loading = campaigns === undefined || counts === undefined;

  return (
    <DashboardLayout>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Marketing</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Reach your attendees across every event.
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!hasCampaigns}>
          <Download /> Export CSV
        </Button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-4 w-20" />
                <Skeleton className="mt-2 h-7 w-16" />
              </CardHeader>
            </Card>
          ))
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardDescription>Contacts</CardDescription>
                <CardTitle className="text-2xl tabular-nums tracking-tight">
                  {counts?.attendees ?? 0}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                across your events
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Campaigns sent</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{stats.count}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Emails sent</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{stats.emails}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground tabular-nums">
                {stats.count > 0
                  ? `${Math.round(stats.emails / stats.count)} avg per campaign`
                  : "—"}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Events reached</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{stats.events}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground tabular-nums">
                of {counts?.events ?? 0} total
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {hasCampaigns && campaigns.length >= MIN_CAMPAIGNS_FOR_CHART ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Recipients by campaign</CardTitle>
            <CardDescription>
              The {Math.min(8, campaigns.length)} most recent campaigns.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
              <BarChart accessibilityLayer data={chartData} margin={{ left: 12, right: 12, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="subject"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval={0}
                  tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 12)}…` : v)}
                />
                <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelKey="subject"
                      formatter={(value) => (
                        <span className="tabular-nums">{value} recipients</span>
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

      <h2 className="mb-3 text-lg font-medium">Campaigns</h2>

      {campaigns === undefined ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : campaigns.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No campaigns yet</EmptyTitle>
            <EmptyDescription>
              Compose an email from an event's Marketing tab to reach its attendees.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead label="Subject" sortKey="subject" sort={sort} onSort={toggleSort} />
                  <SortHead label="Event" sortKey="eventTitle" sort={sort} onSort={toggleSort} />
                  <SortHead label="Recipients" sortKey="recipientCount" sort={sort} onSort={toggleSort} align="right" />
                  <SortHead label="Sent" sortKey="createdAt" sort={sort} onSort={toggleSort} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((c) => (
                  <TableRow key={c._id}>
                    <TableCell className="font-medium">{c.subject}</TableCell>
                    <TableCell>
                      <Link
                        to="/events/$id"
                        params={{ id: c.eventId }}
                        className="text-muted-foreground hover:text-foreground hover:underline"
                      >
                        {c.eventTitle}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.recipientCount}</TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {format(new Date(c.createdAt), "MMM d, yyyy")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-medium">Total</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums">{stats.emails}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </Card>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Campaigns are composed per event, from each event's Marketing tab.
      </p>
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
