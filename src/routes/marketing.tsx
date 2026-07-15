import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { format } from "date-fns";
import { UsersRoundIcon } from "lucide-react";

import { api } from "../../convex/_generated/api";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

export const Route = createFileRoute("/marketing")({ component: MarketingPage });

function MarketingPage() {
  const { data: campaigns } = useQuery(convexQuery(api.marketing.listAllCampaigns, {}));
  const { data: counts } = useQuery(convexQuery(api.organizers.getSidebarCounts, {}));

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Marketing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reach your attendees across every event.
        </p>
      </div>

      <Card className="mb-6">
        <CardContent className="flex items-center gap-4 pt-6">
          <div className="flex size-12 items-center justify-center rounded-lg bg-sidebar-accent">
            <UsersRoundIcon className="size-6 text-muted-foreground" />
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">{counts?.attendees ?? 0}</div>
            <div className="text-sm text-muted-foreground">Contacts across your events</div>
          </div>
        </CardContent>
      </Card>

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
                  <TableHead>Subject</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead className="text-right">Recipients</TableHead>
                  <TableHead>Sent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
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
                    <TableCell className="text-muted-foreground">
                      {format(new Date(c.createdAt), "MMM d, yyyy")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
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
