# Event page cover upload + gallery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let organizers upload an event cover image (drag-and-drop, replacing the paste-URL field) and manage a reorderable gallery (up to 8, alt text) shown on the public event page, all backed by Convex file storage.

**Architecture:** Convex file storage with owner-gated upload URLs. New `eventContent` fields `coverImageId` and `gallery` (storage IDs), resolved to URLs in the `get`/`getBySlug` queries; legacy `coverImageUrl` retained as a fallback. A reusable `ImageDropzone` handles file drag-and-drop + upload; the editor wires cover + gallery to dedicated mutations; the public page renders a gallery grid.

**Tech Stack:** Convex (queries/mutations, `ctx.storage`), convex-test, TanStack Start + React 19, shadcn/ui, Motion (`Reorder`), react-hook-form.

## Global Constraints

- Every image mutation gates ownership with the existing `requireOwnedEvent(ctx, eventId)` helper in `convex/eventContent.ts`.
- Gallery cap: 8 images. Client file validation: `file.type.startsWith("image/")` and `file.size <= 5 * 1024 * 1024` (5 MB).
- Storage IDs use `v.id("_storage")`. Resolve to URLs with `ctx.storage.getUrl` at read time; never store resolved URLs for uploads.
- Replacing/removing/deleting an image always `ctx.storage.delete`s the dropped file (no orphans).
- `eventContent.update` must NOT write `coverImageId`/`gallery` and must not clear `coverImageUrl`; the image fields are owned by the dedicated mutations.
- After any `convex/schema.ts` or new-function change, run `pnpm exec convex codegen` before `pnpm exec tsc --noEmit`.
- Australian English; sentence case; no em/en dashes; no exclamation marks.

---

### Task 1: Schema fields + image mutations (upload URL, cover, gallery)

**Files:**
- Modify: `convex/schema.ts` (`eventContent` table, ~line 300)
- Modify: `convex/eventContent.ts`
- Test: `convex/eventContent.test.ts` (create if absent, else extend)

**Interfaces:**
- Produces: `api.eventContent.generateUploadUrl({ eventId }) => string`; `api.eventContent.setCoverImage({ eventId, storageId: Id<"_storage"> | null }) => Id<"eventContent">`; `api.eventContent.setGallery({ eventId, images: Array<{ storageId: Id<"_storage">, alt?: string }> }) => Id<"eventContent">`.

- [ ] **Step 1: Add schema fields.** In `convex/schema.ts`, `eventContent`, after `coverImageUrl` add:
```ts
    coverImageId: v.optional(v.id("_storage")),
    gallery: v.optional(
      v.array(v.object({ storageId: v.id("_storage"), alt: v.optional(v.string()) })),
    ),
```

- [ ] **Step 2: Regenerate types.** Run `pnpm exec convex codegen`. Expected: succeeds, `convex/_generated` updated.

