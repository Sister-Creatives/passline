import { Suspense } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Copy, Download, QrCode, ScanLine, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { EVENT_SECTIONS, isEventSectionKey, type EventSectionKey } from "@/lib/eventSections";
import { DashboardLayout } from "@/components/DashboardLayout";
import { EventBuilderNav } from "@/components/EventBuilderNav";
import { AttendeeTable } from "@/components/AttendeeTable";
import { EventForm } from "@/components/EventForm";
import { TicketTypesPanel } from "@/components/TicketTypesPanel";
import { SessionsPanel } from "@/components/SessionsPanel";
import { SeatingPanel } from "@/components/SeatingPanel";
import { AddOnsPanel } from "@/components/AddOnsPanel";
import { OrdersPanel } from "@/components/OrdersPanel";
import { AnalyticsPanel } from "@/components/AnalyticsPanel";
import { MarketingPanel } from "@/components/MarketingPanel";
import { PromoCodesPanel } from "@/components/PromoCodesPanel";
import { AccessCodesPanel } from "@/components/AccessCodesPanel";
import { CheckoutQuestionsPanel } from "@/components/CheckoutQuestionsPanel";
import { EventPagePanel } from "@/components/EventPagePanel";
import { VirtualHubPanel } from "@/components/VirtualHubPanel";
import { AccessibilityPanel } from "@/components/AccessibilityPanel";
import { AuditLogPanel } from "@/components/AuditLogPanel";
import { csvField } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type EventWithRsvps = FunctionReturnType<typeof api.events.getMyEventWithRsvps>;

export const Route = createFileRoute("/events/$id/")({
  validateSearch: (search: Record<string, unknown>): { section?: EventSectionKey } => ({
    section: isEventSectionKey(search.section) ? search.section : "details",
  }),
  component: EventManagePage,
});

const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  confirmed_pending_claim: "Pending claim",
  waitlisted: "Waitlisted",
  checked_in: "Checked in",
  cancelled: "Cancelled",
};

const EVENT_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  published: "Published",
};

function EventManagePage() {
  const { id } = Route.useParams();
  const eventId = id as Id<"events">;
  return (
    <DashboardLayout wide>
      <Suspense
        fallback={
          <div className="flex flex-col gap-6 p-4 md:p-6 lg:flex-row lg:gap-8">
            <Skeleton className="hidden h-96 w-60 shrink-0 lg:block" />
            <div className="flex min-w-0 flex-1 flex-col gap-3 lg:max-w-5xl">
              <Skeleton className="h-9 w-64" />
              <Skeleton className="h-64 w-full" />
            </div>
          </div>
        }
      >
        <EventManageContent eventId={eventId} />
      </Suspense>
    </DashboardLayout>
  );
}

