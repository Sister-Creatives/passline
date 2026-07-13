# Passline → Headless Ticketing — F2: API keys + HTTP read API

- **Date:** 2026-07-13
- **Status:** Approved design (autonomous loop — user authorized "do the loop, don't ask again")
- **Slice:** F2 of the multi-slice program (see F1 spec for the full backlog)

## 1. Goal

Make the ticketing engine consumable by external developers over HTTP. A developer mints an
**API key** in the dashboard and uses it (`Authorization: Bearer pl_live_…`) to read their
events and ticket types from a **versioned HTTP API**. This is the first concrete "headless"
surface. Webhooks (**F2b**) and a typed SDK (**F2c**) are separate follow-up slices.

## 2. Scope

**In:** `apiKeys` table + generate/list/revoke; SHA-256 key hashing (store hash, show secret
once); an authenticated HTTP read API (`convex/http.ts` routes + `httpAction`s) for events and
ticket types; the Settings → API keys UI (create → show-once Dialog, list, revoke).

**Out (later slices):** webhooks (F2b); typed SDK package (F2c); any write/checkout endpoints
(F3); rate limiting on the API (F2b); per-key scopes/permissions (future).

## 3. Data model

New `apiKeys` table:

```ts
apiKeys: defineTable({
  organizerId: v.id("organizers"),
  name: v.string(),              // human label, e.g. "Production storefront"
  keyHash: v.string(),           // lowercase hex SHA-256 of the full secret
  prefix: v.string(),            // "pl_live_" — shown in the UI
  lastFour: v.string(),          // last 4 chars of the secret, for display
  createdAt: v.number(),
  lastUsedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
})
  .index("by_organizer", ["organizerId"])
  .index("by_hash", ["keyHash"])
```

Secret format: `pl_live_` + 40 lowercase hex chars (20 random bytes via
`crypto.getRandomValues`). The full secret is returned **once** at creation; only its
SHA-256 hash is persisted. Verification hashes the presented bearer token and looks it up by
`by_hash`.

## 4. Convex functions — `convex/apiKeys.ts`

- `create({ name })` — mutation, organizer-auth'd (`getAuthOrganizerId`). Generates the secret,
  stores `{ keyHash, prefix: "pl_live_", lastFour, name, createdAt }`, returns
  `{ id, secret }` (the only time `secret` is exposed).
- `list({})` — query, organizer-auth'd. Returns metadata only (id, name, prefix, lastFour,
  createdAt, lastUsedAt, revokedAt) — never the hash or secret.
- `revoke({ keyId })` — mutation, organizer-auth'd + ownership-checked, sets `revokedAt`.
- `internalResolve({ keyHash })` — **internal** query used only by httpActions: returns
  `{ organizerId, keyId }` for an active (non-revoked) key, else null.
- `internalTouch({ keyId })` — **internal** mutation: sets `lastUsedAt`.
- Helper `sha256Hex(input: string): Promise<string>` (Web Crypto `crypto.subtle.digest`).

## 5. HTTP API — `convex/http.ts` + `convex/apiHttp.ts`

Bearer-authenticated JSON read API, versioned under `/v1`:

- `GET /v1/events` → `{ data: Event[] }` — the authenticated organizer's events (id, title,
  slug, status, capacity, currency, startsAt, endsAt).
- `GET /v1/events/{eventId}/ticket-types` → `{ data: TicketType[] }` — that org's event's
  ticket types (id, name, kind, priceCents, currency, capacity, sold, badge, sortOrder),
  sorted by `sortOrder`; 404 if the event isn't the caller's.

Auth: parse `Authorization: Bearer <secret>`; `sha256Hex` it; `internalResolve`; on miss/revoked
return `401 {"error":"..."}`. On success, `internalTouch` the key and scope reads to
`organizerId`. All responses `Content-Type: application/json`. Internal queries
(`internal.apiHttp.eventsForOrganizer`, `.ticketTypesForOrganizerEvent`) do the org-scoped
reads (httpActions cannot use `getAuthOrganizerId` — they authenticate by key and pass an
explicit `organizerId`).

## 6. Dashboard UI — `src/routes/settings/api-webhooks.tsx`

Replace the F1 stub with a real page (inside `DashboardLayout`):
- **Create key:** a `Dialog` with a name `Input`; on submit shows the full `pl_live_…` secret
  **once** with a copy button and a "you won't see this again" warning.
- **List:** shadcn `Table` — name, masked key (`pl_live_…{lastFour}`), created, last used,
  status (`Badge`: Active / Revoked). `Skeleton` while loading; `Empty` when none.
- **Revoke:** `AlertDialog` confirm → `apiKeys.revoke`.

## 7. Testing

- TDD: `convex/apiKeys.test.ts` — create returns a secret whose hash is stored (secret never
  persisted); list is metadata-only and org-scoped; revoke is owner-only and sets `revokedAt`;
  `internalResolve` returns the org for a valid active key and null for revoked/unknown.
- HTTP: `convex/apiHttp.test.ts` using `convexTest`'s `t.fetch(...)` — 401 without/with a bad
  key; 200 + correct JSON for a valid key; a revoked key → 401; cross-organizer event → 404.
- Frontend verified by `tsc` + `build` (no component-test harness).

## 8. Constraints (carried from F1)

shadcn/ui for all UI; `Skeleton` loaders (no "Loading…" text); plain `Error` in Convex;
per-file `asOrganizer`/`modules` test helpers; money integer cents; additive only (no changes
to rsvps/waitlist/checkin; ticketTypes/events untouched except reads).

## 9. Delivery

TDD build → `pnpm test` + `tsc` + `build` green → push branch (stacked on F1) → PR → loop to
**F2b (webhooks)**. Live HTTP verification requires a running Convex deployment (deferred to
the shared deploy setup).