- [ ] **Step 3: Write failing tests** in `convex/eventContent.test.ts`. Follow the existing convex-test style in the repo (look at another `*.test.ts` in `convex/` for the `convexTest(schema)` + identity setup helpers; reuse them). Add:
```ts
// Pseudocode-accurate structure; adapt the auth/identity helpers to match the repo's existing tests.
test("generateUploadUrl rejects a non-owner", async () => {
  const t = convexTest(schema);
  const { eventId } = await seedEvent(t /* owner A */);
  await expect(asUser(t, "B").mutation(api.eventContent.generateUploadUrl, { eventId }))
    .rejects.toThrow();
});

test("setGallery rejects more than 8 images", async () => {
  const t = convexTest(schema);
  const { eventId, owner } = await seedEvent(t);
  const ids = await storeN(t, 9); // stores 9 blobs, returns Id<"_storage">[]
  await expect(owner.mutation(api.eventContent.setGallery, {
    eventId, images: ids.map((storageId) => ({ storageId })),
  })).rejects.toThrow();
});

test("setGallery deletes storage files that were removed", async () => {
  const t = convexTest(schema);
  const { eventId, owner } = await seedEvent(t);
  const [a, b] = await storeN(t, 2);
  await owner.mutation(api.eventContent.setGallery, { eventId, images: [{ storageId: a }, { storageId: b }] });
  await owner.mutation(api.eventContent.setGallery, { eventId, images: [{ storageId: a }] });
  expect(await t.run((ctx) => ctx.storage.getUrl(b))).toBeNull(); // b was deleted
  expect(await t.run((ctx) => ctx.storage.getUrl(a))).not.toBeNull();
});

test("setCoverImage replacing an uploaded cover deletes the previous file and clears legacy url", async () => {
  const t = convexTest(schema);
  const { eventId, owner } = await seedEvent(t);
  const [a, b] = await storeN(t, 2);
  await owner.mutation(api.eventContent.setCoverImage, { eventId, storageId: a });
  await owner.mutation(api.eventContent.setCoverImage, { eventId, storageId: b });
  expect(await t.run((ctx) => ctx.storage.getUrl(a))).toBeNull();
  const row = await t.run((ctx) => ctx.db.query("eventContent").withIndex("by_event", (q) => q.eq("eventId", eventId)).unique());
  expect(row?.coverImageId).toBe(b);
  expect(row?.coverImageUrl).toBeUndefined();
});
```
Helper sketch (put near the top of the test file):
```ts
async function storeN(t, n) {
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(await t.run((ctx) => ctx.storage.store(new Blob([`x${i}`], { type: "image/png" }))));
  return ids;
}
```

- [ ] **Step 4: Run tests, verify they fail** — `pnpm exec vitest run convex/eventContent.test.ts` → FAIL (functions not defined).

- [ ] **Step 5: Implement the mutations** in `convex/eventContent.ts` (add after `update`):
```ts
export const generateUploadUrl = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireOwnedEvent(ctx, eventId);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Owner-only: set (or clear, with null) the uploaded cover image. Deletes the
 *  replaced file and clears any legacy coverImageUrl so resolution is unambiguous. */
export const setCoverImage = mutation({
  args: { eventId: v.id("events"), storageId: v.union(v.id("_storage"), v.null()) },
  handler: async (ctx, { eventId, storageId }) => {
    const event = await requireOwnedEvent(ctx, eventId);
    const existing = await ctx.db
      .query("eventContent")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .unique();
    const prev = existing?.coverImageId;
    if (prev && prev !== storageId) await ctx.storage.delete(prev);
    const patch = { coverImageId: storageId ?? undefined, coverImageUrl: undefined };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("eventContent", {
      eventId,
      organizerId: event.organizerId,
      ...emptyContent(),
      ...patch,
    });
  },
});

/** Owner-only: replace the whole gallery (ordered, <= 8). Deletes any storage
 *  files no longer referenced, covering remove/reorder/alt in one write. */
export const setGallery = mutation({
  args: {
    eventId: v.id("events"),
    images: v.array(v.object({ storageId: v.id("_storage"), alt: v.optional(v.string()) })),
  },
  handler: async (ctx, { eventId, images }) => {
    const event = await requireOwnedEvent(ctx, eventId);
    if (images.length > 8) throw new Error("A gallery can have at most 8 images");
    const existing = await ctx.db
      .query("eventContent")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .unique();
    const keep = new Set(images.map((i) => i.storageId));
    for (const old of existing?.gallery ?? []) {
      if (!keep.has(old.storageId)) await ctx.storage.delete(old.storageId);
    }
    const gallery = images.map((i) => ({ storageId: i.storageId, alt: normalizeOptionalString(i.alt) }));
    if (existing) {
      await ctx.db.patch(existing._id, { gallery });
      return existing._id;
    }
    return await ctx.db.insert("eventContent", {
      eventId,
      organizerId: event.organizerId,
      ...emptyContent(),
      gallery,
    });
  },
});
```

