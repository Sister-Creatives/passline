# Logo Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two URL-typed image fields in Settings (Organization profile, Host profiles) with real file uploads backed by Convex file storage.

**Architecture:** Mirrors the existing `convex/eventContent.ts` cover-image pattern: an auth-checked `generateUploadUrl` mutation, a setter that deletes the replaced blob and clears the legacy URL, and a read path that prefers the uploaded file (`storage.getUrl(id)`) and falls back to the legacy URL. Schema changes are additive — no migration, no backfill. `ImageDropzone` is decoupled from `eventId` so all call sites share one component.

**Tech Stack:** Convex (mutations/queries, `ctx.storage`), React 19, TanStack Router/Query, react-hook-form + zod, shadcn/ui, Vitest + convex-test (edge-runtime).

**Design spec:** `docs/superpowers/specs/2026-07-17-logo-upload-design.md`

## Global Constraints

- `npx` is broken in this environment (a shell hook rewrites it to `npm run`). Always call binaries directly: `./node_modules/.bin/vitest`, `./node_modules/.bin/tsc`, `./node_modules/.bin/convex`.
- Convex tests are `// @vitest-environment edge-runtime` at line 1, use `convexTest(schema, modules)` with `const modules = import.meta.glob("./**/*.*s")`, and flat top-level `test()` calls — no `describe` blocks.
- Any test file that drives `api.rsvps.rsvp` must register the rate-limiter component. None of the files in this plan do, so this does not apply — do not add it.
- Doc comments explain rationale (why), not mechanics (what the next line does). Match surrounding style.
- TypeScript, double quotes, semicolons. Named exports. kebab-case for new `src/lib` files.
- Legacy `organizers.image` and `hostProfiles.logoUrl` fields are **never removed** and are **never written with a new value** — they are read-only fallbacks that get cleared (`undefined`) on upload.
- Do not modify the ~10 components that surface raw `error.message` (`TicketTypesPanel`, `RsvpForm`, `EventForm`, …). Out of scope.
- Baseline before starting: 502 tests passing across 39 files. Never finish a task with fewer.

---

### Task 1: Schema fields + organizer-scoped upload URL

**Files:**
- Modify: `convex/schema.ts:17-21` (organizers), `convex/schema.ts:351-358` (hostProfiles)
- Create: `convex/files.ts`
- Test: `convex/files.test.ts` (create)

**Interfaces:**
- Consumes: `getAuthOrganizerId` from `convex/auth.ts` (returns `Id<"organizers"> | null`).
- Produces: `api.files.generateUploadUrl` — mutation, no args, returns `string`. Throws `"Not authenticated"` when there is no authenticated organizer.

- [ ] **Step 1: Add the schema fields**

In `convex/schema.ts`, the `organizers` table becomes:

```ts
  organizers: defineTable({
    name: v.string(),
    email: v.string(),
    // Legacy URL (auto-seeded from the auth user's avatar in `ensureOrganizer`).
    // Read-only fallback: `imageId` wins when set. Never written with a new value.
    image: v.optional(v.string()),
    imageId: v.optional(v.id("_storage")),
  }).index("by_email", ["email"]),
```

And `hostProfiles` becomes:

```ts
  hostProfiles: defineTable({
    organizerId: v.id("organizers"),
    name: v.string(),
    bio: v.optional(v.string()), // <= 600 chars
    // Legacy https URL. Read-only fallback: `logoId` wins when set.
    logoUrl: v.optional(v.string()),
    logoId: v.optional(v.id("_storage")),
    websiteUrl: v.optional(v.string()), // https URL (validated)
    createdAt: v.number(),
  }).index("by_organizer", ["organizerId"]),
```

- [ ] **Step 2: Write the failing test**

Create `convex/files.test.ts`:

