# Passline → Headless Ticketing — F7: Event-day scanning (ticket check-in)

- **Date:** 2026-07-13
- **Status:** Approved design (autonomous loop)
- **Slice:** F7 — check-in for the F3a `tickets`. Stripe-independent.

## 1. Goal

Let door staff scan/enter a ticket `code` to check attendees in, with clear per-scan results
(valid / already-in / cancelled / not-found), a per-ticket-type **gate alert** message, and a
live checked-in count. Parallels — does not disturb — the existing RSVP door flow.

## 2. Scope

**In:** optional `ticketTypes.gateAlert` + `tickets.checkedInAt`; `checkInTicket`,
`undoCheckIn`, `getTicketByCode`, `getScanState` (all organizer-owner-scoped); an organizer door
route `/events/$id/scan` with a code entry, a result card, a gate alert, and a live count.

**Out:** offline-mode caching, multi-device real-time sync, and check-OUT (Humanitix §8) → a
later slice; hardware barcode integration; a public/tokenized scanner for non-organizer staff.

## 3. Data model (additive)

- `ticketTypes`: add `gateAlert: v.optional(v.string())` (e.g. "Check 18+ ID").
- `tickets`: add `checkedInAt: v.optional(v.number())`.

## 4. Functions — `convex/ticketCheckin.ts`

All organizer-authenticated (`getAuthOrganizerId`) + event-ownership-checked (a ticket is
reachable only if the caller owns its event). Reuse a `requireOwnedTicket(ctx, ...)` helper
mirroring `requireOwnedTicketType`.

- `checkInTicket({ code })` → a structured result (never throws for a "business" outcome, so the
  gate UI can render each case):
  - not found / foreign-org ticket → `{ result: "not_found" }`
  - `status === "cancelled"` → `{ result: "cancelled", ticket }`
  - `status === "checked_in"` → `{ result: "already", ticket, checkedInAt, gateAlert }`
  - `status === "valid"` → patch to `"checked_in"` + `checkedInAt = Date.now()`; return
    `{ result: "ok", ticket, ticketTypeName, gateAlert }`
  (Still requires a valid authenticated organizer — an unauthenticated call throws.)
- `undoCheckIn({ ticketId })` — owner-only; if `checked_in`, revert to `valid` and clear
  `checkedInAt` (correct a mis-scan).
- `getTicketByCode({ code })` — owner-only lookup (pre-scan peek): the ticket + its type name +
  gate alert, or null.
- `getScanState({ eventId })` — owner-only: `{ total, checkedIn }` over the event's non-cancelled
  tickets (drives the live count; a reactive query so scans update it live).

## 5. Door UI — `src/routes/events/$id/scan.tsx`

Organizer-gated (`AuthGuard`; this is a focused door screen, NOT wrapped in the full dashboard
sidebar — like the existing `$id.door` route). Contents:
- A live **count** header: `{checkedIn} / {total} checked in` (from `getScanState`, reactive).
- A **code entry** `InputGroup`/`Input` + "Check in" button (manual entry now; a camera/QR
  scanner is a later enhancement). On submit, call `checkInTicket` and show a **result card**
  keyed by `result`:
  - `ok` → green card "Checked in", attendee/ticket-type, and the **gate alert** prominently if set.
  - `already` → amber "Already checked in at {time}" + gate alert.
  - `cancelled` → red "Ticket cancelled".
  - `not_found` → red "Ticket not found".
  Use shadcn `Alert`/`Card` + semantic tokens (not raw colors where a variant exists); `Skeleton`
  for the count while loading.
- A link back to the event page.
- Optional: add a **gate alert** field to the ticket-type editor (`TicketTypesPanel`) so alerts
  can be set from the dashboard.

## 6. Testing (TDD) — `convex/ticketCheckin.test.ts`

- `checkInTicket`: a valid ticket → `ok` + status becomes `checked_in` + `checkedInAt` set;
  scanning it again → `already` (no second transition); a `cancelled` ticket → `cancelled`; an
  unknown code → `not_found`; a ticket whose event another organizer owns → `not_found` (no
  cross-org leak); an unauthenticated call throws.
- `undoCheckIn`: reverts a checked-in ticket to `valid`; owner-only.
- `getScanState`: counts total non-cancelled vs checked-in correctly; owner-only.
- Seed tickets by creating a **free order** via `api.orders.createOrder` (which issues real
  tickets), then read a ticket's `code` to scan.

## 7. Constraints

Carried: shadcn/ui, `Skeleton`, plain `Error` for auth failures (business outcomes are returned,
not thrown), per-file test helpers, additive (existing tests pass; RSVP check-in untouched).

## 8. Delivery

TDD → `pnpm test` + `tsc` + `build` green → push (stacked on F4) → PR → next loop slice
(**F5 custom checkout questions**, or **F8 analytics** — both Stripe-independent).
