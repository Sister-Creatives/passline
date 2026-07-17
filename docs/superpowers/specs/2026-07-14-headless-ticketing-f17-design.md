# Passline → Headless Ticketing — F17: Audit logs

- **Date:** 2026-07-14
- **Status:** Approved design (autonomous loop)
- **Slice:** F17 — an event change-history / audit log (Humanitix §9).

## 1. Goal

Record the meaningful backend changes to an event (published, edited, ticket types / promo / access
code / add-on created or removed, order refunded) so an organizer can see an activity trail. There
is no team/staff feature yet, so the actor is the organizer; the schema is designed so a per-member
actor can be added later without migration.

## 2. Scope

**In:** an `auditLogs` table; a `recordAudit` helper called from a curated set of high-value
mutations; `auditLogs.listForEvent` (organizer); an Activity dashboard tab.

**Out:** logging every read; a global (cross-event) audit view; diffs of before/after values (we
store a human summary + action code); tamper-proofing.

## 3. Data model

```ts
auditLogs: defineTable({
  organizerId: v.id("organizers"),     // the actor (single-user today; a member id can be added later)
  eventId: v.optional(v.id("events")),
  action: v.string(),                  // stable code, e.g. "event.published", "ticket_type.created"
  summary: v.string(),                 // human-readable, e.g. 'Created ticket type "Adult"'
  createdAt: v.number(),
}).index("by_event", ["eventId"]),
```

## 4. Helper + query

`convex/audit.ts`:
- `recordAudit(ctx, { organizerId, eventId, action, summary })` — a **plain helper** (not a Convex
  function) that inserts an `auditLogs` row. Called from inside mutations that already have the
  organizerId + event in scope, so it runs in the same transaction (rolls back if the mutation
  fails — no orphan logs). Keep it defensive: it only inserts (won't throw in practice).
- `listForEvent({ eventId })` — query, organizer-auth'd + ownership; the event's audit rows newest
  first.

## 5. Hook points (add a `recordAudit` call to each; additive, after the main effect)

- `convex/events.ts`: `updateEvent` → `"event.updated"` ("Updated event details"); `publishEvent`
  → `"event.published"`; `unpublishEvent` → `"event.unpublished"`; `deleteEvent` →
  `"event.deleted"` (eventId omitted or the id — the row can outlive the event; store the id).
- `convex/ticketTypes.ts`: `create` → `"ticket_type.created"` (`Created ticket type "<name>"`);
  `update` → `"ticket_type.updated"`; `remove` → `"ticket_type.removed"`.
- `convex/orders.ts`: `refundOrder` → `"order.refunded"` (`Refunded order <token-prefix>`).
- `convex/promoCodes.ts`: `create`/`remove` → `"promo_code.created"`/`"promo_code.removed"`.
- `convex/accessCodes.ts`: `create`/`remove` → `"access_code.created"`/`"access_code.removed"`.

Each call uses the `organizerId` + `eventId` already resolved by the mutation's ownership check.
For `deleteEvent`, record BEFORE the delete (so the summary/title is available) but the row
references the (about-to-be-deleted) event id — that's fine, the log is a history.

## 6. UI

An **Activity** tab on the event page: `AuditLogPanel.tsx` → `auditLogs.listForEvent` — a `Table`
(when via `formatted date`, action `Badge`, summary), `Skeleton`/`Empty` ("No activity yet").

## 7. Testing (TDD)

- `audit.test.ts`: `listForEvent` owner-only + newest-first; publishing an event, creating/removing
  a ticket type, and refunding an order each append the expected `auditLogs` row (assert action +
  that the summary is present) — driven through the real mutations. A non-owner cannot read the log.
- Frontend verified by `tsc` + `build`.

## 8. Constraints

Carried: shadcn/ui, `Skeleton`, plain `Error`, per-file test helpers, integer cents, additive (the
`recordAudit` calls must NOT change existing mutation behavior or break the 327 existing tests —
they only insert a log row).

## 9. Delivery

TDD → `pnpm test` + `tsc` + `build` green → push (stacked on F16) → PR → next slice (**F18 scanning
extras: check-out + box office**, then the big **F13 multi-date** and **F10 seating**).
