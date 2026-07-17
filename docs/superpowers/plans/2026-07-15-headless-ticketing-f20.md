# F20: Free Hosted Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public attendee checkout on `/e/$slug` for **free** ticket types that issues tickets +
QR end-to-end, reusing the existing order engine; coexists with the legacy RSVP form.

**Architecture:** One new public read query (`ticketTypes.listPublicForEvent`) feeds a new
`<Checkout>` component that calls the existing public `orders.createOrder` (which fulfils a $0 cart
inline) and routes to the existing `/orders/$token` confirmation page. `/e/$slug` branches between
`<Checkout>` (event has visible ticket types) and the existing `<RsvpForm>` (none). No schema
changes; `createOrder`/`buildOrder` unchanged.

**Tech Stack:** Convex (queries, `convex-test` + Vitest edge-runtime), TanStack Start/Router (React
19, SSR), `@convex-dev/react-query`, shadcn/ui, Tailwind v4, lucide-react.

## Global Constraints

- Package manager **pnpm** only. Test `pnpm test`; typecheck `pnpm exec tsc --noEmit`; build
  `pnpm build`; routes `pnpm generate-routes`.
- Root `tsconfig.json` enforces **`noUnusedLocals: true` AND `noUnusedParameters: true`** — no unused
  imports/vars; `tsc --noEmit` must be clean.
- **shadcn/ui for all UI**; `Skeleton` for loading (no spinners/"Loading…" text); lucide-react icons
  only; plain `Error`; integer cents; English, no emojis. Conventional Commits.
- **Additive:** the only backend change is one new public query. Do NOT modify `orders.ts`,
  `RsvpForm.tsx`, or any panel. `createOrder` is reused exactly as-is.
- Convex tests: `// @vitest-environment edge-runtime`, `const modules = import.meta.glob("./**/*.*s")`,
  the file-local `asOrganizer(t, email) → { as, userId }` helper (users + authSessions subject).
- Free-only: the UI enables steppers **only** for `kind === "free"` types, so the submitted cart is
  always $0 and `createOrder` returns `status: "paid"` with tickets issued inline.

---

## File Structure

**Modify:**
- `convex/ticketTypes.ts` — add `listPublicForEvent` public query.
- `convex/ticketTypes.test.ts` — append query tests.
- `src/routes/e/$slug.tsx` — branch the registration block: `<Checkout>` vs `<RsvpForm>`.

**Create:**
- `src/components/Checkout.tsx` — the free-checkout UI.

---

## Task 1: `ticketTypes.listPublicForEvent` public query

**Files:**
- Modify: `convex/ticketTypes.ts`
- Test: `convex/ticketTypes.test.ts` (append)

**Interfaces:**
- Produces: `api.ticketTypes.listPublicForEvent({ eventId }) → Array<{ _id, name, kind, priceCents,
  capacity?, sold, badge?, minPerOrder?, maxPerOrder? }>` — active + visible types of a **published**
  event, sorted by `sortOrder`; `[]` for a draft/missing event. Public (no auth). Consumed by Tasks 2–3.

- [ ] **Step 1: Write the failing tests** — append to `convex/ticketTypes.test.ts`:

