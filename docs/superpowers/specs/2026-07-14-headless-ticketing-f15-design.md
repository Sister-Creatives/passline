# Passline → Headless Ticketing — F15: Accessibility hub

- **Date:** 2026-07-14
- **Status:** Approved design (autonomous loop)
- **Slice:** F15 — surface event accessibility info + image alt-text (Humanitix §6). Extends the
  F12 `eventContent` doc.

## 1. Goal

Let organizers advertise their event's accessibility features (wheelchair access, sign language,
closed captions, hearing loop, accessible parking, assistance-animals welcome, plus free-text
notes) on the public event page, and attach **alt text** to the cover image for screen readers.

## 2. Scope

**In:** an `accessibility` block + `coverImageAlt` on `eventContent`; a dedicated
`updateAccessibility` mutation (partial patch, so it doesn't clobber the F12 page content); an
Accessibility section on the public `/e/$slug` page; an Accessibility dashboard tab.

**Out:** WCAG auditing of the organizer's own content; automated alt-text generation; per-image
alt on speaker images (cover only this slice); a mandated accessibility checkout question (F5
already lets organizers add any question — a "quick add" helper is a later nicety).

## 3. Data model (extend `eventContent`)

Add to the `eventContent` table (all optional/additive):

```ts
  coverImageAlt: v.optional(v.string()),
  accessibility: v.optional(v.object({
    wheelchairAccessible: v.optional(v.boolean()),
    signLanguage: v.optional(v.boolean()),
    closedCaptions: v.optional(v.boolean()),
    hearingLoop: v.optional(v.boolean()),
    accessibleParking: v.optional(v.boolean()),
    assistanceAnimalsWelcome: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  })),
```

The F12 `eventContent.get` / `getBySlug` already return the whole doc, so these fields flow to the
editor and the public page automatically.

## 4. Function — `convex/eventContent.ts`

- `updateAccessibility({ eventId, coverImageAlt?, accessibility? })` — organizer-auth'd +
  ownership; **upsert that patches only** `coverImageAlt` + `accessibility` (leaving the F12 page
  content fields untouched — trim `notes`; omitted → cleared). If no content doc exists yet, insert
  one with empty page-content arrays (`agenda:[], speakers:[], faqs:[]`) plus these fields.

(No new read function — `get`/`getBySlug` from F12 already expose the fields.)

## 5. UI

- **Public `/e/$slug`**: use `coverImageAlt` as the cover `<img alt>` (fallback to the event title
  when unset). Render an **Accessibility** section (only when any flag is true or `notes` is set):
  a list of the enabled features (icon + label via shadcn `Badge`/list) and the free-text notes.
- **Accessibility dashboard tab**: `AccessibilityPanel.tsx` prefilled from `eventContent.get`; a
  form with a `Checkbox` per feature, a `Textarea` for notes, and a cover-image alt-text `Input`
  (with a helper hint) → `updateAccessibility`. `Skeleton` while loading.

## 6. Testing (TDD)

- `eventContent.test.ts` (extend): `updateAccessibility` upserts the accessibility block +
  coverImageAlt WITHOUT clobbering existing page content (set page content via `update`, then call
  `updateAccessibility`, assert the agenda/speakers/faqs survive); owner-only; `getBySlug` returns
  the accessibility fields for a published event.
- Frontend verified by `tsc` + `build`.

## 7. Constraints

Carried: shadcn/ui, `Skeleton`, plain `Error`, per-file test helpers, additive (existing 318 tests
pass; the F12 `update` and the new `updateAccessibility` operate on disjoint field sets of the same
doc — verify one does not wipe the other's fields).

## 8. Delivery

TDD → `pnpm test` + `tsc` + `build` green → push (stacked on F14) → PR → next slice (**F16 event
templates + host directory**).
