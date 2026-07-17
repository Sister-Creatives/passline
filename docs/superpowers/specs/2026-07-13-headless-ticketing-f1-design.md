# Passline → Headless Ticketing — F1: Dashboard Shell + Ticket Types

- **Date:** 2026-07-13
- **Status:** Approved design
- **Slice:** F1 of a multi-slice program (see Program Context)

---

## 1. Program context (the pivot)

Passline today is a **free-events RSVP app**: organizers create events with a single
capacity, attendees RSVP with name + email, a waitlist autopilot fills freed seats, and
staff check attendees in at the door. Stack: **Convex** (DB, queries/mutations/actions,
crons, Convex Auth password provider) + **TanStack Start** (React 19, file-based routing,
SSR) + **shadcn/ui** (style `radix-nova`, Tailwind v4).

We are pivoting Passline into a **headless paid-ticketing platform**:

- **Headless engine.** Convex becomes an API-first ticketing backend. Its functions are the
  API surface; developers build their own checkout UIs against it (HTTP API + SDK + webhooks
  come in slice F2).
- **Management dashboard.** A first-party dashboard to configure and manage everything,
  targeting a Humanitix-scale feature set.

This is a large program (~9 subsystems, 40+ features). It is delivered as a sequence of
**small, independently deployable slices**: build → verify → deploy → loop.

### Phased backlog

| #   | Slice                                                                             | Humanitix § |
| --- | --------------------------------------------------------------------------------- | ----------- |
| F1  | **Dashboard shell + Ticket Types** (this spec)                                    | §2, §3      |
| F2  | Headless API + typed SDK + webhooks + API keys                                    | §9          |
| F3  | Checkout + orders + Stripe payments, fee pass/absorb                              | §1, §4      |
| F4  | Promo & access codes                                                              | §5          |
| F5  | Custom checkout questions                                                          | §4          |
| F6  | Attendee self-service, refunds, transfers                                         | §7          |
| F7  | Event-day scanning (offline, box office, gate alerts) — partly exists            | §8          |
| F8  | Analytics dashboard (sales velocity, conversion, revenue)                          | §9          |
| F9  | Marketing: bulk email, waitlist automation (exists), tracking pixels, embeds      | §5          |
| F10+| Reserved-seating maps, merch/add-ons, wallets/BNPL, virtual hub, accessibility hub, templates, Canva | §2–7 |

### Cross-cutting conventions (every slice)

- **shadcn/ui for all UI** (style `radix-nova`). Follow shadcn critical rules: forms use
  `FieldGroup`/`Field`; option sets use `ToggleGroup`; status uses `Badge`; semantic color
  tokens only (`bg-primary`, `text-muted-foreground`), never raw colors.
- **Loading states use shadcn `Skeleton`** — never spinners or `"Loading…"` text.
- **Money is integer minor units** (cents). Currency is per-event (ISO 4217). No floats.
- **Convex functions are the headless API seam** — clean, stable arg/return shapes so F2 can
  wrap them as public HTTP endpoints without reshaping.
- **Collapsible grouped sidebar** (Shopify-style) for navigation.

---

## 2. F1 scope and decisions

**In scope:** dashboard shell + navigation; `ticketTypes` data model + Convex functions;
ticket-types management UI; skeleton loaders.

**Approved decisions:**

- **Full pivot data model** — every event has ticket types; a free event is one `$0` ticket
  type. F1 is **additive** (new `ticketTypes` table + one optional `currency` field on
  `events`); the existing RSVP / waitlist / check-in path is untouched now and migrated onto
  tickets in later slices.
- **Approach A — thin vertical slice.** Build only F1; establish reusable patterns; YAGNI on
  `orders`/`tickets` tables until checkout (F3).
- **Shared-capacity pools deferred** to a later small follow-up (not in F1).
- **Ticket types live as a tab on the event page**, not a separate top-level route.
- **Retire the `@efferd` analytics demo from `/dashboard`;** `/dashboard` becomes the real
  Overview. The analytics chart components stay in the repo for F8.

**Out of F1 (later slices):** payments/Stripe, orders/checkout, shared-capacity pools, sales
windows, access codes, merch/add-ons, RSVP→ticket migration, HTTP API/webhooks/keys.

---

## 3. Architecture

- **Convex is the ticketing engine.** F1 adds one table and one module (`convex/ticketTypes.ts`).
  Every function is organizer-authenticated and event-ownership-checked, reusing the existing
  organizer/event helpers. Function signatures are designed to be the eventual public API
  contract (F2 wraps them; it does not reshape them).
- **Frontend** gets a shared **dashboard layout** (AuthGuard + AppShell sidebar) that wraps the
  authenticated management pages. URLs are unchanged.
- No changes to `rsvps`, `waitlist`, `checkin`, `crons`.

---

## 4. Data model

Add currency to events:

```ts
// events table — add:
currency: v.optional(v.string()), // ISO 4217; code default "USD"
```

New `ticketTypes` table:

```ts
ticketTypes: defineTable({
  eventId: v.id("events"),
  name: v.string(),                                   // "Adult", "Early Bird"
  kind: v.union(v.literal("paid"), v.literal("free"), v.literal("donation")),
  priceCents: v.number(),                             // integer minor units; free ⇒ 0; donation ⇒ suggested/min (≥ 0)
  capacity: v.optional(v.number()),                   // per-type cap; ceiling is event.capacity; undefined = uncapped
  sold: v.number(),                                   // starts 0; maintained by orders in F3
  badge: v.optional(v.string()),                      // "Selling Fast", "Early Bird"
  minPerOrder: v.optional(v.number()),
  maxPerOrder: v.optional(v.number()),
  visibility: v.union(v.literal("visible"), v.literal("hidden")), // hidden = access-code-gated later
  sortOrder: v.number(),
  status: v.union(v.literal("active"), v.literal("archived")),
})
  .index("by_event", ["eventId"])
```

