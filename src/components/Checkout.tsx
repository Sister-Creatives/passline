import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { Minus, Plus, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { formatMoney } from "@/lib/format-money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const DEFAULT_MAX_PER_TYPE = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Checkout({ event }: { event: Doc<"events"> }) {
  const navigate = useNavigate();
  const currency = event.currency ?? "USD";
  const { data: types } = useQuery(convexQuery(api.ticketTypes.listPublicForEvent, { eventId: event._id }));
  const { data: questions } = useQuery(convexQuery(api.checkoutQuestions.listForEvent, { eventId: event._id }));
  const createOrder = useMutation(api.orders.createOrder);

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  if (types === undefined || questions === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

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
  const emailValid = EMAIL_RE.test(buyerEmail);
  const requiredAnswered = questions.every((q) => {
    if (!q.required) return true;
    const val = answers[q._id];
    return q.kind === "checkbox" ? val === "true" : val != null && val.trim() !== "";
  });
  const minOk = freeTypes.every((t) => {
    const n = quantities[t._id] ?? 0;
    return n === 0 || n >= (t.minPerOrder ?? 1);
  });
  const canSubmit =
    totalTickets > 0 && buyerName.trim() !== "" && emailValid && requiredAnswered && minOk && !submitting;

  function setQty(id: string, n: number) {
    setQuantities((q) => ({ ...q, [id]: n }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const items = freeTypes
        .filter((t) => (quantities[t._id] ?? 0) > 0)
        .map((t) => ({ ticketTypeId: t._id, quantity: quantities[t._id]! }));
      const answerList = questions!
        .filter((q) => (answers[q._id] ?? "") !== "")
        .map((q) => ({ questionId: q._id, value: answers[q._id]! }));
      const res = await createOrder({
        eventId: event._id,
        items,
        buyerName: buyerName.trim(),
        buyerEmail: buyerEmail.trim(),
        answers: answerList.length > 0 ? answerList : undefined,
      });
      navigate({ to: "/orders/$token", params: { token: res.token } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not complete registration");
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Get tickets</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
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
                      <Button type="button" variant="outline" size="icon-sm" aria-label="Decrease"
                        disabled={n <= 0} onClick={() => setQty(t._id, Math.max(0, n - 1))}>
                        <Minus />
                      </Button>
                      <span className="w-6 text-center tabular-nums">{n}</span>
                      <Button type="button" variant="outline" size="icon-sm" aria-label="Increase"
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
            <div className="grid gap-1.5">
              <Label htmlFor="buyer-name">Your name</Label>
              <Input id="buyer-name" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="buyer-email">Email</Label>
              <Input id="buyer-email" type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} required />
            </div>
          </div>

          {questions.length > 0 && (
            <div className="grid gap-3">
              {questions.map((q) => (
                <div key={q._id} className="grid gap-1.5">
                  <Label>
                    {q.label}
                    {q.required && <span className="text-destructive"> *</span>}
                  </Label>
                  {q.kind === "text" && (
                    <Textarea
                      value={answers[q._id] ?? ""}
                      onChange={(e) => setAnswers((a) => ({ ...a, [q._id]: e.target.value }))}
                    />
                  )}
                  {q.kind === "select" && (
                    <Select
                      value={answers[q._id] ?? ""}
                      onValueChange={(val) => setAnswers((a) => ({ ...a, [q._id]: val }))}
                    >
                      <SelectTrigger><SelectValue placeholder="Choose an option" /></SelectTrigger>
                      <SelectContent>
                        {(q.options ?? []).map((opt) => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {q.kind === "checkbox" && (
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={answers[q._id] === "true"}
                        onCheckedChange={(c) => setAnswers((a) => ({ ...a, [q._id]: c === true ? "true" : "false" }))}
                      />
                      Yes
                    </label>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between border-t pt-4">
            <span className="text-sm text-muted-foreground">
              {totalTickets} ticket{totalTickets === 1 ? "" : "s"}
            </span>
            <span className="font-medium">Free</span>
          </div>
          <Button type="submit" disabled={!canSubmit}>
            {submitting && <LoaderCircle className="animate-spin" />}
            Complete registration
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
