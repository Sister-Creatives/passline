# Passline → Headless Ticketing — F21c: Host profiles

- **Date:** 2026-07-15
- **Status:** Approved design (slice c — final slice of full Humanitix editor parity)
- **Slice:** F21c — reusable **host profiles** (who is hosting the event): create/manage them, attach
  one to an event in the Event Information form, and show it on the public event page.

## 1. Goal

Match Humanitix's "Host profile" concept: an organizer creates reusable host profiles (name, logo,
bio, website), selects one per event, and attendees see a "Hosted by" block on the public event
page. Closes the last gap in the Event Information form.

## 2. Scope

**In:** a `hostProfiles` table + `events.hostProfileId`; owner-scoped CRUD
(`create`/`listMine`/`update`/`remove`) + a **public** `getForEvent`; `updateEvent` accepts an
(ownership-validated) `hostProfileId`; a **Host profiles** settings page to manage them; a host-profile
`Select` in the Event Information form; a "Hosted by" block on `/e/$slug`.

**Out:** multiple hosts per event (one profile per event); social links beyond a single website;
per-profile analytics; migrating the existing F16 `/host/$organizerId` public directory (unchanged).

## 3. Data model (`convex/schema.ts`)

```ts
hostProfiles: defineTable({
  organizerId: v.id("organizers"),
  name: v.string(),
  bio: v.optional(v.string()),        // <= 600 chars
  logoUrl: v.optional(v.string()),    // https URL (validated)
  websiteUrl: v.optional(v.string()), // https URL (validated)
  createdAt: v.number(),
}).index("by_organizer", ["organizerId"]),
```
Add `hostProfileId: v.optional(v.id("hostProfiles"))` to the `events` table (additive).

## 4. Backend (`convex/hostProfiles.ts`, new)

Owner-scoped via `getAuthOrganizerId` (mirror `checkoutQuestions`/`promoCodes` ownership style). URL
validation: accept only `https://…` (reuse/mirror the existing URL-scheme guard used elsewhere, e.g.
`virtualHub`/`eventContent`); reject other schemes; `bio` ≤ 600.

- `create({ name, bio?, logoUrl?, websiteUrl? }) → Id<"hostProfiles">` — `name` non-empty; validates
  URLs/bio; stamps `organizerId` + `createdAt`.
- `listMine() → Doc<"hostProfiles">[]` — the caller's profiles, newest first; `[]` when unauthenticated.
- `update({ hostProfileId, name, bio?, logoUrl?, websiteUrl? }) → null` — owner-only; re-validates.
- `remove({ hostProfileId }) → null` — owner-only. Before delete, clear `hostProfileId` on any of the
  organizer's events that reference it (query `events` by_organizer, patch matches to `undefined`) so
  no event dangles a deleted profile.
- `getForEvent({ eventId }) → { name, bio?, logoUrl?, websiteUrl? } | null` — **public**, published
  events only (mirror `checkoutQuestions.listForEvent`'s published gate): resolves the event's
  `hostProfileId` to a narrow public projection (never leaks `organizerId`/ids). `null` when the event
  is unpublished, has no host profile, or the profile was deleted.

**`updateEvent` (`convex/events.ts`)**: add optional `hostProfileId?` arg. An `v.id("hostProfiles")`
value must belong to the caller's organizer (load it; reject if not owned) → patch it; a literal
sentinel for "none" — accept `hostProfileId: null`-style clear via an explicit optional: use
`v.optional(v.union(v.id("hostProfiles"), v.null()))` where `null` clears to `undefined` and omitted
leaves untouched. Keep all existing behavior.

## 5. Frontend

### 5.1 Host profiles settings page
- Route `src/routes/settings/host-profiles.tsx` (inside `DashboardLayout`), added to the Settings nav
  group in `src/components/app-shared.tsx` (a new item "Host profiles").
- `src/components/HostProfilesPanel.tsx`: list (`listMine`) with `Skeleton`/`Empty`; a create/edit
  `Sheet` (name, bio `Textarea`, logo URL, website URL `Input`s, react-hook-form + zod); delete via
  `AlertDialog`. Mirrors `TicketTypesPanel`/`CheckoutQuestionsPanel` structure.

### 5.2 Selector in the Event Information form (`src/components/EventForm.tsx`, edit mode)
- A **Host profile** `Select` populated from `listMine` (+ a "None" option → clears), defaulting to
  `event.hostProfileId`. On submit, pass `hostProfileId` (the id, or `null` to clear) to `updateEvent`.
- If the organizer has no profiles yet, show a hint linking to `/settings/host-profiles`.

### 5.3 Public "Hosted by" block (`src/routes/e/$slug.tsx`)
- Add `useSuspenseQuery(convexQuery(api.hostProfiles.getForEvent, { eventId: event._id }))`. When
  non-null, render a "Hosted by" section (logo avatar, name, bio, website link) among the existing
  content sections. Reuse `Avatar`/`Card` like the Speakers block. No change to other content.

## 6. Testing

- **`convex/hostProfiles.test.ts`** (new): create validates name/URL-scheme/bio; `listMine` is
  owner-scoped + newest-first; `update`/`remove` owner-only; `remove` clears the id on referencing
  events; `getForEvent` returns the public projection for a published event with a profile, `null`
  for unpublished / no-profile / deleted-profile, and leaks no ids; a non-owner can't create/update/
  remove. **`convex/events.test.ts`** (append): `updateEvent` assigns an owned `hostProfileId`,
  rejects one owned by another organizer, and clears with `null`.
- **Frontend** via `tsc` + `build` + manual drive: create a profile in settings, attach it to an
  event, confirm the "Hosted by" block on `/e/$slug`, delete the profile → event's selection clears.

## 7. Constraints

Carried: pnpm only; shadcn/ui (`Sheet`, `Select`, `Textarea`, `Input`, `AlertDialog`, `Avatar`,
`Card`, `Skeleton`, `Empty`); lucide icons; plain `Error`; English, no emojis; Conventional Commits;
root `tsconfig` `noUnusedLocals`/`noUnusedParameters` (tsc clean). Additive schema (all optional/new
table — no migration). URL fields accept `https://` only. TDD the backend before the UI.

## 8. Delivery

Three tasks: (1) schema + `hostProfiles.ts` CRUD + `getForEvent` + `updateEvent.hostProfileId` +
tests; (2) Host profiles settings page + panel; (3) EventForm selector + public "Hosted by" block.
`pnpm test` + `tsc` + `build` green → drive-verify → **full Humanitix editor parity complete**.
