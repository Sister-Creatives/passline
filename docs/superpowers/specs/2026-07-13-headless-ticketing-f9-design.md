# Passline → Headless Ticketing — F9: Marketing (bulk email + tracking pixels)

- **Date:** 2026-07-14
- **Status:** Approved design (autonomous loop)
- **Slice:** F9 — bulk email to attendees + tracking pixels (Humanitix §5). Builds on F3a orders +
  the existing Resend integration.

## 1. Goal

Let organizers email all of an event's attendees (announcements, reminders, thank-yous) and
attach analytics/marketing tracking pixels (Meta / Google Analytics / GTM) that render on the
public event page. Live email send reuses the existing RESEND_API_KEY-guarded Resend path (no-op
until the key is set, exactly like the RSVP emails).

## 2. Scope

**In:** `emailCampaigns` table; optional tracking-pixel IDs on `events`; `sendEventEmail`
(organizer → collects distinct attendee emails, records a campaign, enqueues via Resend, guarded),
`listCampaigns`, `getEventMarketing`, `updateTrackingPixels` (organizer); rendering the pixels on
the public `/e/$slug` page; a Marketing dashboard tab.

**Out:** email templates/segmentation, automated drip/reminder scheduling, open/click tracking,
embeddable widgets (§5 — a later slice), unsubscribe management (add a footer note only).

## 3. Data model

- `events`: add `metaPixelId: v.optional(v.string())`, `googleAnalyticsId: v.optional(v.string())`,
  `gtmId: v.optional(v.string())`.
- New `emailCampaigns` table:

```ts
emailCampaigns: defineTable({
  eventId: v.id("events"),
  organizerId: v.id("organizers"),
  subject: v.string(),
  body: v.string(),                 // organizer-authored (trusted; may contain HTML)
  recipientCount: v.number(),
  createdAt: v.number(),
}).index("by_event", ["eventId"]),
```

## 4. Functions — `convex/marketing.ts`

- `sendEventEmail({ eventId, subject, body })` — organizer-auth'd + ownership. Validates non-empty
  subject + body. Collects the **distinct** recipient emails for the event: `orders.buyerEmail`
  (orders where `status !== "cancelled"`), `tickets.attendeeEmail` (non-null), and `rsvps.email`
  (legacy). Inserts an `emailCampaigns` row with `recipientCount`. Schedules
  `internal.marketing.deliverCampaign` (an `internalAction`) with the recipient list + subject +
  body. Returns `{ recipientCount }`. (If `recipientCount === 0`, still record the campaign but
  skip scheduling.)
- `deliverCampaign` — **internalAction** (in `convex/marketing.ts` or reuse `convex/email.ts`
  patterns): for each recipient, `resend.sendEmail(...)` with `FROM`, subject, and a simple HTML
  wrapper around `body` + an unsubscribe/footer note. **Guarded by `RESEND_API_KEY`** exactly like
  the existing email handlers (a clean no-op when the key is absent). The body is organizer-authored
  and trusted (like `eventTitle`), so it is NOT escaped; recipient addresses are validated non-empty.
- `listCampaigns({ eventId })` — organizer-auth'd + ownership: campaigns newest first.
- `getEventMarketing({ eventId })` — organizer-auth'd: `{ metaPixelId, googleAnalyticsId, gtmId }`.
- `updateTrackingPixels({ eventId, metaPixelId?, googleAnalyticsId?, gtmId? })` — organizer-auth'd
  + ownership: patch the three fields (omitted → cleared, like other optional patches). Trim +
  treat empty string as cleared.

## 5. Public tracking-pixel rendering — `src/routes/e/$slug.tsx`

The public event page already loads the event via `events.getEventBySlug` (which returns the event
doc incl. the new pixel fields). Render, when present:
- **Google Analytics (gtag.js)** for `googleAnalyticsId` (`G-…`),
- **Google Tag Manager** for `gtmId` (`GTM-…`),
- **Meta Pixel** for `metaPixelId`.
Inject via the route's `head()` scripts or a small `TrackingPixels` component using
`dangerouslySetInnerHTML` with the standard snippets, **interpolating only the validated ID**
(IDs are constrained to `[A-Za-z0-9-]` before injection to prevent script breakout). Render nothing
when all three are unset.

## 6. Dashboard UI — Marketing tab on `events/$id.index.tsx`

- **Compose**: a `Card`/`Dialog` with subject `Input` + body `Textarea` → `sendEventEmail`; on
  success toast the recipient count. A muted note: "Delivery is a no-op until email sending is
  configured."
- **Sent campaigns**: a `Table` (subject, recipients, date) from `listCampaigns`; `Skeleton`/`Empty`.
- **Tracking pixels**: a small form (three `Input`s) → `updateTrackingPixels`, prefilled from
  `getEventMarketing`.

## 7. Testing (TDD)

- `marketing.test.ts`: `sendEventEmail` collects DISTINCT emails across orders (excluding
  cancelled) + tickets + rsvps, records a campaign with the right `recipientCount`, owner-only;
  `updateTrackingPixels` sets/clears fields, owner-only; `getEventMarketing`/`listCampaigns`
  owner-only. (Do not assert live send — the RESEND guard makes it a no-op; assert the campaign
  row + a scheduled function exists, or just the recorded campaign.)
- The ID-sanitization for pixel injection is unit-testable if extracted to a helper.
- Frontend verified by `tsc` + `build`.

## 8. Constraints

Carried: shadcn/ui, `Skeleton`, plain `Error`, per-file test helpers, integer cents unaffected,
additive (existing 234 tests pass). **Security:** never inject an unsanitized pixel ID into a
`<script>` (constrain to `[A-Za-z0-9-]`); organizer-authored email bodies are trusted but recipient
data is validated.

## 9. Delivery

TDD → `pnpm test` + `tsc` + `build` green → push (stacked on F6) → PR → next loop slice
(**F10 reserved seating** — large; or the embeddable-widget / long-tail items). Live email send
needs `RESEND_API_KEY` + a verified domain (same deferred infra as the RSVP emails).
