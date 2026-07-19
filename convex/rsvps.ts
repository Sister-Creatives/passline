import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id, Doc } from "./_generated/dataModel";
import { countSeatsTaken, nextWaitlistPosition } from "./lib/capacity";
import { SEAT_HOLDING_STATUSES } from "./lib/constants";
import { promoteNext } from "./waitlist";
import { getAuthOrganizerId } from "./auth";
import { rateLimiter } from "./rateLimits";
import { recomputeEventStats } from "./lib/eventStats";
import { canViewEvent } from "./lib/preview";

async function rsvpByToken(ctx: MutationCtx, token: string) {
  const row = await ctx.db
    .query("rsvps")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  if (!row) throw new Error("RSVP not found");
  return row;
}

/**
 * Look up a published event by its public slug.
 *
 * Throws (rather than returning null) for both "no such slug" and "slug
 * exists but the event is a draft", so attendees never learn which of the
 * two is true for an event they cannot access.
 */
async function publishedEventBySlug(ctx: QueryCtx | MutationCtx, slug: string) {
  const event = await ctx.db
    .query("events")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
  if (!event || event.status !== "published") throw new Error("Event not found");
  return event;
}

// An rsvps row that is not `cancelled` -- i.e. it still holds a seat
// (confirmed / confirmed_pending_claim / checked_in) or a waitlist spot.
type ActiveRsvp = Doc<"rsvps"> & { status: Exclude<Doc<"rsvps">["status"], "cancelled"> };

/**
 * Find this event's existing ACTIVE rsvp (any status except `cancelled`) for
 * a given email, if one exists. Backs the `rsvp` mutation's idempotency: a
 * repeat RSVP from the same email returns the existing ticket instead of
 * creating a duplicate row and scheduling a second email. A cancelled row is
 * not active, so it never blocks a fresh RSVP from the same email.
 *
 * Full collect-then-filter over the `by_event` index, consistent with
 * `countSeatsTaken` -- an event has few enough rsvps that this stays cheap,
 * and it avoids adding a schema index for a lookup that is not on a hot path.
 * The email is compared exactly as stored (the insert path does not
 * normalize it either), so this intentionally does not trim/lowercase.
 */
async function findActiveRsvpByEmail(
  ctx: MutationCtx,
  eventId: Id<"events">,
  email: string,
): Promise<ActiveRsvp | undefined> {
  const rows = await ctx.db
    .query("rsvps")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  return rows.find((r): r is ActiveRsvp => r.email === email && r.status !== "cancelled");
}

/**
 * Public RSVP mutation. No account required: attendees identify themselves
 * with name + email and get back a token used later to manage their RSVP.
 *
 * The capacity read (countSeatsTaken) and the insert happen in this single
 * mutation, which Convex runs transactionally -- this is what makes the
 * "last seat" check atomic under concurrent RSVPs instead of racy.
 *
 * Idempotent per (event, email): if this email already has an active rsvp for
 * the event, that existing ticket is returned as-is -- no duplicate row, no
 * second email -- so one address cannot consume multiple seats or flood the
 * waitlist by repeating the same request.
 *
 * Rate limited by email (see convex/rateLimits.ts) before any other work, so a
 * bot hammering this mutation is rejected cheaply -- before the slug lookup,
 * the dedupe scan, or the capacity read. This is defense-in-depth on top of
 * the dedupe behavior above, not a replacement for it: dedupe stops one email
 * from ever holding two seats, while the rate limit stops one email from
 * being used to spam the mutation (and its scheduled emails) in the first
 * place. IP-based / edge rate limiting is a separate, hosting-layer concern.
 */
export const rsvp = mutation({
  args: { slug: v.string(), name: v.string(), email: v.string() },
  handler: async (ctx, { slug, name, email }) => {
    const rateLimit = await rateLimiter.limit(ctx, "rsvp", { key: email });
    if (!rateLimit.ok) {
      throw new Error("Too many RSVP attempts. Please try again in a moment.");
    }

    const event = await publishedEventBySlug(ctx, slug);

    const existing = await findActiveRsvpByEmail(ctx, event._id, email);
    if (existing) {
      if (existing.status === "waitlisted") {
        return {
          status: "waitlisted" as const,
          token: existing.token,
          waitlistPosition: existing.waitlistPosition ?? 0,
        };
      }
      return { status: existing.status, token: existing.token };
    }

    const token = crypto.randomUUID();
    const seatsTaken = await countSeatsTaken(ctx, event._id);

    if (seatsTaken < event.capacity) {
      await ctx.db.insert("rsvps", {
        eventId: event._id,
        name,
        email,
        token,
        status: "confirmed",
      });
      // Fire-and-forget the confirmation email. Scheduling keeps this mutation
      // pure and transactional; the send happens in a separate action.
      await ctx.scheduler.runAfter(0, internal.email.sendConfirmationEmail, {
        email,
        name,
        eventTitle: event.title,
        token,
      });
      await recomputeEventStats(ctx, event._id);
      return { status: "confirmed" as const, token };
    }

    const waitlistPosition = await nextWaitlistPosition(ctx, event._id);
    await ctx.db.insert("rsvps", {
      eventId: event._id,
      name,
      email,
      token,
      status: "waitlisted",
      waitlistPosition,
    });
    await ctx.scheduler.runAfter(0, internal.email.sendWaitlistEmail, {
      email,
      name,
      eventTitle: event.title,
      waitlistPosition,
    });
    await recomputeEventStats(ctx, event._id);
    return { status: "waitlisted" as const, token, waitlistPosition };
  },
});

