import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { formatMoney } from "@/lib/format-money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
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

const KIND_LABEL = { paid: "Paid", free: "Free", donation: "Donation" } as const;

const ticketTypeFormSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    kind: z.enum(["paid", "free", "donation"]),
    // Dollars as a string; converted to cents at submit time, like EventForm's
    // capacity field -- avoids the react-hook-form/zod coerce generic mismatch.
    price: z.string(),
    capacity: z.string(),
    minPerOrder: z.string(),
    maxPerOrder: z.string(),
    badge: z.string(),
    visibility: z.enum(["visible", "hidden"]),
    gateAlert: z.string(),
  })
  .refine(
    (v) => {
      if (v.kind === "free") return true;
      const n = Number(v.price);
      if (v.kind === "paid") return v.price.trim() !== "" && Number.isFinite(n) && n > 0;
      return v.price.trim() === "" || (Number.isFinite(n) && n >= 0);
    },
    { message: "Paid tickets need a price greater than 0", path: ["price"] },
  )
  .refine(
    (v) => {
      const min = v.minPerOrder.trim(), max = v.maxPerOrder.trim();
      if (min === "" || max === "") return true;
      return Number(min) <= Number(max);
    },
    { message: "Min per order cannot exceed max per order", path: ["maxPerOrder"] },
  );

type TicketTypeFormValues = z.infer<typeof ticketTypeFormSchema>;