```ts
// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");

async function asOrganizer(t: TestConvex<typeof schema>, email: string) {
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, name: email });
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 });
    return { userId, sessionId };
  });
  return t.withIdentity({ subject: `${userId}|${sessionId}` });
}

test("generateUploadUrl requires an authenticated organizer", async () => {
  const t = convexTest(schema, modules);
  await expect(t.mutation(api.files.generateUploadUrl, {})).rejects.toThrow(/not authenticated/i);
});

test("generateUploadUrl returns an upload url for an authenticated organizer", async () => {
  const t = convexTest(schema, modules);
  const as = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const url = await as.mutation(api.files.generateUploadUrl, {});
  expect(typeof url).toBe("string");
  expect(url.length).toBeGreaterThan(0);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `./node_modules/.bin/vitest run convex/files.test.ts`
Expected: FAIL — `api.files` does not exist (module not found / property undefined).

- [ ] **Step 4: Write the minimal implementation**

Create `convex/files.ts`:

```ts
import { mutation } from "./_generated/server";
import { getAuthOrganizerId } from "./auth";

/**
 * Mint a one-shot upload URL for any signed-in organizer.
 *
 * Organizer-scoped rather than event-scoped (cf. `eventContent.generateUploadUrl`,
 * which gates on `requireOwnedEvent`) because the settings pages that use it --
 * the organization logo and host-profile logos -- aren't attached to an event.
 * Minting a URL grants no access to any row: the setters that persist a
 * `storageId` are the ones that enforce ownership.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");
    return await ctx.storage.generateUploadUrl();
  },
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `./node_modules/.bin/vitest run convex/files.test.ts`
Expected: PASS — 2 passed.

- [ ] **Step 6: Typecheck and commit**

```bash
./node_modules/.bin/tsc --noEmit
git add convex/schema.ts convex/files.ts convex/files.test.ts
git commit -m "feat(files): add organizer-scoped generateUploadUrl and storage id fields"
```

---

### Task 2: `organizers.setImage` + resolved read path

**Files:**
- Modify: `convex/organizers.ts:37-50` (`updateProfile`), `convex/organizers.ts:52-59` (`getMe`), `convex/organizers.ts:111-118` (`getPublicProfile`)
- Test: `convex/organizers.test.ts` (append)

**Interfaces:**
- Consumes: `api.files.generateUploadUrl` (Task 1); `imageId` field on `organizers` (Task 1).
- Produces:
  - `api.organizers.setImage({ storageId: Id<"_storage"> | null })` → `null`. Throws `"Not authenticated"`.
  - `api.organizers.updateProfile({ name: string })` → `null`. **The `image` arg is removed.**
  - `api.organizers.getMe` → `{ _id, _creationTime, name, email, image?, imageId? }` where `image` is the **resolved** URL string. Same field name and type as before.
  - `api.organizers.getPublicProfile({ organizerId })` → `{ name, image? } | null`, `image` resolved.

- [ ] **Step 1: Write the failing tests**

Append to `convex/organizers.test.ts` (the file already defines `asOrganizer`, `modules`, and imports `api`/`schema` — do not redefine them):

```ts
test("setImage stores the storage id and clears the legacy image url", async () => {
  const t = convexTest(schema, modules);
  const as = await asOrganizer(t, "ada@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});
  await t.run(async (ctx) => {
    await ctx.db.patch(organizerId, { image: "https://legacy.example.com/old.png" });
  });

  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  await as.mutation(api.organizers.setImage, { storageId });

  const row = await t.run((ctx) => ctx.db.get(organizerId));
  expect(row?.imageId).toBe(storageId);
  expect(row?.image).toBeUndefined();
});

test("setImage deletes the blob it replaces", async () => {
  const t = convexTest(schema, modules);
  const as = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  const first = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  await as.mutation(api.organizers.setImage, { storageId: first });
  const second = await t.run((ctx) => ctx.storage.store(new Blob(["b"], { type: "image/png" })));
  await as.mutation(api.organizers.setImage, { storageId: second });

  expect(await t.run((ctx) => ctx.storage.getUrl(first))).toBeNull();
  expect(await t.run((ctx) => ctx.storage.getUrl(second))).not.toBeNull();
});

test("setImage with null removes the logo and deletes the blob", async () => {
  const t = convexTest(schema, modules);
  const as = await asOrganizer(t, "ada@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});

  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  await as.mutation(api.organizers.setImage, { storageId });
  await as.mutation(api.organizers.setImage, { storageId: null });

  const row = await t.run((ctx) => ctx.db.get(organizerId));
  expect(row?.imageId).toBeUndefined();
  expect(await t.run((ctx) => ctx.storage.getUrl(storageId))).toBeNull();
});

test("setImage requires authentication", async () => {
  const t = convexTest(schema, modules);
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  await expect(t.mutation(api.organizers.setImage, { storageId })).rejects.toThrow(/not authenticated/i);
});

test("getMe prefers the uploaded image over the legacy url", async () => {
  const t = convexTest(schema, modules);
  const as = await asOrganizer(t, "ada@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});
  await t.run(async (ctx) => {
    await ctx.db.patch(organizerId, { image: "https://legacy.example.com/old.png" });
  });

  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  await as.mutation(api.organizers.setImage, { storageId });

  const me = await as.query(api.organizers.getMe, {});
  expect(me?.image).not.toBe("https://legacy.example.com/old.png");
  expect(me?.image).toBeTruthy();
});

test("getMe falls back to the legacy url when nothing is uploaded", async () => {
  const t = convexTest(schema, modules);
  const as = await asOrganizer(t, "ada@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});
  await t.run(async (ctx) => {
    await ctx.db.patch(organizerId, { image: "https://legacy.example.com/old.png" });
  });

  const me = await as.query(api.organizers.getMe, {});
  expect(me?.image).toBe("https://legacy.example.com/old.png");
});

test("getPublicProfile resolves the uploaded image", async () => {
  const t = convexTest(schema, modules);
  const as = await asOrganizer(t, "ada@example.com");
  const organizerId = await as.mutation(api.organizers.ensureOrganizer, {});
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  await as.mutation(api.organizers.setImage, { storageId });

  const profile = await t.query(api.organizers.getPublicProfile, { organizerId });
  expect(profile?.image).toBeTruthy();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./node_modules/.bin/vitest run convex/organizers.test.ts`
Expected: FAIL — `api.organizers.setImage` is not a function / property does not exist.

- [ ] **Step 3: Implement `setImage` and the resolved read path**

In `convex/organizers.ts`, replace `updateProfile` (lines 32-50) with:

```ts
/**
 * Update the signed-in organizer's own name. Name is required and trimmed.
 *
 * The logo is deliberately NOT settable here -- it's a file now, applied
 * immediately by `setImage` (mirroring `eventContent.setCoverImage`) so an
 * upload can't be stranded in storage by navigating away without saving.
 */