- [ ] **Step 6: Stop `update` clobbering the cover.** In the `update` mutation's `patch` object (~line 162), REMOVE the line `coverImageUrl: normalizeOptionalString(args.coverImageUrl),`. Leave `coverImageUrl` in the `args` (optional, now ignored) so existing callers do not break. Add a comment: `// coverImageUrl/coverImageId/gallery are owned by the image mutations; update never writes them.`

- [ ] **Step 7: Run tests, verify pass** — `pnpm exec vitest run convex/eventContent.test.ts` → PASS. Then `pnpm exec convex codegen && pnpm exec tsc --noEmit` → no errors.

- [ ] **Step 8: Commit** — `git commit -m "feat(events): Convex storage mutations for cover image + gallery"`

---

### Task 2: Resolve media URLs in get + getBySlug

**Files:**
- Modify: `convex/eventContent.ts` (`get`, `getBySlug`, add a resolver helper)
- Test: `convex/eventContent.test.ts`

**Interfaces:**
- Produces: `get`/`getBySlug` results now include a resolved `coverImageUrl?: string` and `gallery: Array<{ url: string; alt?: string }>` (and no raw `coverImageId`/storage-id gallery).

- [ ] **Step 1: Write failing tests.**
```ts
test("get resolves an uploaded cover and gallery to urls", async () => {
  const t = convexTest(schema);
  const { eventId, owner } = await seedEvent(t);
  const [cover, g1] = await storeN(t, 2);
  await owner.mutation(api.eventContent.setCoverImage, { eventId, storageId: cover });
  await owner.mutation(api.eventContent.setGallery, { eventId, images: [{ storageId: g1, alt: "one" }] });
  const res = await owner.query(api.eventContent.get, { eventId });
  expect(res.coverImageUrl).toEqual(expect.stringContaining("http"));
  expect(res.gallery).toHaveLength(1);
  expect(res.gallery[0]).toMatchObject({ alt: "one", storageId: g1 }); // get keeps storageId
  expect(res.gallery[0].url).toEqual(expect.stringContaining("http"));
});

test("get falls back to a legacy coverImageUrl when there is no uploaded cover", async () => {
  const t = convexTest(schema);
  const { eventId, owner } = await seedEvent(t);
  await owner.mutation(api.eventContent.update, { eventId, agenda: [], speakers: [], faqs: [], coverImageUrl: "https://legacy.example/x.jpg" });
  // update no longer writes coverImageUrl (Task 1 step 6), so set it directly for the legacy case:
  await t.run((ctx) => ctx.db.query("eventContent").withIndex("by_event", (q) => q.eq("eventId", eventId)).unique()
    .then((row) => ctx.db.patch(row._id, { coverImageUrl: "https://legacy.example/x.jpg" })));
  const res = await owner.query(api.eventContent.get, { eventId });
  expect(res.coverImageUrl).toBe("https://legacy.example/x.jpg");
  expect(res.gallery).toEqual([]);
});
```

- [ ] **Step 2: Run to verify fail** — `pnpm exec vitest run convex/eventContent.test.ts` → the two new tests FAIL (no gallery/resolution yet).

