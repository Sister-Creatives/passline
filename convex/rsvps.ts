import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { countSeatsTaken, nextWaitlistPosition } from "./lib/capacity";
import { SEAT_HOLDING_STATUSES } from "./lib/constants";
import { promoteNext } from "./waitlist";

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

/**
 * Public RSVP mutation. No account required: attendees identify themselves
 * with name + email and get back a token used later to manage their RSVP.
 *
 * The capacity read (countSeatsTaken) and the insert happen in this single
 * mutation, which Convex runs transactionally -- this is what makes the
 * "last seat" check atomic under concurrent RSVPs instead of racy.
 */
export const rsvp = mutation({
  args: { slug: v.string(), name: v.string(), email: v.string() },
  handler: async (ctx, { slug, name, email }) => {
    const event = await publishedEventBySlug(ctx, slug);
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

export const getEventPublicState = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const event = await publishedEventBySlug(ctx, slug);
    const seatsTaken = await countSeatsTaken(ctx, event._id);
    const waitlisted = await ctx.db
      .query("rsvps")
      .withIndex("by_event_and_status", (q) => q.eq("eventId", event._id).eq("status", "waitlisted"))
      .collect();
    return { capacity: event.capacity, seatsTaken, waitlistCount: waitlisted.length };
  },
});