**Invariants (validated in mutations):** `name` non-empty; `priceCents ≥ 0`; `kind === "free"
⇒ priceCents === 0`; if `capacity` set, `0 < capacity ≤ event.capacity`; if both set,
`minPerOrder ≤ maxPerOrder`.

---

## 5. Dashboard shell & navigation

- Build a **real Passline sidebar** from the installed shadcn Sidebar primitives
  (`SidebarMenu`, `SidebarMenuButton`, `SidebarMenuSub`, `Collapsible`), replacing the
  `@efferd` demo nav data and the mock `nav-user`.
- A **shared dashboard layout** (pathless layout route) renders
  `<AuthGuard><AppShell><Outlet/></AppShell></AuthGuard>` around the management pages; **URLs
  stay the same**. (Exact TanStack Router mechanics decided in the plan; per-route `AppShell`
  wrapping is an acceptable fallback if a clean pathless layout is impractical.)
- **Navigation** (with the Shopify-style collapsible group):

  ```
  Overview          /dashboard
  Events            /events
  Settings ▾        (collapsible; SidebarMenuSub)
     Organization profile   (stub page)
     Payments               (stub page)
     Team                   (stub page)
     API & webhooks         (stub page)
  ```

  Stub pages render a shadcn `Empty` "coming soon" state; they exist so the collapsible group
  is real and navigable.
- **`nav-user`** shows the real signed-in organizer (name/email from Convex) with a working
  **Sign out**.
- **Skeleton loaders** replace the existing `"Loading events…"` text and any spinner: events
  list, overview, and ticket-types list each render shadcn `Skeleton` placeholders while their
  Convex query resolves.
- `/dashboard` becomes the **Overview** page (simple real content: counts of events, quick
  links). The `@efferd` analytics demo is removed from the route; its components remain in the
  repo for F8.

---

## 6. Ticket Types management UI

- On the event page (`/events/$id`), add a **`Tabs`** row: **Overview / Ticket types /
  Attendees**. (Overview = existing event detail; Attendees = existing attendee view if present.)
- **Ticket types tab:**
  - **List:** shadcn `Table` — columns: name, kind (`Badge`), price (formatted from
    `priceCents` + event currency), cap, sold, badge, visibility. `Skeleton` rows while
    loading. shadcn `Empty` when there are none ("No ticket types yet — create your first").
  - **Create / Edit:** shadcn `Sheet` containing a `Form` (`FieldGroup`/`Field`/`FieldLabel`).
    Fields: name; `kind` via `ToggleGroup` (Paid / Free / Donation); price input (shown for
    paid/donation, hidden+forced-0 for free); capacity cap (optional); badge (optional);
    min/max per order (optional); visibility toggle. Validation mirrors §4 invariants with
    inline `Field` error states (`data-invalid` / `aria-invalid`).
  - **Delete:** shadcn `AlertDialog` confirmation.
  - **Reorder:** up/down buttons updating `sortOrder` (drag-and-drop deferred).

> **F1 scope note (post-review, 2026-07-13):** the **visibility** control (form toggle + list
> column) is deferred to **F4 (access codes)** — a "hidden" ticket type is only meaningful once
> access codes exist to reveal it, so all F1 types are `"visible"`. The event page uses two tabs
> (**Details / Ticket types**), with attendees folded into Details. `ticketTypes.update` uses
> **full-replace semantics** (the caller sends the complete desired state; omitted optionals are
> cleared) — the F1 form therefore sends every field, including min/max per order.

---

## 7. Convex API surface — `convex/ticketTypes.ts`

All mutations are organizer-authenticated and verify the caller owns the event.

- `listForEvent({ eventId })` → `TicketType[]` sorted by `sortOrder`.
- `create({ eventId, name, kind, priceCents?, capacity?, badge?, minPerOrder?, maxPerOrder?, visibility? })` → `ticketTypeId`. Appends at the end (`sortOrder = max + 1`), `sold = 0`, `status = "active"`.
- `update({ ticketTypeId, ...patch })` → `void`. Re-validates invariants.
- `remove({ ticketTypeId })` → `void`. (Hard delete in F1; once orders exist in F3, deletion of a type with sales is blocked and archive is used instead.)
- `reorder({ eventId, orderedIds })` → `void`. Rewrites `sortOrder` from the given order.

Signatures are the future public contract; F2 exposes read + storefront-safe variants over HTTP.

---

## 8. Testing & verification

- **TDD** (per house practice): write `convex/ticketTypes.test.ts` (`convex-test`) **first** —
  covering create/list/update/remove/reorder, every §4 invariant, and auth/ownership rejection
  — then implement to green.
- Frontend **`tsc --noEmit`** and **production build** stay green (as established this session).
- **Drive-verify:** run the app, open an event, create a Paid, a Free, and a Donation ticket
  type via the Sheet, confirm they list correctly with skeleton→content transition, edit one,
  reorder, delete one.

---

## 9. Delivery & deploy loop

Build (TDD) → `tsc` + build green → drive-verify → **deploy via workflow (Vercel)** → loop to
F2. Deploy target (Vercel project + Convex production deployment + env vars) is confirmed with
the user before the first deploy.

---

## 10. Open questions / follow-ups

- **Deploy target** for the Vercel deploy step (existing project? Convex prod deployment name?
  env vars) — confirm before F1's deploy.
- **Shared-capacity pools** — pull into a follow-up slice (F1b) after F1 ships.
