# F19: Event Builder (guided section editor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn event setup into a Humanitix-style guided section editor — one unified editor with a
grouped Build/Manage left rail, per-section completion badges, and a persistent Publish button gated
on a server-enforced readiness model — reusing every existing section panel unchanged.

**Architecture:** A pure `computeReadiness` helper is the single source of truth for both the UI
checklist and the publish gate (they can never drift). A new `getEventReadiness` query drives the
rail; `publishEvent` calls the same helper and rejects an unready event. The event page is rewritten
from a horizontal 15-tab bar into a two-pane layout: a left `EventBuilderNav` (grouped sections +
readiness badges + a gated Publish footer) and a right pane that renders the selected section's
existing panel, with the active section held in a `?section=` URL search param. No schema changes.

**Tech Stack:** Convex (queries/mutations, `convex-test` + Vitest edge-runtime), TanStack
Start/Router (React 19, SSR, search-param validation), `@convex-dev/react-query`, shadcn/ui, Tailwind
v4, lucide-react.

## Global Constraints

- Package manager **pnpm** only. Never `npm install`. Test: `pnpm test`; typecheck:
  `pnpm exec tsc --noEmit`; build: `pnpm build`; routes: `pnpm generate-routes`.
- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `test:`). Body wraps at 100 chars.
- Icons: **lucide-react only**. No hand-written `<svg>`.
- **shadcn/ui for all UI.** Forms use the project's existing `@/components/ui/form` API. Loading
  states use shadcn **`Skeleton`** — never spinners or "Loading…" text.
- Errors are plain `Error` with a human message. Money is integer cents. English only, no emojis.
- **`computeReadiness` is pure and takes `now` as an argument** — never call `Date.now()` inside it
  (determinism for tests). Callers (`getEventReadiness`, `publishEvent`) pass `Date.now()`.
- **Additive backend.** The only behavior change is `publishEvent` enforcing readiness. The refined
  conditional rules are designed so **no existing test needs editing** — a full `pnpm test` must
  stay green (327+ tests). **Do not modify any reused panel component.**
- Convex tests: `// @vitest-environment edge-runtime`, `const modules = import.meta.glob("./**/*.*s")`,
  and the file-local `asOrganizer(t, email) → { as, userId }` helper (users + authSessions subject).
- Commit at the end of every task.

---

## File Structure

**Create:**
- `convex/lib/readiness.ts` — pure readiness types + `computeReadiness` (the single source of truth).
- `convex/readiness.test.ts` — unit tests for the pure helper (bulk of the coverage).
- `src/lib/eventSections.ts` — the section taxonomy (key/label/group) + `isEventSectionKey` guard.
- `src/components/EventBuilderNav.tsx` — the left rail: grouped sections, readiness badges, gated
  Publish footer.

**Modify:**
- `convex/events.ts` — add `loadReadinessInputs` helper + `getEventReadiness` query; enforce the gate
  in `publishEvent`.
- `convex/events.test.ts` — append readiness/gate tests (no existing test changes).
- `src/routes/events/$id.index.tsx` — rewrite into the two-pane section editor with `?section=`
  routing; split the overloaded Details tab (Details = inline form + capacity; Attendees = tables).
- `src/components/EventForm.tsx` — on create, navigate to `?section=tickets`.

---

## Task 1: Readiness engine — pure `computeReadiness` helper

**Files:**
- Create: `convex/lib/readiness.ts`
- Test: `convex/readiness.test.ts`

**Interfaces:**
- Consumes: `Doc` types from `../_generated/dataModel` (structurally, via `Pick`).
- Produces: `computeReadiness(input) → EventReadiness`; the exported types `SectionKey`, `RuleId`,
  `ReadinessRule`, `SectionStatus`, `EventReadiness`. Consumed by Task 2.

- [ ] **Step 1: Write the failing test**

Create `convex/readiness.test.ts`:

