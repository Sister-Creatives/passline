import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

const sectionFormSchema = z.object({
  ticketTypeId: z.string().min(1, "Ticket type is required"),
  section: z.string().min(1, "Section name is required"),
  rows: z
    .string()
    .min(1, "Rows is required")
    .refine(
      (value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 100,
      { message: "Rows must be a whole number between 1 and 100" },
    ),
  seatsPerRow: z
    .string()
    .min(1, "Seats per row is required")
    .refine(
      (value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 100,
      { message: "Seats per row must be a whole number between 1 and 100" },
    ),
});

type SectionFormValues = z.infer<typeof sectionFormSchema>;

/**
 * Section generator form: ticket type Select, section name, rows x
 * seats-per-row. Submits api.seats.generateSection, which lays out the grid
 * (row labels A, B, C, … x seat numbers 1..seatsPerRow) server-side.
 */
function SectionForm({
  eventId,
  ticketTypes,
  onDone,
}: {
  eventId: Id<"events">;
  ticketTypes: Doc<"ticketTypes">[];
  onDone: () => void;
}) {
  const generateSection = useMutation(api.seats.generateSection);
  const form = useForm<SectionFormValues>({
    resolver: zodResolver(sectionFormSchema),
    defaultValues: { ticketTypeId: "", section: "", rows: "1", seatsPerRow: "1" },
  });

  async function onSubmit(values: SectionFormValues) {
    try {
      const count = await generateSection({
        eventId,
        ticketTypeId: values.ticketTypeId as Id<"ticketTypes">,
        section: values.section.trim(),
        rows: Number(values.rows),
        seatsPerRow: Number(values.seatsPerRow),
      });
      toast.success(`${count} seats created`);
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create section");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField
          control={form.control}
          name="ticketTypeId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Ticket type</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a ticket type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectGroup>
                    {ticketTypes.map((tt) => (
                      <SelectItem key={tt._id} value={tt._id}>
                        {tt.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="section"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Section name</FormLabel>
              <FormControl>
                <Input placeholder="Orchestra" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="rows"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Rows</FormLabel>
                <FormControl>
                  <Input type="number" min={1} max={100} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="seatsPerRow"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Seats per row</FormLabel>
                <FormControl>
                  <Input type="number" min={1} max={100} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <Button type="submit" disabled={form.formState.isSubmitting || ticketTypes.length === 0}>
          {form.formState.isSubmitting && <LoaderCircle className="animate-spin" />}
          Generate section
        </Button>
      </form>
    </Form>
  );
}

/**
 * Read-only grid preview of one section's seats, grouped by row (rows are
 * already in reading order from the `seats.list` sort by `sortOrder`).
 * Coloured by status with semantic/muted tokens -- available seats read as
 * an outlined square, sold seats as a filled muted square.
 */
function SeatGrid({ seats }: { seats: Doc<"seats">[] }) {
  const rows = new Map<string, Doc<"seats">[]>();
  for (const seat of seats) {
    const list = rows.get(seat.row) ?? [];
    list.push(seat);
    rows.set(seat.row, list);
  }

  return (
    <div className="flex flex-col gap-1">
      {[...rows.entries()].map(([row, rowSeats]) => (
        <div key={row} className="flex items-center gap-1.5">
          <span className="w-5 shrink-0 text-xs text-muted-foreground">{row}</span>
          <div className="flex flex-wrap gap-1">
            {rowSeats.map((seat) => (
              <div
                key={seat._id}
                title={`${seat.section} ${seat.row}${seat.number} · ${seat.status}`}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-sm border text-[10px] tabular-nums",
                  seat.status === "sold"
                    ? "border-transparent bg-muted text-muted-foreground"
                    : "border-input bg-background text-foreground",
                )}
              >
                {seat.number}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Seating tab (F10.4): a section generator Dialog, a grid preview per
 * section (grouped by section then row, coloured by status), and a
 * removeSection AlertDialog action disabled once any seat in the section has
 * sold -- mirrors SessionsPanel's Skeleton/Empty/header shape.
 */
export function SeatingPanel({ eventId }: { eventId: Id<"events"> }) {
  const { data: seats, isPending: seatsPending } = useQuery(
    convexQuery(api.seats.list, { eventId }),
  );
  const { data: ticketTypes, isPending: typesPending } = useQuery(
    convexQuery(api.ticketTypes.listForEvent, { eventId }),
  );
  const removeSection = useMutation(api.seats.removeSection);
  const [creating, setCreating] = useState(false);

  if (seatsPending || typesPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const types = ticketTypes ?? [];
  const typeNameById = new Map(types.map((tt) => [tt._id, tt.name]));

  const sections = new Map<string, Doc<"seats">[]>();
  for (const seat of seats ?? []) {
    const list = sections.get(seat.section) ?? [];
    list.push(seat);
    sections.set(seat.section, list);
  }

  async function handleRemove(section: string) {
    try {
      await removeSection({ eventId, section });
      toast.success("Section deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove section");
    }
  }

  // Rendered above both the grid and the empty state so "New section" is
  // always reachable, even with zero sections.
  const header = (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-medium">Seating</h2>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogTrigger asChild>
          <Button size="sm">
            <Plus /> New section
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New section</DialogTitle>
          </DialogHeader>
          <SectionForm eventId={eventId} ticketTypes={types} onDone={() => setCreating(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );

  if (sections.size === 0) {
    return (
      <div>
        {header}
        <Empty className="mt-6">
          <EmptyHeader>
            <EmptyTitle>No seating sections yet</EmptyTitle>
            <EmptyDescription>
              Generate a section to sell assigned seats.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div>
      {header}
      <div className="flex flex-col gap-6">
        {[...sections.entries()].map(([section, sectionSeats]) => {
          const soldCount = sectionSeats.filter((s) => s.status === "sold").length;
          const ticketTypeId = sectionSeats[0]?.ticketTypeId;
          return (
            <div key={section} className="rounded-md border p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{section}</p>
                  <p className="text-xs text-muted-foreground">
                    {ticketTypeId ? (typeNameById.get(ticketTypeId) ?? "Unknown ticket type") : ""}{" "}
                    · {sectionSeats.length} seats · {soldCount} sold
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete section"
                      disabled={soldCount > 0}
                    >
                      <Trash2 />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete &ldquo;{section}&rdquo;?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This deletes all {sectionSeats.length} seats in this section. This cannot
                        be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => handleRemove(section)}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              <SeatGrid seats={sectionSeats} />
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-input bg-background" /> Available
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-muted" /> Sold
        </span>
      </div>
    </div>
  );
}
