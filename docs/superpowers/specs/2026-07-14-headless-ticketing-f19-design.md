# Passline → Headless Ticketing — F19: Event builder (guided section editor)

- **Date:** 2026-07-14
- **Status:** Approved design
- **Slice:** F19 — a guided event-builder editor with a readiness model and a server-enforced
  publish gate (Humanitix-style "event editor" with a publish checklist).

## 1. Goal

Turn event setup from "bare create form → flat 15-tab bar" into a **guided section editor**: one
unified editor with a left rail of sections grouped **Build / Manage**, each build section showing a
completion state, and a persistent **Publish** button gated on a **readiness** model. The publish
gate is enforced server-side so an organizer can no longer publish a paid event with no tickets.

This slice is orchestration + a readiness engine. Every existing section panel (`TicketTypesPanel`,
`SeatingPanel`, `EventPagePanel`, …) is reused **unchanged**; no new panels, no schema changes.

## 2. Scope

**In:** a pure `computeReadiness` helper (single source of truth); `events.getEventReadiness`
(organizer query) driving the rail; **publish-gate enforcement in `events.publishEvent`** (rejects
when a required rule fails); the two-pane builder layout with a grouped `EventBuilderNav`;
URL-search-param section routing (`?section=`); per-section completion badges + a readiness
checklist + a gated Publish button; the Details-tab restructure; the create-entry tweak.

**Out (explicit):** no schema changes; no new section panels; no linear stepper (deliberately chose
the section editor); no changes to the public `/e/$slug` page or checkout; child routes per section
(search param is the v1); payments (separate F3b track); a "has content" indicator on optional
sections beyond the light muted dot noted in §6.

## 3. Data model

**No schema changes.** `createEvent` keeps its current required args (title, description, location,
capacity, start/end), so the Details **content** requirements pass the moment a draft exists — no
need to relax `events` fields to optional (the `date` rule is a **recommended** warning that wants a
future `endsAt`, so a past-dated draft shows a Details *warning* badge but can still publish).
Readiness is computed live from existing tables (`events`, `ticketTypes`, `seats`, `accessCodes`,
`eventContent`); nothing is stored.

## 4. Readiness engine (the core)

`convex/lib/readiness.ts` — a **pure function** over already-loaded docs, so it is the single source
of truth for both the UI checklist and the publish gate (they can never drift), and is trivially
unit-testable.

```ts
export type SectionKey =
  | "details" | "tickets" | "sessions" | "seating" | "addons" | "promo"
  | "access" | "questions" | "page" | "hub" | "accessibility"   // BUILD
  | "orders" | "attendees" | "analytics" | "marketing" | "activity"; // MANAGE

export type RuleId = "details" | "tickets" | "date" | "seating" | "cover" | "page";

export type ReadinessRule = {
  id: RuleId;
  section: SectionKey;             // which section this rule belongs to
  label: string;                  // "Add at least one ticket type"
  severity: "required" | "recommended";
  status: "pass" | "fail";
};

export type EventReadiness = {
  rules: ReadinessRule[];
  // Only rule-bearing build sections appear here: details, tickets, seating, page.
  sectionStatus: Partial<Record<SectionKey, "complete" | "warning" | "incomplete">>;
  requiredTotal: number;
  requiredPassing: number;
  blockersRemaining: number;      // requiredTotal - requiredPassing
  canPublish: boolean;            // blockersRemaining === 0
};

export function computeReadiness(input: {
  event: Doc<"events">;
  ticketTypes: Doc<"ticketTypes">[];
  seats: Doc<"seats">[];
  accessCodes: Doc<"accessCodes">[];
  eventContent: Doc<"eventContent"> | null;
  now: number;                    // injected for determinism (never Date.now() inside)
}): EventReadiness;
```

**Rule set** (both `required` calls confirmed by the user):

