import { Suspense } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { ScanLine } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AuthGuard } from "@/components/AuthGuard";
import { AttendeeTable } from "@/components/AttendeeTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/events/$id")({ component: EventManagePage });

function EventManagePage() {
  const { id } = Route.useParams();
  const eventId = id as Id<"events">;

  return (
    <AuthGuard>
      <Suspense
        fallback={<div className="p-8 text-sm text-muted-foreground">Loading event…</div>}
      >
        <EventManageContent eventId={eventId} />
      </Suspense>
    </AuthGuard>
  );
}

function EventManageContent({ eventId }: { eventId: Id<"events"> }) {
  // Reactive query: any RSVP change (new RSVP, cancellation, waitlist
  // autopilot promotion) re-renders this page live, with no manual refetch.
  const { data } = useSuspenseQuery(convexQuery(api.events.getMyEventWithRsvps, { eventId }));
  const { event, confirmed, pendingClaim, waitlisted, checkedIn } = data;

  const publishEvent = useMutation(api.events.publishEvent);
  const unpublishEvent = useMutation(api.events.unpublishEvent);
  const cancelRsvp = useMutation(api.rsvps.cancelRsvp);

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

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{event.title}</h1>
          <Badge variant={isPublished ? "default" : "secondary"} className="mt-2">
            {event.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link to="/events/$id/door" params={{ id: eventId }}>
              <ScanLine /> Door check-in
            </Link>
          </Button>
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
      </div>
    </div>
  );
}
