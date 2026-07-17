# Passline → Headless Ticketing — F2b: Webhooks

- **Date:** 2026-07-13
- **Status:** Approved design (autonomous loop)
- **Slice:** F2b (webhooks) — builds on F2's headless API

## 1. Goal

Let an organizer register webhook endpoints and receive **signed** notifications when their
ticket types change, so external systems stay in sync without polling. F2b wires the delivery
infrastructure and the ticket-type lifecycle events; order/checkout events arrive with F3.

## 2. Scope

**In:** `webhooks` + `webhookDeliveries` tables; `webhooks.create/list/remove`; an
`emitTicketTypeEvent` helper called from the existing `ticketTypes` mutations; a scheduled
**delivery action** that POSTs an HMAC-SHA256-signed payload with retry/backoff; a deliveries
log; the Settings → webhooks UI section.

**Out (later):** order/checkout events (F3); a delivery-inspection UI beyond a recent-attempts
list; per-event replay; webhook signing-secret rotation.

## 3. Data model

```ts
webhooks: defineTable({
  organizerId: v.id("organizers"),
  url: v.string(),
  secret: v.string(),               // "whsec_" + 40 hex, shown once at creation
  subscribedEvents: v.array(v.string()), // e.g. ["ticket_type.created","ticket_type.updated","ticket_type.deleted"]
  active: v.boolean(),
  createdAt: v.number(),
}).index("by_organizer", ["organizerId"]),

webhookDeliveries: defineTable({
  webhookId: v.id("webhooks"),
  organizerId: v.id("organizers"),
  eventType: v.string(),
  payload: v.string(),              // serialized JSON body that was signed
  status: v.union(v.literal("pending"), v.literal("delivered"), v.literal("failed")),
  attempts: v.number(),
  lastAttemptAt: v.optional(v.number()),
  responseStatus: v.optional(v.number()),
}).index("by_webhook", ["webhookId"]).index("by_organizer", ["organizerId"]),
```

## 4. Convex functions

`convex/webhooks.ts`:
- `create({ url, subscribedEvents })` — mutation, organizer-auth'd. Validates `url` starts with
  `https://` and `subscribedEvents` is a non-empty subset of the known event types. Generates
  `secret = "whsec_" + 40 hex`, stores it, returns `{ id, secret }` (secret shown once).
- `list({})` — query, organizer-auth'd, metadata only (no `secret`).
- `remove({ webhookId })` — mutation, organizer-auth'd + ownership.
- `emitTicketTypeEvent(ctx, organizerId, eventType, payload)` — a **plain exported helper** (not
  a Convex function) called from `ticketTypes` mutations: finds the organizer's `active`
  webhooks subscribed to `eventType`, inserts a `pending` `webhookDeliveries` row per webhook,
  and `ctx.scheduler.runAfter(0, internal.webhookDelivery.deliver, { deliveryId })`.
- Helpers: `hmacSha256Hex(secret, body)` (Web Crypto `crypto.subtle.importKey` + `sign`),
  and the known-event-type list.

`convex/webhookDelivery.ts` (Convex **action**):
- `deliver({ deliveryId })` — internalAction. Loads the delivery + its webhook (via internal
  queries/mutations — actions can't touch the db directly). `fetch(url, { method:"POST", headers:
  { "Content-Type":"application/json", "X-Passline-Event": eventType, "X-Passline-Signature":
  hmacSha256Hex(secret, payload) }, body: payload })`. On a 2xx → mark `delivered`
  (`responseStatus`). On non-2xx/throw → increment `attempts`; if `attempts < 5`,
  `scheduler.runAfter(backoffMs(attempts), ...)` (exponential: 1s,5s,30s,2m,10m); else mark
  `failed`. Internal mutations `markDelivered`/`markFailedAttempt` do the db writes.

## 5. Emitting events

Modify `convex/ticketTypes.ts` (additive): after the write in `create`, `update`, `remove`,
call `await emitTicketTypeEvent(ctx, event.organizerId, "ticket_type.created|updated|deleted",
JSON.stringify({ ...serialized ticket type... }))`. Failures to emit MUST NOT fail the mutation
(wrap the enqueue defensively — but since it only inserts + schedules, it won't throw in
practice). `event.organizerId` is available from the ownership check.

## 6. Dashboard UI — `src/routes/settings/api-webhooks.tsx`

Add a **Webhooks** section below the API-keys section:
- **Create:** a `Dialog` with a `url` `Input` and checkboxes (shadcn `Checkbox`) for the event
  types; on submit shows the `whsec_…` secret once (copy button + warning).
- **List:** `Table` — url, subscribed events (`Badge`s), status; `Skeleton`/`Empty`.
- **Remove:** `AlertDialog` → `webhooks.remove`.

## 7. Testing

TDD, `convex/webhooks.test.ts`:
- `create` validates https + event subset, stores `secret`, returns it once; `list` is
  metadata-only + org-scoped; `remove` owner-only.
- `emitTicketTypeEvent` inserts a `pending` delivery **only** for active webhooks subscribed to
  that event type (and none for unsubscribed / other-org / inactive webhooks); assert via the
  `by_organizer` deliveries index after creating a ticket type through the real mutation.
- `hmacSha256Hex` is stable and matches a known vector.
- The live `fetch` in `deliver` is not asserted (no mock server); test that a delivery row is
  created + scheduled. Note this gap.

Frontend verified by `tsc` + `build`.

## 8. Constraints

Carried from F1/F2: shadcn/ui; `Skeleton` loaders (no "Loading…" text); plain `Error`; per-file
`asOrganizer`/`modules` test helpers; integer cents; **additive** (ticketTypes mutations gain an
emit call but existing behavior/tests must still pass).

## 9. Delivery

TDD → `pnpm test` + `tsc` + `build` green → push (stacked on F2) → PR → loop to **F2c (typed SDK)**.
