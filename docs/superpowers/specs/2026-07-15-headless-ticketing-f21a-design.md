# Passline → Headless Ticketing — F21a: Humanitix editor layout parity

- **Date:** 2026-07-15
- **Status:** Approved design (scope: full-parity redesign, slice a = layout; b = new fields, c = host profiles follow)
- **Slice:** F21a — restructure the F19 event editor's nav + chrome to match Humanitix's event-editor
  layout (collapsible "Edit event" / "Manage event" groups, a sticky **Continue** footer, and a
  Humanitix-style Event Information form). **Frontend-only; no schema/backend changes.**

## 1. Goal

Make `/events/$id` look and flow like Humanitix's event editor: a left rail with collapsible
**Edit event** and **Manage event** groups, a sticky **Continue** button that walks the organizer
through the Edit-event sections in order, and the Event Information section laid out as a clean
labeled form. This reorganizes existing sections/panels only — every panel is reused unchanged, and
the F19 readiness checklist + gated Publish stay.

## 2. Scope

**In:** regroup the section nav from `build`/`manage` into collapsible `edit`/`manage` groups with
display labels; render each group as a shadcn `Collapsible` in `EventBuilderNav` (mirroring the
`app-sidebar` Settings-group pattern), preserving the per-section completion glyphs and the readiness
footer + Publish; a **Continue** sticky footer on Edit-event sections that advances `?section=` to the
next edit section; restyle the Event Information (Details) section into a Humanitix-style form heading
+ labeled fields + a read-only "Event page URL" (slug) display.

**Out (F21b/c and later):** the editable/unique URL slug, currency selector, event type/category,
keywords, sharing description (all need schema/backend — **F21b**); host profiles (**F21c**);
splitting "Page & design" into separate "Page design" / "Page content" sections; any change to a
reused panel, to readiness (`convex/lib/readiness.ts`), or to the backend.

## 3. Data model

**No schema changes.** Purely a frontend reorganization of `src/lib/eventSections.ts`,
`src/components/EventBuilderNav.tsx`, and the Details section in `src/routes/events/$id.index.tsx`.

## 4. Section taxonomy (`src/lib/eventSections.ts`)

Rename the group union and reassign; add group display labels. `EventSectionKey` is **unchanged**
(so `SectionKey` in `convex/lib/readiness.ts` stays in sync — no readiness change).

```ts
export type EventSectionGroup = "edit" | "manage";

export const EVENT_SECTION_GROUPS: { key: EventSectionGroup; label: string }[] = [
  { key: "edit", label: "Edit event" },
  { key: "manage", label: "Manage event" },
];

// EVENT_SECTIONS: same keys/labels/order, but `group: "build"` → `"edit"` for the
// setup sections and `group: "manage"` stays for orders/attendees/analytics/marketing/activity.
// (Label "Marketing" may read "Promote" to match Humanitix — display-only.)
```

`isEventSectionKey` and the section list/order are otherwise unchanged.

## 5. `EventBuilderNav` (collapsible groups + Continue)

`src/components/EventBuilderNav.tsx`:

- Render **two collapsible groups** (`edit`, `manage`) using `Collapsible`/`CollapsibleTrigger`/
  `CollapsibleContent` (already installed; same pattern as `app-sidebar.tsx`'s Settings group). Each
  group header shows its label + a chevron that rotates on open. **Edit event** is `defaultOpen`;
  **Manage event** is `defaultOpen` when the active section is a manage section, else collapsed.
- Inside each group, render the section links exactly as today (active state via `activeSection`,
  completion glyph from `readiness.sectionStatus[key]` for rule-bearing edit sections; manage
  sections get no glyph).
- Keep the existing rail **footer** unchanged: `Ready N/M`, blockers/suggestions (clickable), the
  gated **Publish**/Unpublish button, and the "View page" link.

## 6. Continue footer

A sticky bottom bar rendered by the section-content pane in `src/routes/events/$id.index.tsx`, shown
**only when the active section is in the `edit` group**:

- Right-aligned **Continue** button. Its target is the next `edit`-group section after the active one
  (in `EVENT_SECTIONS` order); on the **last** edit section it reads **Review & publish** and scrolls
  to / focuses the Publish control (or navigates to the first section with an open blocker — simplest:
  it links to the last edit section's Publish; for v1, on the last edit section the button is a plain
  "Review & publish" that does nothing beyond being present, or is hidden). Choose: **hide Continue on
  the last edit section** (v1), show it on all earlier edit sections.
- Implemented as a `sticky bottom-0` bar with a top border and background, inside the content column,
  so it stays visible while the section body scrolls. `<Button asChild><Link search={{ section: next }}>`.
- Manage sections render no Continue bar.

## 7. Event Information section restyle

In `src/routes/events/$id.index.tsx`, the `DetailsSection` becomes a Humanitix-style form block:

- A section heading **"Event information"** (h2) above the form.
- The existing `EventForm` (edit mode) unchanged in behavior, but preceded by a read-only **"Event
  page URL"** row showing the public path, e.g. `/e/<slug>` (or `${window.location.origin}/e/<slug>`),
  styled like a disabled input with the slug — read-only in F21a (editable slug is F21b).
- The capacity meter stays. Keep everything inside the existing `max-w-2xl` column.

## 8. Testing

Frontend-only, no unit harness — verified by `pnpm generate-routes` (no route changes expected, but
run it) + `pnpm exec tsc --noEmit` + `pnpm build`, plus a manual drive: open an event, confirm the
**Edit event** / **Manage event** groups collapse/expand, the completion glyphs and readiness footer
still work, **Continue** advances through the edit sections and is hidden on manage sections and the
last edit section, and the Event Information section shows the heading + read-only URL + form.
`noUnusedLocals`/`noUnusedParameters` are enforced — keep `tsc` clean.

## 9. Constraints

Carried: pnpm only; shadcn/ui for all UI (`Collapsible` for groups, `Skeleton` for loading); lucide
icons only; English, no emojis; Conventional Commits; root `tsconfig` enforces
`noUnusedLocals`/`noUnusedParameters`. **Do not modify any reused panel, the readiness engine, or the
backend.** `EventSectionKey` must stay identical to `SectionKey` in `convex/lib/readiness.ts`.

## 10. Delivery

Frontend build via the subagent pipeline; `generate-routes` + `tsc` + `build` green → drive-verify →
proceed to **F21b** (new event fields: editable slug, currency, event type/category, sharing
description, keywords) then **F21c** (host profiles).
