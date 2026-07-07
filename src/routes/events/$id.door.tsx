import { Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AuthGuard } from "@/components/AuthGuard";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
      <Suspense
        fallback={<div className="p-8 text-sm text-muted-foreground">Loading door…</div>}
      >
        <DoorContent eventId={eventId} />
      </Suspense>
    </AuthGuard>
  );
}

function DoorContent({ eventId }: { eventId: Id<"events"> }) {
  // Reactive query: as staff check attendees in (from this tab or any other),
  // the counters and recent list update live with no manual refetch.
  const { data } = useSuspenseQuery(convexQuery(api.rsvps.getDoorState, { eventId }));
  const checkIn = useMutation(api.rsvps.checkIn);

  const form = useForm<CheckInValues>({
    resolver: zodResolver(checkInSchema),
    defaultValues: { token: "" },
  });

  async function onSubmit(values: CheckInValues) {
    try {
      const result = await checkIn({ token: values.token.trim() });
      if (result.status === "checked_in") {
        toast.success("Checked in");
      } else if (result.status === "already") {
        toast.info("Already checked in");
      } else {
        toast.error("Not confirmed -- cannot check in");
      }
      form.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Check-in failed");
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <h1 className="text-2xl font-semibold">Door check-in</h1>

      <Card className="mt-6">
        <CardHeader>
          <CardDescription>Checked in</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-5xl font-bold tabular-nums">{data.checkedIn}</p>
          <p className="mt-1 text-sm text-muted-foreground">of {data.confirmed} confirmed</p>
        </CardContent>
      </Card>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-8 flex items-start gap-2">
          <FormField
            control={form.control}
            name="token"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel className="sr-only">Ticket token</FormLabel>
                <FormControl>
                  <Input placeholder="Paste or scan ticket token" autoFocus {...field} />
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

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Recent check-ins</h2>
        {data.recent.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No check-ins yet.</p>
        ) : (
          <Table className="mt-2">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Checked in at</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recent.map((attendee, index) => (
                <TableRow key={`${attendee.name}-${attendee.at}-${index}`}>
                  <TableCell className="font-medium">{attendee.name}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {new Date(attendee.at).toLocaleTimeString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
