import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Plus, Trash2, X } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

const KIND_LABEL = { text: "Text", select: "Select", checkbox: "Checkbox" } as const;

const questionFormSchema = z
  .object({
    label: z.string().min(1, "Label is required"),
    kind: z.enum(["text", "select", "checkbox"]),
    // Repeatable options, only meaningful (and validated) when kind ===
    // "select" -- wrapped in objects because useFieldArray needs a stable
    // key per row, not raw strings.
    options: z.array(z.object({ value: z.string() })),
    required: z.boolean(),
  })
  .refine(
    (v) => v.kind !== "select" || v.options.some((option) => option.value.trim().length > 0),
    { message: "A select question needs at least one option", path: ["options"] },
  );

type QuestionFormValues = z.infer<typeof questionFormSchema>;

/**
 * Create-question form. label, kind (text/select/checkbox) ToggleGroup, a
 * repeatable options editor shown only for kind === "select", and a required
 * Checkbox. Submits api.checkoutQuestions.create.
 */
function QuestionForm({ eventId, onDone }: { eventId: Id<"events">; onDone: () => void }) {
  const create = useMutation(api.checkoutQuestions.create);
  const form = useForm<QuestionFormValues>({
    resolver: zodResolver(questionFormSchema),
    defaultValues: {
      label: "",
      kind: "text",
      options: [{ value: "" }],
      required: false,
    },
  });
  const kind = form.watch("kind");
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "options" });
  // Rendered manually (not via FormField/FormMessage) so the array-level
  // refine error doesn't require mounting a second Controller at "options",
  // which useFieldArray already manages.
  const optionsError = form.formState.errors.options?.message;

  async function onSubmit(values: QuestionFormValues) {
    const options =
      values.kind === "select"
        ? values.options.map((option) => option.value.trim()).filter((value) => value.length > 0)
        : undefined;
    try {
      await create({
        eventId,
        label: values.label,
        kind: values.kind,
        options,
        required: values.required,
      });
      toast.success("Question created");
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create question");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField
          control={form.control}
          name="label"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Label</FormLabel>
              <FormControl>
                <Input placeholder="Dietary restrictions" {...field} />
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
                  <ToggleGroupItem value="text">Text</ToggleGroupItem>
                  <ToggleGroupItem value="select">Select</ToggleGroupItem>
                  <ToggleGroupItem value="checkbox">Checkbox</ToggleGroupItem>
                </ToggleGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {kind === "select" && (
          <FormItem>
            <FormLabel>Options</FormLabel>
            <div className="flex flex-col gap-2">
              {fields.map((optionField, index) => (
                <div key={optionField.id} className="flex items-center gap-2">
                  <Input
                    placeholder={`Option ${index + 1}`}
                    {...form.register(`options.${index}.value` as const)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => remove(index)}
                    disabled={fields.length === 1}
                    aria-label="Remove option"
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ value: "" })}
            >
              <Plus /> Add option
            </Button>
            {optionsError ? <p className="text-sm text-destructive">{optionsError}</p> : null}
          </FormItem>
        )}
        <FormField
          control={form.control}
          name="required"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center gap-2">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <FormLabel className="font-normal">Required</FormLabel>
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          Create question
        </Button>
      </form>
    </Form>
  );
}

/**
 * Checkout questions tab: a Table of the event's questions (label, kind
 * Badge, required, option count), a create Dialog, up/down reorder, and
 * AlertDialog-confirmed removal. Mirrors TicketTypesPanel/PromoCodesPanel's
 * Skeleton/Empty/Table shape.
 */
export function CheckoutQuestionsPanel({ eventId }: { eventId: Id<"events"> }) {
  const { data: questions, isPending } = useQuery(
    convexQuery(api.checkoutQuestions.list, { eventId }),
  );
  const remove = useMutation(api.checkoutQuestions.remove);
  const reorder = useMutation(api.checkoutQuestions.reorder);
  const [creating, setCreating] = useState(false);

  async function move(index: number, direction: -1 | 1) {
    const ids = rows.map((q) => q._id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await reorder({ eventId, orderedIds: ids });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reorder questions");
    }
  }

  async function handleDelete(questionId: Id<"checkoutQuestions">) {
    try {
      await remove({ questionId });
      toast.success("Question deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete question");
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

  const rows = questions ?? [];

  // Rendered above both the table and the empty state so "New question" is
  // always reachable, even with zero questions.
  const header = (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-medium">Checkout questions</h2>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogTrigger asChild>
          <Button size="sm">
            <Plus /> New question
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New question</DialogTitle>
          </DialogHeader>
          <QuestionForm eventId={eventId} onDone={() => setCreating(false)} />
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
            <EmptyTitle>No checkout questions yet</EmptyTitle>
            <EmptyDescription>
              Add a question to collect extra information from buyers at checkout.
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
            <TableHead>Label</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Required</TableHead>
            <TableHead className="text-right">Options</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((question: Doc<"checkoutQuestions">, index) => (
            <TableRow key={question._id}>
              <TableCell className="font-medium">
                {question.label}
                {!question.active ? (
                  <Badge variant="secondary" className="ml-2">
                    Inactive
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell>
                <Badge variant="outline">{KIND_LABEL[question.kind]}</Badge>
              </TableCell>
              <TableCell>{question.required ? "Yes" : "No"}</TableCell>
              <TableCell className="text-right tabular-nums">
                {question.kind === "select" ? (question.options?.length ?? 0) : "—"}
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
                    disabled={index === rows.length - 1}
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
                        <AlertDialogTitle>Delete &ldquo;{question.label}&rdquo;?</AlertDialogTitle>
                        <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => handleDelete(question._id)}
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
