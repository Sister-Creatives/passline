import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { motion } from "motion/react";
import { format } from "date-fns";
import { CalendarIcon, ChevronDown, ChevronUp, LoaderCircle, Plus, Repeat, Trash2 } from "lucide-react";

import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { generateRecurringDates } from "@/lib/recurrence";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
        {/* Stacked, not side by side: two DateTimePickers (each a date button
            plus a fixed 124px time button) do not fit two-up in this narrow
            dialog and overflow their grid tracks, overlapping each other. */}
        <div className="grid gap-4">
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

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** Popover + Calendar date button returning "YYYY-MM-DD" (local). */
function DateField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const selected = value ? new Date(`${value}T00:00:00`) : undefined;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn("w-full justify-start font-normal", !value && "text-muted-foreground")}
        >
          <CalendarIcon className="size-4" />
          {value ? format(selected as Date, "MMM d, yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => date && onChange(format(date, "yyyy-MM-dd"))}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Recurring-dates generator: pick weekdays + a date range + a time window, and
 * bulk-create one session per matching day. The exact dates are previewed
 * (recomputed live via `generateRecurringDates`) before anything is created.
 */
function RecurringForm({ eventId, onDone }: { eventId: Id<"events">; onDone: () => void }) {
  const createRecurring = useMutation(api.eventSessions.createRecurring);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [untilDate, setUntilDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [capacity, setCapacity] = useState("50");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const sessions = useMemo(
    () => generateRecurringDates({ weekdays, fromDate, untilDate, startTime, endTime }),
    [weekdays, fromDate, untilDate, startTime, endTime],
  );
  const capacityNum = Number(capacity);
  const capacityValid = Number.isInteger(capacityNum) && capacityNum >= 1;
  const timeValid = endTime > startTime;
  const tooMany = sessions.length > 100;
  const canCreate = sessions.length > 0 && !tooMany && capacityValid && timeValid && !saving;

  async function submit() {
    setSaving(true);
    try {
      const result = await createRecurring({
        eventId,
        sessions,
        capacity: capacityNum,
        label: label.trim() === "" ? undefined : label.trim(),
      });
      toast.success(`Created ${result.created} session${result.created === 1 ? "" : "s"}`);
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create sessions");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2">
        <Label>Repeat on</Label>
        <ToggleGroup
          type="multiple"
          variant="outline"
          value={weekdays.map(String)}
          onValueChange={(values) => setWeekdays(values.map(Number).sort())}
          className="grid grid-cols-7 gap-1"
        >
          {WEEKDAY_LABELS.map((day, i) => (
            <ToggleGroupItem key={day} value={String(i)} className="h-9 px-0">
              {day}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>From</Label>
          <DateField value={fromDate} onChange={setFromDate} placeholder="Start date" />
        </div>
        <div className="space-y-2">
          <Label>Until</Label>
          <DateField value={untilDate} onChange={setUntilDate} placeholder="End date" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rec-start">Start time</Label>
          <Input id="rec-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rec-end">End time</Label>
          <Input id="rec-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rec-cap">Capacity</Label>
          <Input id="rec-cap" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rec-label">Label (optional)</Label>
          <Input id="rec-label" placeholder="Matinee" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
      </div>

      <div className="rounded-lg border bg-muted/40 p-3 text-sm">
        {!timeValid ? (
          <span className="text-destructive">End time must be after start time.</span>
        ) : tooMany ? (
          <span className="text-destructive">
            That&apos;s {sessions.length} dates — narrow the range (max 100 at once).
          </span>
        ) : sessions.length === 0 ? (
          <span className="text-muted-foreground">
            Pick weekdays and a date range to preview the sessions.
          </span>
        ) : (
          <div className="space-y-1">
            <p className="font-medium">
              Creates {sessions.length} session{sessions.length === 1 ? "" : "s"}
            </p>
            <p className="text-xs text-muted-foreground">
              {sessions
                .slice(0, 4)
                .map((s) => format(new Date(s.startsAt), "EEE MMM d"))
                .join(" · ")}
              {sessions.length > 4 ? ` · +${sessions.length - 4} more` : ""}
            </p>
          </div>
        )}
      </div>

      <Button onClick={submit} disabled={!canCreate}>
        {saving && <LoaderCircle className="animate-spin" />}
        Create {sessions.length > 0 && !tooMany ? `${sessions.length} ` : ""}sessions
      </Button>
    </div>
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
  const [repeating, setRepeating] = useState(false);
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
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-medium">Sessions</h2>
      <div className="flex items-center gap-2">
        <Dialog open={repeating} onOpenChange={setRepeating}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Repeat /> Repeat…
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Recurring dates</DialogTitle>
            </DialogHeader>
            <RecurringForm eventId={eventId} onDone={() => setRepeating(false)} />
          </DialogContent>
        </Dialog>
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