```ts
// @vitest-environment edge-runtime
import { expect, test } from "vitest";
import { computeReadiness } from "./lib/readiness";
import type { Id } from "./_generated/dataModel";

const TT1 = "tt1" as Id<"ticketTypes">;

// Minimal structural fixtures — computeReadiness reads only these fields.
function baseEvent(over: Partial<{ title: string; description: string; location: string; startsAt: number; endsAt: number }> = {}) {
  return { title: "Party", description: "Fun", location: "Hall", startsAt: 10, endsAt: 20, ...over };
}
function tt(over: Partial<{ _id: Id<"ticketTypes">; status: "active" | "archived"; visibility: "visible" | "hidden"; capacity: number | undefined }> = {}) {
  return { _id: TT1, status: "active" as const, visibility: "visible" as const, capacity: undefined, ...over };
}
const NOW = 15; // between startsAt(10) and endsAt(20) so `date` (endsAt > now) passes by default

test("an event with no ticket types publishes as free RSVP", () => {
  const r = computeReadiness({ event: baseEvent(), ticketTypes: [], seats: [], accessCodes: [], eventContent: null, now: NOW });
  expect(r.canPublish).toBe(true);
  expect(r.blockersRemaining).toBe(0);
  expect(r.sectionStatus.tickets).toBe("complete");
  expect(r.sectionStatus.details).toBe("complete");
});

test("a hidden ticket type with no access code blocks publish", () => {
  const r = computeReadiness({ event: baseEvent(), ticketTypes: [tt({ visibility: "hidden" })], seats: [], accessCodes: [], eventContent: null, now: NOW });
  expect(r.canPublish).toBe(false);
  expect(r.sectionStatus.tickets).toBe("incomplete");
  expect(r.rules.find((x) => x.id === "tickets")?.status).toBe("fail");
});

test("an active access code unlocks a hidden type", () => {
  const r = computeReadiness({ event: baseEvent(), ticketTypes: [tt({ visibility: "hidden" })], seats: [], accessCodes: [{ active: true }], eventContent: null, now: NOW });
  expect(r.canPublish).toBe(true);
  expect(r.sectionStatus.tickets).toBe("complete");
});

test("a visible active type publishes; an archived-only set blocks", () => {
  expect(computeReadiness({ event: baseEvent(), ticketTypes: [tt()], seats: [], accessCodes: [], eventContent: null, now: NOW }).canPublish).toBe(true);
  const archived = computeReadiness({ event: baseEvent(), ticketTypes: [tt({ status: "archived" })], seats: [], accessCodes: [], eventContent: null, now: NOW });
  expect(archived.canPublish).toBe(false);
});

test("a past end date is a warning, not a blocker", () => {
  const r = computeReadiness({ event: baseEvent(), ticketTypes: [tt()], seats: [], accessCodes: [], eventContent: null, now: 999 });
  expect(r.canPublish).toBe(true);
  expect(r.sectionStatus.details).toBe("warning");
  expect(r.rules.find((x) => x.id === "date")?.status).toBe("fail");
});

test("seating: a seated type with fewer seats than its capacity blocks; enough passes", () => {
  const seats4 = [TT1, TT1, TT1, TT1].map((ticketTypeId) => ({ ticketTypeId }));
  const under = computeReadiness({ event: baseEvent(), ticketTypes: [tt({ capacity: 10 })], seats: seats4, accessCodes: [], eventContent: null, now: NOW });
  expect(under.canPublish).toBe(false);
  expect(under.sectionStatus.seating).toBe("incomplete");
  const ok = computeReadiness({ event: baseEvent(), ticketTypes: [tt({ capacity: 4 })], seats: seats4, accessCodes: [], eventContent: null, now: NOW });
  expect(ok.canPublish).toBe(true);
  expect(ok.sectionStatus.seating).toBe("complete");
});

test("the seating rule is absent when the event has no seats", () => {
  const r = computeReadiness({ event: baseEvent(), ticketTypes: [tt()], seats: [], accessCodes: [], eventContent: null, now: NOW });
  expect(r.sectionStatus.seating).toBeUndefined();
  expect(r.rules.some((x) => x.id === "seating")).toBe(false);
});

test("cover/page are warnings on the page section and never block", () => {
  const bare = computeReadiness({ event: baseEvent(), ticketTypes: [tt()], seats: [], accessCodes: [], eventContent: null, now: NOW });
  expect(bare.canPublish).toBe(true);
  expect(bare.sectionStatus.page).toBe("warning");
  const rich = computeReadiness({
    event: baseEvent(), ticketTypes: [tt()], seats: [], accessCodes: [], now: NOW,
    eventContent: { coverImageUrl: "https://x/y.jpg", agenda: [], speakers: [], faqs: [{ question: "q", answer: "a" }] },
  });
  expect(rich.sectionStatus.page).toBe("complete");
});

test("details is incomplete when a required field is blank", () => {
  const r = computeReadiness({ event: baseEvent({ title: "  " }), ticketTypes: [tt()], seats: [], accessCodes: [], eventContent: null, now: NOW });
  expect(r.canPublish).toBe(false);
  expect(r.sectionStatus.details).toBe("incomplete");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test convex/readiness.test.ts`
Expected: FAIL (`computeReadiness` is not defined / module missing).

- [ ] **Step 3: Implement `convex/lib/readiness.ts`**

