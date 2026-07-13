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

export const Route = createFileRoute("/events/$id/scan")({ component: ScanPage });

const scanSchema = z.object({
  code: z.string().min(1, "Enter or scan a ticket code"),
});

type ScanValues = z.infer<typeof scanSchema>;

type CheckInResult = FunctionReturnType<typeof api.ticketCheckin.checkInTicket>;

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
  // Reactive query: the live count updates as scans land, from this tab or
  // any other door device, with no manual refetch.
  const { data } = useSuspenseQuery(convexQuery(api.ticketCheckin.getScanState, { eventId }));
  const checkInTicket = useMutation(api.ticketCheckin.checkInTicket);
  const [result, setResult] = useState<CheckInResult | null>(null);

  const form = useForm<ScanValues>({
    resolver: zodResolver(scanSchema),
    defaultValues: { code: "" },
  });

  async function onSubmit(values: ScanValues) {
    try {
      const outcome = await checkInTicket({ code: values.code.trim() });
      setResult(outcome);
      form.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Check-in failed");
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Scan tickets</h1>
        <Button asChild variant="ghost" size="sm">
          <Link to="/events/$id" params={{ id: eventId }}>
            <ArrowLeft /> Back to event
          </Link>
        </Button>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardDescription>Checked in</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-5xl font-bold tabular-nums">
            {data.checkedIn} / {data.total}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">checked in</p>
        </CardContent>
      </Card>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-8 flex items-start gap-2">
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
            Check in
          </Button>
        </form>
      </Form>

      {result && <ScanResultCard result={result} />}
    </div>
  );
}

/** Formats an epoch-ms timestamp as a local time string, e.g. "3:45:12 PM". */
function formatTime(at: number) {
  return new Date(at).toLocaleTimeString();
}

function ScanResultCard({ result }: { result: CheckInResult }) {
  switch (result.result) {
    case "ok":
      return (
        <Alert className="mt-6 border-emerald-500/50 bg-emerald-500/10">
          <AlertTitle className="text-emerald-700 dark:text-emerald-400">Checked in</AlertTitle>
          <AlertDescription className="flex flex-col gap-1 text-emerald-700/90 dark:text-emerald-400/90">
            {result.ticket.attendeeName && <span>{result.ticket.attendeeName}</span>}
            {result.ticketTypeName && <span>{result.ticketTypeName}</span>}
            {result.gateAlert && <GateAlertBanner message={result.gateAlert} />}
          </AlertDescription>
        </Alert>
      );
    case "already":
      return (
        <Alert className="mt-6 border-amber-500/50 bg-amber-500/10">
          <AlertTitle className="text-amber-700 dark:text-amber-400">
            Already checked in at {formatTime(result.checkedInAt)}
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-1 text-amber-700/90 dark:text-amber-400/90">
            {result.ticket.attendeeName && <span>{result.ticket.attendeeName}</span>}
            {result.gateAlert && <GateAlertBanner message={result.gateAlert} />}
          </AlertDescription>
        </Alert>
      );
    case "cancelled":
      return (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>Ticket cancelled</AlertTitle>
          <AlertDescription>
            {result.ticket.attendeeName ?? "This ticket"} is not valid for entry.
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
