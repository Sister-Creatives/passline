# Passline → Headless Ticketing — F14: Virtual event hub

- **Date:** 2026-07-14
- **Status:** Approved design (autonomous loop)
- **Slice:** F14 — a gated digital lobby for online events (Humanitix §7). Builds on F3a orders +
  the F12 video helper.

## 1. Goal

Give online events a private "hub": an embedded stream/video, a live meeting link (Zoom/Meet/…),
and downloadable resources — visible only to **ticket holders** (via their order token) or anyone
with the **event access password**.

## 2. Scope

**In:** a `virtualHubs` config doc per event; `get`/`update` (organizer); `getForOrder({token})`
(public, ticket-holder) + `getWithPassword({slug, password})` (public); a hub section on the
existing `/orders/$token` self-service page + a password-gated `/e/$slug/watch` route; a Virtual
hub dashboard tab.

**Out:** live-attendee presence, native Zoom SDK embedding (we render the organizer's link),
per-resource access rules, DRM. The access password is a simple shared gate (stored plaintext —
it's an event lobby gate, not user credentials); note this.

## 3. Data model

```ts
virtualHubs: defineTable({
  eventId: v.id("events"),
  organizerId: v.id("organizers"),
  enabled: v.boolean(),
  heading: v.optional(v.string()),
  description: v.optional(v.string()),
  videoUrl: v.optional(v.string()),        // YouTube/Vimeo, via parseVideoEmbed
  meetingUrl: v.optional(v.string()),      // organizer-supplied https link (Zoom/Meet/…) — rendered as a link (href), never script
  resources: v.array(v.object({ title: v.string(), url: v.string() })),
  accessPassword: v.optional(v.string()),  // optional shared password for non-ticket-holders
}).index("by_event", ["eventId"]),
```

## 4. Functions — `convex/virtualHub.ts`

- `get({ eventId })` — organizer-auth'd + ownership: the config or an empty default (`{ enabled:
  false, resources: [] }`).
- `update({ eventId, enabled, heading?, description?, videoUrl?, meetingUrl?, resources, accessPassword? })`
  — organizer-auth'd + ownership; upsert; validate `videoUrl` via `parseVideoEmbed` when non-empty;
  `meetingUrl` (when set) must start with `https://`; trim; drop empty resource rows (blank title
  or url); cap resources ≤ 50.
- `getForOrder({ token })` — **public**: load the order by `by_token`; if it exists and
  `status !== "cancelled"` and its event's hub is `enabled`, return the **public hub view**
  (heading/description/video/meetingUrl/resources — NOT the password); else null. (A ticket holder
  proves entitlement by holding the order token.)
- `getWithPassword({ slug, password })` — **public**: for a `published` event whose hub is
  `enabled` and `accessPassword` is set and matches (constant-ish compare), return the public hub
  view; else null (do not reveal whether the password vs the event was wrong beyond null).

The **public hub view** never includes `accessPassword`.

## 5. UI

- **`/orders/$token`** (existing self-service page): if `getForOrder` returns a hub, render a
  "Virtual event" card — heading, description, an embedded video (via `parseVideoEmbed`), a
  prominent "Join the meeting" button (`meetingUrl`, `target=_blank rel=noopener noreferrer`), and
  a resources list (links).
- **`/e/$slug/watch`** (new public route): a password form → `getWithPassword`; on success render
  the same hub view. `Skeleton`/`Empty`/"incorrect password" states. (Ticket holders use their
  order link; this route is for password access.)
- **Virtual hub dashboard tab**: an `EventPagePanel`-style editor — an `enabled` `Switch`, heading,
  description, video URL, meeting URL, a repeatable resources editor, and an access password
  `Input` → `virtualHub.update`.

## 6. Testing (TDD)

- `virtualHub.test.ts`: `update` upserts, validates video + `https://` meetingUrl, drops empty
  resources, owner-only; `get` owner-only; `getForOrder` returns the hub (no password) for a
  non-cancelled order of an enabled hub, null for a cancelled order / disabled hub / bad token;
  `getWithPassword` returns the hub for the right password on a published enabled hub, null for a
  wrong password / unpublished / disabled — and NEVER returns `accessPassword`.
- Frontend verified by `tsc` + `build`.

## 7. Constraints

Carried: shadcn/ui, `Skeleton`, plain `Error`, per-file test helpers, additive (existing 293 tests
pass). **Security:** the public hub views must exclude `accessPassword`; `meetingUrl`/resource URLs
render as `href` only (never script/iframe); the embed comes only from `parseVideoEmbed`'s
sanitized id.

## 8. Delivery

TDD → `pnpm test` + `tsc` + `build` green (+ `pnpm generate-routes` for the new `/e/$slug/watch`
route) → push (stacked on F12) → PR → next slice (**F15 accessibility hub**).