```ts
import type { Doc } from "../_generated/dataModel";

/** Every section in the event editor. Rule-bearing ones appear in `sectionStatus`. */
export type SectionKey =
  | "details" | "tickets" | "sessions" | "seating" | "addons" | "promo"
  | "access" | "questions" | "page" | "hub" | "accessibility"
  | "orders" | "attendees" | "analytics" | "marketing" | "activity";

export type RuleId = "details" | "tickets" | "seating" | "date" | "cover" | "page";
export type RuleSeverity = "required" | "recommended";
export type RuleStatus = "pass" | "fail";
export type SectionStatus = "complete" | "warning" | "incomplete";

export type ReadinessRule = {
  id: RuleId;
  section: SectionKey;
  label: string;
  severity: RuleSeverity;
  status: RuleStatus;
};

export type EventReadiness = {
  rules: ReadinessRule[];
  /** Only rule-bearing sections (details, tickets, page, and seating when in use). */
  sectionStatus: Partial<Record<SectionKey, SectionStatus>>;
  requiredTotal: number;
  requiredPassing: number;
  blockersRemaining: number;
  canPublish: boolean;
};

// Structural inputs: the real Convex Docs satisfy these Picks, and unit tests
// can pass minimal literals without constructing a full Doc.
type EventInput = Pick<Doc<"events">, "title" | "description" | "location" | "startsAt" | "endsAt">;
type TicketTypeInput = Pick<Doc<"ticketTypes">, "_id" | "status" | "visibility" | "capacity">;
type SeatInput = Pick<Doc<"seats">, "ticketTypeId">;
type AccessCodeInput = Pick<Doc<"accessCodes">, "active">;
type EventContentInput = Pick<Doc<"eventContent">, "coverImageUrl" | "agenda" | "speakers" | "faqs">;

/**
 * Compute an event's publish-readiness. Pure: reads only the fields above and
 * the injected `now`, so it is the single source of truth for both the UI
 * checklist (`getEventReadiness`) and the server gate (`publishEvent`).
 *
 * Required rules (block publish): `details`; `tickets` (a way in exists);
 * `seating` (only when the event uses reserved seating). Recommended rules
 * (warn only): `date`, `cover`, `page`.
 */
export function computeReadiness(input: {
  event: EventInput;
  ticketTypes: TicketTypeInput[];
  seats: SeatInput[];
  accessCodes: AccessCodeInput[];
  eventContent: EventContentInput | null;
  now: number;
}): EventReadiness {
  const { event, ticketTypes, seats, accessCodes, eventContent, now } = input;

  const detailsOk =
    event.title.trim() !== "" &&
    event.description.trim() !== "" &&
    event.location.trim() !== "" &&
    event.endsAt > event.startsAt;

  // "A way in": no ticket types (free RSVP), or a visible active type, or an
  // active access code that unlocks hidden types (invite-only event).
  const hasTypes = ticketTypes.length > 0;
  const hasVisibleActive = ticketTypes.some((t) => t.status === "active" && t.visibility === "visible");
  const hasActiveCode = accessCodes.some((c) => c.active);
  const ticketsOk = !hasTypes || hasVisibleActive || hasActiveCode;

  // Seating coherence — only relevant once the event has a seat map.
  const seatingEnabled = seats.length > 0;
  let seatingOk = true;
  if (seatingEnabled) {
    for (const type of ticketTypes) {
      const seatCount = seats.filter((s) => s.ticketTypeId === type._id).length;
      if (seatCount > 0) {
        const needed = type.capacity ?? seatCount;
        if (seatCount < needed) seatingOk = false;
      }
    }
  }

  const dateOk = event.endsAt > now;
  const coverOk = Boolean(eventContent?.coverImageUrl);
  const pageOk =
    eventContent != null &&
    (eventContent.agenda.length > 0 || eventContent.speakers.length > 0 || eventContent.faqs.length > 0);

  const rules: ReadinessRule[] = [
    { id: "details", section: "details", severity: "required", label: "Add a title, description, location, and a valid date range", status: detailsOk ? "pass" : "fail" },
    { id: "tickets", section: "tickets", severity: "required", label: "Add a ticket type buyers can access", status: ticketsOk ? "pass" : "fail" },
  ];
  if (seatingEnabled) {
    rules.push({ id: "seating", section: "seating", severity: "required", label: "Map enough seats for each seated ticket type", status: seatingOk ? "pass" : "fail" });
  }
  rules.push(
    { id: "date", section: "details", severity: "recommended", label: "Set an end date in the future", status: dateOk ? "pass" : "fail" },
    { id: "cover", section: "page", severity: "recommended", label: "Add a cover image", status: coverOk ? "pass" : "fail" },
    { id: "page", section: "page", severity: "recommended", label: "Add an agenda, speakers, or FAQs", status: pageOk ? "pass" : "fail" },
  );

  const sectionStatus: Partial<Record<SectionKey, SectionStatus>> = {};
  for (const section of new Set(rules.map((r) => r.section))) {
    const secRules = rules.filter((r) => r.section === section);
    const requiredFail = secRules.some((r) => r.severity === "required" && r.status === "fail");
    const recommendedFail = secRules.some((r) => r.severity === "recommended" && r.status === "fail");
    sectionStatus[section] = requiredFail ? "incomplete" : recommendedFail ? "warning" : "complete";
  }

  const requiredRules = rules.filter((r) => r.severity === "required");
  const requiredPassing = requiredRules.filter((r) => r.status === "pass").length;
  const requiredTotal = requiredRules.length;
  const blockersRemaining = requiredTotal - requiredPassing;

  return { rules, sectionStatus, requiredTotal, requiredPassing, blockersRemaining, canPublish: blockersRemaining === 0 };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test convex/readiness.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add convex/lib/readiness.ts convex/readiness.test.ts
git commit -m "feat(builder): pure computeReadiness helper + unit tests"
```

---

## Task 2: `getEventReadiness` query + `publishEvent` gate

**Files:**
- Modify: `convex/events.ts`
- Test: `convex/events.test.ts` (append)

**Interfaces:**
- Consumes: `computeReadiness` (Task 1); the existing `requireOwnedEvent`, `recordAudit`.
- Produces: `api.events.getEventReadiness({ eventId }) → EventReadiness`; `publishEvent` now throws
  `Error("Cannot publish: <blocker label>")` when `!canPublish`. Consumed by Tasks 3–4.

- [ ] **Step 1: Write the failing tests** — append to `convex/events.test.ts`:

