# Passline — Design Spec

**Date:** 2026-07-03
**Status:** Approved (design)

## Overview

Passline is a free-events SaaS — an Eventbrite-style platform scoped to free events
only. Organizers sign in, create and publish event pages, and manage RSVPs with
capacity limits and QR-based check-in. Attendees RSVP with just a name and email; they
do not create accounts. The headline differentiator is **Live Waitlist Autopilot**.

## Goals

- Ship a working free-events product: create, publish, RSVP, check in.
- Deliver one memorable killer feature (Live Waitlist Autopilot) that Eventbrite
  handles poorly.
- Build on a reactive-first stack so realtime behavior is cheap and correct.

## Non-Goals (v1)

- Payments / paid ticketing.
- Attendee accounts or attendee dashboards.
- Public discovery, search, or a two-sided marketplace.
- Recurring events.

## Stack

- **TanStack Start** — full-stack React. File-based routing, SSR for public event
  pages (SEO), server functions.
- **Convex** — reactive database + backend. Realtime queries drive live
  capacity/waitlist state. Convex Auth for organizers. Scheduled functions for
  claim-link expiry.
- **shadcn/ui** + Tailwind CSS — UI layer.
- **Resend** (via the official Convex component) — transactional email
  (confirmations, waitlist claim links).
- **QR** — a per-RSVP token encoded as a QR code, scanned on the check-in view.

## Data Model (Convex tables)

### `organizers`
Auth identity for people who create events.
- `name`, `email`, `image` (from Convex Auth).

### `events`
- `organizerId` (ref `organizers`)
- `title` (rich text allowed — authors may drop inline `<i>`, `<em>`, `<br>`,
  `<strong>`)
- `description`
- `startsAt`, `endsAt` (timestamps)
- `location`
- `capacity` (number)
- `status` — `draft` | `published`
- `slug` (unique, used in public URL)

### `rsvps`
- `eventId` (ref `events`)
- `name`, `email`
- `token` (unique — encodes QR / check-in identity)
- `status` — `confirmed` | `waitlisted` | `confirmed_pending_claim` |
  `checked_in` | `cancelled`
- `waitlistPosition` (number, when waitlisted)
- `claimExpiresAt` (timestamp, when in `confirmed_pending_claim`)
- `createdAt`, `updatedAt`

**Derived capacity:** available seats = `event.capacity` minus the count of `rsvps`
in `confirmed`, `confirmed_pending_claim`, and `checked_in` states. Never stored as a
counter — always computed to avoid drift.

## Key Flows

### RSVP
1. Attendee submits name + email on a published event page.
2. In a single Convex mutation, atomically check available seats:
   - If a seat is available → create RSVP `confirmed`, email confirmation + QR.
   - If full → create RSVP `waitlisted` with the next `waitlistPosition`, email
     "you are #N on the waitlist."

### Waitlist Autopilot (killer feature)
1. A holding attendee cancels, or the organizer removes them, freeing a seat.
2. A Convex mutation atomically promotes the next `waitlisted` person to
   `confirmed_pending_claim` and sets `claimExpiresAt = now + 30 minutes`.
3. Resend emails that person a **claim link** (`/claim/<token>`). Clicking it flips
   their status to `confirmed`.
4. A scheduled Convex function sweeps expiries. If a hold is unclaimed at
   `claimExpiresAt`, it reverts that person to the bottom of the waitlist (or drops
   them, configurable) and automatically promotes the next person — repeating the
   claim cycle.
5. All counts and waitlist positions update **live** for every viewer via Convex
   reactive queries. Organizers watch the waitlist drain in real time.

**Correctness note:** the promote / claim / expire transitions are the highest-risk
part of the system (race on the last seat). They must run as atomic Convex mutations
and are the primary target for unit tests.

### Check-in
- Organizer opens a live "door dashboard" for the event.
- Scanning an attendee QR runs a mutation flipping `confirmed` → `checked_in`.
- Reactive queries keep multiple simultaneous scanners consistent; the checked-in
  count and remaining list update live.

## Routes (TanStack Start)

**Public**
- `/e/$slug` — event page (SSR).
- `/rsvp/$token` — RSVP confirmation view.
- `/claim/$token` — waitlist claim link handler.

**Organizer (authenticated)**
- `/dashboard` — list of the organizer's events.
- `/events/new` — create event.
- `/events/$id` — manage event + waitlist.
- `/events/$id/door` — live check-in dashboard.

## Testing

- **Convex mutation unit tests** for the waitlist state machine: promotion, claim,
  expiry sweep, and the last-seat race. This is where correctness matters most.
- **Component tests** for the RSVP form across capacity states (open, full,
  waitlist).
- End-to-end smoke of the RSVP → full → cancel → auto-promote → claim path.

## Open Questions

- Email provider defaulted to **Resend**; revisit before launch if a single-vendor
  (Brevo) approach is preferred.
- Claim-link expiry window defaulted to 30 minutes; confirm with real usage.
