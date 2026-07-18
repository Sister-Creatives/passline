import { Suspense, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Camera, LoaderCircle, ScanLine, TriangleAlert, Users } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";

import { spring } from "@/lib/motion";
import { playScanFeedback, signalForResult } from "@/lib/scan-feedback";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AuthGuard } from "@/components/AuthGuard";
import { BoxOfficeSaleDialog } from "@/components/BoxOfficeSaleDialog";
import { CameraScanner } from "@/components/CameraScanner";
import { KioskShell, KioskHeader, StatMeterCard } from "@/components/kiosk";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
    <KioskShell>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-8 w-48" />
      <Skeleton className="mt-6 h-36 w-full rounded-2xl" />
      <Skeleton className="mt-6 h-12 w-full rounded-md" />
    </KioskShell>
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
  const [cameraOn, setCameraOn] = useState(false);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  // Monotonic sequence so the result card re-mounts (and re-flashes) on every
  // scan, even when two identical verdicts land back to back.
  const [seq, setSeq] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const form = useForm<ScanValues>({
    resolver: zodResolver(scanSchema),
    defaultValues: { code: "" },
  });

  // Shared by the manual field and the camera scanner, so both go through the
  // same mode-aware check-in/out, feedback, and result-card path.
  async function submitCode(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    try {
      const data =
        mode === "in"
          ? await checkInTicket({ code: trimmed })
          : await checkOutTicket({ code: trimmed });
      setOutcome({ mode, data } as ScanOutcome);
      setSeq((n) => n + 1);
      playScanFeedback(signalForResult(data.result));
      form.reset();
    } catch (error) {
      playScanFeedback("error");
      toast.error(
        error instanceof Error ? error.message : mode === "in" ? "Check-in failed" : "Check-out failed",
      );
    } finally {
      // Keyboard-wedge scanners type into whatever is focused; re-pin the
      // input so the next scan never lands in the void after a toggle/tap.
      inputRef.current?.focus();
    }
  }

  function onSubmit(values: ScanValues) {
    void submitCode(values.code);
  }

  const insidePercent = data.total > 0 ? Math.round((data.currentlyInside / data.total) * 100) : 0;

  return (
    <KioskShell>
      <KioskHeader
        eventTitle={eventData.event.title}
        title="Scan tickets"
        live
        actions={
          <>
            <BoxOfficeSaleDialog eventId={eventId} currency={currency} />
            <Button asChild variant="ghost" size="sm">
              <Link to="/events/$id" params={{ id: eventId }}>
                <ArrowLeft /> Back to event
              </Link>
            </Button>
          </>
        }
      />

      <StatMeterCard
        icon={<Users />}
        label="Currently inside"
        value={data.currentlyInside}
        total={data.total}
        percent={insidePercent}
        sub={`${data.currentlyInside} of ${data.total} checked in`}
      />

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => value && setMode(value as ScanMode)}
          variant="outline"
          className="grid w-full grid-cols-2 sm:flex sm:w-fit"
        >
          <ToggleGroupItem value="in" className="h-10">Check in</ToggleGroupItem>
          <ToggleGroupItem value="out" className="h-10">Check out</ToggleGroupItem>
        </ToggleGroup>
        <Button
          type="button"
          variant={cameraOn ? "default" : "outline"}
          className="h-10 w-full sm:w-auto"
          onClick={() => setCameraOn((v) => !v)}
        >
          <Camera /> {cameraOn ? "Stop camera" : "Scan with camera"}
        </Button>
      </div>

      {cameraOn ? (
        <CameraScanner onDecode={(value) => void submitCode(value)} className="mt-4" />
      ) : null}

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start"
        >
          <FormField
            control={form.control}
            name="code"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel className="sr-only">Ticket code</FormLabel>
                <FormControl>
                  <div className="relative">
                    <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="h-12 pl-10 text-base"
                      placeholder="Scan or enter ticket code"
                      autoFocus
                      {...field}
                      ref={(el) => {
                        field.ref(el);
                        inputRef.current = el;
                      }}
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            size="lg"
            className="h-12 w-full px-6 sm:w-auto"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting && <LoaderCircle className="animate-spin" />}
            {mode === "in" ? "Check in" : "Check out"}
          </Button>
        </form>
      </Form>

      {outcome && (
        <motion.div
          key={seq}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={spring.snappy}
        >
          <ScanResultCard outcome={outcome} />
        </motion.div>
      )}
    </KioskShell>
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