```ts
import { computeReadiness } from "./lib/readiness";

// Future window so the recommended `date` rule passes in these tests.
async function makeFutureEvent(as: Awaited<ReturnType<typeof asOrganizer>>["as"]) {
  return as.mutation(api.events.createEvent, {
    title: "Gala", description: "x", location: "Hall",
    startsAt: Date.now() + 3_600_000, endsAt: Date.now() + 7_200_000, capacity: 100,
  });
}

test("getEventReadiness is owner-only and reflects state", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeFutureEvent(asAda);

  // No ticket types -> publishable as free RSVP.
  const r1 = await asAda.query(api.events.getEventReadiness, { eventId });
  expect(r1.canPublish).toBe(true);

  await expect(asBob.query(api.events.getEventReadiness, { eventId })).rejects.toThrow();
});

test("publishEvent rejects an unreachable ticketed event, then succeeds when a type is visible", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeFutureEvent(as);

  const hiddenId = await as.mutation(api.ticketTypes.create, {
    eventId, name: "VIP", kind: "paid", priceCents: 5000, visibility: "hidden",
  });
  await expect(as.mutation(api.events.publishEvent, { eventId })).rejects.toThrow(/Cannot publish/);

  await as.mutation(api.ticketTypes.update, {
    ticketTypeId: hiddenId, name: "VIP", kind: "paid", priceCents: 5000, visibility: "visible",
  });
  await as.mutation(api.events.publishEvent, { eventId });
  const ev = await t.run((ctx) => ctx.db.get(eventId));
  expect(ev?.status).toBe("published");
});

test("a zero-ticket RSVP draft still publishes (past dates allowed)", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Meetup", description: "x", location: "y", startsAt: 100, endsAt: 200, capacity: 10,
  });
  await as.mutation(api.events.publishEvent, { eventId });
  const ev = await t.run((ctx) => ctx.db.get(eventId));
  expect(ev?.status).toBe("published");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm test convex/events.test.ts`
Expected: FAIL (`api.events.getEventReadiness` undefined; the publish-rejection test fails because
the gate is not implemented yet).

- [ ] **Step 3: Implement in `convex/events.ts`**

Add the import near the top (after the existing imports):

```ts
import { computeReadiness } from "./lib/readiness";
```

Add this private helper just after `requireOwnedEvent`:

```ts
/**
 * Load the child docs `computeReadiness` needs for an event. Sequential reads
 * (no Date.now()/randomness) keep the mutation transaction deterministic.
 */
async function loadReadinessInputs(ctx: QueryCtx | MutationCtx, eventId: Id<"events">) {
  const ticketTypes = await ctx.db
    .query("ticketTypes").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect();
  const seats = await ctx.db
    .query("seats").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect();
  const accessCodes = await ctx.db
    .query("accessCodes").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect();
  const eventContent = await ctx.db
    .query("eventContent").withIndex("by_event", (q) => q.eq("eventId", eventId)).unique();
  return { ticketTypes, seats, accessCodes, eventContent };
}
```

Replace the existing `publishEvent` body to enforce the gate:

```ts
export const publishEvent = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await requireOwnedEvent(ctx, eventId);
    const { ticketTypes, seats, accessCodes, eventContent } = await loadReadinessInputs(ctx, eventId);
    const readiness = computeReadiness({
      event, ticketTypes, seats, accessCodes, eventContent, now: Date.now(),
    });
    if (!readiness.canPublish) {
      const blocker = readiness.rules.find((r) => r.severity === "required" && r.status === "fail");
      throw new Error(`Cannot publish: ${blocker?.label ?? "the event is not ready"}`);
    }
    await ctx.db.patch(eventId, { status: "published" });
    await recordAudit(ctx, {
      organizerId: event.organizerId, eventId, action: "event.published", summary: "Published event",
    });
    return null;
  },
});
```

Add the query (place it just after `getMyEventWithRsvps`):

```ts
/** Owner-only publish-readiness report, reactive so the builder rail updates live. */
export const getEventReadiness = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await requireOwnedEvent(ctx, eventId);
    const { ticketTypes, seats, accessCodes, eventContent } = await loadReadinessInputs(ctx, eventId);
    return computeReadiness({ event, ticketTypes, seats, accessCodes, eventContent, now: Date.now() });
  },
});
```

- [ ] **Step 4: Run to verify pass (new + full suite)**

Run: `pnpm test convex/events.test.ts`
Expected: PASS (existing + 3 new tests).

Run: `pnpm test`
Expected: **all** tests green (327+). If any pre-existing publish test now fails, STOP — the refined
gate was implemented wrong (it must pass zero-ticket RSVP events, active+visible ticketed events, and
hidden+active-access-code invite events). Do not edit other test files to work around it.

- [ ] **Step 5: Commit**

```bash
git add convex/events.ts convex/events.test.ts
git commit -m "feat(builder): getEventReadiness query + publishEvent readiness gate"
```

---

## Task 3: Section taxonomy + two-pane editor shell + `?section=` routing + Details split

**Files:**
- Create: `src/lib/eventSections.ts`
- Modify: `src/routes/events/$id.index.tsx` (rewrite into the two-pane shell)

**Interfaces:**
- Consumes: `api.events.getMyEventWithRsvps` (unchanged); every existing `*Panel` component.
- Produces: `EVENT_SECTIONS`, `EventSectionKey`, `isEventSectionKey` (consumed by Task 4 nav);
  the `/events/$id/` route now validates a `section` search param.

- [ ] **Step 1: Create the section taxonomy** — `src/lib/eventSections.ts`:

