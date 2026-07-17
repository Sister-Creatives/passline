# Event page media: cover image upload + gallery

Date: 2026-07-17
Branch: feat/headless-ticketing-f22
Status: approved (design)

## Goal

Let organizers upload a cover image (drag-and-drop, replacing the paste-a-URL
field) and manage a small reorderable image gallery on the event page, with all
files stored in Convex file storage. The gallery renders on the public event
page. Existing pasted-URL covers keep working.

## Current state

- `eventContent` (`convex/schema.ts:300`) stores `coverImageUrl: v.optional(v.string())`
  and `coverImageAlt`. There is **no gallery field** and **no file-upload /
  storage code anywhere** in `convex/` (no `generateUploadUrl`, `ctx.storage`,
  or `v.id("_storage")` usage).
- The organizer editor is `EventPagePanel.tsx`. It reads `api.eventContent.get`
  (`convex/eventContent.ts:116`) and writes `api.eventContent.update`
  (`convex/eventContent.ts:138`); the cover field is a plain "Cover image URL"
  text `Input` bound to react-hook-form.
- The public page reads `api.eventContent.getBySlug` (`convex/eventContent.ts:235`)
  and renders the cover in `src/routes/e/$slug.tsx`; `EventMobilePreview.tsx`
  mirrors it.
- All `eventContent` mutations gate ownership through the shared
  `requireOwnedEvent(ctx, eventId)` helper.

## Decisions

1. Storage: **Convex file storage** (built-in; no external service or keys).
2. Cover: a **drag-and-drop drop zone replaces the URL field** (preview + remove);
   legacy pasted URLs still display.
3. Gallery: **reorderable, up to 8 images, with per-image alt text**, shown on the
   public event page.

## Design

### Data model (`convex/schema.ts`, `eventContent` table)

- Add `coverImageId: v.optional(v.id("_storage"))` — the uploaded cover.
- Add `gallery: v.optional(v.array(v.object({ storageId: v.id("_storage"), alt: v.optional(v.string()) })))`.
- Keep `coverImageUrl` (legacy pasted URLs, no longer settable from the new UI but
  still rendered when present and no `coverImageId`). Keep `coverImageAlt`.

### Backend (`convex/eventContent.ts`)

New mutations, each calling `requireOwnedEvent(ctx, eventId)` first:

- `generateUploadUrl({ eventId })` → returns `await ctx.storage.generateUploadUrl()`.
  Ownership-gated so only the event's organizer can obtain an upload URL.
- `setCoverImage({ eventId, storageId: v.union(v.id("_storage"), v.null()) })`
  - Loads the event's `eventContent` row (create-on-write like `update` does).
  - If a previous `coverImageId` exists and differs, `await ctx.storage.delete(prev)`.
  - Sets `coverImageId = storageId` (or clears it when `null`); when setting a new
    uploaded cover, also clears the legacy `coverImageUrl` so resolution is
    unambiguous.
- `setGallery({ eventId, images: v.array(v.object({ storageId: v.id("_storage"), alt: v.optional(v.string()) })) })`
  - Rejects if `images.length > 8`.
  - Deletes every storage ID present in the old `gallery` but absent from the new
    `images` (`ctx.storage.delete`), so remove + reorder + alt-edit all flow
    through this one full-array-replace mutation with no orphaned files.
  - Writes the new ordered `gallery`.

URL resolution (read side):

- `get` (organizer editor) and `getBySlug` (public) resolve storage IDs to URLs:
  - `coverImageUrl` returned = `coverImageId ? await ctx.storage.getUrl(coverImageId) : coverImageUrl` (legacy).
  - add `gallery: Array<{ url: string; alt?: string }>` resolved via
    `ctx.storage.getUrl(storageId)` for each entry (drop any whose URL resolves to
    null, i.e. a deleted file).
- `getBySlug` keeps its existing shape otherwise; consumers that read
  `coverImageUrl` need no change because the field name is preserved.

The existing `update` mutation must **not** write `coverImageId` or `gallery`, and
must leave `coverImageUrl` untouched (it patches the text/branding fields only) —
the image fields are owned exclusively by the three mutations above, so a page-form
save never clobbers an uploaded cover or gallery.

Cleanup on event deletion: extend `deleteEvent` (`convex/events.ts`) to delete the
event's `coverImageId` and every `gallery[].storageId` from storage before/with
removing the `eventContent` row.

### Upload flow (client)

1. User drops or selects a file.
2. `const url = await generateUploadUrl({ eventId })`.
3. `POST` the file to `url` with `Content-Type: file.type`; response JSON gives
   `{ storageId }`.
