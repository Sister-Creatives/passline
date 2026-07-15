import { Suspense } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useAuthActions } from "@convex-dev/auth/react";
import { LogOut, Plus } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

export const Route = createFileRoute("/events/")({ component: EventsIndexPage });

function EventsIndexPage() {
  return (
    <DashboardLayout>
      <Suspense fallback={<TableSkeleton />}>
        <EventsListContent />
      </Suspense>
    </DashboardLayout>
  );
}

function TableSkeleton() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3 p-4 sm:p-8">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function EventsListContent() {
  const { data: events } = useSuspenseQuery(convexQuery(api.events.listMyEvents, {}));
  const { signOut } = useAuthActions();

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Your events</h1>
        <div className="flex items-center gap-2">
          <Button asChild>
            <Link to="/events/new">
              <Plus /> New event
            </Link>
          </Button>
          <Button variant="outline" onClick={() => signOut()}>
            <LogOut /> Sign out
          </Button>
        </div>
      </div>

      <div className="mt-6">
        {events.length === 0 ? (
          <Empty className="mt-6">
            <EmptyHeader>
              <EmptyTitle>No events yet</EmptyTitle>
              <EmptyDescription>Create your first event to get started.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableCaption>A list of your events.</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Capacity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event._id}>
                  <TableCell className="font-medium">
                    <Link
                      to="/events/$id"
                      params={{ id: event._id }}
                      className="hover:underline"
                    >
                      {event.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={event.status === "published" ? "default" : "secondary"}>
                      {event.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{event.capacity}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
