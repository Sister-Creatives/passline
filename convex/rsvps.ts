import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { countSeatsTaken, nextWaitlistPosition } from "./lib/capacity";

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
