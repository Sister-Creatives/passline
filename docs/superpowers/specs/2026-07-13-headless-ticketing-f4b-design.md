# Passline → Headless Ticketing — F4b: Access codes + hidden-ticket visibility

- **Date:** 2026-07-13
- **Status:** Approved design (autonomous loop)
- **Slice:** F4b — hidden ticket types + access codes that unlock them. Completes the F1-deferred
  visibility UI. Builds on F3a orders + F1 ticket types.

## 1. Goal

Let organizers mark ticket types **hidden** (not shown/sellable in a normal storefront) and issue
**access codes** that reveal specific hidden types at checkout — for VIP/staff/pre-sale tickets.

## 2. Scope

**In:** the F1-deferred **visibility toggle + list column** in the ticket-type UI; public reads
filter to `visible` (dashboard still shows all); `accessCodes` table + `create/list/remove`
(organizer); a **public** `resolveAccessCode` returning which hidden ticket types it unlocks;
`createOrder` + `POST /v1/orders` enforce that any `hidden` ticket type in the cart is unlocked
by a provided `accessCode`; an Access-codes dashboard tab.

**Out:** per-code redemption caps/windows (mirror F4 promo caps if wanted later); codes that
apply a discount (that's F4 promo codes); one code unlocking across events.

## 3. Data model

`ticketTypes.visibility` already exists (`"visible" | "hidden"`, from F1). Add:

```ts
accessCodes: defineTable({
  eventId: v.id("events"),
  organizerId: v.id("organizers"),
  code: v.string(),                                  // UPPERCASE, unique per event
  ticketTypeIds: v.array(v.id("ticketTypes")),       // the hidden types this code unlocks
  active: v.boolean(),
  createdAt: v.number(),
})
  .index("by_event", ["eventId"])
  .index("by_event_and_code", ["eventId", "code"]),
```

## 4. Public-read visibility filter

- `checkoutQuestions`/`ticketTypes` public reads: `ticketTypes.listForEvent`-style public read
  (add one if not present) and the HTTP `GET /v1/events/{id}/ticket-types` must return only
  `status === "active"` **and** `visibility === "visible"` types (the F2 endpoint already filters
  active; **add the `visible` filter here** — this was the F1/F2 deferral). Hidden types are
  returned only via `resolveAccessCode`.

## 5. Access-code functions — `convex/accessCodes.ts`

- `create({ eventId, code, ticketTypeIds })` — organizer-auth'd + ownership. Uppercase/trim code,
  unique per event; assert every `ticketTypeId` belongs to the event and is `hidden`; `active = true`.
- `list({ eventId })`, `remove({ accessCodeId })` — organizer-auth'd + ownership.
- `resolveAccessCode({ eventId, code })` — **public**: for an `active` code on a `published`
  event, return the unlocked **hidden** ticket types (id, name, priceCents, kind, currency, …) so
  a checkout can render them; else `{ ticketTypes: [] }`.
- Exported helper `unlockedTicketTypeIds(ctx, eventId, code)` → `Set<Id>` (or []): the hidden type
  ids a (valid, active) code unlocks; empty for a missing/inactive code.

## 6. Checkout enforcement (`convex/orders.ts`)

`createOrder` gains optional `accessCode?: string`:
- Compute `unlocked = accessCode ? unlockedTicketTypeIds(ctx, eventId, accessCode) : empty`.
- During per-item validation, if a ticket type has `visibility === "hidden"`, reject unless its id
  is in `unlocked` (error "This ticket requires a valid access code"). `visible` types are always
  allowed. (This is the real gate — a hidden type can never be bought without its code, even via
  the raw API.)
- `POST /v1/orders` accepts optional `accessCode` and passes it through.

## 7. Dashboard UI

- **Ticket-type editor** (`TicketTypesPanel`): add the deferred **Visibility** control — a
  `ToggleGroup`/`Switch` (Visible / Hidden) wired to `create`/`update` (the mutations already
  accept `visibility`), and a **Visibility** column/badge in the list.
- **Access codes** tab on the event page: a `Table` (code, unlocked ticket types as `Badge`s,
  status), a create `Dialog` (code + a multi-select of the event's **hidden** ticket types via
  `Checkbox`es), and `AlertDialog` remove. `Skeleton`/`Empty`.

## 8. Testing (TDD)

- `accessCodes.test.ts`: create validates unique code + that all ids are hidden types of the
  event; list/remove owner-only; `resolveAccessCode` returns the hidden types for an active code
  on a published event and `[]` for missing/inactive/unpublished; `unlockedTicketTypeIds` correct.
- `orders.test.ts`: `createOrder` for a hidden type WITHOUT a code (or with a wrong code) is
  rejected; WITH the right `accessCode` it succeeds; a `visible` type is unaffected.
- `apiHttp.test.ts`: `GET /v1/events/{id}/ticket-types` excludes hidden types; `POST /v1/orders`
  with a hidden type + valid `accessCode` → 201, without → 400.
- `ticketTypes.test.ts` / public-read test: the public list excludes hidden types.

## 9. Constraints

Carried: shadcn/ui, `Skeleton`, plain `Error`, per-file test helpers, integer cents, additive
(existing 200 tests pass; `createOrder`/`POST /v1/orders` gain a defaulted optional `accessCode`;
the public ticket-types filter change must not break existing tests — update any test that
assumed hidden types were returned).

## 10. Delivery

TDD → `pnpm test` + `tsc` + `build` green → push (stacked on F8) → PR → next loop slice
(**F6 refunds/attendee self-service** or **F9 marketing**).