function EventManageContent({ eventId }: { eventId: Id<"events"> }) {
  const { section = "details" } = Route.useSearch();
  const navigate = useNavigate();
  const { data } = useSuspenseQuery(convexQuery(api.events.getMyEventWithRsvps, { eventId }));
  const { event, confirmed, pendingClaim, checkedIn } = data;

  const publishEvent = useMutation(api.events.publishEvent);
  const unpublishEvent = useMutation(api.events.unpublishEvent);
  const deleteEvent = useMutation(api.events.deleteEvent);
  const duplicateEvent = useMutation(api.events.duplicateEvent);

  const isPublished = event.status === "published";
  const seatsTaken = confirmed.length + pendingClaim.length + checkedIn.length;

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

  async function handleDelete() {
    try {
      await deleteEvent({ eventId });
      toast.success("Event deleted");
      navigate({ to: "/events" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete event");
    }
  }

  async function handleDuplicate() {
    try {
      const newEventId = await duplicateEvent({ eventId });
      toast.success("Event duplicated");
      navigate({ to: "/events/$id", params: { id: newEventId }, search: { section: "details" } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to duplicate event");
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 lg:flex-row lg:gap-8">
      <EventBuilderNav
        eventId={eventId}
        activeSection={section}
        isPublished={isPublished}
        slug={event.slug}
        onTogglePublish={handleTogglePublish}
      />
      <div className="min-w-0 flex-1 lg:max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{event.title}</h1>
            <Badge variant={isPublished ? "default" : "secondary"} className="mt-2">{EVENT_STATUS_LABEL[event.status] ?? event.status}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/events/$id/door" params={{ id: eventId }}><ScanLine /> Door</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/events/$id/scan" params={{ id: eventId }}><QrCode /> Scan</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={handleDuplicate}><Copy /> Duplicate</Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm"><Trash2 /> Delete</Button>
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
                  <AlertDialogAction variant="destructive" onClick={handleDelete}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <div className="mt-6">
          <SectionContent section={section} event={event} seatsTaken={seatsTaken} rsvps={data} />
        </div>
        <ContinueFooter eventId={eventId} section={section} />
      </div>
    </div>
  );
}

function ContinueFooter({ eventId, section }: { eventId: Id<"events">; section: EventSectionKey }) {
  const editSections = EVENT_SECTIONS.filter((s) => s.group === "edit");
  const index = editSections.findIndex((s) => s.key === section);
  if (index === -1) return null;
  const next = editSections[index + 1];
  if (!next) return null;

  return (
    <div className="sticky bottom-0 mt-6 flex justify-end border-t bg-muted py-4 dark:bg-background">
      <Button asChild>
        <Link to="/events/$id" params={{ id: eventId }} search={{ section: next.key }}>
          Continue
        </Link>
      </Button>
    </div>
  );
}

function SectionContent({
  section, event, seatsTaken, rsvps,
}: {
  section: EventSectionKey;
  event: EventWithRsvps["event"];
  seatsTaken: number;
  rsvps: EventWithRsvps;
}) {
  const currency = event.currency ?? "USD";
  switch (section) {
    case "details": return <DetailsSection event={event} seatsTaken={seatsTaken} />;
    case "attendees": return <AttendeesSection event={event} rsvps={rsvps} />;
    case "tickets": return <TicketTypesPanel eventId={event._id} currency={currency} />;
    case "sessions": return <SessionsPanel eventId={event._id} />;
    case "seating": return <SeatingPanel eventId={event._id} />;
    case "addons": return <AddOnsPanel eventId={event._id} currency={currency} />;
    case "promo": return <PromoCodesPanel eventId={event._id} currency={currency} />;
    case "access": return <AccessCodesPanel eventId={event._id} />;
    case "questions": return <CheckoutQuestionsPanel eventId={event._id} />;
    case "page": return <EventPagePanel eventId={event._id} />;
    case "hub": return <VirtualHubPanel eventId={event._id} />;
    case "accessibility": return <AccessibilityPanel eventId={event._id} />;
    case "orders": return <OrdersPanel eventId={event._id} />;
    case "analytics": return <AnalyticsPanel eventId={event._id} />;
    case "marketing": return <MarketingPanel eventId={event._id} />;
    case "activity": return <AuditLogPanel eventId={event._id} />;
  }
}

function DetailsSection({ event, seatsTaken }: { event: EventWithRsvps["event"]; seatsTaken: number }) {
  const capacityPercent = Math.min(100, (seatsTaken / event.capacity) * 100);
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h2 className="text-lg font-medium">Event information</h2>
      <div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Capacity</span>
          <span className="text-muted-foreground">{seatsTaken} / {event.capacity} seats taken</span>
        </div>
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={Math.round(capacityPercent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Capacity"
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${capacityPercent}%` }} />
        </div>
      </div>
      <EventForm event={event} />
    </div>
  );
}

function AttendeesSection({
  event, rsvps,
}: {
  event: EventWithRsvps["event"];
  rsvps: EventWithRsvps;
}) {
  const cancelRsvp = useMutation(api.rsvps.cancelRsvp);
  const { confirmed, pendingClaim, waitlisted, checkedIn } = rsvps;

  async function handleCancel(token: string) {
    try {
      await cancelRsvp({ token });
      toast.success("RSVP cancelled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel RSVP");
    }
  }

  function handleExportCsv() {
    try {
      const header = ["Name", "Email", "Status", "Checked in at"];
      const attendees = [...confirmed, ...pendingClaim, ...waitlisted, ...checkedIn];
      const rows = attendees.map((a: EventWithRsvps["confirmed"][number]) => [
        a.name, a.email, STATUS_LABEL[a.status] ?? a.status,
        a.checkedInAt ? new Date(a.checkedInAt).toLocaleString() : "",
      ]);
      const csv = [header, ...rows].map((row) => row.map((f: string) => csvField(f)).join(",")).join("\r\n");
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
    <div className="flex flex-col gap-8">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleExportCsv}><Download /> Export CSV</Button>
      </div>
      <AttendeeTable
        title={`Confirmed (${confirmed.length})`}
        attendees={confirmed}
        emptyMessage="No confirmed attendees yet."
        renderAction={(a: EventWithRsvps["confirmed"][number]) => (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">Cancel</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel this RSVP?</AlertDialogTitle>
                <AlertDialogDescription>
                  This frees the seat and cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => handleCancel(a.token)}>
                  Cancel RSVP
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      />
      <AttendeeTable title={`Pending claim (${pendingClaim.length})`} attendees={pendingClaim} emptyMessage="No one is currently claiming a seat." />
      <AttendeeTable title={`Waitlist (${waitlisted.length})`} attendees={waitlisted} emptyMessage="The waitlist is empty." />
      <AttendeeTable title={`Checked in (${checkedIn.length})`} attendees={checkedIn} emptyMessage="No one has checked in yet." />
    </div>
  );
}