- [ ] **Step 3: Implement the resolver + apply it.** The owner editor (`get`) needs each gallery entry's `storageId` (to call `setGallery`); the public `getBySlug` must not leak it. So the resolver takes a `keepStorageId` flag. Add near the top helpers:
```ts
/** Resolve storage IDs to URLs for a content row (or the empty default). Uploaded
 *  cover wins over the legacy URL; gallery entries whose file is gone are dropped.
 *  `keepStorageId` includes each gallery entry's storageId (owner editor only). */
async function withResolvedMedia(
  ctx: QueryCtx,
  content: Record<string, unknown> & { coverImageId?: Id<"_storage">; coverImageUrl?: string; gallery?: { storageId: Id<"_storage">; alt?: string }[] },
  keepStorageId: boolean,
) {
  const coverImageUrl = content.coverImageId
    ? ((await ctx.storage.getUrl(content.coverImageId)) ?? undefined)
    : content.coverImageUrl;
  const gallery = (
    await Promise.all(
      (content.gallery ?? []).map(async (g) => {
        const url = await ctx.storage.getUrl(g.storageId);
        if (!url) return null;
        return keepStorageId ? { storageId: g.storageId, url, alt: g.alt } : { url, alt: g.alt };
      }),
    )
  ).filter((g) => g !== null);
  const { coverImageId: _drop, gallery: _dropGallery, ...rest } = content;
  return { ...rest, coverImageUrl, gallery };
}
```
Then in `get`: replace `return content ?? emptyContent();` with `return withResolvedMedia(ctx, content ?? emptyContent(), true);`. In `getBySlug`: `return withResolvedMedia(ctx, content ?? emptyContent(), false);`. (`emptyContent()` has no image fields, so cover resolves to `undefined` and gallery to `[]`.)

- [ ] **Step 4: Run tests, verify pass** — `pnpm exec vitest run convex/eventContent.test.ts` → PASS. `pnpm exec convex codegen && pnpm exec tsc --noEmit` → no errors.

- [ ] **Step 5: Commit** — `git commit -m "feat(events): resolve cover + gallery storage urls in get/getBySlug"`

---

### Task 3: Delete cover + gallery files on event deletion

**Files:**
- Modify: `convex/events.ts` (`deleteEvent`)
- Test: `convex/events.test.ts` (or the file where deleteEvent is tested)

- [ ] **Step 1: Write a failing test** that seeds an event with an uploaded cover + one gallery image, deletes the event, and asserts both storage files are gone (`ctx.storage.getUrl` returns null). Reuse `storeN` and the existing deleteEvent test setup.

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement.** In `deleteEvent`, before deleting the `eventContent` row (or wherever content is cleaned up), load the content row and delete its files:
```ts
const content = await ctx.db.query("eventContent").withIndex("by_event", (q) => q.eq("eventId", eventId)).unique();
if (content?.coverImageId) await ctx.storage.delete(content.coverImageId);
for (const g of content?.gallery ?? []) await ctx.storage.delete(g.storageId);
```
Place this alongside the existing eventContent deletion in `deleteEvent` (match how the mutation currently cascades related rows).

- [ ] **Step 4: Run tests, verify pass.** `pnpm exec tsc --noEmit`.

- [ ] **Step 5: Commit** — `git commit -m "feat(events): purge cover + gallery files when an event is deleted"`

---

### Task 4: ImageDropzone component

**Files:**
- Create: `src/components/ImageDropzone.tsx`

**Interfaces:**
- Produces: `ImageDropzone({ eventId: Id<"events">, onUploaded: (storageId: Id<"_storage">) => void | Promise<void>, disabled?: boolean, label?: string, className?: string }): JSX.Element`

- [ ] **Step 1: Implement.**
```tsx
import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { ImagePlus, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";

const MAX_BYTES = 5 * 1024 * 1024;

export function ImageDropzone({
  eventId,
  onUploaded,
  disabled,
  label = "Drag an image here, or click to upload",
  className,
}: {
  eventId: Id<"events">;
  onUploaded: (storageId: Id<"_storage">) => void | Promise<void>;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  const generateUploadUrl = useMutation(api.eventContent.generateUploadUrl);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Images must be 5 MB or smaller");
      return;
    }
    setUploading(true);
    try {
      const url = await generateUploadUrl({ eventId });
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await onUploaded(storageId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <button
      type="button"
      disabled={disabled || uploading}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void handleFile(file);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-input p-6 text-sm text-muted-foreground transition-colors",
        "hover:border-ring hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        dragActive && "border-ring bg-accent/60",
        (disabled || uploading) && "pointer-events-none opacity-60",
        className,
      )}
    >
      {uploading ? <LoaderCircle className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
      <span>{uploading ? "Uploading…" : label}</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
      />
    </button>
  );
}
```

