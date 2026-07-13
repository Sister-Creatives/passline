import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { formatMoney } from "@/lib/format-money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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

const promoCodeFormSchema = z
  .object({
    code: z.string().min(1, "Code is required"),
    discountKind: z.enum(["percent", "fixed"]),
    // Percent as a whole number (e.g. "10" = 10%) or dollars as a string for
    // fixed, like TicketTypesPanel's price field -- converted at submit time.
    amount: z.string(),
    maxRedemptions: z.string(),
  })
  .refine(
    (v) => {
      const n = Number(v.amount);
      if (v.amount.trim() === "" || !Number.isFinite(n)) return false;
      return v.discountKind === "percent" ? n >= 1 && n <= 100 : n > 0;
    },
    {
      message: "Enter a percent between 1 and 100, or an amount greater than 0",
      path: ["amount"],
    },
  )
  .refine(
    (v) => {
      const max = v.maxRedemptions.trim();
      if (max === "") return true;
      const n = Number(max);
      return Number.isInteger(n) && n >= 1;
    },
    { message: "Max redemptions must be a whole number of at least 1", path: ["maxRedemptions"] },
  );

type PromoCodeFormValues = z.infer<typeof promoCodeFormSchema>;

/**
 * Create-promo-code form. code, discountKind (percent/fixed) ToggleGroup, an
 * amount field whose meaning depends on kind (whole percent, or dollars for
 * fixed), and an optional max-redemptions cap. Submits api.promoCodes.create.
 */
function PromoCodeForm({ eventId, onDone }: { eventId: Id<"events">; onDone: () => void }) {
  const create = useMutation(api.promoCodes.create);
  const form = useForm<PromoCodeFormValues>({
    resolver: zodResolver(promoCodeFormSchema),
    defaultValues: {
      code: "",
      discountKind: "percent",
      amount: "",
      maxRedemptions: "",
    },
  });
  const discountKind = form.watch("discountKind");

  async function onSubmit(values: PromoCodeFormValues) {
    const amount = Number(values.amount);
    const percentBps = values.discountKind === "percent" ? Math.round(amount * 100) : undefined;
    const fixedCents = values.discountKind === "fixed" ? Math.round(amount * 100) : undefined;
    const maxRedemptions =
      values.maxRedemptions.trim() === "" ? undefined : Number(values.maxRedemptions);
    try {
      await create({
        eventId,
        code: values.code,
        discountKind: values.discountKind,
        percentBps,
        fixedCents,
        maxRedemptions,
      });
      toast.success("Promo code created");
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create promo code");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Code</FormLabel>
              <FormControl>
                <Input placeholder="EARLYBIRD" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="discountKind"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Discount type</FormLabel>
              <FormControl>
                <ToggleGroup
                  type="single"
                  value={field.value}
                  onValueChange={(value) => value && field.onChange(value)}
                  variant="outline"
                >
                  <ToggleGroupItem value="percent">Percent</ToggleGroupItem>
                  <ToggleGroupItem value="fixed">Fixed amount</ToggleGroupItem>
                </ToggleGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{discountKind === "percent" ? "Percent off" : "Amount off"}</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  step={discountKind === "percent" ? 1 : 0.01}
                  placeholder={discountKind === "percent" ? "10" : "5.00"}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="maxRedemptions"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Max redemptions (optional)</FormLabel>
              <FormControl>
                <Input type="number" min={1} placeholder="Unlimited" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          Create promo code
        </Button>
      </form>
    </Form>
  );
}

/**
 * Promo codes tab: a Table of the event's promo codes (code, discount,
 * redeemed/max, active status), a create Dialog, and AlertDialog-confirmed
 * removal. Mirrors TicketTypesPanel's Skeleton/Empty/Table shape.
 */
export function PromoCodesPanel({
  eventId,
  currency,
}: {
  eventId: Id<"events">;
  currency: string;
}) {
  const { data: promoCodes, isPending } = useQuery(
    convexQuery(api.promoCodes.list, { eventId }),
  );
  const remove = useMutation(api.promoCodes.remove);
  const [creating, setCreating] = useState(false);

  async function handleDelete(promoCodeId: Id<"promoCodes">) {
    try {
      await remove({ promoCodeId });
      toast.success("Promo code deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete promo code");
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

  const rows = promoCodes ?? [];

  // Rendered above both the table and the empty state so "New promo code" is
  // always reachable, even with zero promo codes.
  const header = (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-medium">Promo codes</h2>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogTrigger asChild>
          <Button size="sm">
            <Plus /> New promo code
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New promo code</DialogTitle>
          </DialogHeader>
          <PromoCodeForm eventId={eventId} onDone={() => setCreating(false)} />
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
            <EmptyTitle>No promo codes yet</EmptyTitle>
            <EmptyDescription>Create a code to offer buyers a discount at checkout.</EmptyDescription>
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
            <TableHead>Code</TableHead>
            <TableHead>Discount</TableHead>
            <TableHead className="text-right">Redeemed</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((promoCode: Doc<"promoCodes">) => (
            <TableRow key={promoCode._id}>
              <TableCell className="font-medium">{promoCode.code}</TableCell>
              <TableCell>
                {promoCode.discountKind === "percent"
                  ? `${(promoCode.percentBps ?? 0) / 100}%`
                  : formatMoney(promoCode.fixedCents ?? 0, currency)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {promoCode.timesRedeemed}/{promoCode.maxRedemptions ?? "∞"}
              </TableCell>
              <TableCell>
                <Badge variant={promoCode.active ? "default" : "secondary"}>
                  {promoCode.active ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Delete">
                      <Trash2 />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete &ldquo;{promoCode.code}&rdquo;?</AlertDialogTitle>
                      <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => handleDelete(promoCode._id)}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