/**
 * Cancel an RSVP by its token. If the cancelled RSVP was holding a seat
 * (confirmed, pending claim, or checked in), the freed seat is immediately
 * offered to the next waitlisted attendee in the same mutation, so promotion
 * is atomic with the cancellation.
 */
export const cancelRsvp = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const row = await rsvpByToken(ctx, token);
    const heldSeat = (SEAT_HOLDING_STATUSES as readonly string[]).includes(row.status);
    await ctx.db.patch(row._id, {
      status: "cancelled",
      waitlistPosition: undefined,
      claimExpiresAt: undefined,
    });
    if (heldSeat) await promoteNext(ctx, row.eventId, Date.now());
    await recomputeEventStats(ctx, row.eventId);
    return null;
  },
});

/**
 * Claim a seat that was auto-offered off the waitlist. Succeeds only while the
 * hold is a live `confirmed_pending_claim`; an already-confirmed RSVP claims as
 * a no-op, and an expired or otherwise non-holdable RSVP returns "expired".
 */
export const claimSpot = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const row = await rsvpByToken(ctx, token);
    if (row.status !== "confirmed_pending_claim") {
      return { status: row.status === "confirmed" ? ("confirmed" as const) : ("expired" as const) };
    }
    if ((row.claimExpiresAt ?? 0) < Date.now()) {
      return { status: "expired" as const };
    }
    await ctx.db.patch(row._id, { status: "confirmed", claimExpiresAt: undefined });
    return { status: "confirmed" as const };
  },
});

/**
 * Public ticket lookup by token, for the confirmation/ticket page.
 *
 * The token is an unguessable secret minted by `rsvp` and handed only to the
 * attendee who holds it, so an unauthenticated lookup-by-token is the intended
 * design (equivalent to a paper ticket's barcode). Returns a safe subset of
 * just that one RSVP plus its event's public display fields -- never other
 * attendees' data -- or null if no RSVP has that token.
 */
export const getRsvpByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const row = await ctx.db
      .query("rsvps")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!row) return null;
    const event = await ctx.db.get(row.eventId);
    if (!event) return null;
    return {
      name: row.name,
      status: row.status,
      token: row.token,
      eventTitle: event.title,
      eventStartsAt: event.startsAt,
      eventEndsAt: event.endsAt,
      eventLocation: event.location,
    };
  },
});

export const getEventPublicState = query({
  args: { slug: v.string(), previewToken: v.optional(v.string()) },
  handler: async (ctx, { slug, previewToken }) => {
    // Inlined (not publishedEventBySlug) so a valid preview token can open a
    // draft here, without loosening the write-path helper that rsvp() still
    // uses to reject draft RSVPs -- see the security invariant in the design
    // doc (docs/superpowers/specs/2026-07-19-preview-link-design.md §3).
    const event = await ctx.db
      .query("events")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!event || !canViewEvent(event, previewToken)) throw new Error("Event not found");
    const seatsTaken = await countSeatsTaken(ctx, event._id);
    const waitlisted = await ctx.db
      .query("rsvps")
      .withIndex("by_event_and_status", (q) => q.eq("eventId", event._id).eq("status", "waitlisted"))
      .collect();
    return { capacity: event.capacity, seatsTaken, waitlistCount: waitlisted.length };
  },
});

/**
 * Door check-in. Looked up by the ticket's token (the same unguessable secret
 * used for `getRsvpByToken`), so door staff scan/paste a QR-encoded token with
 * no organizer account required at the point of scanning -- the dashboard
 * that surfaces the result is what's owner-gated (see `getDoorState`).
 *
 * Idempotent: checking in an already-checked-in rsvp returns "already" rather
 * than erroring, so a duplicate scan at a busy door is harmless. Only a
 * `confirmed` rsvp can be checked in; anything else (waitlisted, pending
 * claim, cancelled) returns "not_confirmed" without mutating state.
 */
export const checkIn = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const row = await rsvpByToken(ctx, token);
    if (row.status === "checked_in") return { status: "already" as const };
    if (row.status !== "confirmed") return { status: "not_confirmed" as const };
    await ctx.db.patch(row._id, { status: "checked_in", checkedInAt: Date.now() });
    return { status: "checked_in" as const };
  },
});

/**
 * Live door dashboard state for one event. Owner-only: mirrors
 * `events.requireOwnedEvent`'s non-disclosure pattern (that helper is not
 * exported, so the check is inlined here) -- throws "Not authenticated" when
 * no organizer is signed in, and "Not found" for both a missing event and one
 * belonging to a different organizer, so a non-owner never learns which.
 *
 * `confirmed` counts seats that are confirmed OR already checked in (a
 * checked-in attendee still occupies a confirmed seat), `checkedIn` counts
 * only `checked_in` rows, and `recent` is the most recently checked-in
 * attendees (newest first), by `checkedInAt`.
 */
export const getDoorState = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }: { eventId: Id<"events"> }) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");
    const event = await ctx.db.get(eventId);
    if (!event || event.organizerId !== organizerId) throw new Error("Not found");

    const rows = await ctx.db
      .query("rsvps")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();

    const checkedInRows = rows.filter((r) => r.status === "checked_in");
    const confirmed = rows.filter((r) => r.status === "confirmed" || r.status === "checked_in").length;
    const recent = checkedInRows
      .slice()
      .sort((a, b) => (b.checkedInAt ?? b._creationTime) - (a.checkedInAt ?? a._creationTime))
      .slice(0, 10)
      .map((r) => ({ name: r.name, at: r.checkedInAt ?? r._creationTime }));

    return { eventTitle: event.title, checkedIn: checkedInRows.length, confirmed, recent };
  },
});
