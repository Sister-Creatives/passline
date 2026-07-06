import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { CLAIM_WINDOW_MS } from "./lib/constants";
import { countSeatsTaken } from "./lib/capacity";

/**
 * Offer a freed seat to the next person on an event's waitlist.
 *
 * If the event has a free seat and at least one waitlisted attendee, promotes
 * the lowest-position waitlister to a `confirmed_pending_claim` hold that
 * expires `CLAIM_WINDOW_MS` from `now`, clearing their waitlist position.
 * `confirmed_pending_claim` is a seat-holding status, so the seat stays
 * occupied while the hold is live. Returns the promoted rsvp id, or null if
 * there was nothing to promote.
 *
 * `now` is passed in (not read from the clock here) so callers -- the sweep in
 * particular -- stay deterministic and testable.
 */
export async function promoteNext(
  ctx: MutationCtx,
  eventId: Id<"events">,
  now: number,
): Promise<Id<"rsvps"> | null> {
  const event = await ctx.db.get(eventId);
  if (!event) return null;

  const seatsTaken = await countSeatsTaken(ctx, eventId);
  if (seatsTaken >= event.capacity) return null;

  const waitlisted = await ctx.db
    .query("rsvps")
    .withIndex("by_event_and_status", (q) => q.eq("eventId", eventId).eq("status", "waitlisted"))
    .collect();
  if (waitlisted.length === 0) return null;

  waitlisted.sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0));
  const next = waitlisted[0];
  await ctx.db.patch(next._id, {
    status: "confirmed_pending_claim",
    claimExpiresAt: now + CLAIM_WINDOW_MS,
    waitlistPosition: undefined,
  });
  // Offer the freed seat to the promoted attendee via a time-limited claim link.
  // Scheduled (not sent inline) so this stays a pure, transactional mutation.
  await ctx.scheduler.runAfter(0, internal.email.sendClaimEmail, {
    email: next.email,
    name: next.name,
    eventTitle: event.title,
    claimUrl: `${process.env.APP_URL}/claim/${next.token}`,
  });
  return next._id;
}

/**
 * Expire stale claim holds and re-offer their seats.
 *
 * Any `confirmed_pending_claim` whose `claimExpiresAt` is before `now` is sent
 * to the back of its event's waitlist (freeing the seat), then `promoteNext`
 * re-offers that seat to the next waitlister. Shared by the deterministic,
 * now-injected entry point (for tests) and the cron entry point (below).
 * Returns the number of expired holds reprocessed.
 */
async function sweep(ctx: MutationCtx, now: number): Promise<number> {
  const holds = await ctx.db
    .query("rsvps")
    .filter((q) => q.eq(q.field("status"), "confirmed_pending_claim"))
    .collect();

  let reprocessed = 0;
  for (const hold of holds) {
    if ((hold.claimExpiresAt ?? 0) >= now) continue;

    const waitlisted = await ctx.db
      .query("rsvps")
      .withIndex("by_event_and_status", (q) =>
        q.eq("eventId", hold.eventId).eq("status", "waitlisted"),
      )
      .collect();
    const maxPosition = waitlisted.reduce((m, r) => Math.max(m, r.waitlistPosition ?? 0), 0);

    await ctx.db.patch(hold._id, {
      status: "waitlisted",
      waitlistPosition: maxPosition + 1,
      claimExpiresAt: undefined,
    });
    await promoteNext(ctx, hold.eventId, now);
    reprocessed++;
  }
  return reprocessed;
}

// Deterministic entry point: `now` is injected so tests control expiry.
export const sweepExpiredClaims = internalMutation({
  args: { now: v.number() },
  handler: async (ctx, { now }) => sweep(ctx, now),
});

// Cron entry point: uses the real clock. Registered on a 1-minute interval in
// crons.ts.
export const sweepExpiredClaimsNow = internalMutation({
  args: {},
  handler: async (ctx) => sweep(ctx, Date.now()),
});
