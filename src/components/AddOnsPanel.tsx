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
import { formatMoney } from "@/lib/format-money";
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

const addOnFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  // Dollars as a string; converted to cents at submit time, like
  // TicketTypesPanel's price field -- avoids the react-hook-form/zod coerce
  // generic mismatch.
  price: z.string().refine(
    (v) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) > 0,
    { message: "Price must be greater than 0" },
  ),
  capacity: z.string(),
});

type AddOnFormValues = z.infer<typeof addOnFormSchema>;

/** Converts a dollars-as-string form value to integer cents. */
function toCents(dollars: string): number {
  const n = Number(dollars);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Create-add-on form. name, price (dollars, converted to cents on submit),
 * optional capacity. Submits api.addOns.create.
 */
function AddOnForm({ eventId, onDone }: { eventId: Id<"events">; onDone: () => void }) {
  const create = useMutation(api.addOns.create);
  const form = useForm<AddOnFormValues>({
    resolver: zodResolver(addOnFormSchema),
    defaultValues: { name: "", price: "", capacity: "" },
  });

  async function onSubmit(values: AddOnFormValues) {
    const priceCents = toCents(values.price);
    const capacity = values.capacity.trim() === "" ? undefined : Number(values.capacity);
    try {
      await create({ eventId, name: values.name, priceCents, capacity });
      toast.success("Add-on created");
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create add-on");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Event T-shirt" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="price"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Price</FormLabel>
              <FormControl>
                <Input type="number" min={0} step="0.01" placeholder="25.00" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
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
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <LoaderCircle className="animate-spin" />}
          Create add-on
        </Button>
      </form>
    </Form>
  );
}

// Motion-capable table row so reorders FLIP-animate to their new slot instead
// of teleporting. Keys stay stable (addOn._id) so Motion can track each row.
const MotionTableRow = motion.create(TableRow);

/**
 * Add-ons tab: a Table of the event's add-ons (name, price, cap, sold), a
 * create Dialog, up/down reorder, and AlertDialog-confirmed removal. Mirrors
 * TicketTypesPanel/CheckoutQuestionsPanel's Skeleton/Empty/Table shape.
 */
export function AddOnsPanel({
  eventId,
  currency,
}: {
  eventId: Id<"events">;
  currency: string;
}) {
  const { data: addOns, isPending } = useQuery(convexQuery(api.addOns.list, { eventId }));
  const remove = useMutation(api.addOns.remove);
  const reorder = useMutation(api.addOns.reorder);
  const [creating, setCreating] = useState(false);
  // Optimistic order: applied on the click frame so the row moves immediately,
  // then cleared once the server confirms (or reverted on failure).
  const [pendingOrder, setPendingOrder] = useState<Array<Id<"addOns">> | null>(null);

  const rows = addOns ?? [];
  const orderedRows = useMemo(() => {
    if (!pendingOrder) return rows;
    const byId = new Map(rows.map((a) => [a._id, a]));
    const next = pendingOrder
      .map((id) => byId.get(id))
      .filter((a): a is (typeof rows)[number] => Boolean(a));
    // Fall back to server order if membership changed (add/delete elsewhere).
    return next.length === rows.length ? next : rows;
  }, [rows, pendingOrder]);

  async function move(index: number, direction: -1 | 1) {
    const ids = orderedRows.map((a) => a._id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setPendingOrder(ids);
    try {
      await reorder({ eventId, orderedIds: ids });
      setPendingOrder(null);
    } catch (error) {
      setPendingOrder(null);
      toast.error(error instanceof Error ? error.message : "Failed to reorder add-ons");
    }
  }

  async function handleDelete(addOnId: Id<"addOns">) {
    try {
      await remove({ addOnId });
      toast.success("Add-on deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete add-on");
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

  // Rendered above both the table and the empty state so "New add-on" is
  // always reachable, even with zero add-ons.
  const header = (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-medium">Add-ons</h2>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogTrigger asChild>
          <Button size="sm">
            <Plus /> New add-on
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New add-on</DialogTitle>
          </DialogHeader>
          <AddOnForm eventId={eventId} onDone={() => setCreating(false)} />
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
            <EmptyTitle>No add-ons yet</EmptyTitle>
            <EmptyDescription>
              Create an add-on to sell alongside tickets, like merch or parking.
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
            <TableHead>Name</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Cap</TableHead>
            <TableHead className="text-right">Sold</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orderedRows.map((addOn: Doc<"addOns">, index) => (
            <MotionTableRow key={addOn._id} layout transition={spring.snappy}>
              <TableCell className="font-medium">{addOn.name}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(addOn.priceCents, currency)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{addOn.capacity ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{addOn.sold}</TableCell>
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
                      <Button variant="ghost" size="icon-sm" aria-label="Delete">
                        <Trash2 />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete &ldquo;{addOn.name}&rdquo;?</AlertDialogTitle>
                        <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => handleDelete(addOn._id)}
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
