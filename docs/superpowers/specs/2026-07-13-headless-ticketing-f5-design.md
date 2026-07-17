# Passline → Headless Ticketing — F5: Custom checkout questions

- **Date:** 2026-07-13
- **Status:** Approved design (autonomous loop)
- **Slice:** F5 — organizer-defined questions collected at checkout. Builds on F3a orders.

## 1. Goal

Let organizers collect custom data at checkout (dietary needs, a waiver agreement, company name,
…) with text / dropdown / checkbox questions, stored per order and readable by the organizer and
the buyer. Exposed to headless checkouts so a developer can render the questions and submit
answers.

## 2. Scope

**In:** `checkoutQuestions` + `orderResponses` tables; `checkoutQuestions.create/list/remove/
reorder` (organizer); a **public** `listQuestionsForEvent` + `GET /v1/events/{id}/questions` so a
checkout can render them; `answers` accepted by `createOrder` and `POST /v1/orders` (validates
required + select-option membership, stores responses); `getOrder` returns the responses; a
Questions dashboard tab.

**Out:** conditional/branching questions; per-ticket-type questions; file-upload answers;
multi-page checkout mechanics (developer/UI concern).

## 3. Data model

```ts
checkoutQuestions: defineTable({
  eventId: v.id("events"),
  organizerId: v.id("organizers"),
  label: v.string(),
  kind: v.union(v.literal("text"), v.literal("select"), v.literal("checkbox")),
  options: v.optional(v.array(v.string())),   // required + non-empty when kind === "select"
  required: v.boolean(),
  sortOrder: v.number(),
  active: v.boolean(),
  createdAt: v.number(),
}).index("by_event", ["eventId"]),

orderResponses: defineTable({
  orderId: v.id("orders"),
  eventId: v.id("events"),
  questionId: v.id("checkoutQuestions"),
  label: v.string(),        // snapshot of the question label at purchase time
  value: v.string(),        // text; for checkbox "true"/"false"; for select the chosen option
}).index("by_order", ["orderId"]),
```

## 4. Functions — `convex/checkoutQuestions.ts`

- `create({ eventId, label, kind, options?, required })` — organizer-auth'd + ownership. Validates
  non-empty label; `kind === "select"` ⇒ `options` non-empty (each non-empty, trimmed). Appends
  `sortOrder`, `active = true`.
- `list({ eventId })` — organizer-auth'd + ownership (dashboard: all questions incl. inactive).
- `listForEvent({ eventId })` — **public** read: the event's `active` questions sorted by
  `sortOrder` (for a checkout to render). Only returns questions for a `published` event.
- `remove({ questionId })`, `reorder({ eventId, orderedIds })` — organizer-auth'd + ownership
  (reorder rejects a non-permutation, mirroring `ticketTypes.reorder`).
- Exported helper `validateAndSnapshotAnswers(ctx, eventId, answers)` →
  `{ questionId, label, value }[]`: loads the event's `active` questions; for each **required**
  question asserts a non-empty answer is present; for each provided answer asserts the question
  belongs to the event + is active, and — when `kind === "select"` — the value is one of
  `options`; ignores answers to unknown/foreign questions (throws) ; returns snapshot rows.

## 5. Checkout integration (`convex/orders.ts`)

`createOrder` gains optional `answers?: { questionId, value }[]`:
- Call `validateAndSnapshotAnswers(ctx, eventId, answers ?? [])` (throws on a missing required
  answer or an invalid select value → maps to 400 over HTTP).
- After the order is inserted, insert one `orderResponses` row per snapshot.
- `getOrder({ token })` additionally returns the order's `orderResponses`.

`POST /v1/orders` (convex/apiHttp.ts): accept an optional `answers` array in the body and pass it
through; a validation failure → the existing `400 {error}`. Add `GET /v1/events/{eventId}/ticket-
types`-style **`GET /v1/events/{eventId}/questions`** returning the public `listForEvent` result.

## 6. Dashboard UI

Add a **Questions** tab to the event page: a `Table` (label, kind `Badge`, required, options
count) with a create `Dialog` (label + kind `ToggleGroup` + a repeatable options editor shown only
for `select` + a required `Checkbox`), up/down reorder, and `AlertDialog` remove. `Skeleton`/
`Empty`. Also surface responses on the order — extend the Orders tab row or a per-order view to
show answers (at minimum, include them in `getOrder`).

## 7. Testing (TDD)

- `checkoutQuestions.test.ts`: create validates label + select-options; list/remove/reorder
  owner-only; `listForEvent` returns only active questions of a published event, sorted;
  `validateAndSnapshotAnswers` throws on a missing required answer and on an out-of-set select
  value, and returns snapshot rows for valid answers.
- `orders.test.ts`: `createOrder` with a required unanswered question is rejected; with valid
  answers stores `orderResponses` (assert via `by_order`); `getOrder` returns them.
- `apiHttp.test.ts`: `GET /v1/events/{id}/questions` returns active questions (200, org-scoped);
  `POST /v1/orders` with a missing required answer → 400.

## 8. Constraints

Carried: shadcn/ui, `Skeleton`, plain `Error`, per-file test helpers, integer cents unaffected,
additive (existing 162 tests pass; `createOrder`/`POST /v1/orders` gain a defaulted optional arg).

## 9. Delivery

TDD → `pnpm test` + `tsc` + `build` green → push (stacked on F7) → PR → next loop slice (**F8
analytics** or **F4b access codes + visibility UI**).
