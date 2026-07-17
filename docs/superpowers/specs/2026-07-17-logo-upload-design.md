# Passline → Logo upload (organization profile + host profiles)

- **Date:** 2026-07-17
- **Status:** Approved design
- **Slice:** Replace the two URL-typed image fields in Settings with real file uploads,
  mirroring the existing `eventContent` cover-image pattern.

## 1. Goal

Organizers currently paste a URL to set a logo. Settings → Organization profile has a
"Logo URL" text input (`organizers.image`), and Settings → Host profiles has the same
(`hostProfiles.logoUrl`, validated `https://`). Both should accept an uploaded file
instead, stored in Convex file storage.

## 2. Scope

**In:** storage-backed logo upload on Settings → Organization profile and Settings →
Host profiles; an organizer-scoped `generateUploadUrl`; blob cleanup on replace/remove;
`ImageDropzone` decoupled from `eventId` so all three call sites share it.

**Out:** migrating existing URL values into storage (they remain as a read-only
fallback — see §4); image cropping/resizing; changing the public host page layout;
the ~10 other components that surface raw `error.message` (tracked separately).

## 3. Precedent this mirrors

`convex/eventContent.ts` already solved this exact problem for event cover images:

- `generateUploadUrl` — auth-checked mutation returning `ctx.storage.generateUploadUrl()`.
- `setCoverImage({ storageId | null })` — patches `coverImageId`, `ctx.storage.delete()`s
  the replaced blob, and clears the legacy `coverImageUrl` "so resolution is unambiguous".
- Read path resolves `coverImageId ? await ctx.storage.getUrl(...) : coverImageUrl`.

This design follows that shape rather than inventing a second pattern.

## 4. Data model (additive — no migration)

- `organizers`: add `imageId: v.optional(v.id("_storage"))` alongside existing `image`.
- `hostProfiles`: add `logoId: v.optional(v.id("_storage"))` alongside existing `logoUrl`.

Legacy URL fields are **kept as a read-only fallback**. Rationale: `organizers.image` is
auto-seeded from the auth user's avatar in `ensureOrganizer`, so dropping it would blank
existing logos. Nothing writes a new URL after this change; uploading clears the legacy
value. The fields are not removed, and no backfill runs.

## 5. Server

### `convex/files.ts` (new)

- `generateUploadUrl()` — requires an authenticated organizer via `getAuthOrganizerId`;
  returns `ctx.storage.generateUploadUrl()`. Organizer-scoped rather than event-scoped,
  so both settings pages can use it. Ownership of the *target* row is enforced by the
  setter mutations below, not here.

### `convex/organizers.ts`

- `setImage({ storageId: v.union(v.id("_storage"), v.null()) })` — authenticated organizer.
  Deletes the previous `imageId` blob when it differs; patches
  `{ imageId: storageId ?? undefined, image: undefined }`. Passing `null` removes the logo.
- `updateProfile` — drop the `image` arg; it now only sets `name`. (Logo is set via `setImage`.)
- `getMe` / `getPublicProfile` — return `image` resolved as
  `imageId ? (await ctx.storage.getUrl(imageId)) ?? undefined : image`. The field name and
  string type are unchanged, so no consumer outside these pages changes.

### `convex/hostProfiles.ts`

- `create` / `update` — replace the `logoUrl` arg with `logoId: v.optional(v.id("_storage"))`.
  `validateFields` keeps its `websiteUrl` and `bio` checks; the `logoUrl` https guard is removed
  with the arg.
  - `create` inserts `logoId` directly.
  - `update` deletes the previous `logoId` blob when it differs from the incoming one, patches
    `logoId`, and clears `logoUrl`.

  **Why not `setLogo` here.** Unlike the org profile (a row that always exists), host profiles
  are created in a dialog — on create there is no `hostProfileId` yet, so an immediate
  `setLogo(hostProfileId, …)` is impossible. The logo therefore travels with `create`/`update`
  and commits on Save. This is a deliberate divergence from §6's "applies immediately" rule,
  which holds only for the org profile.
- `listMine` / `getForEvent` — resolve `logoId` to a URL, falling back to `logoUrl`,
  returned under the existing `logoUrl` key.

## 6. Client

### `src/components/ImageDropzone.tsx` (refactor)

Replace the `eventId: Id<"events">` prop with `getUploadUrl: () => Promise<string>`. The
component keeps its own validation (image mime-type, 5 MB cap), drag state, a11y
(`role="button"`, keyboard activation), and upload lifecycle — only the URL *source* is
injected. `EventPagePanel` passes `() => generateUploadUrl({ eventId })` and is otherwise
untouched.

### `src/routes/settings/profile.tsx`

Remove the "Logo URL" `Input`. Render the existing `Avatar` preview above an
`ImageDropzone`, plus a "Remove" button when a logo is set (calls `setImage({ storageId: null })`).
Uploading calls `setImage` **immediately** — consistent with `setCoverImage`, and it avoids
stranding an unreferenced blob if the user uploads then navigates away. "Save changes"
therefore only saves the name; its disabled condition (`!name.trim()`) is unchanged.

### `src/routes/settings/host-profiles.tsx`

Same treatment for each host profile's logo field.

## 7. Error handling

Upload failures surface via the dropzone's existing `toast.error`. Note `ImageDropzone`
currently does `toast.error(error instanceof Error ? error.message : "Upload failed")` —
the same raw-message pattern fixed in `login.tsx`. Out of scope here; not made worse.

## 8. Testing

Convex tests (`convex/organizers.test.ts`, `convex/hostProfiles.test.ts`), following
`events.test.ts`, which already asserts `ctx.storage.getUrl(cover)` is `null` after deletion:

- `setImage` stores `imageId` and clears the legacy `image`.
- Replacing a logo deletes the previous blob (`getUrl(prev)` → `null`) and keeps the new one.
- `setImage({ storageId: null })` removes the logo and deletes the blob.
- Unauthenticated `setImage` throws; `setLogo` on another organizer's profile throws.
- `getMe` prefers `imageId` over legacy `image`; falls back to `image` when `imageId` is unset.
- `hostProfiles.setLogo` mirrors the above; `getForEvent` resolves the uploaded logo.

## 9. Risks

- **Orphaned blobs on host-profile delete.** `hostProfiles.remove` deletes no blob today,
  which is correct while `logoUrl` is just a string — but the moment `logoId` exists it leaks
  the file. `remove` **must** `await ctx.storage.delete(profile.logoId)` when set, before
  `ctx.db.delete(hostProfileId)`. This mirrors `events.ts:304`, which deletes
  `content.coverImageId` (and each gallery blob) on event delete. Covered by a test asserting
  `getUrl(logoId)` is `null` after `remove`.
- **Shared `generateUploadUrl`.** Any authenticated organizer can mint an upload URL. This
  matches the event-scoped precedent's trust level (an organizer is already trusted to upload);
  the setters enforce row ownership. Worth noting, not blocking.

- **Orphaned blob on host-profile dialog cancel.** Accepted, eyes open. Because the logo
  uploads before Save (see §5), uploading and then cancelling the dialog strands one
  unreferenced blob (≤5 MB, the dropzone's cap). No cleanup is built for this; the alternative
  (a `discardUpload` mutation on cancel/unmount) was considered and rejected as not worth the
  complexity, since it still leaks if the tab is closed mid-dialog. Revisit if storage cost
  ever shows up.