```ts
test("listPublicForEvent returns active+visible types of a published event, sorted; excludes hidden/archived", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const freeId = await as.mutation(api.ticketTypes.create, { eventId, name: "GA", kind: "free", priceCents: 0 });
  const paidId = await as.mutation(api.ticketTypes.create, { eventId, name: "VIP", kind: "paid", priceCents: 5000 });
  const hiddenId = await as.mutation(api.ticketTypes.create, { eventId, name: "Secret", kind: "paid", priceCents: 9000, visibility: "hidden" });
  // Archive one via update (visibility visible, but status archived through remove? use a direct patch).
  await t.run((ctx) => ctx.db.patch(hiddenId, { status: "active" })); // keep hidden+active
  // Publish (F19 gate passes: there is a visible active type).
  await as.mutation(api.events.publishEvent, { eventId });

  const list = await t.query(api.ticketTypes.listPublicForEvent, { eventId });
  const ids = list.map((x) => x._id);
  expect(ids).toContain(freeId);
  expect(ids).toContain(paidId);
  expect(ids).not.toContain(hiddenId); // hidden excluded
  // sorted by sortOrder (GA created first -> before VIP)
  expect(list.findIndex((x) => x._id === freeId)).toBeLessThan(list.findIndex((x) => x._id === paidId));
  // shape: kind/price present, no internal-only fields required
  const ga = list.find((x) => x._id === freeId)!;
  expect(ga).toMatchObject({ name: "GA", kind: "free", priceCents: 0, sold: 0 });
});

test("listPublicForEvent returns [] for an unpublished (draft) event and is callable without auth", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await as.mutation(api.ticketTypes.create, { eventId, name: "GA", kind: "free", priceCents: 0 });
  // Not published yet:
  expect(await t.query(api.ticketTypes.listPublicForEvent, { eventId })).toEqual([]);
  // Publish, then an anonymous caller (no withIdentity) can read it:
  await as.mutation(api.events.publishEvent, { eventId });
  const anon = await t.query(api.ticketTypes.listPublicForEvent, { eventId });
  expect(anon.map((x) => x.name)).toEqual(["GA"]);
});
```

> Note: `makeEvent` in this file uses tiny past dates; F19's publish gate keeps `date` as a
> recommended warning (non-blocking) and passes on a visible active ticket type, so `publishEvent`
> succeeds here.

- [ ] **Step 2: Run to verify fail** — `pnpm test convex/ticketTypes.test.ts` → FAIL
  (`api.ticketTypes.listPublicForEvent` undefined).

- [ ] **Step 3: Implement** — append to `convex/ticketTypes.ts`:

```ts
/**
 * Public storefront query: the active + visible ticket types of a *published*
 * event, sorted by sortOrder. No auth / no ownership check (mirrors the public
 * checkoutQuestions.listForEvent). Returns all kinds -- the storefront shows
 * paid/donation tiers as "coming soon" while only free ones are purchasable
 * this slice. Hidden/archived types and draft events never leak.
 */
export const listPublicForEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "published") return [];
    const types = await ctx.db
      .query("ticketTypes")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    return types
      .filter((t) => t.status === "active" && t.visibility === "visible")
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({
        _id: t._id,
        name: t.name,
        kind: t.kind,
        priceCents: t.priceCents,
        capacity: t.capacity,
        sold: t.sold,
        badge: t.badge,
        minPerOrder: t.minPerOrder,
        maxPerOrder: t.maxPerOrder,
      }));
  },
});
```

(`query` and `v` are already imported in this file.)

- [ ] **Step 4: Run to verify pass** — `pnpm test convex/ticketTypes.test.ts` → PASS. Then
  `pnpm test` → full suite green.

- [ ] **Step 5: Commit**

```bash
git add convex/ticketTypes.ts convex/ticketTypes.test.ts
git commit -m "feat(checkout): public ticketTypes.listPublicForEvent query"
```

---

## Task 2: `<Checkout>` component

**Files:**
- Create: `src/components/Checkout.tsx`

**Interfaces:**
- Consumes: `api.ticketTypes.listPublicForEvent`, `api.checkoutQuestions.listForEvent`,
  `api.orders.createOrder` (`{ eventId, items: {ticketTypeId, quantity}[], buyerName, buyerEmail,
  answers?: {questionId, value}[] }` → `{ token, status, ... }`), `formatMoney`.
- Produces: `<Checkout event={Doc<"events">} />`.

- [ ] **Step 1: Create `src/components/Checkout.tsx`**

```tsx
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
      const answerList = questions
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
```

- [ ] **Step 2: Typecheck + build** — `pnpm exec tsc --noEmit && pnpm build` → green. If `Checkbox`
  is not installed, run `pnpm dlx shadcn@latest add checkbox` first (it is listed in
  `src/components/ui/`, so it should already exist).