export const updateProfile = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error("Name is required");
    await ctx.db.patch(organizerId, { name: trimmedName });
    return null;
  },
});

/**
 * Set (or clear, with null) the organizer's uploaded logo.
 *
 * Deletes the blob it replaces so storage doesn't accumulate orphans, and
 * clears the legacy `image` URL so resolution is unambiguous -- the same
 * contract as `eventContent.setCoverImage`.
 */
export const setImage = mutation({
  args: { storageId: v.union(v.id("_storage"), v.null()) },
  handler: async (ctx, { storageId }) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");
    const organizer = await ctx.db.get(organizerId);
    const prev = organizer?.imageId;
    if (prev && prev !== storageId) await ctx.storage.delete(prev);
    await ctx.db.patch(organizerId, {
      imageId: storageId ?? undefined,
      image: undefined,
    });
    return null;
  },
});
```

Then replace `getMe` (lines 52-59) with:

```ts
/**
 * The signed-in organizer. `image` is the resolved logo URL: the uploaded file
 * when present, otherwise the legacy URL, so callers keep receiving a plain
 * string and don't need to know which storage era a row is from.
 */
export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return null;
    const organizer = await ctx.db.get(organizerId);
    if (!organizer) return null;
    return {
      ...organizer,
      image: organizer.imageId
        ? ((await ctx.storage.getUrl(organizer.imageId)) ?? undefined)
        : organizer.image,
    };
  },
});
```

And replace `getPublicProfile` (lines 111-118) with:

```ts
export const getPublicProfile = query({
  args: { organizerId: v.id("organizers") },
  handler: async (ctx, { organizerId }) => {
    const organizer = await ctx.db.get(organizerId);
    if (!organizer) return null;
    return {
      name: organizer.name,
      image: organizer.imageId
        ? ((await ctx.storage.getUrl(organizer.imageId)) ?? undefined)
        : organizer.image,
    };
  },
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./node_modules/.bin/vitest run convex/organizers.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Fix the now-broken `updateProfile` caller**

`src/routes/settings/profile.tsx:36` still passes `image`. Typecheck will fail until Task 4. To keep this task independently green, change only that call now:

```ts
      await updateProfile({ name: name.trim() });
```

- [ ] **Step 6: Typecheck and commit**

```bash
./node_modules/.bin/tsc --noEmit
git add convex/organizers.ts convex/organizers.test.ts src/routes/settings/profile.tsx
git commit -m "feat(organizers): add setImage and resolve logo from storage"
```

---

### Task 3: Decouple `ImageDropzone` from `eventId`

**Files:**
- Modify: `src/components/ImageDropzone.tsx:12-52` (props + `handleFile`)
- Modify: `src/components/EventPagePanel.tsx:376-381, 452-458, 466-472` (three call sites)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ImageDropzone` props become
  `{ getUploadUrl: () => Promise<string>; onUploaded: (storageId: Id<"_storage">) => void | Promise<void>; disabled?: boolean; label?: string; className?: string }`.
  The `eventId: Id<"events">` prop is **removed**.

- [ ] **Step 1: Change the component's props**

In `src/components/ImageDropzone.tsx`, remove the `useMutation`/`api` import usage and swap the prop. The file's top becomes:

```tsx
import { useRef, useState } from "react";
import { ImagePlus, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import type { Id } from "../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * The upload URL is injected rather than minted here: the event page mints an
 * event-scoped one, the settings pages an organizer-scoped one. Keeping that
 * choice with the caller is what lets all three share this component.
 */
export function ImageDropzone({
  getUploadUrl,
  onUploaded,
  disabled,
  label = "Drag an image here, or click to upload",
  className,
}: {
  getUploadUrl: () => Promise<string>;
  onUploaded: (storageId: Id<"_storage">) => void | Promise<void>;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
```

Then in `handleFile`, replace the `generateUploadUrl({ eventId })` line:

```tsx
      const url = await getUploadUrl();
```

Everything else in the file (validation, drag handlers, a11y, JSX) is unchanged.

- [ ] **Step 2: Update the three EventPagePanel call sites**

`EventPagePanel` must now mint the URL itself. Near its other `useMutation` calls add:

```tsx
  const generateUploadUrl = useMutation(api.eventContent.generateUploadUrl);
```

Then at each of the three `<ImageDropzone ... />` sites, replace `eventId={eventId}` with:

```tsx
          getUploadUrl={() => generateUploadUrl({ eventId })}
```

Leave every other prop (`label`, `className`, `onUploaded`) exactly as-is.

- [ ] **Step 3: Verify nothing else references the old prop**

Run: `grep -rn "eventId=" src/components/EventPagePanel.tsx | grep -i dropzone`
Expected: no output.

Run: `grep -rn "ImageDropzone" src/`
Expected: only the definition and `EventPagePanel` (3 usages + 1 import).

- [ ] **Step 4: Typecheck and run the suite**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: clean — if `eventId` is still passed anywhere, this fails.

Run: `./node_modules/.bin/vitest run`
Expected: PASS — same count as baseline (no test covers this component directly; this step guards against regressions).

- [ ] **Step 5: Commit**

```bash
git add src/components/ImageDropzone.tsx src/components/EventPagePanel.tsx
git commit -m "refactor(dropzone): inject upload url so non-event pages can reuse it"
```

---

### Task 4: Organization profile page — upload the logo

**Files:**
- Modify: `src/routes/settings/profile.tsx` (whole component)

**Interfaces:**
- Consumes: `api.files.generateUploadUrl` (Task 1); `api.organizers.setImage`, `api.organizers.updateProfile({ name })`, `api.organizers.getMe` (Task 2); `ImageDropzone`'s `getUploadUrl` prop (Task 3).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace the Logo URL input with the dropzone**

In `src/routes/settings/profile.tsx`:

Add imports:

```tsx
import { ImageDropzone } from "@/components/ImageDropzone";
```

Add the mutations beside the existing `updateProfile`:

```tsx
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const setImage = useMutation(api.organizers.setImage);
```

Delete the `image` state (`const [image, setImage] = React.useState("")` — note it collides with the mutation name) and read the logo straight from the query instead. The state block becomes:

```tsx
  const [name, setName] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!me) return;
    setName(me.name ?? "");
  }, [me]);

  const logoUrl = me?.image ?? undefined;
```

Replace the whole "Logo URL" `div` (lines 89-98 in the current file) with:

```tsx
            <div className="space-y-2">
              <Label>Logo</Label>
              <ImageDropzone
                getUploadUrl={() => generateUploadUrl({})}
                onUploaded={async (storageId) => {
                  await setImage({ storageId });
                  toast.success("Logo updated");
                }}
                label={logoUrl ? "Drop a new image to replace" : "Drag an image here, or click to upload"}
              />
              {logoUrl ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await setImage({ storageId: null });
                    toast.success("Logo removed");
                  }}
                >
                  Remove logo
                </Button>
              ) : null}
              <p className="text-xs text-muted-foreground">Shown on your public event pages.</p>
            </div>
