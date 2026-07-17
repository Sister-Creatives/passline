import { Suspense, useMemo, useState } from "react";
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
import { filterAndPaginate, type AttendeeBucket, type AttendeeStatusFilter, type MergedAttendee } from "@/lib/attendees";
import { DashboardLayout } from "@/components/DashboardLayout";
import { EventBuilderNav } from "@/components/EventBuilderNav";
import { EventForm } from "@/components/EventForm";
import { EventPerformanceOverview } from "@/components/EventPerformanceOverview";
import { EventMobilePreview } from "@/components/EventMobilePreview";
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
import { NumberedPagination } from "@/components/numbered-pagination";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
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
            <Skeleton className="h-40 w-full shrink-0 lg:h-96 lg:w-60" />
            <div className="min-w-0 flex-1 lg:max-w-5xl">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <Skeleton className="h-8 w-64" />
                  <Skeleton className="mt-2 h-5 w-20" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Skeleton className="h-7 w-20" />
                  <Skeleton className="h-7 w-20" />
                  <Skeleton className="h-7 w-24" />
                  <Skeleton className="h-7 w-20" />
                </div>
              </div>
              <div className="mt-6 flex flex-col gap-6">
                <Skeleton className="h-6 w-40" />
                <div>
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                  <Skeleton className="mt-2 h-2 w-full rounded-full" />
                </div>
                <div className="flex max-w-2xl flex-col gap-5">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-9 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-9 w-full" />
                  </div>
                  <Skeleton className="h-9 w-32" />
                </div>
              </div>
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
  // The mobile preview mirrors the public event page, so it's only shown while
  // building the event (the "edit" section group), not on the manage tabs.
  const isEditSection = EVENT_SECTIONS.find((s) => s.key === section)?.group === "edit";

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
      {isEditSection && <EventMobilePreview event={event} />}
    </div>
  );
}

// TODO: Continue button and section-nav links navigate immediately and can
// silently discard unsaved EventForm edits (formState.isDirty is scoped
// inside EventForm, not available here). Wire a useBlocker-based confirm
// prompt once form dirty state is lifted to this level.
function ContinueFooter({ eventId, section }: { eventId: Id<"events">; section: EventSectionKey }) {
  const editSections = EVENT_SECTIONS.filter((s) => s.group === "edit");
  const index = editSections.findIndex((s) => s.key === section);
  if (index === -1) return null;
  const next = editSections[index + 1];
  if (!next) return null;

  return (
    <div className="sticky bottom-0 mt-6 flex justify-end border-t border-border/40 bg-muted py-4 dark:bg-background">
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
  const isPublished = event.status === "published";
  const capacityPercent = Math.min(100, (seatsTaken / event.capacity) * 100);
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      {isPublished ? (
        <EventPerformanceOverview eventId={event._id} />
      ) : (
        <>
          <h2 className="text-lg font-medium">Event information</h2>
          <div>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Capacity</span>
              <span className="text-muted-foreground">{seatsTaken} / {event.capacity} seats taken</span>
            </div>
            <div
              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar" aria-valuenow={Math.round(capacityPercent)}
              aria-valuemin={0} aria-valuemax={100} aria-label="Capacity"
            >
              <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${capacityPercent}%` }} />
            </div>
          </div>
        </>
      )}
      <div className="max-w-2xl">
        <EventForm event={event} />
      </div>
    </div>
  );
}

const BUCKET_LABEL: Record<AttendeeBucket, string> = {
  confirmed: "Confirmed", pending: "Pending claim", waitlist: "Waitlist", checkedIn: "Checked in",
};
const FILTERS: { value: AttendeeStatusFilter; label: string }[] = [
  { value: "all", label: "All" }, { value: "confirmed", label: "Confirmed" },
  { value: "pending", label: "Pending" }, { value: "waitlist", label: "Waitlist" },
  { value: "checkedIn", label: "Checked in" },
];
const ATTENDEES_PAGE_SIZE = 10;

function AttendeesSection({ event, rsvps }: { event: EventWithRsvps["event"]; rsvps: EventWithRsvps }) {
  const cancelRsvp = useMutation(api.rsvps.cancelRsvp);
  const { confirmed, pendingClaim, waitlisted, checkedIn } = rsvps;
  const [status, setStatus] = useState<AttendeeStatusFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const all = useMemo<MergedAttendee[]>(() => {
    const tag = (list: EventWithRsvps["confirmed"], bucket: AttendeeBucket): MergedAttendee[] =>
      list.map((a) => ({ _id: a._id, name: a.name, email: a.email, token: a.token, bucket, checkedInAt: a.checkedInAt }));
    return [
      ...tag(confirmed, "confirmed"), ...tag(pendingClaim, "pending"),
      ...tag(waitlisted, "waitlist"), ...tag(checkedIn, "checkedIn"),
    ];
  }, [confirmed, pendingClaim, waitlisted, checkedIn]);

  const counts = useMemo(() => {
    const c: Record<AttendeeStatusFilter, number> = { all: all.length, confirmed: 0, pending: 0, waitlist: 0, checkedIn: 0 };
    for (const a of all) c[a.bucket]++;
    return c;
  }, [all]);

  const result = filterAndPaginate(all, { status, search, page, pageSize: ATTENDEES_PAGE_SIZE });

  async function handleCancel(token: string) {
    try { await cancelRsvp({ token }); toast.success("RSVP cancelled"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Failed to cancel RSVP"); }
  }

  function handleExportCsv() {
    try {
      const header = ["Name", "Email", "Status", "Checked in at"];
      const rows = all.map((a) => [
        a.name, a.email, BUCKET_LABEL[a.bucket],
        a.checkedInAt ? new Date(a.checkedInAt).toLocaleString() : "",
      ]);
      const csv = [header, ...rows].map((row) => row.map((f) => csvField(f)).join(",")).join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `${event.slug}-attendees.csv`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Failed to export CSV"); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          type="single" variant="outline" value={status}
          onValueChange={(v) => { if (v) { setStatus(v as AttendeeStatusFilter); setPage(1); } }}
        >
          {FILTERS.map((f) => (
            <ToggleGroupItem key={f.value} value={f.value} className="h-9">
              {f.label} <span className="ml-1 tabular-nums text-muted-foreground">{counts[f.value]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex items-center gap-2">
          <Input
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search name or email" className="w-56"
          />
          <Button variant="outline" onClick={handleExportCsv}><Download /> Export CSV</Button>
        </div>
      </div>

      {result.total === 0 ? (
        <Empty className="mt-2">
          <EmptyHeader>
            <EmptyTitle>{all.length === 0 ? "No attendees yet" : "No matching attendees"}</EmptyTitle>
            <EmptyDescription>
              {all.length === 0 ? "Registrations will appear here." : "Try a different filter or search."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((a) => (
                <TableRow key={a._id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell>{a.email}</TableCell>
                  <TableCell><Badge variant="outline">{BUCKET_LABEL[a.bucket]}</Badge></TableCell>
                  <TableCell className="text-right">
                    {a.bucket === "confirmed" && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm">Cancel</Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Cancel this RSVP?</AlertDialogTitle>
                            <AlertDialogDescription>This frees the seat and cannot be undone.</AlertDialogDescription>
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">{result.total} attendees</span>
            <NumberedPagination page={result.page} pageCount={result.pageCount} onPage={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
