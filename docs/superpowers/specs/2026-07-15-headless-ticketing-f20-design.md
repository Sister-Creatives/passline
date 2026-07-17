# Passline → Headless Ticketing — F20: Free hosted checkout

- **Date:** 2026-07-15
- **Status:** Approved design (scope confirmed: free-only + checkout questions)
- **Slice:** F20 — a public attendee checkout UI on the event page for **free** ticket types,
  completing end-to-end against the existing order engine. The attendee-facing counterpart to the
  F19 builder.

## 1. Goal

Give a published event with **free** ticket types a real hosted checkout on `/e/$slug`: the buyer
picks quantities per free ticket type, fills name/email and the organizer's checkout questions, and
submits — tickets (with QR) are issued immediately and the buyer lands on the existing order
confirmation page. This is buildable with **no external dependency**: `createOrder` already fulfils a
$0 order inline. Paid/donation purchase stays behind the F3b (Stripe) seam.

## 2. Scope

**In:** one public query `ticketTypes.listPublicForEvent`; a `<Checkout>` component (free ticket
quantity steppers, disabled paid/donation rows, buyer fields, checkout questions, $0 order summary)
that calls the existing public `orders.createOrder` and routes to `/orders/{token}`; a branch on
`/e/$slug` selecting `<Checkout>` (has visible ticket types) vs the existing `<RsvpForm>` (none).

**Out (explicit, deferred):** paid and donation **purchase** (shown disabled — needs F3b); add-ons,
promo codes, access codes (all create a nonzero total); interactive seat selection and session
selection; any change to `createOrder`/`buildOrder`; schema changes; a dedicated checkout route
(checkout renders inline on the event page).

## 3. Data model

**No schema changes.** Reuses `ticketTypes`, `orders`, `orderItems`, `tickets`, `checkoutQuestions`,
`orderResponses`. The order confirmation reuses the existing public `orders.getOrder` +
`/orders/$token` route (which already renders tickets/QR).

## 4. Backend — one public query

`convex/ticketTypes.ts` → **`listPublicForEvent({ eventId }) → PublicTicketType[]`**, mirroring the
public `checkoutQuestions.listForEvent` shape (no `requireOwnedEvent`; published-event gate):

```ts
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
        kind: t.kind,               // "paid" | "free" | "donation"
        priceCents: t.priceCents,
        capacity: t.capacity,       // optional per-type cap
        sold: t.sold,
        badge: t.badge,
        minPerOrder: t.minPerOrder,
        maxPerOrder: t.maxPerOrder,
      }));
  },
});
```

It deliberately returns **all** active+visible types (not just free) so the storefront can show paid
tiers as "coming soon"; only free rows are ever purchasable in this slice. Hidden/archived types and
draft events never leak. `sold`/`capacity` let the UI compute remaining availability (the server
`buildOrder` remains the source of truth on oversell).

## 5. Frontend

### 5.1 `/e/$slug` branch (`src/routes/e/$slug.tsx`)

Add a `listPublicForEvent` query. `visibleTypes.length > 0` → render `<Checkout>`; else keep the
existing `<RsvpForm>` (unchanged). This mirrors the F19 RSVP-vs-ticketed duality on the public side.
The existing event content (cover, agenda, speakers, etc.) is untouched — only the registration block
switches.

### 5.2 `<Checkout>` component (`src/components/Checkout.tsx`, new)

- **Ticket rows** (from `listPublicForEvent`, sorted): each free (`kind === "free"`) type gets a
  quantity stepper (0..N). `N = min(maxPerOrder ?? 10, remaining)` where
  `remaining = capacity != null ? max(0, capacity - sold) : Infinity`; a `minPerOrder` applies once
  quantity > 0. A type with `remaining === 0` shows a "Sold out" badge, stepper disabled. Paid and
  donation types render a **disabled** row with their price + a "Coming soon" badge (not purchasable
  this slice). `badge` (e.g. "Early bird") renders as a `Badge`.
- **Buyer fields:** name + email (shadcn `Form` + `Input`, zod: name non-empty, email valid).
- **Checkout questions:** from the public `checkoutQuestions.listForEvent`. Render `text` →
  `Input`/`Textarea`, `select` → shadcn `Select` (its `options`), `checkbox` → `Checkbox`. A
  `required` question must be answered (checkbox required ⇒ must be checked). Answers map to
  `answerInput[] = { questionId, value }` (checkbox value `"true"`/`"false"`; select ⇒ chosen option).
- **Summary + submit:** show line items and a total that is always **$0** ("Free"). Submit is
  disabled until ≥1 ticket is selected and all required fields/questions are valid. On submit call
  `createOrder({ eventId: event._id, items, buyerName, buyerEmail, answers })` where `items` is the
  free rows with quantity > 0 as `{ ticketTypeId, quantity }`. On success (`{ token }`), navigate to
  `/orders/$token`. Errors (server-side capacity race, validation) surface via `toast` — the server
  is authoritative.
- Loading via `Skeleton`; empty (only paid/donation types, no free) shows an inline notice
  "Online ticket sales are coming soon." No emojis; lucide icons; shadcn only.

## 6. Testing

- **`convex/ticketTypes.test.ts`** (append): `listPublicForEvent` returns only `active` + `visible`
  types sorted by `sortOrder`, excludes hidden/archived, returns `[]` for a draft (unpublished)
  event, and is callable **without** auth (public). Include a paid + a free type; assert both are
  returned (the free/paid distinction is a UI concern, not a query filter).
- **Free checkout end-to-end** (`convex/orders.test.ts` or reuse): a public `createOrder` with a
  single free ticket type issues tickets and returns `status: "paid"` — this path already exists;
  add/confirm a test asserting a free-only cart is fulfilled inline (no pending order). (No new
  mutation is introduced, so this guards the reuse.)
- **Frontend** verified by `pnpm exec tsc --noEmit` + `pnpm build` + a manual drive: publish an event
  with a free type + a required question → open `/e/$slug` → pick 2 tickets → answer → submit → land
  on `/orders/$token` with 2 QR tickets. Confirm an event with no ticket types still shows the RSVP
  form, and an event with only a paid type shows the "coming soon" notice.

## 7. Constraints

Carried: pnpm only; shadcn/ui for all UI (`Skeleton` for loading, no spinners/"Loading…"); plain
`Error`; integer cents; lucide icons only; English, no emojis; root `tsconfig` enforces
`noUnusedLocals`/`noUnusedParameters` (prune imports; `tsc --noEmit` must be clean); Conventional
Commits. **Additive:** the only backend addition is one public query; `createOrder`/`buildOrder` and
every existing panel/route are unchanged; the `/e/$slug` change is a branch, not a rewrite.

## 8. Delivery

TDD the query first, then the `<Checkout>` component, then the `/e/$slug` branch; `pnpm test` + `tsc`
+ `build` green → drive-verify. Follow-ups (not this slice): F3b Stripe so paid/donation rows become
purchasable; add-ons/promo/access in checkout; interactive seat + session selection.
