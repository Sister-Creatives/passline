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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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

const accessCodeFormSchema = z.object({
  code: z.string().min(1, "Code is required"),
  ticketTypeIds: z.array(z.string()).min(1, "Select at least one hidden ticket type"),
});

type AccessCodeFormValues = z.infer<typeof accessCodeFormSchema>;

/**
 * Create-access-code form. code + a Checkbox multi-select of the event's
 * hidden ticket types -- the only types an access code can unlock, mirroring
 * the webhook subscribedEvents Checkbox-array pattern. Submits
 * api.accessCodes.create.
 */
function AccessCodeForm({
  eventId,
  hiddenTicketTypes,
  onDone,
}: {
  eventId: Id<"events">;
  hiddenTicketTypes: Doc<"ticketTypes">[];
  onDone: () => void;
}) {
  const create = useMutation(api.accessCodes.create);
  const form = useForm<AccessCodeFormValues>({
    resolver: zodResolver(accessCodeFormSchema),
    defaultValues: { code: "", ticketTypeIds: [] },
  });

  async function onSubmit(values: AccessCodeFormValues) {
    try {
      await create({
        eventId,
        code: values.code,
        ticketTypeIds: values.ticketTypeIds as Id<"ticketTypes">[],
      });
      toast.success("Access code created");
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create access code");
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
                <Input placeholder="VIP2026" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="ticketTypeIds"
          render={() => (
            <FormItem>
              <FormLabel>Unlocks</FormLabel>
              {hiddenTicketTypes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hidden ticket types yet. Mark a ticket type Hidden first.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {hiddenTicketTypes.map((ticketType) => (
                    <FormField
                      key={ticketType._id}
                      control={form.control}
                      name="ticketTypeIds"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center gap-2">
                          <FormControl>
                            <Checkbox
                              checked={field.value?.includes(ticketType._id)}
                              onCheckedChange={(checked) => {
                                const current = field.value ?? [];
                                field.onChange(
                                  checked
                                    ? [...current, ticketType._id]
                                    : current.filter((id) => id !== ticketType._id),
                                );
                              }}
                            />
                          </FormControl>
                          <FormLabel className="font-normal">{ticketType.name}</FormLabel>
                        </FormItem>
                      )}
                    />
                  ))}
                </div>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          disabled={form.formState.isSubmitting || hiddenTicketTypes.length === 0}
        >
          Create access code
        </Button>
      </form>
    </Form>
  );
}

/**
 * Access codes tab: a Table of the event's access codes (code, unlocked
 * hidden ticket types as Badges, status), a create Dialog scoped to the
 * event's hidden ticket types, and AlertDialog-confirmed removal. Mirrors
 * PromoCodesPanel's Skeleton/Empty/Table shape.
 */
export function AccessCodesPanel({ eventId }: { eventId: Id<"events"> }) {
  const { data: accessCodes, isPending: accessCodesPending } = useQuery(
    convexQuery(api.accessCodes.list, { eventId }),
  );
  const { data: ticketTypes, isPending: ticketTypesPending } = useQuery(
    convexQuery(api.ticketTypes.listForEvent, { eventId }),
  );
  const remove = useMutation(api.accessCodes.remove);
  const [creating, setCreating] = useState(false);

  async function handleDelete(accessCodeId: Id<"accessCodes">) {
    try {
      await remove({ accessCodeId });
      toast.success("Access code deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete access code");
    }
  }

  if (accessCodesPending || ticketTypesPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const rows = accessCodes ?? [];
  const allTicketTypes = ticketTypes ?? [];
  const hiddenTicketTypes = allTicketTypes.filter((tt) => tt.visibility === "hidden");
  const ticketTypeById = new Map(allTicketTypes.map((tt) => [tt._id, tt]));

  // Rendered above both the table and the empty state so "New access code"
  // is always reachable, even with zero access codes.
  const header = (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-medium">Access codes</h2>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogTrigger asChild>
          <Button size="sm">
            <Plus /> New access code
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New access code</DialogTitle>
          </DialogHeader>
          <AccessCodeForm
            eventId={eventId}
            hiddenTicketTypes={hiddenTicketTypes}
            onDone={() => setCreating(false)}
          />
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
            <EmptyTitle>No access codes yet</EmptyTitle>
            <EmptyDescription>
              Create a code to unlock hidden ticket types like VIP or staff passes.
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
            <TableHead>Code</TableHead>
            <TableHead>Unlocks</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((accessCode: Doc<"accessCodes">) => (
            <TableRow key={accessCode._id}>
              <TableCell className="font-medium">{accessCode.code}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {accessCode.ticketTypeIds.map((ticketTypeId) => (
                    <Badge key={ticketTypeId} variant="secondary">
                      {ticketTypeById.get(ticketTypeId)?.name ?? "Unknown"}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={accessCode.active ? "default" : "secondary"}>
                  {accessCode.active ? "Active" : "Inactive"}
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
                      <AlertDialogTitle>Delete &ldquo;{accessCode.code}&rdquo;?</AlertDialogTitle>
                      <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => handleDelete(accessCode._id)}
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
