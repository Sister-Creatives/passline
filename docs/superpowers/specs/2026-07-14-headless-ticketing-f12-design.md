# Passline → Headless Ticketing — F12: Event page builder & branding

- **Date:** 2026-07-14
- **Status:** Approved design (autonomous loop)
- **Slice:** F12 — rich content + branding for the public event page (Humanitix §2).

## 1. Goal

Let organizers make the public event page (`/e/$slug`) their own: a cover image, a brand accent
colour, a custom call-to-action label, an embedded video, an agenda, a speaker lineup, and
collapsible FAQs.

## 2. Scope

**In:** an `eventContent` doc per event (branding + modular content); `eventContent.get` +
`update` (organizer) + public `getBySlug`; public rendering of all of it on `/e/$slug`; a **Page**
dashboard tab (content/branding editor with repeatable agenda/speaker/FAQ rows).

**Out:** the Canva integration (external API); a full drag-drop layout builder; per-section
visibility toggles; a public host directory (that's F16). Cover/speaker images are **URLs** the
organizer supplies (no upload pipeline this slice).

## 3. Data model

One content doc per event (`by_event`, at most one):

```ts
eventContent: defineTable({
  eventId: v.id("events"),
  organizerId: v.id("organizers"),
  coverImageUrl: v.optional(v.string()),
  brandColor: v.optional(v.string()),     // "#RRGGBB", validated
  ctaLabel: v.optional(v.string()),       // e.g. "Register", "Donate", "RSVP" — replaces the default button text
  videoUrl: v.optional(v.string()),       // a YouTube/Vimeo watch URL
  agenda: v.array(v.object({ time: v.string(), title: v.string(), description: v.optional(v.string()) })),
  speakers: v.array(v.object({ name: v.string(), title: v.optional(v.string()), bio: v.optional(v.string()), imageUrl: v.optional(v.string()) })),
  faqs: v.array(v.object({ question: v.string(), answer: v.string() })),
}).index("by_event", ["eventId"]),
```

## 4. Helpers — `convex/lib/eventContent.ts`

- `isValidHexColor(s)` → `/^#[0-9a-fA-F]{6}$/`.
- `parseVideoEmbed(url)` → `{ provider: "youtube" | "vimeo", id } | null`: extract the ID from a
  YouTube (`watch?v=`, `youtu.be/`, `/embed/`) or Vimeo (`vimeo.com/<digits>`) URL; the `id` is
  constrained to `[A-Za-z0-9_-]` (YouTube) / `[0-9]` (Vimeo) so it can be safely interpolated into
  an iframe `src`. Returns null for anything else (no arbitrary-URL embedding).

## 5. Functions — `convex/eventContent.ts`

- `get({ eventId })` — organizer-auth'd + ownership: the content doc (or an empty default if none).
- `update({ eventId, coverImageUrl?, brandColor?, ctaLabel?, videoUrl?, agenda, speakers, faqs })` —
  organizer-auth'd + ownership; **upsert** (patch the existing doc or insert one). Validate
  `brandColor` with `isValidHexColor` when non-empty (reject otherwise); `videoUrl` must be
  `parseVideoEmbed`-able when non-empty (reject otherwise); trim strings, drop empty agenda/speaker/
  faq rows (a row is empty if its required field is blank). Cap array lengths (e.g. ≤ 50 each).
- `getBySlug({ slug })` — **public**: for a `published` event, its `eventContent` (or an empty
  default) so the storefront can render it. Returns null if the event isn't published.

## 6. Public rendering — `src/routes/e/$slug.tsx`

Extend the public page (which already loads the event) to also load `eventContent.getBySlug` and
render, when present:
- **Cover image** (`coverImageUrl`) as a hero (`max-w-full`, lazy).
- **Brand colour** applied as an accent — set a CSS variable on the page root and use it for the
  primary CTA / headings (only via the validated hex).
- **CTA label** — the public RSVP/register button uses `ctaLabel` when set (default unchanged).
- **Video** — a responsive 16:9 `iframe` from `parseVideoEmbed(videoUrl)` (YouTube/Vimeo embed URL
  with the sanitized id; `title`, `allowfullscreen`; render nothing if unparseable).
- **Agenda** — a simple time/title/description list.
- **Speakers** — cards (name, title, bio, optional avatar via `imageUrl`).
- **FAQs** — a shadcn `Accordion` (install via `pnpm dlx shadcn@latest add accordion` if missing).
All sections render only when non-empty.

## 7. Dashboard UI — Page tab on `events/$id.index.tsx`

A **Page** tab with `EventPagePanel.tsx`: prefilled from `eventContent.get`; a form (react-hook-form
+ `useFieldArray`) with cover URL, brand colour (an `Input type="color"` or hex `Input` validated),
CTA label, video URL, and **repeatable** agenda / speaker / FAQ editors (add/remove rows) →
`eventContent.update`. `Skeleton` while loading; toast on save.

## 8. Testing (TDD)

- `eventContent.test.ts`: `isValidHexColor` accepts `#1a2b3c`, rejects `red`/`#fff`/injection;
  `parseVideoEmbed` extracts ids from YouTube (`watch?v=`, `youtu.be/`) + Vimeo and rejects other
  URLs; `update` upserts, rejects a bad hex / unparseable video, drops empty rows, is owner-only;
  `get`/`getBySlug` owner-only vs public-published behavior.
- Frontend verified by `tsc` + `build`.

## 9. Constraints

Carried: shadcn/ui, `Skeleton`, plain `Error`, per-file test helpers, additive (existing 268 tests
pass). **Security:** the video id and brand colour are the only organizer values interpolated into
markup — both are strictly validated/sanitized before use; cover/speaker image URLs go into
`<img src>` only (not script), still fine.

## 10. Delivery

TDD → `pnpm test` + `tsc` + `build` green → push (stacked on F11) → PR → next slice (**F13
multi-date / recurring events**).