```

Update the `Avatar` preview (line 78) to use `logoUrl`:

```tsx
              {logoUrl ? <AvatarImage src={logoUrl} /> : null}
```

Confirm `save()` reads (it was already changed in Task 2 Step 5):

```tsx
      await updateProfile({ name: name.trim() });
```

- [ ] **Step 2: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: clean. If it complains that `image` is unused or `setImage` is redeclared, the old `React.useState` line was not deleted.

- [ ] **Step 3: Run the suite**

Run: `./node_modules/.bin/vitest run`
Expected: PASS — baseline count.

- [ ] **Step 4: Commit**

```bash
git add src/routes/settings/profile.tsx
git commit -m "feat(settings): upload the organization logo instead of pasting a url"
```

---

### Task 5: `hostProfiles` — `logoId` end-to-end (backend + panel)

> **Scope note:** the backend arg change and the panel wiring ship in ONE task
> because splitting them would leave typecheck red at the task boundary. Both
> the tests AND `tsc --noEmit` must be green before this task is committed.

**Files:**
- Modify: `convex/hostProfiles.ts:14-39` (`validateFields`), `:55-81` (`create`), `:97-121` (`update`), `:123-141` (`remove`), `:83-95` (`listMine`), `:152-170` (`getForEvent`)
- Modify: `src/components/HostProfilesPanel.tsx:63-68` (form schema), `:99-125` (defaults + submit), `:163-172` (the logo field)
- Test: `convex/hostProfiles.test.ts` (append)

**Interfaces:**
- Consumes: `logoId` field on `hostProfiles` (Task 1).
- Produces:
  - `api.hostProfiles.create({ name, bio?, logoId?, websiteUrl? })` → `Id<"hostProfiles">`. **`logoUrl` arg removed**, `logoId: v.optional(v.id("_storage"))` added.
  - `api.hostProfiles.update({ hostProfileId, name, bio?, logoId?, websiteUrl? })` → `null`. Same swap.
  - `api.hostProfiles.listMine` → array of `{ ...doc, logoUrl }` with `logoUrl` **resolved**.
  - `api.hostProfiles.getForEvent({ eventId })` → `{ name, bio?, logoUrl?, websiteUrl? } | null`, `logoUrl` resolved.

- [ ] **Step 1: Write the failing tests**

Append to `convex/hostProfiles.test.ts` (reuse the file's existing helpers — do not redefine `asOrganizer`/`modules`):

```ts
test("create stores an uploaded logo id", async () => {
  const t = convexTest(schema, modules);
  const as = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const logoId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));

  const id = await as.mutation(api.hostProfiles.create, { name: "Acme", logoId });
  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row?.logoId).toBe(logoId);
});