| id | section | severity | passes when |
|----|---------|----------|-------------|
| `details` | details | required | `title`, `description`, `location` non-empty **and** `endsAt > startsAt` (true post-create; re-checked defensively for edits) |
| `tickets` | tickets | required (conditional) | **"a way in" exists:** `ticketTypes.length === 0` (free-RSVP event) **or** ≥1 ticket type with `status === "active"` **and** `visibility === "visible"` **or** ≥1 access code with `active === true` (unlocks hidden types for an invite-only event). Fails only when ticket types exist, none is active+visible, and no active access code exists. |
| `seating` | seating | required (conditional) | fires **only if `seats.length > 0`**: every seated ticket type (has ≥1 seat) has `seatCount ≥ (capacity ?? seatCount)` — i.e. enough seats mapped for its cap. Never fires for non-seated events. |
| `date` | details | recommended | `endsAt > now` (a past-dated event is almost always a mistake, but importing/record-keeping is legitimate — warn, do not block) |
| `cover` | page | recommended | `eventContent?.coverImageUrl` is set |
| `page` | page | recommended | any page richness present (`agenda`/`speakers`/`faqs` non-empty) |

**`sectionStatus` derivation**, per rule-bearing section: `incomplete` if any of its `required`
rules fail; else `warning` if any `recommended` rule fails; else `complete`. Sections with no rules
(sessions, add-ons, promo, access, questions, hub, accessibility, and all Manage sections) are
**optional** — absent from `sectionStatus` and shown without a readiness glyph.

**Confirmed product decisions** (baked in, refined during planning to fit this platform's
RSVP-by-default / ticketed-by-opt-in model and to avoid a fragile 18-file test retrofit): the
`tickets` blocker is **conditional** — a bare event with no ticket types publishes as free RSVP, an
invite-only event whose only tickets are hidden publishes as long as an active access code unlocks
them, and the blocker bites only a genuinely unreachable ticketed setup (has tickets, none
visible/active, no active code). `date` is a **recommended warning**, not a blocker. This design
leaves all existing publish-path tests green (they publish either zero-ticket RSVP events or
active+visible ticketed events); the only new backend behavior is `publishEvent` rejecting an
unreachable ticketed setup or a seating-incoherent one.

## 5. Backend functions

`convex/events.ts`:

- **`getEventReadiness({ eventId })`** — new organizer query, owner-checked via the existing
  `requireOwnedEvent`. Loads the event + its `ticketTypes` (`by_event`), `seats` (`by_event`),
  `accessCodes` (`by_event`), and `eventContent` (`by_event`), calls
  `computeReadiness({ …, now: Date.now() })`, returns the report. Read-only, reactive: the rail
  updates live as sections are filled in.
- **`publishEvent` enforcement** — before flipping status to `"published"`, load the same docs, call
  `computeReadiness`, and if `!canPublish` **throw** `Error` naming the first failing required rule
  (e.g. `"Cannot publish: add a ticket type buyers can access"`). Covers every caller (UI, HTTP
  API, duplicate-then-publish), not just the button. The existing `recordAudit("event.published")`
  stays, after the successful patch. `unpublishEvent` is unchanged (unpublishing is always allowed).

## 6. UI — the section editor

Convert `src/routes/events/$id.index.tsx` from the horizontal `Tabs` into a **two-pane** layout
inside the existing `DashboardLayout`.

- **`src/components/EventBuilderNav.tsx`** — the left rail:
  - **BUILD** group: Details · Ticket types · Sessions · Seating · Add-ons · Promo codes · Access
    codes · Questions · Page & design · Virtual hub · Accessibility. Rule-bearing sections
    (Details, Ticket types, Seating, Page & design) render a glyph from `sectionStatus`:
    ✓ `complete` / ⚠ `warning` / ○ `incomplete`. Optional sections render a muted "has content"
    dot (filled if the section has rows, hollow if empty) — purely informational, never a blocker.
  - **MANAGE** group: Orders · Attendees · Analytics · Marketing · Activity, plus outline links to
    Door check-in and Scan (the existing `/events/$id/door` and `/events/$id/scan` routes).
  - **Rail footer**: `Ready {requiredPassing}/{requiredTotal}`, the list of remaining blockers
    (required, failing) and suggestions (recommended, failing) — each links to its section — and the
    persistent **Publish** button. When `!canPublish`, the button is disabled with a tooltip naming
    the blockers; when published, it becomes **Unpublish** + a "View page" link to `/e/$slug`.
