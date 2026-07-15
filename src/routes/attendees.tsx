import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { SearchIcon, CheckIcon } from "lucide-react";

import { api } from "../../convex/_generated/api";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/attendees")({ component: AttendeesPage });

function statusBadge(status: string) {
  switch (status) {
    case "checked_in":
      return <Badge className="bg-success/15 text-success">Checked in</Badge>;
    case "confirmed":
    case "valid":
      return <Badge variant="secondary">Confirmed</Badge>;
    case "confirmed_pending_claim":
      return <Badge variant="outline">Pending</Badge>;
    case "waitlisted":
      return <Badge variant="outline">Waitlisted</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function AttendeesPage() {
  const { data: rows } = useQuery(convexQuery(api.attendees.listForOrganizer, {}));
  const [q, setQ] = useState("");

  const filtered = (rows ?? []).filter((r) =>
    [r.name, r.email, r.eventTitle].some((v) => v.toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <DashboardLayout wide>
      <div className="p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Attendees</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everyone who has registered across your events.{" "}
          {rows ? `${rows.length} registrations` : ""}
        </p>
      </div>

      <div className="relative mb-4 max-w-sm">
        <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email, or event…"
          className="max-w-sm pl-8"
        />
      </div>

      {rows === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty className="mt-12">
          <EmptyHeader>
            <EmptyTitle>No attendees yet</EmptyTitle>
            <EmptyDescription>
              Registrations across your events will appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Checked in</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r._id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-muted-foreground">{r.email}</TableCell>
                      <TableCell className="text-muted-foreground">{r.eventTitle}</TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell>
                        {r.checkedIn ? (
                          <CheckIcon className="size-4 text-success" />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </DashboardLayout>
  );
}