```ts
export type EventSectionGroup = "build" | "manage";

export type EventSectionKey =
  | "details" | "tickets" | "sessions" | "seating" | "addons" | "promo"
  | "access" | "questions" | "page" | "hub" | "accessibility"
  | "orders" | "attendees" | "analytics" | "marketing" | "activity";

export type EventSection = { key: EventSectionKey; label: string; group: EventSectionGroup };

/** Ordered nav: BUILD sections (setup) then MANAGE sections (post-publish ops). */
export const EVENT_SECTIONS: EventSection[] = [
  { key: "details", label: "Details", group: "build" },
  { key: "tickets", label: "Ticket types", group: "build" },
  { key: "sessions", label: "Sessions", group: "build" },
  { key: "seating", label: "Seating", group: "build" },
  { key: "addons", label: "Add-ons", group: "build" },
  { key: "promo", label: "Promo codes", group: "build" },
  { key: "access", label: "Access codes", group: "build" },
  { key: "questions", label: "Questions", group: "build" },
  { key: "page", label: "Page & design", group: "build" },
  { key: "hub", label: "Virtual hub", group: "build" },
  { key: "accessibility", label: "Accessibility", group: "build" },
  { key: "orders", label: "Orders", group: "manage" },
  { key: "attendees", label: "Attendees", group: "manage" },
  { key: "analytics", label: "Analytics", group: "manage" },
  { key: "marketing", label: "Marketing", group: "manage" },
  { key: "activity", label: "Activity", group: "manage" },
];

const KEYS = new Set<string>(EVENT_SECTIONS.map((s) => s.key));

export function isEventSectionKey(value: unknown): value is EventSectionKey {
  return typeof value === "string" && KEYS.has(value);
}
```

- [ ] **Step 2: Rewrite `src/routes/events/$id.index.tsx`** — replace the whole file with the
  two-pane shell. The panels and handlers are unchanged; only the layout and the Details/Attendees
  split are new. In this task the nav is a **plain inline list** (`SectionLinks`); Task 4 swaps it for
  the readiness-aware `EventBuilderNav`.

```tsx
import { Suspense } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { Copy, Download, QrCode, ScanLine, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { EVENT_SECTIONS, isEventSectionKey, type EventSectionKey } from "@/lib/eventSections";
import { cn } from "@/lib/utils";
import { DashboardLayout } from "@/components/DashboardLayout";
import { AttendeeTable } from "@/components/AttendeeTable";
import { EventForm } from "@/components/EventForm";
import { TicketTypesPanel } from "@/components/TicketTypesPanel";
import { SessionsPanel } from "@/components/SessionsPanel";
import { SeatingPanel } from "@/components/SeatingPanel";
import { AddOnsPanel } from "@/components/AddOnsPanel";
import { OrdersPanel } from "@/components/OrdersPanel";
import { AnalyticsPanel } from "@/components/AnalyticsPanel";
import { MarketingPanel } from "@/components/MarketingPanel";
import { PromoCodesPanel } from "@/components/PromoCodesPanel";
import { AccessCodesPanel } from "@/components/AccessCodesPanel";
import { CheckoutQuestionsPanel } from "@/components/CheckoutQuestionsPanel";
import { EventPagePanel } from "@/components/EventPagePanel";
import { VirtualHubPanel } from "@/components/VirtualHubPanel";
import { AccessibilityPanel } from "@/components/AccessibilityPanel";
import { AuditLogPanel } from "@/components/AuditLogPanel";
import { csvField } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/events/$id/")({
  validateSearch: (search: Record<string, unknown>): { section: EventSectionKey } => ({
    section: isEventSectionKey(search.section) ? search.section : "details",
  }),
  component: EventManagePage,
});

const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  confirmed_pending_claim: "Pending claim",
  waitlisted: "Waitlisted",
  checked_in: "Checked in",
  cancelled: "Cancelled",
};

function EventManagePage() {
  const { id } = Route.useParams();
  const eventId = id as Id<"events">;
  return (
    <DashboardLayout>
      <Suspense
        fallback={
          <div className="mx-auto flex max-w-6xl gap-6 p-4 sm:p-8">
            <Skeleton className="hidden h-96 w-52 sm:block" />
            <div className="flex flex-1 flex-col gap-3">
              <Skeleton className="h-9 w-64" />
              <Skeleton className="h-64 w-full" />
            </div>
          </div>
        }
      >
        <EventManageContent eventId={eventId} />
      </Suspense>
    </DashboardLayout>
  );
}

function EventManageContent({ eventId }: { eventId: Id<"events"> }) {
  const { section } = Route.useSearch();
  const navigate = useNavigate();
  const { data } = useSuspenseQuery(convexQuery(api.events.getMyEventWithRsvps, { eventId }));
  const { event, confirmed, pendingClaim, waitlisted, checkedIn } = data;

  const publishEvent = useMutation(api.events.publishEvent);
  const unpublishEvent = useMutation(api.events.unpublishEvent);
  const deleteEvent = useMutation(api.events.deleteEvent);
  const duplicateEvent = useMutation(api.events.duplicateEvent);

  const isPublished = event.status === "published";
  const seatsTaken = confirmed.length + pendingClaim.length + checkedIn.length;

  async function handleTogglePublish() {
    try {
      if (isPublished) {
        await unpublishEvent({ eventId });
        toast.success("Event unpublished");
      } else {
        await publishEvent({ eventId });
        toast.success("Event published");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update event");
    }
  }

  async function handleDelete() {
    try {
      await deleteEvent({ eventId });
      toast.success("Event deleted");
      navigate({ to: "/events" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete event");
    }
  }

  async function handleDuplicate() {
    try {
      const newEventId = await duplicateEvent({ eventId });
      toast.success("Event duplicated");
      navigate({ to: "/events/$id", params: { id: newEventId }, search: { section: "details" } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to duplicate event");
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:flex-row sm:p-8">
      <SectionLinks eventId={eventId} active={section} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{event.title}</h1>
            <Badge variant={isPublished ? "default" : "secondary"} className="mt-2">{event.status}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/events/$id/door" params={{ id: eventId }}><ScanLine /> Door</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/events/$id/scan" params={{ id: eventId }}><QrCode /> Scan</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={handleDuplicate}><Copy /> Duplicate</Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm"><Trash2 /> Delete</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this event?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes the event and all RSVPs. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={handleDelete}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button onClick={handleTogglePublish} variant={isPublished ? "outline" : "default"} size="sm">
              {isPublished ? "Unpublish" : "Publish"}
            </Button>
          </div>
        </div>

        <div className="mt-6">
          <SectionContent section={section} event={event} seatsTaken={seatsTaken} rsvps={data} />
        </div>
      </div>
    </div>
  );
}

/** Plain grouped nav (replaced by EventBuilderNav in Task 4). */
function SectionLinks({ eventId, active }: { eventId: Id<"events">; active: EventSectionKey }) {
  const groups = [
    { title: "Build", items: EVENT_SECTIONS.filter((s) => s.group === "build") },
    { title: "Manage", items: EVENT_SECTIONS.filter((s) => s.group === "manage") },
  ];
  return (
    <nav className="flex w-full shrink-0 flex-col gap-4 sm:w-52">
      {groups.map((group) => (
        <div key={group.title}>
          <div className="px-2 text-xs font-medium uppercase text-muted-foreground">{group.title}</div>
          <div className="mt-1 flex flex-col">
            {group.items.map((s) => (
              <Link
                key={s.key}
                to="/events/$id"
                params={{ id: eventId }}
                search={{ section: s.key }}
                className={cn(
                  "rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                  s.key === active && "bg-accent font-medium",
                )}
              >
                {s.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function SectionContent({
  section, event, seatsTaken, rsvps,
}: {
  section: EventSectionKey;
  event: any;
  seatsTaken: number;
  rsvps: { confirmed: any[]; pendingClaim: any[]; waitlisted: any[]; checkedIn: any[] };
}) {
  const currency = event.currency ?? "USD";
  switch (section) {
    case "details": return <DetailsSection event={event} seatsTaken={seatsTaken} />;
    case "attendees": return <AttendeesSection event={event} rsvps={rsvps} />;
    case "tickets": return <TicketTypesPanel eventId={event._id} currency={currency} />;
    case "sessions": return <SessionsPanel eventId={event._id} />;
    case "seating": return <SeatingPanel eventId={event._id} />;
    case "addons": return <AddOnsPanel eventId={event._id} currency={currency} />;
    case "promo": return <PromoCodesPanel eventId={event._id} currency={currency} />;
    case "access": return <AccessCodesPanel eventId={event._id} />;
    case "questions": return <CheckoutQuestionsPanel eventId={event._id} />;
    case "page": return <EventPagePanel eventId={event._id} />;
    case "hub": return <VirtualHubPanel eventId={event._id} />;
    case "accessibility": return <AccessibilityPanel eventId={event._id} />;
    case "orders": return <OrdersPanel eventId={event._id} />;
    case "analytics": return <AnalyticsPanel eventId={event._id} />;
    case "marketing": return <MarketingPanel eventId={event._id} />;
    case "activity": return <AuditLogPanel eventId={event._id} />;
  }
}

function DetailsSection({ event, seatsTaken }: { event: any; seatsTaken: number }) {
  const capacityPercent = Math.min(100, (seatsTaken / event.capacity) * 100);
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Capacity</span>
          <span className="text-muted-foreground">{seatsTaken} / {event.capacity} seats taken</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${capacityPercent}%` }} />
        </div>
      </div>
      <EventForm event={event} />
    </div>
  );
}

