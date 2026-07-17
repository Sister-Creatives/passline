# Passline → Headless Ticketing — F21b: Event Information fields

- **Date:** 2026-07-15
- **Status:** Approved design (slice b of full Humanitix editor parity)
- **Slice:** F21b — add the remaining Humanitix "Event information" fields to the model + edit form:
  an editable/unique URL slug, a currency selector, event type + category, a sharing (meta)
  description, and keywords.

## 1. Goal

Bring the Event Information form to Humanitix parity: the organizer can set the event's public URL
slug, currency, type, category, a search/share meta description, and keywords — all edited in the
Event Information section and persisted via `updateEvent`. Create stays minimal (F19 model); these
are edit-time fields.

## 2. Scope

**In:** schema fields `eventType?`, `eventCategory?`, `keywords?`, `sharingDescription?` on `events`
(currency + slug already exist); `convex/lib/eventTaxonomy.ts` with the type/category option lists +
validators; `updateEvent` extended to accept + validate these plus `currency` and an editable unique
`slug`; the Event Information form (EventForm edit mode) surfacing all of them.

**Out (F21c and later):** host profiles (**F21c**); redirect handling for old slugs after a slug
change (a changed slug simply takes effect — links to the old slug 404, standard); free-form
type/category (fixed lists only); any change to `createEvent` (create stays minimal).

## 3. Data model (`convex/schema.ts`)

Add to the `events` table (all optional, additive — no migration needed):

```ts
    sharingDescription: v.optional(v.string()), // <= 160 chars; search/social meta
    eventType: v.optional(v.string()),          // one of EVENT_TYPES
    eventCategory: v.optional(v.string()),      // one of EVENT_CATEGORIES
    keywords: v.optional(v.array(v.string())),  // <= 10, trimmed, de-duped, non-empty
```

`slug` (existing) becomes user-editable; `currency` (existing) becomes user-settable. The `by_slug`
index already exists for the uniqueness check.

## 4. Taxonomy (`convex/lib/eventTaxonomy.ts`, new)

Shared by backend validation and the form (frontend already imports from `convex/lib/*`):

```ts
export const EVENT_TYPES = [
  "Conference", "Workshop", "Concert or performance", "Festival", "Networking",
  "Class or course", "Sporting event", "Exhibition", "Party or social",
  "Fundraiser", "Screening", "Other",
] as const;

export const EVENT_CATEGORIES = [
  "Music", "Business & professional", "Food & drink", "Community & culture", "Arts",
  "Sports & fitness", "Health & wellbeing", "Charity & causes", "Education",
  "Family & kids", "Film & media", "Other",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export function isEventType(v: string): v is EventType { return (EVENT_TYPES as readonly string[]).includes(v); }
export function isEventCategory(v: string): v is EventCategory { return (EVENT_CATEGORIES as readonly string[]).includes(v); }

// Slug: lowercase letters/digits/hyphens, 1..80, no leading/trailing/double hyphen.
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function isValidSlug(s: string): boolean { return s.length >= 1 && s.length <= 80 && SLUG_RE.test(s); }
```

## 5. Backend — `updateEvent` extension (`convex/events.ts`)

Extend the existing owner-only `updateEvent` with new **optional** args:
`currency?`, `slug?`, `eventType?`, `eventCategory?`, `keywords?`, `sharingDescription?`. Keep the
existing title/description/location/capacity/date behavior (incl. the capacity-vs-seatsTaken guard
and the raise-capacity promotion loop) unchanged. Validation (throw plain `Error` on violation):

- **slug**: if provided and different from the current, require `isValidSlug(slug)` and that no
  **other** event already uses it (query `by_slug`; a hit whose `_id !== eventId` → "That URL is
  already taken"). Patch the new slug.
- **currency**: if provided, a non-empty string (3-letter ISO code; accept any `/^[A-Z]{3}$/`).
- **eventType / eventCategory**: if provided and non-empty, must pass `isEventType`/`isEventCategory`
  (empty string clears the field to `undefined`).
- **keywords**: if provided, trim each, drop empties, de-dupe, cap at 10 (reject > 10 with an error);
  store the cleaned array (empty array clears).
- **sharingDescription**: if provided, `length <= 160` (reject longer); empty string clears.

Only patch the fields that were provided (omitted args leave the stored value untouched). Keep the
existing `recordAudit("event.updated")`.

## 6. Frontend — Event Information form (`src/components/EventForm.tsx`)

In **edit mode only** (the `event` prop is present), add below the existing fields:

- **Event page URL**: an `Input` prefixed with `/e/` bound to a `slug` field (default `event.slug`);
  zod-validated with `isValidSlug`. Replaces the read-only URL row F21a added in the Details section
  (the form now owns it).
- **Currency**: a shadcn `Select` of common ISO codes (`USD, EUR, GBP, AUD, CAD, NZD, …`), default
  `event.currency ?? "USD"`.
- **Event type** / **Event category**: two `Select`s from `EVENT_TYPES` / `EVENT_CATEGORIES` (plus a
  blank "None" option to clear), defaulting to the stored value.
- **Sharing description**: a `Textarea` with a live `n/160` counter; zod `max(160)`.
- **Keywords**: an add/remove list (an `Input` + "Add" that pushes a `Badge`-with-remove; cap 10),
  stored as `string[]`.

On submit (edit branch), pass the new fields to `updateEvent` alongside the existing ones. Create
mode (`event` absent) is unchanged — none of these render, `createEvent` is not touched. The Details
section's F21a read-only URL row is removed (the editable field lives in the form now).

## 7. Testing

- **`convex/events.test.ts`** (append): `updateEvent` sets type/category/keywords/sharingDescription/
  currency; rejects an invalid slug, a slug already used by another event (but allows keeping the
  event's own slug), an invalid type/category, > 10 keywords, and a > 160-char sharing description;
  de-dupes/trims keywords; a non-owner is rejected; omitted fields are left untouched.
- **`convex/eventTaxonomy.test.ts`** (new, optional but preferred): `isValidSlug`, `isEventType`,
  `isEventCategory` edge cases.
- **Frontend** verified by `pnpm exec tsc --noEmit` + `pnpm build` + a manual drive: edit an event,
  set every field, save, reload, confirm persistence; try a duplicate slug → error toast.

## 8. Constraints

Carried: pnpm only; shadcn/ui (`Select`, `Textarea`, `Badge`, `Input`); lucide icons; plain `Error`;
integer cents (n/a here); English, no emojis; Conventional Commits; root `tsconfig`
`noUnusedLocals`/`noUnusedParameters` (tsc clean). Additive schema (all optional — no migration).
`createEvent` and every panel unchanged. TDD the backend before the form.

## 9. Delivery

Two tasks: (1) schema + taxonomy + `updateEvent` validation + tests; (2) EventForm edit-mode fields
+ remove the F21a read-only URL row. `pnpm test` + `tsc` + `build` green → drive-verify → proceed to
**F21c** (host profiles).
