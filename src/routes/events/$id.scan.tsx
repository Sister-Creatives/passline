import { Suspense, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, LoaderCircle, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AuthGuard } from "@/components/AuthGuard";
import { BoxOfficeSaleDialog } from "@/components/BoxOfficeSaleDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export const Route = createFileRoute("/events/$id/scan")({ component: ScanPage });

const scanSchema = z.object({
  code: z.string().min(1, "Enter or scan a ticket code"),
});

type ScanValues = z.infer<typeof scanSchema>;

type CheckInResult = FunctionReturnType<typeof api.ticketCheckin.checkInTicket>;
type CheckOutResult = FunctionReturnType<typeof api.ticketCheckin.checkOutTicket>;
type ScanMode = "in" | "out";
/**
 * Tags the mutation's structured result with which mode produced it (F18
 * §6), so `ScanResultCard` can render check-in's "ok"/"already" and
 * check-out's "ok"/"not_in" cases distinctly -- most notably the "ok" case,
 * whose ticket/gate-alert shape is identical either way but means "checked
 * in" for one mode and "checked out" for the other.
 */
type ScanOutcome = { mode: "in"; data: CheckInResult } | { mode: "out"; data: CheckOutResult };

function ScanPage() {
  const { id } = Route.useParams();
  const eventId = id as Id<"events">;

  return (
    <AuthGuard>
      <Suspense fallback={<ScanSkeleton />}>
        <ScanContent eventId={eventId} />
      </Suspense>
    </AuthGuard>
  );
}

function ScanSkeleton() {
  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-6 h-24 w-full" />
      <Skeleton className="mt-8 h-10 w-full" />
    </div>
  );
}

function ScanContent({ eventId }: { eventId: Id<"events"> }) {
  // Reactive query: the live count (including currentlyInside) updates as
  // scans land, from this tab or any other door device, with no manual
  // refetch.
  const { data } = useSuspenseQuery(convexQuery(api.ticketCheckin.getScanState, { eventId }));
  // Only `event.currency` is needed here (for the box-office form's price
  // display), but there's no lighter owner-scoped event query to reuse, so
  // this pulls in `getMyEventWithRsvps`'s RSVP lists too.
  const { data: eventData } = useSuspenseQuery(
    convexQuery(api.events.getMyEventWithRsvps, { eventId }),
  );
  const currency = eventData.event.currency ?? "USD";

  const checkInTicket = useMutation(api.ticketCheckin.checkInTicket);
  const checkOutTicket = useMutation(api.ticketCheckin.checkOutTicket);
  const [mode, setMode] = useState<ScanMode>("in");
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);

  const form = useForm<ScanValues>({
    resolver: zodResolver(scanSchema),
    defaultValues: { code: "" },
  });

  async function onSubmit(values: ScanValues) {
    try {
      if (mode === "in") {
        const data = await checkInTicket({ code: values.code.trim() });
        setOutcome({ mode: "in", data });
      } else {
        const data = await checkOutTicket({ code: values.code.trim() });
        setOutcome({ mode: "out", data });
      }
      form.reset();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : mode === "in" ? "Check-in failed" : "Check-out failed",
      );
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Scan tickets</h1>
        <div className="flex items-center gap-2">
          <BoxOfficeSaleDialog eventId={eventId} currency={currency} />
          <Button asChild variant="ghost" size="sm">
            <Link to="/events/$id" params={{ id: eventId }}>
              <ArrowLeft /> Back to event
            </Link>
          </Button>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardDescription>Currently inside</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-5xl font-bold tabular-nums">
            {data.currentlyInside} / {data.total}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">checked in</p>
        </CardContent>
      </Card>

      <ToggleGroup
        type="single"
        value={mode}
        onValueChange={(value) => value && setMode(value as ScanMode)}
        variant="outline"
        className="mt-6"
      >
        <ToggleGroupItem value="in">Check in</ToggleGroupItem>
        <ToggleGroupItem value="out">Check out</ToggleGroupItem>
      </ToggleGroup>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-4 flex items-start gap-2">
          <FormField
            control={form.control}
            name="code"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel className="sr-only">Ticket code</FormLabel>
                <FormControl>
                  <Input placeholder="Scan or enter ticket code" autoFocus {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <LoaderCircle className="animate-spin" />}
            {mode === "in" ? "Check in" : "Check out"}
          </Button>
        </form>
      </Form>

      {outcome && <ScanResultCard outcome={outcome} />}
    </div>
  );
}

/** Formats an epoch-ms timestamp as a local time string, e.g. "3:45:12 PM". */
function formatTime(at: number) {
  return new Date(at).toLocaleTimeString();
}

function ScanResultCard({ outcome }: { outcome: ScanOutcome }) {
  const { data } = outcome;
  switch (data.result) {
    case "ok":
      return (
        <Alert className="mt-6 border-emerald-500/50 bg-emerald-500/10">
          <AlertTitle className="text-emerald-700 dark:text-emerald-400">
            {outcome.mode === "in" ? "Checked in" : "Checked out"}
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-1 text-emerald-700/90 dark:text-emerald-400/90">
            {data.ticket.attendeeName && <span>{data.ticket.attendeeName}</span>}
            {data.ticketTypeName && <span>{data.ticketTypeName}</span>}
            {data.gateAlert && <GateAlertBanner message={data.gateAlert} />}
          </AlertDescription>
        </Alert>
      );
    case "already":
      return (
        <Alert className="mt-6 border-amber-500/50 bg-amber-500/10">
          <AlertTitle className="text-amber-700 dark:text-amber-400">
            Already checked in at {formatTime(data.checkedInAt)}
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-1 text-amber-700/90 dark:text-amber-400/90">
            {data.ticket.attendeeName && <span>{data.ticket.attendeeName}</span>}
            {data.gateAlert && <GateAlertBanner message={data.gateAlert} />}
          </AlertDescription>
        </Alert>
      );
    case "not_in":
      return (
        <Alert className="mt-6 border-amber-500/50 bg-amber-500/10">
          <AlertTitle className="text-amber-700 dark:text-amber-400">Not currently inside</AlertTitle>
          <AlertDescription className="flex flex-col gap-1 text-amber-700/90 dark:text-amber-400/90">
            {data.ticket.attendeeName && <span>{data.ticket.attendeeName}</span>}
            {data.gateAlert && <GateAlertBanner message={data.gateAlert} />}
          </AlertDescription>
        </Alert>
      );
    case "cancelled":
      return (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>Ticket cancelled</AlertTitle>
          <AlertDescription>
            {data.ticket.attendeeName ?? "This ticket"} is not valid for entry.
          </AlertDescription>
        </Alert>
      );
    case "not_found":
      return (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>Ticket not found</AlertTitle>
          <AlertDescription>No ticket matches that code.</AlertDescription>
        </Alert>
      );
  }
}

/** Prominent per-ticket-type gate note (e.g. "Check 18+ ID"), spec F7 §5. */
function GateAlertBanner({ message }: { message: string }) {
  return (
    <div className="mt-1 flex items-center gap-2 rounded-md border border-current/30 bg-background/60 px-2.5 py-1.5 font-medium">
      <TriangleAlert className="size-4 shrink-0" />
      {message}
    </div>
  );
}