4. Persist: `setCoverImage({ eventId, storageId })` for the cover, or build the new
   ordered `images` array and call `setGallery({ eventId, images })` for the gallery.

Client validation before upload: `file.type.startsWith("image/")` and
`file.size <= 5 * 1024 * 1024` (5 MB); reject others with a toast. Gallery is
capped at 8 (the add control is hidden/disabled at 8).

### Frontend

New reusable component `src/components/ImageDropzone.tsx`:

- Props: `{ eventId, onUploaded: (storageId: Id<"_storage">) => void, disabled?, className? }`.
- Renders a bordered drop area ("Drag an image here, or click to upload"). Handles
  `onDragOver`/`onDragLeave`/`onDrop` (with `preventDefault`) for a drag-active
  highlight, and a hidden `<input type="file" accept="image/*">` for click-to-select.
- Runs the upload flow above; shows a spinner while uploading; toasts validation
  and network errors. It only uploads and reports the `storageId`; the parent owns
  what to do with it (cover vs gallery).

Cover, in `EventPagePanel.tsx` (Branding card):

- Replace the "Cover image URL" `FormField` with a cover control driven by the
  `get` query's resolved `coverImageUrl`, not react-hook-form:
  - No image: render `ImageDropzone`; on `onUploaded`, call `setCoverImage`.
  - Has image: show the preview thumbnail with a Remove button
    (`setCoverImage({ storageId: null })`) and a "Replace" affordance (re-upload).
- Remove `coverImageUrl` from the RHF schema/submit (it is now managed by its own
  mutation). Keep `coverImageAlt` in the form.

Gallery, in `EventPagePanel.tsx` (new "Gallery" card):

- Read `gallery` from `get`. Local state mirrors it as `{ storageId, alt }[]`.
- Render a grid of thumbnails using Motion `Reorder.Group` / `Reorder.Item`
  (`motion/react`) for drag-to-reorder; each tile has the image, an alt-text
  `Input`, and a Remove button.
- An `ImageDropzone` "add" tile appends a new image (up to 8).
- Any change (add, remove, reorder, alt edit) recomputes the ordered array and
  calls `setGallery({ eventId, images })`. Debounce alt-text saves on blur/change.
- Show a "Gallery is full (8 images)" note and hide the add tile at the cap.

### Public page (`src/routes/e/$slug.tsx`)

- Cover: unchanged markup; it already reads `content.coverImageUrl`, now the
  resolved value.
- New "Gallery" section: when `content.gallery?.length`, render a responsive grid
  (e.g. `grid gap-2 sm:grid-cols-3`) of `<img>` with `loading="lazy"`, `alt` from
  each entry, rounded corners, placed after the description (before Agenda).
- `EventMobilePreview.tsx`: reads the resolved `coverImageUrl`; no change needed
  beyond the resolved value flowing through.

## Isolation

- `ImageDropzone` — self-contained, reusable upload control (file DnD + upload +
  validation); depends only on `generateUploadUrl`.
- `convex/eventContent.ts` — three new mutations + URL resolution added to `get`
  and `getBySlug`; ownership via the existing `requireOwnedEvent`.
- `EventPagePanel` — swaps the cover field, adds a Gallery card.
- `e/$slug.tsx` — adds a Gallery section.

## Testing

Convex mutation tests (`convex-test`, matching existing test style):

- `generateUploadUrl` and the image mutations reject a non-owner (auth gate).
- `setCoverImage`: setting stores `coverImageId`; replacing deletes the previous
  file; `null` clears it; setting an upload clears the legacy `coverImageUrl`.
- `setGallery`: rejects > 8 images; removing/replacing entries deletes exactly the
  dropped storage IDs; order is preserved.
- `get`/`getBySlug` resolve `coverImageId` and `gallery` storage IDs to URLs and
  fall back to the legacy `coverImageUrl`.

The dropzone drag/drop, the Motion reorder, and the public grid are verified
manually (tsc + build + a run in the app).

## Edge cases

- Upload network failure: toast, leave state unchanged (no partial write).
- Non-image or oversized file: rejected client-side with a toast before upload.
- Deleted/expired storage file: read queries drop gallery entries whose
  `getUrl` returns null and fall back for the cover.
- Legacy events with `coverImageUrl` and no `coverImageId`: render the legacy URL;
  removing it (via the new control) clears `coverImageUrl`.
- Reorder/remove during an in-flight save: the full-array replace is
  last-write-wins; acceptable for a single-editor form.

## Out of scope

- Image cropping/resizing/transforms (Convex serves the original bytes).
- CDN delivery / external image service.
- Uploads for speaker photos or host logos (still URL fields for now).
- Reusing the gallery across events or a media library.
