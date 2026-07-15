import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { Minus, Plus, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { formatMoney } from "@/lib/format-money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const DEFAULT_MAX_PER_TYPE = 10;

/**
 * Builds the checkout form's zod schema. The question answers are keyed by
 * question id under `answers`, so required-question validation is added via
 * `superRefine` against the event's loaded question list -- there's no way
 * to express "these dynamic keys are required" declaratively.
 */
function buildCheckoutSchema(questions: Doc<"checkoutQuestions">[]) {
  return z
    .object({
      buyerName: z.string().min(1, "Name is required"),
      buyerEmail: z.email("Enter a valid email address"),
      answers: z.record(z.string(), z.string()),
    })
    .superRefine((values, ctx) => {
      for (const q of questions) {
        if (!q.required) continue;
        const val = values.answers[q._id] ?? "";
        const answered = q.kind === "checkbox" ? val === "true" : val.trim() !== "";
        if (!answered) {
          ctx.addIssue({
            code: "custom",
            message: q.kind === "checkbox" ? "This must be checked" : "This field is required",
            path: ["answers", q._id],
          });
        }
      }
    });
}

type CheckoutFormValues = z.infer<ReturnType<typeof buildCheckoutSchema>>;

export function Checkout({ event }: { event: Doc<"events"> }) {
  const navigate = useNavigate();
  const currency = event.currency ?? "USD";
  const { data: types } = useQuery(convexQuery(api.ticketTypes.listPublicForEvent, { eventId: event._id }));
  const { data: questions } = useQuery(convexQuery(api.checkoutQuestions.listForEvent, { eventId: event._id }));
  const { data: sessions } = useQuery(convexQuery(api.eventSessions.listForEvent, { eventId: event._id }));
  const createOrder = useMutation(api.orders.createOrder);

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [sessionId, setSessionId] = useState<Id<"eventSessions"> | "">("");

  const form = useForm<CheckoutFormValues>({
    resolver: zodResolver(buildCheckoutSchema(questions ?? [])),
    defaultValues: { buyerName: "", buyerEmail: "", answers: {} },
  });

  if (types === undefined || questions === undefined || sessions === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const hasSessions = sessions.length > 0;
  const freeTypes = types.filter((t) => t.kind === "free");
  const hasPaid = types.some((t) => t.kind !== "free");

  if (freeTypes.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Online ticket sales are coming soon.
        </CardContent>
      </Card>
    );
  }

  const totalTickets = Object.values(quantities).reduce((sum, n) => sum + n, 0);

  function setQty(id: string, n: number) {
    setQuantities((q) => ({ ...q, [id]: n }));
  }

  async function onValid(values: CheckoutFormValues) {
    const items = freeTypes
      .filter((t) => (quantities[t._id] ?? 0) > 0)
      .map((t) => ({ ticketTypeId: t._id, quantity: quantities[t._id]! }));

    if (items.length === 0) {
      toast.error("Select at least one ticket");
      return;
    }
    if (hasSessions && sessionId === "") {
      toast.error("Choose a session");
      return;
    }

    const answerList = questions!
      .filter((q) => (values.answers[q._id] ?? "") !== "")
      .map((q) => ({ questionId: q._id, value: values.answers[q._id]! }));

    try {
      const res = await createOrder({
        eventId: event._id,
        items,
        buyerName: values.buyerName.trim(),
        buyerEmail: values.buyerEmail.trim(),
        answers: answerList.length > 0 ? answerList : undefined,
        sessionId: hasSessions && sessionId !== "" ? sessionId : undefined,
      });
      navigate({ to: "/orders/$token", params: { token: res.token } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not complete registration");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Get tickets</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onValid)} className="flex flex-col gap-6">
            {hasSessions && (
              <div className="grid gap-1.5">
                <Label htmlFor="checkout-session">Session</Label>
                <Select
                  value={sessionId}
                  onValueChange={(value) => setSessionId(value as Id<"eventSessions">)}
                >
                  <SelectTrigger id="checkout-session" className="w-full">
                    <SelectValue placeholder="Choose a session" />
                  </SelectTrigger>
                  <SelectContent>
                    {sessions.map((session) => (
                      <SelectItem key={session._id} value={session._id}>
                        {new Date(session.startsAt).toLocaleString()}
                        {session.label ? ` · ${session.label}` : ""} · {session.remaining} left
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-col gap-3">
              {types.map((t) => {
                const isFree = t.kind === "free";
                const remaining = t.capacity != null ? Math.max(0, t.capacity - t.sold) : Number.POSITIVE_INFINITY;
                const soldOut = remaining === 0;
                const max = Math.min(t.maxPerOrder ?? DEFAULT_MAX_PER_TYPE, remaining);
                const n = quantities[t._id] ?? 0;
                return (
                  <div key={t._id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{t.name}</span>
                        {t.badge && <Badge variant="secondary">{t.badge}</Badge>}
                        {!isFree && <Badge variant="outline">Coming soon</Badge>}
                        {isFree && soldOut && <Badge variant="outline">Sold out</Badge>}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {isFree ? "Free" : formatMoney(t.priceCents, currency)}
                      </div>
                    </div>
                    {isFree ? (
                      <div className="flex items-center gap-2">
                        <Button type="button" variant="outline" size="icon-sm" aria-label={`Decrease quantity for ${t.name}`}
                          disabled={n <= 0} onClick={() => setQty(t._id, Math.max(0, n - 1))}>
                          <Minus />
                        </Button>
                        <span className="w-6 text-center tabular-nums">{n}</span>
                        <Button type="button" variant="outline" size="icon-sm" aria-label={`Increase quantity for ${t.name}`}
                          disabled={soldOut || n >= max} onClick={() => setQty(t._id, n + 1)}>
                          <Plus />
                        </Button>
                      </div>
                    ) : (
                      <Button type="button" variant="outline" size="sm" disabled>Unavailable</Button>
                    )}
                  </div>
                );
              })}
            </div>

            {hasPaid && (
              <p className="text-xs text-muted-foreground">Paid tickets will be available online soon.</p>
            )}

            <div className="grid gap-3">
              <FormField
                control={form.control}
                name="buyerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Your name</FormLabel>
                    <FormControl>
                      <Input autoComplete="name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="buyerEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {questions.length > 0 && (
              <div className="grid gap-3">
                {questions.map((q) => (
                  <FormField
                    key={q._id}
                    control={form.control}
                    name={`answers.${q._id}`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {q.label}
                          {q.required && <span className="text-destructive"> *</span>}
                        </FormLabel>
                        {q.kind === "text" && (
                          <FormControl>
                            <Textarea {...field} value={field.value ?? ""} />
                          </FormControl>
                        )}
                        {q.kind === "select" && (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Choose an option" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {(q.options ?? []).map((opt) => (
                                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {q.kind === "checkbox" && (
                          <label className="flex items-center gap-2 text-sm">
                            <FormControl>
                              <Checkbox
                                checked={field.value === "true"}
                                onCheckedChange={(c) => field.onChange(c === true ? "true" : "false")}
                              />
                            </FormControl>
                            Yes
                          </label>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
            )}

            <div className="flex items-center justify-between border-t pt-4">
              <span className="text-sm text-muted-foreground">
                {totalTickets} ticket{totalTickets === 1 ? "" : "s"}
              </span>
              <span className="font-medium">Free</span>
            </div>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <LoaderCircle className="animate-spin" />}
              Complete registration
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
