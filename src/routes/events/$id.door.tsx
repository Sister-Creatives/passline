import { Suspense, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Camera, DoorOpen, LoaderCircle, ScanLine } from "lucide-react";
import { toast } from "sonner";

import { playScanFeedback, signalForResult } from "@/lib/scan-feedback";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AuthGuard } from "@/components/AuthGuard";
import { CameraScanner } from "@/components/CameraScanner";
import { KioskShell, KioskHeader, StatMeterCard } from "@/components/kiosk";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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

export const Route = createFileRoute("/events/$id/door")({ component: DoorPage });

const checkInSchema = z.object({
  token: z.string().min(1, "Paste or scan a ticket token"),
});

type CheckInValues = z.infer<typeof checkInSchema>;

function DoorPage() {
  const { id } = Route.useParams();
  const eventId = id as Id<"events">;

  return (
    <AuthGuard>
      <Suspense fallback={<DoorSkeleton />}>
        <DoorContent eventId={eventId} />
      </Suspense>
    </AuthGuard>
  );
}

function DoorSkeleton() {
  return (
    <KioskShell>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-8 w-48" />
      <Skeleton className="mt-6 h-36 w-full rounded-2xl" />
      <Skeleton className="mt-6 h-12 w-full rounded-md" />
    </KioskShell>
  );
}

function DoorContent({ eventId }: { eventId: Id<"events"> }) {
  // Reactive query: as staff check attendees in (from this tab or any other),
  // the counters and recent list update live with no manual refetch.
  const { data } = useSuspenseQuery(convexQuery(api.rsvps.getDoorState, { eventId }));
  const checkIn = useMutation(api.rsvps.checkIn);
  const inputRef = useRef<HTMLInputElement>(null);

  const form = useForm<CheckInValues>({
    resolver: zodResolver(checkInSchema),
    defaultValues: { token: "" },
  });

  const [cameraOn, setCameraOn] = useState(false);
  const remaining = Math.max(0, data.confirmed - data.checkedIn);
  const percent = data.confirmed > 0 ? Math.round((data.checkedIn / data.confirmed) * 100) : 0;

  // Shared by the manual field and the camera scanner.
  async function submitToken(token: string) {
    const trimmed = token.trim();
    if (!trimmed) return;
    try {
      const result = await checkIn({ token: trimmed });
      playScanFeedback(signalForResult(result.status));
      if (result.status === "checked_in") {
        toast.success("Checked in");
      } else if (result.status === "already") {
        toast.info("Already checked in");
      } else {
        toast.error("Not confirmed, cannot check in");
      }
      form.reset();
    } catch (error) {
      playScanFeedback("error");
      toast.error(error instanceof Error ? error.message : "Check-in failed");
    } finally {
      // Re-pin focus so the next keyboard-wedge scan doesn't drop silently.
      inputRef.current?.focus();
    }
  }

  function onSubmit(values: CheckInValues) {
    void submitToken(values.token);
  }

  return (
    <KioskShell>
      <KioskHeader
        eventTitle={data.eventTitle}
        title="Door check-in"
        live
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link to="/events/$id" params={{ id: eventId }}>
              <ArrowLeft /> Back to event
            </Link>
          </Button>
        }
      />

      <StatMeterCard
        icon={<DoorOpen />}
        label="Checked in"
        value={data.checkedIn}
        total={data.confirmed}
        percent={percent}
        sub={`${percent}% · ${remaining} still to arrive`}
      />

      <div className="mt-6 flex justify-end">
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
        <CameraScanner onDecode={(value) => void submitToken(value)} className="mt-4" />
      ) : null}

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-start"
        >
          <FormField
            control={form.control}
            name="token"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel className="sr-only">Ticket token</FormLabel>
                <FormControl>
                  <div className="relative">
                    <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="h-12 pl-10 text-base"
                      placeholder="Paste or scan ticket token"
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
            Check in
          </Button>
        </form>
      </Form>

      <section className="mt-8">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Recent check-ins
        </h2>
        {data.recent.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No check-ins yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60 bg-card/50">
            {data.recent.map((attendee, index) => (
              <li
                key={`${attendee.name}-${attendee.at}-${index}`}
                className="flex items-center gap-3 px-4 py-3"
              >
                <Avatar className="size-8 shrink-0 ring-1 ring-border">
                  <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                    {attendee.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{attendee.name}</span>
                <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                  {new Date(attendee.at).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </KioskShell>
  );
}
