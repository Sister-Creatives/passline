import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { motion } from "motion/react";
import { ChevronDown, ChevronUp, LoaderCircle, Plus, Trash2 } from "lucide-react";

import { spring } from "@/lib/motion";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DateTimePicker } from "@/components/DateTimePicker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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

const sessionFormSchema = z
  .object({
    startsAt: z.string().min(1, "Start date and time is required"),
    endsAt: z.string().min(1, "End date and time is required"),
    // Kept as a string, like EventForm's capacity field, and converted to a
    // number at submit time -- avoids the react-hook-form/zod coerce generic
    // mismatch.
    capacity: z
      .string()
      .min(1, "Capacity is required")
      .refine((value) => Number.isInteger(Number(value)) && Number(value) >= 1, {
        message: "Capacity must be a whole number of at least 1",
      }),
    label: z.string(),
  })
  .refine((values) => new Date(values.endsAt).getTime() > new Date(values.startsAt).getTime(), {
    message: "End time must be after start time",
    path: ["endsAt"],
  });

type SessionFormValues = z.infer<typeof sessionFormSchema>;

/**
 * Create-session form: start/end via DateTimePicker, capacity, and an
 * optional label (e.g. "Matinee"). Submits api.eventSessions.create.
 */
function SessionForm({ eventId, onDone }: { eventId: Id<"events">; onDone: () => void }) {
  const create = useMutation(api.eventSessions.create);
  const form = useForm<SessionFormValues>({
    resolver: zodResolver(sessionFormSchema),
    defaultValues: { startsAt: "", endsAt: "", capacity: "1", label: "" },
  });

  async function onSubmit(values: SessionFormValues) {
    try {
      await create({
        eventId,
        startsAt: new Date(values.startsAt).getTime(),
        endsAt: new Date(values.endsAt).getTime(),
        capacity: Number(values.capacity),
        label: values.label.trim() === "" ? undefined : values.label.trim(),
      });
      toast.success("Session created");
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create session");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="startsAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Starts at</FormLabel>
                <FormControl>
                  <DateTimePicker {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="endsAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Ends at</FormLabel>
                <FormControl>
                  <DateTimePicker {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="capacity"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Capacity</FormLabel>
              <FormControl>
                <Input type="number" min={1} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="label"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Label (optional)</FormLabel>
              <FormControl>
                <Input placeholder="Matinee" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <LoaderCircle className="animate-spin" />}
          Create session
        </Button>
      </form>
    </Form>
  );
}

// Motion-capable table row so reorders FLIP-animate to their new slot instead
// of teleporting. Keys stay stable (session._id) so Motion can track each row.
const MotionTableRow = motion.create(TableRow);

/**
 * Sessions tab (F13.4): a Table of the event's sessions (date range,
 * capacity, sold, remaining), a create Dialog, up/down reorder, and
 * AlertDialog-confirmed removal -- disabled once a session has sold tickets,
 * mirroring TicketTypesPanel's Skeleton/Empty/Table shape and reorder
 * mechanics.
 */
export function SessionsPanel({ eventId }: { eventId: Id<"events"> }) {
  const { data: sessions, isPending } = useQuery(
    convexQuery(api.eventSessions.list, { eventId }),
  );
  const remove = useMutation(api.eventSessions.remove);
  const reorder = useMutation(api.eventSessions.reorder);
  const [creating, setCreating] = useState(false);
  // Optimistic order: applied on the click frame so the row moves immediately,
  // then cleared once the server confirms (or reverted on failure).
  const [pendingOrder, setPendingOrder] = useState<Array<Id<"eventSessions">> | null>(null);

  const rows = sessions ?? [];
  const orderedRows = useMemo(() => {
    if (!pendingOrder) return rows;
    const byId = new Map(rows.map((s) => [s._id, s]));
    const next = pendingOrder
      .map((id) => byId.get(id))
      .filter((s): s is (typeof rows)[number] => Boolean(s));
    // Fall back to server order if membership changed (add/delete elsewhere).
    return next.length === rows.length ? next : rows;
  }, [rows, pendingOrder]);

  async function move(index: number, direction: -1 | 1) {
    const ids = orderedRows.map((s) => s._id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setPendingOrder(ids);
    try {
      await reorder({ eventId, orderedIds: ids });
      setPendingOrder(null);
    } catch (error) {
      setPendingOrder(null);
      toast.error(error instanceof Error ? error.message : "Failed to reorder sessions");
    }
  }

  async function handleDelete(sessionId: Id<"eventSessions">) {
    try {
      await remove({ sessionId });
      toast.success("Session deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete session");
    }
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  // Rendered above both the table and the empty state so "New session" is
  // always reachable, even with zero sessions.
  const header = (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-medium">Sessions</h2>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogTrigger asChild>
          <Button size="sm">
            <Plus /> New session
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New session</DialogTitle>
          </DialogHeader>
          <SessionForm eventId={eventId} onDone={() => setCreating(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );

  if (rows.length === 0) {
    return (
      <div>
        {header}
        <Empty className="mt-6">
          <EmptyHeader>
            <EmptyTitle>No sessions yet</EmptyTitle>
            <EmptyDescription>
              Add a session to sell tickets for specific dates or times.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div>
      {header}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date range</TableHead>
            <TableHead>Label</TableHead>
            <TableHead className="text-right">Cap</TableHead>
            <TableHead className="text-right">Sold</TableHead>
            <TableHead className="text-right">Remaining</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orderedRows.map((session: Doc<"eventSessions">, index: number) => (
            <MotionTableRow key={session._id} layout transition={spring.snappy}>
              <TableCell className="font-medium">
                {new Date(session.startsAt).toLocaleString()} &ndash;{" "}
                {new Date(session.endsAt).toLocaleString()}
              </TableCell>
              <TableCell>{session.label ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{session.capacity}</TableCell>
              <TableCell className="text-right tabular-nums">{session.sold}</TableCell>
              <TableCell className="text-right tabular-nums">
                {session.capacity - session.sold}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label="Move up"
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => move(index, 1)}
                    disabled={index === orderedRows.length - 1}
                    aria-label="Move down"
                  >
                    <ChevronDown />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete"
                        disabled={session.sold > 0}
                      >
                        <Trash2 />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this session?</AlertDialogTitle>
                        <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => handleDelete(session._id)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </TableCell>
            </MotionTableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