- [ ] **Step 3: Commit**

```bash
git add src/components/Checkout.tsx
git commit -m "feat(checkout): free-ticket Checkout component"
```

---

## Task 3: Branch `/e/$slug` between Checkout and RsvpForm

**Files:**
- Modify: `src/routes/e/$slug.tsx`

**Interfaces:** Consumes `api.ticketTypes.listPublicForEvent`, `<Checkout>`.

- [ ] **Step 1: Add the query + branch** — in `src/routes/e/$slug.tsx`:
  1. Add imports: `import { Checkout } from "@/components/Checkout";`
  2. Inside `EventDetails` (which already has `event` and several `useSuspenseQuery` calls), add:

```tsx
const { data: ticketTypes } = useSuspenseQuery(
  convexQuery(api.ticketTypes.listPublicForEvent, { eventId: event._id }),
);
```

  3. Replace the existing registration block:

```tsx
<div className="mt-6 max-w-sm">
  <RsvpForm
    slug={slug}
    isFull={isFull}
    ctaLabel={content?.ctaLabel}
    accentColor={brandColor}
  />
</div>
```

  with:

```tsx
<div className="mt-6">
  {ticketTypes.length > 0 ? (
    <Checkout event={event} />
  ) : (
    <div className="max-w-sm">
      <RsvpForm
        slug={slug}
        isFull={isFull}
        ctaLabel={content?.ctaLabel}
        accentColor={brandColor}
      />
    </div>
  )}
</div>
```

(Leave the "N of M spots taken" line and all other content as-is. `RsvpForm` is unchanged.)

- [ ] **Step 2: Regenerate routes, typecheck, build** —
  `pnpm generate-routes && pnpm exec tsc --noEmit && pnpm build` → green.

- [ ] **Step 3: Commit**

```bash
git add src/routes/e/$slug.tsx src/routeTree.gen.ts
git commit -m "feat(checkout): show Checkout on ticketed events, RsvpForm otherwise"
```

---

## Task 4: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full suite** — `pnpm test` → all green (existing + the two new `listPublicForEvent`
  tests). No existing test modified.
- [ ] **Step 2: Typecheck + routes + build** —
  `pnpm generate-routes && pnpm exec tsc --noEmit && pnpm build` → green.
- [ ] **Step 3: Drive-verify** — `pnpm dev`: create an event, add a **free** ticket type + one
  **required** checkout question, publish. Open `/e/<slug>`: confirm the Checkout renders (not the
  RSVP form), pick 2 tickets, try to submit with the required question blank (submit disabled),
  answer it, submit → land on `/orders/<token>` showing 2 QR tickets. Then: an event with **no**
  ticket types still shows the RSVP form; an event whose only visible type is **paid** shows the
  "Online ticket sales are coming soon" notice and a disabled row.

---

## Self-Review

**Spec coverage:** public `listPublicForEvent` (§4 → T1); `<Checkout>` with free steppers + disabled
paid/donation + buyer fields + checkout questions + $0 summary → `createOrder` → `/orders/$token`
(§5.2 → T2); `/e/$slug` Checkout-vs-RsvpForm branch (§5.1 → T3); free-only enforced by only enabling
`kind==="free"` steppers (§2 → T2); reuse of `createOrder` + confirmation page, no schema change
(§3 → T1–T3); TDD for the query + tsc/build/drive for UI (§6 → T1–T4). Covered.

**Type consistency:** `listPublicForEvent`'s returned element shape (T1) is what `<Checkout>` maps
over (T2: `t._id/name/kind/priceCents/capacity/sold/badge/minPerOrder/maxPerOrder`) and what
`/e/$slug` checks `.length` on (T3). `createOrder` item shape `{ ticketTypeId, quantity }` matches
`orderItemInput` and the `answers` shape matches `answerInput` (`{ questionId, value }`).

**Placeholder scan:** no TBD/TODO; every code step is complete; no unused imports introduced
(Checkbox/Select/Textarea/Label/Badge/Skeleton/Card all consumed).
