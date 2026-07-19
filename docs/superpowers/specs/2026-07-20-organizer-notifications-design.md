# Passline → Organizer notifications + Help menu

- **Date:** 2026-07-20
- **Status:** Approved design
- **Slice:** In-app notifications for organizers, surfaced through the header bell (unread badge +
  dropdown list), generated from attendee activity; plus wiring the header Help (?) button to a
  small dropdown. The header theme toggle already works and is out of scope.

## 1. Goal

Make the two dead header buttons functional. The bell becomes a real notification center driven by
live organizer activity; the Help button opens a small menu. Notifications are **organizer-scoped**
and **shared across the team** (one list per org, one shared read flag per notification), consistent
with how the rest of the app scopes data via `getAuthOrganizerId`.

## 2. Scope

**In:**
- A `notifications` table.
- Generation on four attendee activities: new RSVP, waitlist join, event sold out, RSVP cancellation.
- Organizer-scoped reactive queries (`list`, `unreadCount`) and mutations (`markRead`, `markAllRead`).
- A header bell dropdown (badge, list, mark-all-read, click-through, empty state).
- A header Help dropdown (command menu + contact support).

**Out (future):**
- Per-user read state (v1 is shared team read state).
- Email/push delivery of these notifications (attendee-facing emails already exist separately).
- Notification preferences/filtering; a full notifications page; check-in notifications (organizers
  run check-in themselves, so notifying them is redundant).
- A documentation site link in Help (no docs URL exists yet).

## 3. Data model (additive, no migration)

```ts
notifications: defineTable({
  organizerId: v.id("organizers"),
  type: v.union(
    v.literal("rsvp"),
    v.literal("waitlist"),
    v.literal("sold_out"),
    v.literal("cancellation"),
  ),
  title: v.string(),                 // short label, e.g. "New RSVP"
  body: v.string(),                  // e.g. "Jane Doe RSVP'd to Autumn forest gathering"
  eventId: v.optional(v.id("events")),
  read: v.boolean(),                 // shared across the org's team
  createdAt: v.number(),
}).index("by_organizer", ["organizerId", "createdAt"])
  .index("by_organizer_unread", ["organizerId", "read"]),
```

`createdAt` is stored explicitly (rather than relying on `_creationTime`) so notification ordering is
independent of document internals and easy to assert in tests.

## 4. Generation (server, transactional with the activity)

A shared internal helper in `convex/notifications.ts`:

```ts
export async function createNotification(
  ctx: MutationCtx,
  args: { organizerId: Id<"organizers">; type: ...; title: string; body: string; eventId?: Id<"events"> },
): Promise<void> {
  await ctx.db.insert("notifications", { ...args, read: false, createdAt: Date.now() });
}
```

Called inline (same transaction as the activity) from the existing **public** attendee mutations in
`convex/rsvps.ts`, each of which already resolves `event` (and thus `event.organizerId`):

- **`rsvp`** (`convex/rsvps.ts:88`):
  - Confirmed spot → `rsvp`: title "New RSVP", body `"{name} RSVP'd to {event.title}"`.
  - Waitlisted → `waitlist`: title "New waitlist join", body `"{name} joined the waitlist for {event.title}"`.
  - **Sold out**: when the confirmed insert fills the last seat — i.e. the pre-insert
    `seatsTaken + 1 === event.capacity` — also emit `sold_out`: title "Event sold out",
    body `"{event.title} is now sold out"`. Emitted in addition to the `rsvp` notification.
  - The existing dedupe path (returning an existing ticket on a repeat submission) must NOT emit a
    notification — only a genuinely new confirmed/waitlisted row does.
- **`cancelRsvp`** (`convex/rsvps.ts:159`): look up the event by `row.eventId`, then `cancellation`:
  title "RSVP cancelled", body `"An attendee cancelled their RSVP for {event.title}"`. (Attendee-initiated
  via their ticket token; the organizer wants to know a seat freed.)

No auth on these writes — they are server-derived from the activity and scoped to the event's
organizer, exactly like the existing `ctx.scheduler.runAfter(..., sendConfirmationEmail, ...)` calls.

## 5. Queries & mutations (`convex/notifications.ts`, organizer-scoped)

All resolve the caller with `getAuthOrganizerId`; unauthenticated → `list` returns `[]`,
`unreadCount` returns `0`, mutations throw `"Not authenticated"`.

- `list()` → newest ~30 notifications for the org (`by_organizer` index, desc). Reactive.
- `unreadCount()` → number of unread for the org (`by_organizer_unread`, `read === false`). Reactive;
  drives the badge.
- `markAllRead()` → patch every unread org notification to `read: true`.
- `markRead({ notificationId })` → patch one, after asserting `notification.organizerId` equals the
  caller's org (reject cross-org).

## 6. Frontend

### Bell — `src/components/notifications-menu.tsx` (new), used in `app-header.tsx`
- A `DropdownMenu` (or `Popover`) triggered by the bell button.
- **Badge**: when `unreadCount > 0`, a small count badge on the bell (display "9+" when > 9).
- **List**: `list()` items — a type icon, `title`, `body` (truncated), and relative time
  (`formatDistanceToNow` from date-fns). Newest first.
- **Mark all read**: header action in the dropdown, shown when there are unread items.
- **Click-through**: clicking an item calls `markRead` and, if it has an `eventId`, navigates to
  `/events/$id` with search `{ section: "attendees" }` (a valid section key).
- **Empty state**: "You're all caught up." when the list is empty.

### Help — `app-header.tsx`
Replace the dead Help button with a `DropdownMenu`:
- **"Command menu"** with a ⌘K hint → opens the palette via `useCommandPalette().setOpen(true)`.
- **"Contact support"** → `mailto:support@passline.app` (placeholder; swap when a real address exists).

## 7. Testing

`convex/notifications.test.ts` (edge-runtime, `asOrganizer`/`withIdentity` pattern):
- `rsvp` on a published event with free capacity creates one `rsvp` notification for the event's
  organizer; a repeat (dedupe) submission creates **no** new notification.
- An RSVP that lands on the waitlist (event at capacity) creates a `waitlist` notification.
- The RSVP that fills the last seat creates BOTH an `rsvp` and a `sold_out` notification.
- `cancelRsvp` creates a `cancellation` notification.
- `list`/`unreadCount` are org-scoped: a second organizer sees none of the first's notifications.
- `markRead` flips one (and rejects a cross-org id); `markAllRead` clears `unreadCount` to 0.

Frontend: optional light render test; the reactive query wiring is the security-relevant surface and
is covered server-side.

## 8. Risks

- **Notification volume.** A popular event could generate many rows. Acceptable for v1 (list caps at
  ~30 for display; `unreadCount` is an indexed count). A retention/cleanup job is out of scope.
- **Generation must not fire on dedupe.** The `rsvp` mutation returns early for repeat submissions;
  the notification insert must sit only on the genuinely-new-row branches (tested explicitly).
- **Sold-out edge.** Emitted only on the exact last-seat confirm (`seatsTaken + 1 === capacity`), so it
  fires once, not on every subsequent full-capacity waitlist attempt (tested).