test("update deletes the logo blob it replaces and clears the legacy url", async () => {
  const t = convexTest(schema, modules);
  const as = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const first = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  const id = await as.mutation(api.hostProfiles.create, { name: "Acme", logoId: first });
  await t.run(async (ctx) => {
    await ctx.db.patch(id, { logoUrl: "https://legacy.example.com/old.png" });
  });

  const second = await t.run((ctx) => ctx.storage.store(new Blob(["b"], { type: "image/png" })));
  await as.mutation(api.hostProfiles.update, { hostProfileId: id, name: "Acme", logoId: second });

  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row?.logoId).toBe(second);
  expect(row?.logoUrl).toBeUndefined();
  expect(await t.run((ctx) => ctx.storage.getUrl(first))).toBeNull();
});

test("remove deletes the profile's logo blob", async () => {
  const t = convexTest(schema, modules);
  const as = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const logoId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  const id = await as.mutation(api.hostProfiles.create, { name: "Acme", logoId });

  await as.mutation(api.hostProfiles.remove, { hostProfileId: id });

  expect(await t.run((ctx) => ctx.storage.getUrl(logoId))).toBeNull();
});

test("setting a logo on another organizer's profile is rejected", async () => {
  const t = convexTest(schema, modules);
  const ada = await asOrganizer(t, "ada@example.com");
  await ada.mutation(api.organizers.ensureOrganizer, {});
  const id = await ada.mutation(api.hostProfiles.create, { name: "Acme" });

  const bob = await asOrganizer(t, "bob@example.com");
  await bob.mutation(api.organizers.ensureOrganizer, {});
  const logoId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));

  await expect(
    bob.mutation(api.hostProfiles.update, { hostProfileId: id, name: "Acme", logoId }),
  ).rejects.toThrow(/not found/i);
});

