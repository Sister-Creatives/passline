# Passline → Pre-publish preview link (shareable token)

- **Date:** 2026-07-19
- **Status:** Approved design
- **Slice:** A shareable `/e/<slug>?preview=<token>` URL that lets anyone with the link view
  a **draft** event's public page before it's published.

## 1. Goal

Today `/e/<slug>` returns "not found" for a draft — every public query gates on
`status === "published"`. Add an unguessable per-event **preview token**; supplying the
matching token in the URL bypasses the published gate for the public *read* path only, so
an organizer can share a draft with a client/co-organizer before going live.

## 2. Scope (agreed)

**In:** a `previewToken` on the event; the 5 public queries accept an optional token that
opens the draft when it matches; a preview **banner** on the page when previewing; a
"copy preview link" (+ rotate) control in the builder.

**Out:** per-viewer analytics on preview, expiring tokens (rotation is the invalidation
mechanism), previewing anything other than the public event page.

## 3. Security invariant

The token bypasses the published gate for **reads only**. **Writes stay gated**: RSVP
(`rsvps.rsvp` via `publishedEventBySlug`) and checkout still reject a draft. Do **not**
change `publishedEventBySlug` — it guards those mutations. The preview path is a separate
read check.

## 4. Data model (additive, no migration)

`events` gains `previewToken: v.optional(v.string())`. New events get one at creation;
existing events get one lazily via `ensurePreviewToken` (below), so no backfill is needed.

## 5. Server

### `convex/lib/preview.ts` (new) — shared gate
```ts
import type { Doc } from "../_generated/dataModel";
/** May this event be read on the public surface: published, or a draft whose
 *  preview token was supplied. */
export function canViewEvent(event: Doc<"events">, previewToken?: string): boolean {
  return event.status === "published" || (!!previewToken && previewToken === event.previewToken);
}
```

### The 5 public queries — add `previewToken: v.optional(v.string())` and swap the gate
Replace each `event.status !== "published"` read check with `!canViewEvent(event, previewToken)`:
- `events.getEventBySlug(slug, previewToken?)` → `if (!event || !canViewEvent(event, previewToken)) return null;`
- `rsvps.getEventPublicState(slug, previewToken?)` → currently calls `publishedEventBySlug`
  (which throws). Do NOT reuse it. Inline: fetch by slug, `if (!event || !canViewEvent(event, previewToken)) throw new Error("Event not found");` then compute as before. Leave `publishedEventBySlug` untouched (RSVP still uses it).
- `eventContent.getBySlug(slug, previewToken?)` → `if (!event || !canViewEvent(event, previewToken)) return null;`
- `ticketTypes.listPublicForEvent(eventId, previewToken?)` → `if (!event || !canViewEvent(event, previewToken)) return [];`
- `hostProfiles.getForEvent(eventId, previewToken?)` → `if (!event || !canViewEvent(event, previewToken)) return null;`

### `convex/events.ts`
- `createEvent`: set `previewToken: generatePreviewToken()` on insert. Token = a long,
  unguessable string — reuse the existing pattern (e.g. `crypto.randomUUID()` twice, or a
  `prv_` prefix + `crypto.randomUUID()`). Keep it opaque.
- `ensurePreviewToken({ eventId })` (mutation, owner via `requireOwnedEvent`): if the event
  has no `previewToken`, generate and patch one; return `{ previewToken }`. Idempotent.
- `rotatePreviewToken({ eventId })` (mutation, owner): always generate a new token, patch,
  return `{ previewToken }` — invalidates any shared link.
- `getMyEventWithRsvps` already returns the event doc, so `previewToken` flows to the
  builder with no query change.

## 6. Client

### `src/routes/e/$slug.tsx`
- `validateSearch` to accept `preview?: string`. Read it and pass `previewToken: preview`
  to all 5 `convexQuery` calls (undefined when absent → behaves exactly as today).
- When the resolved event is **not** `published` (i.e. we're viewing via a valid token),
  render a sticky **preview banner** at the top: "Preview — this event isn't published
  yet. Only people with this link can see it." Muted/amber, unobtrusive.

### Builder — a "Preview" control (in `EventBuilderNav`, near Publish / View page)
- For a **draft**, show a "Copy preview link" button. On click: if `event.previewToken`
  is missing call `ensurePreviewToken` to get one, build
  `${origin}/e/${slug}?preview=${token}`, copy to clipboard, toast "Preview link copied".
  An "Open preview" link opens the same URL in a new tab.
- A small "Reset link" action calls `rotatePreviewToken` (with an AlertDialog confirm,
  since it breaks any shared link).
- For a **published** event the live page is the preview, so keep the existing "View page"
  link; the preview control is draft-only.

## 7. Testing

- `convex/lib/preview.test.ts` (or in an existing test): `canViewEvent` — published → true
  regardless of token; draft + matching token → true; draft + wrong/absent token → false.
- Query tests (extend the relevant `*.test.ts`): a draft returns null/[]/throws WITHOUT a
  token, and returns the data WITH the matching token, for at least `getEventBySlug` and
  `ticketTypes.listPublicForEvent`.
- `events.test.ts`: `createEvent` sets a non-empty `previewToken`; `rotatePreviewToken`
  changes it and is owner-gated; RSVP on a draft still throws even if a token exists
  (the write-stays-gated invariant).

## 8. Risks

- **Leaked link = viewable draft.** That's the accepted trade-off of a shareable link;
  `rotatePreviewToken` is the remedy. The token is unguessable and read-only.
- **Five-query surface.** The gate change is mechanical but must be applied to all five, or
  a preview renders half the page. The shared `canViewEvent` keeps them consistent.