- [ ] **Step 2: Verify** — `pnpm exec tsc --noEmit`.

- [ ] **Step 3: Commit** — `git commit -m "feat(events): reusable ImageDropzone upload component"`

---

### Task 5: Cover upload in EventPagePanel

**Files:**
- Modify: `src/components/EventPagePanel.tsx`

**Interfaces:**
- Consumes: `ImageDropzone` (Task 4), `api.eventContent.setCoverImage` (Task 1), the resolved `coverImageUrl` from `api.eventContent.get` (Task 2).

- [ ] **Step 1: Remove `coverImageUrl` from the form.** Read the file first. In the zod schema (near the top, where `coverImageUrl`/`brandColor` are defined) remove the `coverImageUrl` field; remove it from `defaultValues`; and remove it from the `update({ ... })` call in `onSubmit`. (`update` still accepts it optionally, but we no longer send it.)

- [ ] **Step 2: Add the cover control.** Replace the `coverImageUrl` `FormField` (currently the "Cover image URL" `Input`, ~line 345-357) with a cover block driven by the query + a mutation. Add near the other hooks: `const setCoverImage = useMutation(api.eventContent.setCoverImage);` and read `data.coverImageUrl` (the component already has `const { data } = useQuery(convexQuery(api.eventContent.get, { eventId }))` at ~line 450 — thread the resolved `coverImageUrl` into the branding card, e.g. `const coverUrl = data?.coverImageUrl;`). Render:
```tsx
<div className="flex flex-col gap-2">
  <FormLabel>Cover image</FormLabel>
  {coverUrl ? (
    <div className="relative overflow-hidden rounded-lg border">
      <img src={coverUrl} alt="Cover preview" className="max-h-48 w-full object-cover" />
      <div className="absolute right-2 top-2 flex gap-2">
        <ImageDropzone eventId={eventId} label="Replace" className="border-0 bg-background/80 p-2 backdrop-blur"
          onUploaded={(storageId) => setCoverImage({ eventId, storageId })} />
        <Button type="button" variant="secondary" size="sm"
          onClick={() => setCoverImage({ eventId, storageId: null })}>Remove</Button>
      </div>
    </div>
  ) : (
    <ImageDropzone eventId={eventId} onUploaded={(storageId) => setCoverImage({ eventId, storageId })} />
  )}
</div>
```
Keep the `coverImageAlt` field (managed by `updateAccessibility`) exactly as it is. Add the `ImageDropzone` import and confirm `eventId` is in scope in the branding card (thread it down if the card is a subcomponent).

- [ ] **Step 3: Verify** — `pnpm exec tsc --noEmit`.

- [ ] **Step 4: Commit** — `git commit -m "feat(events): drag-and-drop cover upload in the page editor"`

---

### Task 6: Gallery manager in EventPagePanel

**Files:**
- Modify: `src/components/EventPagePanel.tsx`

**Interfaces:**
- Consumes: `ImageDropzone` (Task 4), `api.eventContent.setGallery` (Task 1), resolved `gallery` from `get` (Task 2).

- [ ] **Step 1: Add a Gallery card** after the Branding card. Add `const setGallery = useMutation(api.eventContent.setGallery);`. The owner `get` query already returns `gallery: Array<{ storageId, url, alt? }>` (Task 2, `keepStorageId: true`), so `data.gallery` carries the `storageId` needed to call `setGallery` directly — no separate local id-pairing model required.

  Implement the card:
```tsx
import { Reorder } from "motion/react";
// gallery: Array<{ storageId: Id<"_storage">; url: string; alt?: string }>
const gallery = data?.gallery ?? [];

function persist(next) {
  return setGallery({ eventId, images: next.map((g) => ({ storageId: g.storageId, alt: g.alt })) });
}
```
  Render a Card titled "Gallery" with:
  - A `Reorder.Group axis="y" values={gallery} onReorder={(next) => persist(next)}` of `Reorder.Item` tiles (one per image): thumbnail (`<img src={g.url} className="size-16 rounded object-cover" />`), an alt `Input` (persist on blur), and a Remove `Button` (`persist(gallery.filter((x) => x.storageId !== g.storageId))`, which drops + deletes the file server-side).
  - When `gallery.length < 8`, an `ImageDropzone` whose `onUploaded={(storageId) => persist([...gallery, { storageId, url: "", alt: undefined }])}` appends the new image (the query refetch replaces the placeholder `url` with the resolved one).
  - When `gallery.length >= 8`, show "Gallery is full (8 images)" and hide the dropzone.

- [ ] **Step 2: Verify** — `pnpm exec tsc --noEmit`.

- [ ] **Step 3: Commit** — `git commit -m "feat(events): reorderable gallery manager in the page editor"`

---

### Task 7: Public gallery section + resolved cover

**Files:**
- Modify: `src/routes/e/$slug.tsx`
- Modify: `src/components/EventMobilePreview.tsx` (verify only)

- [ ] **Step 1: Extend the public content type.** In `e/$slug.tsx`, the `PublicEventContent` type (~line 105) — add `gallery?: { url: string; alt?: string }[]`. `coverImageUrl` already exists and now carries the resolved value, so the cover `<img>` needs no change.

- [ ] **Step 2: Render the gallery section.** After the description block (before the Agenda section, ~line 200), add:
```tsx
{content && content.gallery && content.gallery.length > 0 && (
  <section className="mt-8">
    <h2 className="text-lg font-semibold">Gallery</h2>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {content.gallery.map((img, i) => (
        <img
          key={i}
          src={img.url}
          alt={img.alt || `${stripHtml(event.title)} photo ${i + 1}`}
          loading="lazy"
          className="aspect-square w-full rounded-lg object-cover ring-1 ring-border/60"
        />
      ))}
    </div>
  </section>
)}
```

- [ ] **Step 3: Verify EventMobilePreview** reads the resolved cover. It already uses `content.coverImageUrl` — confirm no change is needed (the resolved value flows through). Leave it unless it references a raw storage field.

- [ ] **Step 4: Verify** — `pnpm exec tsc --noEmit`.

- [ ] **Step 5: Commit** — `git commit -m "feat(events): render the gallery on the public event page"`

---

### Task 8: Final verification

- [ ] **Step 1:** `pnpm exec convex codegen && pnpm exec tsc --noEmit` → no errors.
- [ ] **Step 2:** `pnpm test` → all pass (existing + new convex tests).
- [ ] **Step 3:** `pnpm build` → succeeds.
- [ ] **Step 4: Manual smoke** (dev server, logged in): on an event's Page & design tab, drag an image onto the cover (uploads + preview), replace it, remove it; add several gallery images, drag to reorder, edit alt, remove one; open the public `/e/<slug>` and confirm the cover + gallery render; confirm a legacy pasted-URL cover on an older event still shows.

## Self-review notes

- Spec coverage: schema + upload URL + cover/gallery mutations + no-clobber `update` (Task 1); URL resolution (Task 2); delete cleanup (Task 3); ImageDropzone (Task 4); cover UI (Task 5); gallery UI (Task 6); public gallery + resolved cover (Task 7). All spec sections covered.
- The `get` resolver returns `storageId` per gallery entry for the editor (needed to call `setGallery`) via `keepStorageId: true`; `getBySlug` passes `false` and omits it. Both are set up in Task 2 (with the Task 2 test asserting the owner shape), so Task 6 consumes it without re-touching the backend.
- Types consistent across tasks: `generateUploadUrl`/`setCoverImage`/`setGallery` signatures, `ImageDropzone` props, resolved `gallery` shapes (`{url,alt}` public, `{storageId,url,alt}` owner).
- Storage cleanup on replace/remove/delete is covered by tests in Tasks 1 and 3.