- **Right pane**: the selected section's existing panel, rendered exactly as today. Panel internals
  are untouched.
- **Section selection** via a validated TanStack Router **search param** `?section=<SectionKey>`
  (default `"details"`), so sections are deep-linkable and the browser back button moves between
  them, with no route-tree churn (one route file stays).

**Details-section restructure** (the current Details tab is overloaded; split cleanly):
- *Details* build section: the event **edit form inline** (reuse `EventForm` in edit mode) + the
  capacity meter.
- *Attendees* (Manage): the four `AttendeeTable`s (confirmed / pending claim / waitlist / checked
  in) + Export CSV.
- *Orders* (Manage): `OrdersPanel` (unchanged).
- Publish/unpublish → the gated **rail** button (removed from the tab body).
- Duplicate / Delete → a header **"⋯" actions menu**; Door / Scan → Manage links.

**Create entry** (`src/routes/events/new.tsx` + `EventForm`): keep the create args; reword the card
copy to "Add the basics — tickets and design come next"; on success navigate to
`/events/$id?section=tickets` so the next build step is obvious.

## 7. Testing (TDD)

- **`convex/readiness.test.ts`** (pure helper, the bulk of the coverage): a fresh draft with **no
  ticket types** passes `tickets` (free-RSVP, `canPublish` true); adding a single **hidden** type
  with **no** access code fails `tickets` (unreachable), adding an **active access code** for it
  passes again, and an **active + visible** type passes directly; an **archived-only** set fails; the
  `seating` rule stays `pass` when no seats exist, fails when a seated type has fewer seats than its
  capacity, passes when covered; `date` failing (past `endsAt`) marks Details `warning` but keeps
  `canPublish` true; `cover`/`page` toggle `warning` vs `complete` on the `page` section without
  affecting `canPublish`; `sectionStatus`, `blockersRemaining`, and `canPublish` compute correctly.
- **`convex/events.test.ts`** (append): `getEventReadiness` is owner-only and mirrors the helper on
  real docs; `publishEvent` **throws** for a draft whose only ticket type is hidden with no access
  code, and **succeeds** once the type is made visible (or an active code is added); a zero-ticket
  RSVP draft still publishes; a non-owner is rejected. **No existing test is modified** — the gate is
  designed so every current publish-path test (zero-ticket RSVP events, or active+visible ticketed
  events, or hidden+active-code invite events) stays green. A full `pnpm test` run confirms zero
  regressions across the 327+ existing tests.
- **Frontend** verified by `pnpm exec tsc --noEmit` + `pnpm build` + a manual drive (create → land
  on Tickets → watch the rail go Ready 1/2 → 2/2 → Publish enables → publish → View page).

## 8. Constraints

Carried from the plan: shadcn/ui for all UI (`Sidebar`/`Collapsible` primitives already installed
for the nav; `Skeleton` for loading, no spinners/"Loading…"); plain `Error`; integer cents;
per-file convex-test helpers; English, no emojis. **Additive to the backend**: the only behavior
change is `publishEvent` now rejecting an unreachable ticketed setup or a seating-incoherent one; the
refined conditional rules leave every existing publish-path test green (no test edits). Reused panels
must not be modified. Determinism: `computeReadiness` takes `now` as an argument (never `Date.now()`
in its body).

## 9. Delivery

TDD the readiness helper + backend gate first, then the layout/nav, then badges + checklist + gated
publish, then the Details restructure + create tweak. `pnpm test` + `tsc` + `build` green → push
(stacked on F10 seating) → PR. Follow-ups (not this slice): child-route section URLs; conditional
sections (hide Seating/Sessions until opted in); F3b payments so a paid publish is truly sellable.
