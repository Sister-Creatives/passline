import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { format } from "date-fns";

import { api } from "../../convex/_generated/api";
import { DashboardLayout } from "@/components/DashboardLayout";
import { formatMoney } from "@/lib/format-money";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

export const Route = createFileRoute("/reports")({ component: ReportsPage });

function ReportsPage() {
  const { data: rows } = useQuery(convexQuery(api.reports.getEventBreakdown, {}));

  const totalEvents = rows?.length ?? 0;
  const totalReg = (rows ?? []).reduce((sum, row) => sum + row.registrations, 0);
  const totalCheckedIn = (rows ?? []).reduce((sum, row) => sum + row.checkedIn, 0);
  const totalRevenue = (rows ?? []).reduce((sum, row) => sum + row.revenueCents, 0);
  const currency = rows?.[0]?.currency ?? "USD";

  return (
    <DashboardLayout wide>
      <div className="p-4 md:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sales, check-ins, and attendance across all your events.
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {rows === undefined ? (
            <>
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                  <CardHeader className="pb-2">
                    <Skeleton className="h-4 w-20" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-7 w-16" />
                  </CardContent>
                </Card>
              ))}
            </>
          ) : (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Events</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold tabular-nums">{totalEvents}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Registrations</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold tabular-nums">{totalReg}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Check-ins</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold tabular-nums">{totalCheckedIn}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Revenue</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold tabular-nums">
                    {formatMoney(totalRevenue, currency)}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>

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
                  <EmptyDescription>
                    Create an event to see performance here.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Registrations</TableHead>
                    <TableHead className="text-right">Check-ins</TableHead>
                    <TableHead className="text-right">Sell-through</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row._id}>
                      <TableCell className="font-medium">{row.title}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(row.startsAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.status === "published" ? "secondary" : "outline"}>
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.registrations}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.checkedIn}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {row.capacity > 0
                          ? `${Math.round((row.registrations / row.capacity) * 100)}%`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.revenueCents, row.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