function AttendeesSection({ event, rsvps }: { event: any; rsvps: any }) {
  const cancelRsvp = useMutation(api.rsvps.cancelRsvp);
  const { confirmed, pendingClaim, waitlisted, checkedIn } = rsvps;

  async function handleCancel(token: string) {
    try {
      await cancelRsvp({ token });
      toast.success("RSVP cancelled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel RSVP");
    }
  }

  function handleExportCsv() {
    try {
      const header = ["Name", "Email", "Status", "Checked in at"];
      const attendees = [...confirmed, ...pendingClaim, ...waitlisted, ...checkedIn];
      const rows = attendees.map((a: any) => [
        a.name, a.email, STATUS_LABEL[a.status] ?? a.status,
        a.checkedInAt ? new Date(a.checkedInAt).toLocaleString() : "",
      ]);
      const csv = [header, ...rows].map((row) => row.map((f: string) => csvField(f)).join(",")).join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${event.slug}-attendees.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export CSV");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleExportCsv}><Download /> Export CSV</Button>
      </div>
      <AttendeeTable
        title={`Confirmed (${confirmed.length})`}
        attendees={confirmed}
        emptyMessage="No confirmed attendees yet."
        renderAction={(a: any) => (
          <Button variant="outline" size="sm" onClick={() => handleCancel(a.token)}>Cancel</Button>
        )}
      />
      <AttendeeTable title={`Pending claim (${pendingClaim.length})`} attendees={pendingClaim} emptyMessage="No one is currently claiming a seat." />
      <AttendeeTable title={`Waitlist (${waitlisted.length})`} attendees={waitlisted} emptyMessage="The waitlist is empty." />
      <AttendeeTable title={`Checked in (${checkedIn.length})`} attendees={checkedIn} emptyMessage="No one has checked in yet." />
    </div>
  );
}
```

> Implementer note: the `any` types on `event`/`rsvps` are a deliberate shortcut for the relocated
> JSX (the source data comes from the typed `getMyEventWithRsvps` query). If `tsc` complains under the
> project's settings, narrow them to `Doc<"events">` and the rsvp bucket shapes returned by
> `getMyEventWithRsvps`; do not change any panel component.

- [ ] **Step 3: Regenerate routes, typecheck, build**

Run: `pnpm generate-routes && pnpm exec tsc --noEmit && pnpm build`
Expected: green. The `/events/$id/` route now carries a validated `section` search param.

- [ ] **Step 4: Manually verify**

Run `pnpm dlx convex dev` + `pnpm dev`. Open an event; confirm the left rail switches sections, the
URL gains `?section=…`, the browser back button moves between sections, Details shows the inline edit
form + capacity meter, Attendees shows the four tables + Export, and Publish/Duplicate/Delete/Door/
Scan still work.

- [ ] **Step 5: Commit**

```bash
git add src/lib/eventSections.ts src/routes/events/$id.index.tsx src/routeTree.gen.ts
git commit -m "feat(builder): two-pane event editor with ?section= routing and Details split"
```

---

## Task 4: `EventBuilderNav` — completion badges + readiness footer + gated Publish

**Files:**
- Create: `src/components/EventBuilderNav.tsx`
- Modify: `src/routes/events/$id.index.tsx` (use `EventBuilderNav`; move Publish/Unpublish into it)

**Interfaces:**
- Consumes: `api.events.getEventReadiness` (Task 2); `EVENT_SECTIONS`, `EventSectionKey` (Task 3).
- Produces: `<EventBuilderNav eventId activeSection isPublished slug onTogglePublish />`.

- [ ] **Step 1: Create `src/components/EventBuilderNav.tsx`**

```tsx
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { Check, CircleAlert, Circle, Dot, ExternalLink } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { EVENT_SECTIONS, type EventSectionKey } from "@/lib/eventSections";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type SectionStatus = "complete" | "warning" | "incomplete";

function StatusGlyph({ status }: { status: SectionStatus | undefined }) {
  if (status === "complete") return <Check className="size-4 text-green-600" aria-label="Complete" />;
  if (status === "warning") return <CircleAlert className="size-4 text-amber-500" aria-label="Has suggestions" />;
  if (status === "incomplete") return <Circle className="size-4 text-muted-foreground" aria-label="Incomplete" />;
  return <Dot className="size-4 text-muted-foreground/50" aria-hidden />;
}

export function EventBuilderNav({
  eventId, activeSection, isPublished, slug, onTogglePublish,
}: {
  eventId: Id<"events">;
  activeSection: EventSectionKey;
  isPublished: boolean;
  slug: string;
  onTogglePublish: () => void;
}) {
  const { data: readiness } = useQuery(convexQuery(api.events.getEventReadiness, { eventId }));
  const sectionStatus = readiness?.sectionStatus ?? {};
  const blockers = (readiness?.rules ?? []).filter((r) => r.severity === "required" && r.status === "fail");
  const suggestions = (readiness?.rules ?? []).filter((r) => r.severity === "recommended" && r.status === "fail");

  const groups: { title: string; items: typeof EVENT_SECTIONS }[] = [
    { title: "Build", items: EVENT_SECTIONS.filter((s) => s.group === "build") },
    { title: "Manage", items: EVENT_SECTIONS.filter((s) => s.group === "manage") },
  ];

  return (
    <nav className="flex w-full shrink-0 flex-col gap-4 sm:w-56">
      {groups.map((group) => (
        <div key={group.title}>
          <div className="px-2 text-xs font-medium uppercase text-muted-foreground">{group.title}</div>
          <div className="mt-1 flex flex-col">
            {group.items.map((s) => (
              <Link
                key={s.key}
                to="/events/$id"
                params={{ id: eventId }}
                search={{ section: s.key }}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                  s.key === activeSection && "bg-accent font-medium",
                )}
              >
                {group.title === "Build" ? <StatusGlyph status={sectionStatus[s.key]} /> : null}
                <span>{s.label}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}

      <div className="mt-2 rounded-lg border p-3">
        {readiness === undefined ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <div className="text-sm font-medium">
              Ready {readiness.requiredPassing}/{readiness.requiredTotal}
            </div>
            {blockers.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                {blockers.map((b) => (
                  <li key={b.id}>&bull; {b.label}</li>
                ))}
              </ul>
            )}
            {blockers.length === 0 && suggestions.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                {suggestions.map((s) => (
                  <li key={s.id}>Suggested: {s.label}</li>
                ))}
              </ul>
            )}
            <Button
              className="mt-3 w-full"
              variant={isPublished ? "outline" : "default"}
              disabled={!isPublished && !readiness.canPublish}
              onClick={onTogglePublish}
            >
              {isPublished ? "Unpublish" : "Publish"}
            </Button>
            {isPublished && (
              <Button asChild variant="link" size="sm" className="mt-1 w-full">
                <a href={`/e/${slug}`} target="_blank" rel="noreferrer">
                  View page <ExternalLink className="size-3" />
                </a>
              </Button>
            )}
          </>
        )}
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Wire it into `$id.index.tsx`** — in `src/routes/events/$id.index.tsx`:
  1. Add the import: `import { EventBuilderNav } from "@/components/EventBuilderNav";`
  2. Delete the `SectionLinks` function (Task 3's plain nav) and its usage.
  3. Replace `<SectionLinks eventId={eventId} active={section} />` with:

```tsx
<EventBuilderNav
  eventId={eventId}
  activeSection={section}
  isPublished={isPublished}
  slug={event.slug}
  onTogglePublish={handleTogglePublish}
/>
```

  4. Remove the **Publish/Unpublish** `Button` from the header actions row (it now lives in the nav
     footer). Keep Door, Scan, Duplicate, and Delete in the header. Keep `handleTogglePublish`.

- [ ] **Step 3: Typecheck + build**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: green.

- [ ] **Step 4: Manually verify the readiness UX**

Run the app. Create a new event → it lands on the Tickets section. The rail shows `Ready 1/2` with
"Add a ticket type buyers can access" as a blocker and Publish disabled. Add a visible ticket type →
the Tickets badge turns to a check, the rail shows `Ready 2/2`, Publish enables. Publish → the button
becomes Unpublish and a "View page" link appears. Add a seated ticket type with capacity above its
seat count → a Seating blocker appears and Publish disables again.

- [ ] **Step 5: Commit**

```bash
git add src/components/EventBuilderNav.tsx src/routes/events/$id.index.tsx
git commit -m "feat(builder): readiness badges, checklist, and gated Publish in the nav rail"
```

---

## Task 5: Create-entry tweak — land new events on the Tickets section

**Files:**
- Modify: `src/components/EventForm.tsx`
- Modify: `src/routes/events/new.tsx` (copy only)

**Interfaces:** none new.

- [ ] **Step 1: Navigate to the Tickets section on create** — in `src/components/EventForm.tsx`,
  change the create-branch navigation (inside `onSubmit`, the `else` branch after `createEvent`):

```tsx
navigate({ to: "/events/$id", params: { id: eventId }, search: { section: "tickets" } });
```

(Leave the edit branch — the one guarded by `if (event)` — unchanged; it calls `onDone?.()` and does
not navigate.)

- [ ] **Step 2: Reword the create-page copy** — in `src/routes/events/new.tsx`, change the
  `CardDescription` text to:

```tsx
<CardDescription>
  Add the basics to start a draft &mdash; tickets and design come next.
</CardDescription>
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/components/EventForm.tsx src/routes/events/new.tsx
git commit -m "feat(builder): new events land on the Tickets section"
```

---

## Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite** — `pnpm test` → all Convex tests green (existing 327+ plus the new
  `readiness.test.ts` and the appended `events.test.ts` cases). No pre-existing test was modified.
- [ ] **Step 2: Typecheck + routes + build** — `pnpm generate-routes && pnpm exec tsc --noEmit && pnpm build` → green.
- [ ] **Step 3: End-to-end drive** — `pnpm dev`: create an event → lands on Tickets, `Ready 1/2`,
  Publish disabled → add a visible ticket type → `Ready 2/2`, Publish enabled → publish → Unpublish +
  View page appear → open `/e/<slug>` in a new tab and confirm the public page renders. Then: try to
  publish a fresh event whose only ticket type is hidden (expect the gate to block with a toast);
  add an access code for it (expect Publish to enable). Confirm every Build and Manage section renders
  its existing panel unchanged and the `?section=` deep links / back button behave.
- [ ] **Step 4: Deliver** — push branch `feat/headless-ticketing-f19`, open a PR. Follow-ups (not this
  slice): child-route section URLs; conditional Sessions/Seating (hide until opted in); a "has
  content" dot on optional sections; F3b payments so a paid publish is truly sellable.

---

## Self-Review

**Spec coverage:**
- `computeReadiness` pure helper (single source of truth) → Task 1. ✓
- `getEventReadiness` query + `publishEvent` gate (server-enforced, all callers) → Task 2. ✓
- Refined conditional rules (RSVP-exempt tickets, access-code unlock, seating conditional, date/cover/
  page recommended) → Task 1 helper + Task 1 tests + Task 2 no-regression run. ✓
- Two-pane section editor, grouped Build/Manage nav, `?section=` search-param routing → Task 3. ✓
- Completion badges + readiness checklist + gated Publish + View page → Task 4. ✓
- Details-tab restructure (inline form + capacity → Details; attendee tables + export → Attendees;
  publish → nav footer; duplicate/delete/door/scan → header) → Tasks 3–4. ✓
- Create-entry tweak (copy + land on Tickets) → Task 5. ✓
- No schema changes; panels reused unchanged; no existing test edits → Global Constraints + Task 2
  Step 4 + Task 6 Step 1. ✓
- Frontend verified by tsc + build + manual drive (no component-test harness) → Tasks 3–6. ✓

**Type consistency:** `computeReadiness` input/`EventReadiness`/`sectionStatus`/`rules` shapes are
defined in Task 1 and consumed verbatim in Task 2 (`getEventReadiness`, `publishEvent`) and Task 4
(`sectionStatus[key]`, `rules.filter(...)`, `requiredPassing`/`requiredTotal`/`canPublish`).
`EVENT_SECTIONS`/`EventSectionKey`/`isEventSectionKey` defined in Task 3 and consumed by Task 3's
route + Task 4's nav. `EventBuilderNav` props (`eventId`, `activeSection`, `isPublished`, `slug`,
`onTogglePublish`) defined in Task 4 Step 1 and passed in Task 4 Step 2.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; the only `any` types are
called out explicitly (Task 3 implementer note) with a concrete narrowing instruction.
