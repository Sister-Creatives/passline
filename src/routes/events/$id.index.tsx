import { Suspense, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { Download, Pencil, QrCode, ScanLine, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DashboardLayout } from "@/components/DashboardLayout";
import { AttendeeTable } from "@/components/AttendeeTable";
import { EventForm } from "@/components/EventForm";
import { TicketTypesPanel } from "@/components/TicketTypesPanel";
import { OrdersPanel } from "@/components/OrdersPanel";
import { PromoCodesPanel } from "@/components/PromoCodesPanel";
import { CheckoutQuestionsPanel } from "@/components/CheckoutQuestionsPanel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/events/$id/")({ component: EventManagePage });

function EventManagePage() {
  const { id } = Route.useParams();
  const eventId = id as Id<"events">;

  return (
    <DashboardLayout>
      <Suspense
        fallback={
          <div className="mx-auto flex max-w-4xl flex-col gap-3 p-4 sm:p-8">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        }
      >
        <EventManageContent eventId={eventId} />
      </Suspense>
    </DashboardLayout>
  );
}

/** CSV-escapes a single field: wraps in double quotes, doubling any embedded quotes. */
function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Human-friendly labels for RSVP statuses (used in the CSV and the UI). */
const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  confirmed_pending_claim: "Pending claim",
  waitlisted: "Waitlisted",
  checked_in: "Checked in",
  cancelled: "Cancelled",
};

function EventManageContent({ eventId }: { eventId: Id<"events"> }) {
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);

  // Reactive query: any RSVP change (new RSVP, cancellation, waitlist
  // autopilot promotion) re-renders this page live, with no manual refetch.
  const { data } = useSuspenseQuery(convexQuery(api.events.getMyEventWithRsvps, { eventId }));
  const { event, confirmed, pendingClaim, waitlisted, checkedIn } = data;

  const publishEvent = useMutation(api.events.publishEvent);
  const unpublishEvent = useMutation(api.events.unpublishEvent);
  const cancelRsvp = useMutation(api.rsvps.cancelRsvp);
  const deleteEvent = useMutation(api.events.deleteEvent);

  const isPublished = event.status === "published";
  // Matches the backend's countSeatsTaken: confirmed + confirmed_pending_claim
  // + checked_in. Checked-in attendees leave the `confirmed` bucket, so they
  // must be added back in here or the meter under-counts taken seats.
  const seatsTaken = confirmed.length + pendingClaim.length + checkedIn.length;
  const capacityPercent = Math.min(100, (seatsTaken / event.capacity) * 100);

  async function handleTogglePublish() {
    try {
      if (isPublished) {
        await unpublishEvent({ eventId });
        toast.success("Event unpublished");
      } else {
        await publishEvent({ eventId });
        toast.success("Event published");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update event");
    }
  }

  async function handleCancel(token: string) {
    try {
      await cancelRsvp({ token });
      toast.success("RSVP cancelled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel RSVP");
    }
  }

  async function handleDelete() {
    try {
      await deleteEvent({ eventId });
      toast.success("Event deleted");
      navigate({ to: "/events" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete event");
    }
  }

  function handleExportCsv() {
    try {
      const header = ["Name", "Email", "Status", "Checked in at"];
      const attendees = [...confirmed, ...pendingClaim, ...waitlisted, ...checkedIn];
      const rows = attendees.map((attendee) => [
        attendee.name,
        attendee.email,
        STATUS_LABEL[attendee.status] ?? attendee.status,
        attendee.checkedInAt ? new Date(attendee.checkedInAt).toLocaleString() : "",
      ]);
      const csv = [header, ...rows]
        .map((row) => row.map((field) => csvEscape(field)).join(","))
        .join("\r\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${event.slug}-attendees.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export CSV");
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-8">
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="tickets">Ticket types</TabsTrigger>
          <TabsTrigger value="promo">Promo codes</TabsTrigger>
          <TabsTrigger value="questions">Questions</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
        </TabsList>
        <TabsContent value="details">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">{event.title}</h1>
              <Badge variant={isPublished ? "default" : "secondary"} className="mt-2">
                {event.status}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline">
                <Link to="/events/$id/door" params={{ id: eventId }}>
                  <ScanLine /> Door check-in
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/events/$id/scan" params={{ id: eventId }}>
                  <QrCode /> Scan tickets
                </Link>
              </Button>
              <Button variant="outline" onClick={handleExportCsv}>
                <Download /> Export CSV
              </Button>
              <Dialog open={editOpen} onOpenChange={setEditOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Pencil /> Edit
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Edit event</DialogTitle>
                    <DialogDescription>Update the details guests will see.</DialogDescription>
                  </DialogHeader>
                  <EventForm event={event} onDone={() => setEditOpen(false)} />
                </DialogContent>
              </Dialog>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">
                    <Trash2 /> Delete event
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this event?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently deletes the event and all RSVPs. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={handleDelete}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button onClick={handleTogglePublish} variant={isPublished ? "outline" : "default"}>
                {isPublished ? "Unpublish" : "Publish"}
              </Button>
            </div>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Capacity</span>
              <span className="text-muted-foreground">
                {seatsTaken} / {event.capacity} seats taken
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${capacityPercent}%` }}
              />
            </div>
          </div>

          <div className="mt-8 grid gap-8">
            <AttendeeTable
              title={`Confirmed (${confirmed.length})`}
              attendees={confirmed}
              emptyMessage="No confirmed attendees yet."
              renderAction={(attendee) => (
                <Button variant="outline" size="sm" onClick={() => handleCancel(attendee.token)}>
                  Cancel
                </Button>
              )}
            />
            <AttendeeTable
              title={`Pending claim (${pendingClaim.length})`}
              attendees={pendingClaim}
              emptyMessage="No one is currently claiming a seat."
            />
            <AttendeeTable
              title={`Waitlist (${waitlisted.length})`}
              attendees={waitlisted}
              emptyMessage="The waitlist is empty."
            />
            <AttendeeTable
              title={`Checked in (${checkedIn.length})`}
              attendees={checkedIn}
              emptyMessage="No one has checked in yet."
            />
          </div>
        </TabsContent>
        <TabsContent value="tickets">
          <TicketTypesPanel eventId={event._id} currency={event.currency ?? "USD"} />
        </TabsContent>
        <TabsContent value="promo">
          <PromoCodesPanel eventId={event._id} currency={event.currency ?? "USD"} />
        </TabsContent>
        <TabsContent value="questions">
          <CheckoutQuestionsPanel eventId={event._id} />
        </TabsContent>
        <TabsContent value="orders">
          <OrdersPanel eventId={event._id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
