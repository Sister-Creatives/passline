# Passline → Headless Ticketing — F16: Event templates (duplicate) + host directory

- **Date:** 2026-07-14
- **Status:** Approved design (autonomous loop)
- **Slice:** F16 — reuse an event's setup via duplication, and a public host profile page
  (Humanitix §2). Builds on F1 events + F5/F11/F12 config tables.

## 1. Goal

Let organizers **duplicate** an event (its settings, ticket types, questions, add-ons, and page
branding) into a new draft in one click — the practical form of "save as template" — and give each
organizer a **public host directory** page listing their events.

## 2. Scope

**In:** `events.duplicateEvent` (deep-copies the reusable config into a new draft); a **Duplicate**
action in the dashboard; a public host directory route `/host/$organizerId` with
`organizers.getPublicProfile` + `events.listPublishedByOrganizer`.

**Out:** a separate reusable "templates" library (duplication covers the need); copying
orders/tickets/rsvps (never — a duplicate starts empty); copying promo/access codes (they reference
per-event ticket-type ids that change on copy — deferred); a custom vanity handle for the directory
URL (uses the opaque organizer id this slice).

## 3. Functions

`convex/events.ts` — `duplicateEvent({ eventId })` — organizer-auth'd + ownership:
- Insert a new `events` row: `title = source.title + " (Copy)"`, same `description`/`location`/
  `startsAt`/`endsAt`/`capacity`/`currency`/`feeMode`, `status: "draft"`, a fresh `slug`
  (`slugify(title, crypto.randomUUID())`), `organizerId` = caller.
- Deep-copy into the new event (fresh ids, `sold` reset to 0 where applicable, preserving
  `sortOrder`):
  - all `ticketTypes` (name/kind/priceCents/capacity/badge/min-max/visibility/gateAlert; `sold:0`,
    `status:"active"`),
  - all `checkoutQuestions` (label/kind/options/required/sortOrder/active),
  - all `addOns` (name/priceCents/capacity/sortOrder/active; `sold:0`),
  - the `eventContent` doc if present (all branding/accessibility fields), and the `virtualHubs`
    config if present.
- Do NOT copy orders/orderItems/orderAddOns/tickets/rsvps/promoCodes/accessCodes/emailCampaigns.
- Return the new `eventId`.

`convex/organizers.ts` — `getPublicProfile({ organizerId })` — **public**: `{ name, image }` of the
organizer (or null).

`convex/events.ts` — `listPublishedByOrganizer({ organizerId })` — **public**: that organizer's
`published` events (id, title, slug, startsAt, endsAt, location), sorted by `startsAt`. (Read via
`by_organizer` then filter to `published` — bounded per organizer.)

## 4. UI

- **Duplicate action**: on the event page (`$id.index.tsx` Details tab) and/or the events list — a
  "Duplicate" `Button`/menu item → `duplicateEvent` → navigate to the new event
  (`/events/$newId`), toast "Event duplicated".
- **Public host directory** `src/routes/host/$organizerId.tsx` (**public**, no auth): loads
  `getPublicProfile` + `listPublishedByOrganizer`; renders the host name/avatar and the events split
  into **Upcoming** (`endsAt >= now`) and **Past**, each a card linking to `/e/$slug`.
  `Skeleton`/`Empty`/"host not found" states.

## 5. Testing (TDD)

- `events.test.ts`: `duplicateEvent` creates a new **draft** event owned by the caller with
  `" (Copy)"` title and a distinct slug; deep-copies ticket types (with `sold` reset to 0),
  questions, add-ons, and eventContent; does NOT copy the source's orders/tickets (seed some and
  assert the copy has none); is owner-only. `listPublishedByOrganizer` returns only published events
  of that organizer, sorted; `getPublicProfile` returns name/image or null.
- Frontend verified by `tsc` + `build`.

## 6. Constraints

Carried: shadcn/ui, `Skeleton`, plain `Error`, per-file test helpers, integer cents, additive (no
schema change — read/insert only; existing 323 tests pass). Duplication must be O(source config
size).

## 7. Delivery

TDD → `pnpm test` + `tsc` + `build` green (+ `pnpm generate-routes` for `/host/$organizerId`) →
push (stacked on F15) → PR → next slice (**F17 audit logs**).
