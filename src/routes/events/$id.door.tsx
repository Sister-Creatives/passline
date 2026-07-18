import { Suspense, useRef } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { playScanFeedback, signalForResult } from "@/lib/scan-feedback";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AuthGuard } from "@/components/AuthGuard";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-8 w-48" />
      <Skeleton className="mt-6 h-32 w-full" />
      <Skeleton className="mt-6 h-10 w-full" />
    </div>
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

  const remaining = Math.max(0, data.confirmed - data.checkedIn);
  const percent = data.confirmed > 0 ? Math.round((data.checkedIn / data.confirmed) * 100) : 0;

  async function onSubmit(values: CheckInValues) {
    try {
      const result = await checkIn({ token: values.token.trim() });
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

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{data.eventTitle}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Door check-in</h1>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/events/$id" params={{ id: eventId }}>
            <ArrowLeft /> Back to event
          </Link>
        </Button>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardDescription>Checked in</CardDescription>
          <CardTitle className="text-4xl font-bold tabular-nums">
            {data.checkedIn}
            <span className="text-2xl font-medium text-muted-foreground"> / {data.confirmed}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            {percent}% &middot; {remaining} still to arrive
          </p>
        </CardContent>
      </Card>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 flex items-start gap-2">
          <FormField
            control={form.control}
            name="token"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel className="sr-only">Ticket token</FormLabel>
                <FormControl>
                  <Input
                    className="h-11 text-base"
                    placeholder="Paste or scan ticket token"
                    autoFocus
                    {...field}
                    ref={(el) => {
                      field.ref(el);
                      inputRef.current = el;
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" size="lg" className="h-11" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <LoaderCircle className="animate-spin" />}
            Check in
          </Button>
        </form>
      </Form>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-muted-foreground">Recent check-ins</h2>
        {data.recent.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No check-ins yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border/60">
            {data.recent.map((attendee, index) => (
              <li
                key={`${attendee.name}-${attendee.at}-${index}`}
                className="flex items-center gap-3 py-2.5"
              >
                <Avatar className="size-8 shrink-0">
                  <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
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
    </div>
  );
}