test("listMine resolves an uploaded logo to a url", async () => {
  const t = convexTest(schema, modules);
  const as = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const logoId = await t.run((ctx) => ctx.storage.store(new Blob(["a"], { type: "image/png" })));
  await as.mutation(api.hostProfiles.create, { name: "Acme", logoId });

  const rows = await as.query(api.hostProfiles.listMine, {});
  expect(rows[0]?.logoUrl).toBeTruthy();
});

test("listMine falls back to the legacy logo url", async () => {
  const t = convexTest(schema, modules);
  const as = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const id = await as.mutation(api.hostProfiles.create, { name: "Acme" });
  await t.run(async (ctx) => {
    await ctx.db.patch(id, { logoUrl: "https://legacy.example.com/old.png" });
  });

  const rows = await as.query(api.hostProfiles.listMine, {});
  expect(rows[0]?.logoUrl).toBe("https://legacy.example.com/old.png");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./node_modules/.bin/vitest run convex/hostProfiles.test.ts`
Expected: FAIL — `logoId` is not a valid arg for `create`.

- [ ] **Step 3: Drop `logoUrl` from `validateFields`**

In `convex/hostProfiles.ts`, `validateFields` becomes (note the doc comment loses its `logoUrl` claim):

```ts
/**
 * Trim and validate the optional fields shared by `create`/`update`: `bio`
 * must be <= MAX_BIO_LENGTH characters after trim, and `websiteUrl`, when
 * present, must start with `https://` (mirrors `virtualHub.ts`'s `meetingUrl`
 * guard -- blocks `http://`, `javascript:`, `data:`, etc). These are direct
 * create/update args (not a clear-or-set patch), so every value the caller
 * actually passed is validated as given, not silently dropped.
 *
 * The logo is no longer a URL -- it's an uploaded file (`logoId`), so there is
 * nothing to validate: the id's existence is enforced by the storage type.
 */
function validateFields(args: { bio?: string; websiteUrl?: string }) {
  const bio = normalizeOptionalString(args.bio);
  if (bio !== undefined && bio.length > MAX_BIO_LENGTH) {
    throw new Error(`Bio must be ${MAX_BIO_LENGTH} characters or fewer`);
  }

  const websiteUrl = normalizeOptionalString(args.websiteUrl);
  if (websiteUrl !== undefined && !websiteUrl.startsWith("https://")) {
    throw new Error("Website URL must start with https://");
  }

  return { bio, websiteUrl };
}
```

- [ ] **Step 4: Swap the arg on `create` and `update`**

`create` becomes:

```ts
export const create = mutation({
  args: {
    name: v.string(),
    bio: v.optional(v.string()),
    logoId: v.optional(v.id("_storage")),
    websiteUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");

    const name = args.name.trim();
    if (name.length === 0) throw new Error("Name is required");

    const { bio, websiteUrl } = validateFields(args);

    return ctx.db.insert("hostProfiles", {
      organizerId,
      name,
      bio,
      logoId: args.logoId,
      websiteUrl,
      createdAt: Date.now(),
    });
  },
});
```

`update` becomes — note it deletes the replaced blob and clears the legacy URL, mirroring `setCoverImage`:

```ts
/**
 * Owner-only: re-validate and patch every field of an existing host profile.
 *
 * Deletes the logo blob it replaces so storage doesn't accumulate orphans, and
 * clears the legacy `logoUrl` so resolution is unambiguous.
 */
export const update = mutation({
  args: {
    hostProfileId: v.id("hostProfiles"),
    name: v.string(),
    bio: v.optional(v.string()),
    logoId: v.optional(v.id("_storage")),
    websiteUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await requireOwnedHostProfile(ctx, args.hostProfileId);

    const name = args.name.trim();
    if (name.length === 0) throw new Error("Name is required");

    const { bio, websiteUrl } = validateFields(args);

    const prev = profile.logoId;
    if (prev && prev !== args.logoId) await ctx.storage.delete(prev);

    await ctx.db.patch(args.hostProfileId, {
      name,
      bio,
      logoId: args.logoId,
      logoUrl: undefined,
      websiteUrl,
    });
    return null;
  },
});
```

- [ ] **Step 5: Delete the blob in `remove`**

In `remove`, add the storage delete immediately before `ctx.db.delete(hostProfileId)`:

```ts
    // Mirrors events.deleteEvent, which deletes coverImageId + gallery blobs on
    // delete: without this the logo file outlives every reference to it.
    if (profile.logoId) await ctx.storage.delete(profile.logoId);

    await ctx.db.delete(hostProfileId);
```

- [ ] **Step 6: Resolve the logo in `listMine` and `getForEvent`**

`listMine` becomes:

```ts
/** Owner-only: the caller's host profiles, newest first. `[]` when unauthenticated (mirrors `listMyEvents`).
 *  `logoUrl` is resolved: the uploaded file when present, else the legacy URL. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return [];
    const rows = await ctx.db
      .query("hostProfiles")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .order("desc")
      .collect();
    return await Promise.all(
      rows.map(async (row) => ({
        ...row,
        logoUrl: row.logoId ? ((await ctx.storage.getUrl(row.logoId)) ?? undefined) : row.logoUrl,
      })),
    );
  },
});
```

`getForEvent`'s return becomes:

```ts
    return {
      name: profile.name,
      bio: profile.bio,
      logoUrl: profile.logoId
        ? ((await ctx.storage.getUrl(profile.logoId)) ?? undefined)
        : profile.logoUrl,
      websiteUrl: profile.websiteUrl,
    };
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `./node_modules/.bin/vitest run convex/hostProfiles.test.ts`
Expected: PASS.

- [ ] **Step 8: Swap `logoUrl` for `logoId` in the form schema**

In `src/components/HostProfilesPanel.tsx`, the schema becomes — `logoId` is a plain optional string in the form (it holds a storage id, validated server-side by the `v.id("_storage")` type):

```tsx
const hostProfileFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  bio: z.string().max(MAX_BIO_LENGTH, `Bio must be ${MAX_BIO_LENGTH} characters or fewer`),
  logoId: z.string().optional(),
  websiteUrl: optionalHttpsUrl,
});
```

If `optionalHttpsUrl` is now referenced only by `websiteUrl`, leave it — it is still used.

- [ ] **Step 9: Update defaults and submit**

Add the upload mutation near the component's other hooks:

```tsx
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
```

Defaults (currently `logoUrl: hostProfile.logoUrl ?? ""` / `logoUrl: ""`) become:

```tsx
          logoId: hostProfile.logoId ?? undefined,
```

and for the create case:

```tsx
          logoId: undefined,
```

In submit, delete the `const logoUrl = toOptional(values.logoUrl);` line and pass `logoId` straight through to both calls:

```tsx
        await update({
          hostProfileId: hostProfile._id,
          name: values.name,
          bio,
          logoId: values.logoId as Id<"_storage"> | undefined,
          websiteUrl,
        });
```

```tsx
        await create({
          name: values.name,
          bio,
          logoId: values.logoId as Id<"_storage"> | undefined,
          websiteUrl,
        });
```

Add the `Id` type import if not present:

```tsx
import type { Id } from "../../convex/_generated/dataModel";
```

- [ ] **Step 10: Replace the logo URL field with the dropzone**

Replace the `FormField` for `logoUrl` (the one rendering `<Input placeholder="https://example.com/logo.png" {...field} />`) with:

```tsx
            <FormField
              control={form.control}
              name="logoId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Logo</FormLabel>
                  <FormControl>
                    <ImageDropzone
                      getUploadUrl={() => generateUploadUrl({})}
                      onUploaded={(storageId) => field.onChange(storageId)}
                      label={field.value ? "Logo ready — drop a new image to replace" : "Drag an image here, or click to upload"}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
```

Add the import:

```tsx
import { ImageDropzone } from "@/components/ImageDropzone";
```

- [ ] **Step 11: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: clean. This is the step that proves Task 5's arg change is fully wired.

- [ ] **Step 12: Run the full suite**

Run: `./node_modules/.bin/vitest run`
Expected: PASS — baseline 502 plus the tests added in Tasks 1/2/5 (≈517), 41 files.

- [ ] **Step 13: Commit**

```bash
git add src/components/HostProfilesPanel.tsx
git commit -m "feat(settings): upload host profile logos instead of pasting urls"
```

---

### Task 6: Verify end-to-end in the real app

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Confirm the whole suite and typecheck are green**

Run: `./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit`
Expected: all tests pass, tsc silent.

- [ ] **Step 2: Push the Convex schema to dev**

Run: `./node_modules/.bin/convex codegen`
Expected: completes through "Running TypeScript..." with no error. This proves the additive schema change validates against existing dev data — if an existing row violated the new schema, this is where it fails.

- [ ] **Step 3: Drive the real flow**

Use the `verify` skill (or `run`) to start the app and exercise:
1. Settings → Organization profile → drop an image → avatar preview updates, toast "Logo updated".
2. Reload → logo persists.
3. "Remove logo" → avatar falls back to the letter, toast "Logo removed".
4. Settings → Host profiles → create a profile with a logo → it appears in the list.
5. Edit that profile, replace the logo → new logo shows.

Expected: each step behaves as described. Note the app needs a signed-in organizer — the dev deployment's `authAccounts` may be empty, so sign UP rather than sign in.

- [ ] **Step 4: Commit any fixes, then report**

If steps 3's flows revealed bugs, fix them with a test first (return to the relevant task's pattern), then re-run the suite.

---

## Notes for the implementer

- **Do not remove `organizers.image` or `hostProfiles.logoUrl`.** They are read-only fallbacks. Tests in Tasks 2 and 5 assert the fallback works; deleting the fields will fail them.
- **`profile.tsx` has a name collision.** Its existing `const [image, setImage] = React.useState("")` shadows the new `setImage` mutation. Task 4 Step 1 deletes the state — if you see "setImage is not a function", that's why.
- **Task 5 ships backend + panel together** precisely so typecheck is never left red at a task boundary. Both `vitest run` and `tsc --noEmit` must be green before it commits.
- **Orphaned blob on dialog cancel is accepted**, by explicit decision — see the design spec §9. Do not build a cleanup mechanism.
