# Passline → Settings page: polish + more options

- **Date:** 2026-07-18
- **Status:** Approved design
- **Slice:** Restructure `settings/profile` into a professional sectioned page and add
  three genuinely-wired settings groups: event defaults, appearance, and account.

## 1. Goal

The org profile settings page is a single card with name, logo, and a disabled email.
Make it a professional, sectioned settings page and add useful, real settings — no
fields that store data and do nothing.

## 2. Scope

**In:** four section cards on `src/routes/settings/profile.tsx` — Organization, Event
defaults, Appearance, Account. Backend for event defaults (3 optional `organizers`
fields + a preferences mutation + `createEvent` gaining optional `currency`), and
prefilling the create-event form from those defaults.

**Out (deliberately):** timezone (events have no timezone concept — a stored default
would be dead); notification toggles (nothing to wire them to); account deletion
(destructive); changing email/password (handled by the auth provider). Public
profile/social links were considered and dropped by the requester.

## 3. Sections

### Organization (polish of what exists)
Name (`updateProfile`), logo (existing `ImageDropzone` → `setImage`), email (read-only).
Restyled into a titled section card matching the app's `Card`/`CardHeader` idiom.

### Event defaults (NEW — fully wired)
Default **location**, **capacity**, **currency**. Stored on the organizer and used to
**prefill the Create-event form**, so an organizer running similar events doesn't retype
them.
- Location and capacity are visible fields in the create form → prefilled as the form's
  default values.
- Currency is not a create-form field (create mode stays minimal); the organizer's
  default currency is applied to the new event's `currency` at creation instead of the
  hardcoded `"USD"`.

### Appearance (NEW — wired to next-themes)
Theme: **System / Light / Dark**, driven by `useTheme()` from next-themes (already the
app's theme system; persists to localStorage). No schema — this is the same setting as
the header toggle, surfaced as a first-class control (a 3-way segmented control).

### Account (NEW — wired)
Sign-in email (read-only) with a note that email/password are managed by sign-in; a
**Sign out** button via `useAuthActions().signOut()`.

## 4. Data model (additive — no migration)

`organizers` gains:
- `defaultLocation: v.optional(v.string())`
- `defaultCapacity: v.optional(v.number())`
- `defaultCurrency: v.optional(v.string())`

`getMe` already returns the spread org doc, so these flow to the client with no query
change.

## 5. Server

### `convex/organizers.ts`
- `updatePreferences({ defaultLocation?, defaultCapacity?, defaultCurrency? })` —
  authenticated organizer. Trims strings (empty → `undefined`, clearing); validates
  `defaultCapacity >= 1` when provided; patches only the fields supplied. Mirrors the
  optional-field clearing pattern used elsewhere.

### `convex/events.ts`
- `createEvent` gains `currency: v.optional(v.string())`. Insert uses `currency ?? "USD"`
  (unchanged default when absent). Everything else in `createEvent` is untouched.

## 6. Client

### `src/routes/settings/profile.tsx` (rewrite into sections)
H1 "Settings" + subtitle. Four `Card` sections in a single `max-w-2xl` column:
Organization, Event defaults, Appearance, Account. Existing name/logo/email logic is
preserved inside the Organization card. Event-defaults card has its own local state +
Save (calls `updatePreferences`); it seeds from `me`. Appearance uses `useTheme()`.
Account uses `signOut()`.

### `src/components/EventForm.tsx`
Add an optional `defaults?: { location?: string; capacity?: number; currency?: string }`
prop. In **create mode only**:
- `defaultValues.location = defaults?.location ?? ""`
- `defaultValues.capacity = String(defaults?.capacity ?? 1)`
- submit passes `currency: defaults?.currency ?? "USD"` to `createEvent`.
Edit mode is completely unchanged (it reads from `event`).

### `src/routes/events/new.tsx`
Fetch `getMe`; while it's loading, show a form skeleton; once loaded, render
`<EventForm defaults={{ location: me?.defaultLocation, capacity: me?.defaultCapacity, currency: me?.defaultCurrency }} />`.
(react-hook-form seeds `defaultValues` once at mount, so the form must mount after the
defaults are known — hence the gate.)

## 7. Testing

- `convex/organizers.test.ts`: `updatePreferences` stores the three fields; empty
  strings clear them; `defaultCapacity < 1` throws; unauthenticated throws.
- `convex/events.test.ts`: `createEvent` with an explicit `currency` stores it;
  `createEvent` without `currency` still defaults to `"USD"`.

## 8. Risks

- **Create-form mount gate.** If `new.tsx` renders `EventForm` before `getMe` resolves,
  react-hook-form locks in the hardcoded defaults and the org defaults never apply. The
  loading gate in §6 is load-bearing, not cosmetic — covered by rendering order.
- **Appearance is client-only.** Theme persists via next-themes (localStorage), not the
  account, so it doesn't follow the user across devices. Acceptable and honest — matches
  the existing header toggle's behavior; called out so it isn't mistaken for account sync.