/** Converts a dollars-as-string form value to integer cents. */
function toCents(dollars: string): number {
  const n = Number(dollars);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Create/edit ticket type form. Fields: name, kind (paid/free/donation),
 * price (hidden for free), optional capacity, and an optional badge label.
 * Submits either `api.ticketTypes.create` (no `ticketType` prop) or
 * `api.ticketTypes.update` (`ticketType` prop supplied).
 */
function TicketTypeEditor({
  eventId,
  ticketType,
  onDone,
}: {
  eventId: Id<"events">;
  ticketType?: Doc<"ticketTypes">;
  onDone: () => void;
}) {
  const create = useMutation(api.ticketTypes.create);
  const update = useMutation(api.ticketTypes.update);
  const form = useForm<TicketTypeFormValues>({
    resolver: zodResolver(ticketTypeFormSchema),
    defaultValues: ticketType
      ? {
          name: ticketType.name,
          kind: ticketType.kind,
          price: (ticketType.priceCents / 100).toFixed(2),
          capacity: ticketType.capacity != null ? String(ticketType.capacity) : "",
          minPerOrder: ticketType.minPerOrder != null ? String(ticketType.minPerOrder) : "",
          maxPerOrder: ticketType.maxPerOrder != null ? String(ticketType.maxPerOrder) : "",
          badge: ticketType.badge ?? "",
          visibility: ticketType.visibility,
          gateAlert: ticketType.gateAlert ?? "",
        }
      : {
          name: "",
          kind: "paid",
          price: "",
          capacity: "",
          minPerOrder: "",
          maxPerOrder: "",
          badge: "",
          visibility: "visible",
          gateAlert: "",
        },
  });
  const kind = form.watch("kind");

  async function onSubmit(values: TicketTypeFormValues) {
    const priceCents = values.kind === "free" ? 0 : toCents(values.price);
    const capacity = values.capacity.trim() === "" ? undefined : Number(values.capacity);
    const minPerOrder = values.minPerOrder.trim() === "" ? undefined : Number(values.minPerOrder);
    const maxPerOrder = values.maxPerOrder.trim() === "" ? undefined : Number(values.maxPerOrder);
    const badge = values.badge.trim() === "" ? undefined : values.badge.trim();
    const gateAlert = values.gateAlert.trim() === "" ? undefined : values.gateAlert.trim();
    try {
      if (ticketType) {
        await update({
          ticketTypeId: ticketType._id,
          name: values.name,
          kind: values.kind,
          priceCents,
          capacity,
          minPerOrder,
          maxPerOrder,
          badge,
          visibility: values.visibility,
          gateAlert,
        });
        toast.success("Ticket type updated");
      } else {
        await create({
          eventId,
          name: values.name,
          kind: values.kind,
          priceCents,
          capacity,
          minPerOrder,
          maxPerOrder,
          badge,
          visibility: values.visibility,
          gateAlert,
        });
        toast.success("Ticket type created");
      }
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save ticket type");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4 p-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Adult" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="kind"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Kind</FormLabel>
              <FormControl>
                <ToggleGroup
                  type="single"
                  value={field.value}
                  onValueChange={(value) => value && field.onChange(value)}
                  variant="outline"
                >
                  <ToggleGroupItem value="paid">Paid</ToggleGroupItem>
                  <ToggleGroupItem value="free">Free</ToggleGroupItem>
                  <ToggleGroupItem value="donation">Donation</ToggleGroupItem>
                </ToggleGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {kind !== "free" && (
          <FormField
            control={form.control}
            name="price"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{kind === "donation" ? "Suggested price" : "Price"}</FormLabel>
                <FormControl>
                  <Input type="number" min={0} step="0.01" placeholder="25.00" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        <FormField
          control={form.control}
          name="capacity"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Capacity (optional)</FormLabel>
              <FormControl>
                <Input type="number" min={1} placeholder="Uncapped" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="minPerOrder"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Min per order</FormLabel>
              <FormControl>
                <Input type="number" min={1} placeholder="No minimum" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="maxPerOrder"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Max per order</FormLabel>
              <FormControl>
                <Input type="number" min={1} placeholder="No maximum" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="badge"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Badge (optional)</FormLabel>
              <FormControl>
                <Input placeholder="Early Bird" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="gateAlert"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Gate alert (optional)</FormLabel>
              <FormControl>
                <Input placeholder="Check 18+ ID" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {ticketType ? "Save changes" : "Create ticket type"}
        </Button>
      </form>
    </Form>
  );
}

export function TicketTypesPanel({
  eventId,
  currency,
}: {
  eventId: Id<"events">;
  currency: string;
}) {
  const { data: types, isPending } = useQuery(
    convexQuery(api.ticketTypes.listForEvent, { eventId }),
  );
  const remove = useMutation(api.ticketTypes.remove);
  const reorder = useMutation(api.ticketTypes.reorder);
  const [editing, setEditing] = useState<Doc<"ticketTypes"> | null>(null);
  const [creating, setCreating] = useState(false);

  async function move(index: number, direction: -1 | 1) {
    const ids = rows.map((t) => t._id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await reorder({ eventId, orderedIds: ids });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reorder ticket types");
    }
  }

  async function handleDelete(ticketTypeId: Id<"ticketTypes">) {
    try {
      await remove({ ticketTypeId });
      toast.success("Ticket type deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete ticket type");
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

  const rows = types ?? [];

  // Rendered above both the table and the empty state so "New ticket type"
  // is always reachable, even with zero ticket types.
  const header = (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-medium">Ticket types</h2>
      <Sheet open={creating} onOpenChange={setCreating}>
        <SheetTrigger asChild>
          <Button size="sm">
            <Plus /> New ticket type
          </Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>New ticket type</SheetTitle>
          </SheetHeader>
          <TicketTypeEditor eventId={eventId} onDone={() => setCreating(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );

  if (rows.length === 0) {
    return (
      <div>
        {header}
        <Empty className="mt-6">
          <EmptyHeader>
            <EmptyTitle>No ticket types yet</EmptyTitle>
            <EmptyDescription>Create your first ticket type to start selling.</EmptyDescription>
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
            <TableHead>Name</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Cap</TableHead>
            <TableHead className="text-right">Sold</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((tt, index) => (
            <TableRow key={tt._id}>
              <TableCell className="font-medium">
                {tt.name}
                {tt.badge ? (
                  <Badge variant="secondary" className="ml-2">
                    {tt.badge}
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell>
                <Badge variant="outline">{KIND_LABEL[tt.kind]}</Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {tt.kind === "free" ? "Free" : formatMoney(tt.priceCents, currency)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{tt.capacity ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{tt.sold}</TableCell>
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
                    disabled={index === rows.length - 1}
                    aria-label="Move down"
                  >
                    <ChevronDown />
                  </Button>
                  <Sheet
                    open={editing?._id === tt._id}
                    onOpenChange={(open) => setEditing(open ? tt : null)}
                  >
                    <SheetTrigger asChild>
                      <Button variant="outline" size="sm">
                        Edit
                      </Button>
                    </SheetTrigger>
                    <SheetContent>
                      <SheetHeader>
                        <SheetTitle>Edit ticket type</SheetTitle>
                      </SheetHeader>
                      <TicketTypeEditor
                        eventId={eventId}
                        ticketType={tt}
                        onDone={() => setEditing(null)}
                      />
                    </SheetContent>
                  </Sheet>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="Delete">
                        <Trash2 />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete &ldquo;{tt.name}&rdquo;?</AlertDialogTitle>
                        <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => handleDelete(tt._id)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
