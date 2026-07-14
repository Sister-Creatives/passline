import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getAuthOrganizerId } from "./auth";
import { slugify } from "./lib/slug";
import { countSeatsTaken } from "./lib/capacity";
import { promoteNext } from "./waitlist";
import { recordAudit } from "./audit";

/**
 * Load an event and verify it belongs to the currently authenticated
 * organizer. Throws if unauthenticated, if the event does not exist, or if it
 * belongs to a different organizer (ownership is enforced, not merely
 * checked, so callers never leak existence of other organizers' events).
 */
async function requireOwnedEvent(ctx: QueryCtx | MutationCtx, eventId: Id<"events">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const event = await ctx.db.get(eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return event;
}

export const createEvent = mutation({
  args: {
    title: v.string(),
    description: v.string(),
    startsAt: v.number(),
    endsAt: v.number(),
    location: v.string(),
    capacity: v.number(),
  },
  handler: async (ctx, args) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");
    if (args.capacity < 1) throw new Error("Capacity must be at least 1");
    const eventId = await ctx.db.insert("events", {
      organizerId,
      ...args,
      status: "draft",
      slug: slugify(args.title, crypto.randomUUID()),
    });
    return eventId;
  },
});

export const publishEvent = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await requireOwnedEvent(ctx, eventId);
    await ctx.db.patch(eventId, { status: "published" });
    await recordAudit(ctx, {
      organizerId: event.organizerId,
      eventId,
      action: "event.published",
      summary: "Published event",
    });
    return null;
  },
});

export const unpublishEvent = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await requireOwnedEvent(ctx, eventId);
    await ctx.db.patch(eventId, { status: "draft" });
    await recordAudit(ctx, {
      organizerId: event.organizerId,
      eventId,
      action: "event.unpublished",
      summary: "Unpublished event",
    });
    return null;
  },
});

/**
 * Update an existing event's editable fields (owner-only).
 *
 * Capacity may never drop below the number of seats already taken (a derived
 * count over seat-holding rsvp statuses, never a stored counter -- see
 * `countSeatsTaken`), so shrinking below that is rejected outright rather than
 * silently overbooking. Raising capacity, on the other hand, frees up seats
 * that may already have people waiting for them: after the patch, `promoteNext`
 * is called in a loop (once per freed seat) so every newly available seat is
 * immediately offered to the next waitlister, exactly as if that many seats had
 * been individually cancelled and re-promoted one at a time. The loop stops
 * itself once there is no more free capacity or the waitlist is empty (either
 * way `promoteNext` returns null).
 */
export const updateEvent = mutation({
  args: {
    eventId: v.id("events"),
    title: v.string(),
    description: v.string(),
    startsAt: v.number(),
    endsAt: v.number(),
    location: v.string(),
    capacity: v.number(),
  },
  handler: async (ctx, { eventId, title, description, startsAt, endsAt, location, capacity }) => {
    const event = await requireOwnedEvent(ctx, eventId);
    if (capacity < 1) throw new Error("Capacity must be at least 1");

    const seatsTaken = await countSeatsTaken(ctx, eventId);
    if (capacity < seatsTaken) {
      throw new Error(`Capacity cannot be below the ${seatsTaken} seats already taken`);
    }

    await ctx.db.patch(eventId, { title, description, startsAt, endsAt, location, capacity });

    if (capacity > event.capacity) {
      while ((await promoteNext(ctx, eventId, Date.now())) !== null) {
        // Keep offering freed seats to the waitlist until capacity is filled
        // or the waitlist runs out.
      }
    }

    await recordAudit(ctx, {
      organizerId: event.organizerId,
      eventId,
      action: "event.updated",
      summary: "Updated event details",
    });

    return null;
  },
});

/**
 * Delete an event and all of its rsvps (owner-only).
 *
 * Rsvps are not retained for a deleted event -- there is no cancellation email
 * or waitlist notice sent here, since the event itself is gone, not one seat
 * within it.
 */
export const deleteEvent = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await requireOwnedEvent(ctx, eventId);

    // Recorded before the delete so the row can reference this (about-to-be
    // -deleted) event id -- the log is a history and may outlive the event.
    await recordAudit(ctx, {
      organizerId: event.organizerId,
      eventId,
      action: "event.deleted",
      summary: `Deleted event "${event.title}"`,
    });

    const rsvps = await ctx.db
      .query("rsvps")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    for (const rsvp of rsvps) {
      await ctx.db.delete(rsvp._id);
    }

    await ctx.db.delete(eventId);
    return null;
  },
});

export const listMyEvents = query({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return [];
    return ctx.db
      .query("events")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .order("desc")
      .collect();
  },
});

/**
 * Owner-only view of an event plus its RSVPs, bucketed by status.
 *
 * Ownership is enforced by `requireOwnedEvent` (throws "Not found" for both a
 * missing event and one belonging to a different organizer, so callers never
 * learn which). RSVPs are loaded once via `by_event` and split into buckets
 * client code renders directly: `confirmed`, `pendingClaim` (holding a seat
 * pending claim), `waitlisted` (sorted ascending by `waitlistPosition`, so the
 * next-in-line is first), and `checkedIn`. This is the query the live
 * management page subscribes to, so any RSVP change (new RSVP, cancellation,
 * autopilot promotion) re-renders the page with no manual refetch.
 */
export const getMyEventWithRsvps = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await requireOwnedEvent(ctx, eventId);
    const rsvps = await ctx.db
      .query("rsvps")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();

    const confirmed = rsvps.filter((r) => r.status === "confirmed");
    const pendingClaim = rsvps.filter((r) => r.status === "confirmed_pending_claim");
    const checkedIn = rsvps.filter((r) => r.status === "checked_in");
    const waitlisted = rsvps
      .filter((r) => r.status === "waitlisted")
      .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0));

    return { event, confirmed, pendingClaim, waitlisted, checkedIn };
  },
});

export const getEventBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const event = await ctx.db
      .query("events")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!event || event.status !== "published") return null;
    return event;
  },
});

/**
 * Duplicate an event into a new draft "template" (owner-only).
 *
 * Copies the reusable config -- ticket types, checkout questions, add-ons,
 * page content (`eventContent`), and virtual hub config -- into a fresh
 * `events` row with a new title/slug and `status: "draft"`. Every copied
 * child row gets a fresh id and, where applicable, its counters reset
 * (`sold: 0`); `sortOrder` is preserved so the copy's ordering matches the
 * source. Deliberately does NOT copy orders/orderItems/orderAddOns/tickets/
 * rsvps/promoCodes/accessCodes/emailCampaigns -- a duplicate always starts
 * with zero activity (promo/access codes reference per-event ticket-type ids
 * that change on copy, so carrying them over would silently break them).
 */
export const duplicateEvent = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const source = await requireOwnedEvent(ctx, eventId);

    const title = `${source.title} (Copy)`;
    const newEventId = await ctx.db.insert("events", {
      organizerId: source.organizerId,
      title,
      description: source.description,
      startsAt: source.startsAt,
      endsAt: source.endsAt,
      location: source.location,
      capacity: source.capacity,
      status: "draft",
      slug: slugify(title, crypto.randomUUID()),
      currency: source.currency,
      feeMode: source.feeMode,
      metaPixelId: source.metaPixelId,
      googleAnalyticsId: source.googleAnalyticsId,
      gtmId: source.gtmId,
    });

    const ticketTypes = await ctx.db
      .query("ticketTypes")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    for (const ticketType of ticketTypes) {
      await ctx.db.insert("ticketTypes", {
        eventId: newEventId,
        name: ticketType.name,
        kind: ticketType.kind,
        priceCents: ticketType.priceCents,
        capacity: ticketType.capacity,
        sold: 0,
        badge: ticketType.badge,
        minPerOrder: ticketType.minPerOrder,
        maxPerOrder: ticketType.maxPerOrder,
        visibility: ticketType.visibility,
        sortOrder: ticketType.sortOrder,
        status: "active",
        gateAlert: ticketType.gateAlert,
      });
    }

    const questions = await ctx.db
      .query("checkoutQuestions")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    for (const question of questions) {
      await ctx.db.insert("checkoutQuestions", {
        eventId: newEventId,
        organizerId: source.organizerId,
        label: question.label,
        kind: question.kind,
        options: question.options,
        required: question.required,
        sortOrder: question.sortOrder,
        active: question.active,
        createdAt: Date.now(),
      });
    }

    const addOns = await ctx.db
      .query("addOns")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    for (const addOn of addOns) {
      await ctx.db.insert("addOns", {
        eventId: newEventId,
        organizerId: source.organizerId,
        name: addOn.name,
        priceCents: addOn.priceCents,
        capacity: addOn.capacity,
        sold: 0,
        sortOrder: addOn.sortOrder,
        active: addOn.active,
      });
    }

    const content = await ctx.db
      .query("eventContent")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .unique();
    if (content) {
      const { _id, _creationTime, eventId: _eventId, organizerId: _organizerId, ...rest } = content;
      await ctx.db.insert("eventContent", {
        eventId: newEventId,
        organizerId: source.organizerId,
        ...rest,
      });
    }

    const hub = await ctx.db
      .query("virtualHubs")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .unique();
    if (hub) {
      const { _id, _creationTime, eventId: _eventId, organizerId: _organizerId, ...rest } = hub;
      await ctx.db.insert("virtualHubs", {
        eventId: newEventId,
        organizerId: source.organizerId,
        ...rest,
      });
    }

    return newEventId;
  },
});

/**
 * Public: an organizer's `published` events for the host directory page
 * (`/host/$organizerId`), sorted ascending by `startsAt`. Loaded via
 * `by_organizer` then filtered to `published` in memory -- bounded per
 * organizer, mirroring `listMyEvents`. Returns a narrow projection (not the
 * full event doc) so the public directory never leaks `description`,
 * `capacity`, `currency`, or other org-internal fields.
 */
export const listPublishedByOrganizer = query({
  args: { organizerId: v.id("organizers") },
  handler: async (ctx, { organizerId }) => {
    const events = await ctx.db
      .query("events")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .collect();
    return events
      .filter((event) => event.status === "published")
      .sort((a, b) => a.startsAt - b.startsAt)
      .map((event) => ({
        id: event._id,
        title: event.title,
        slug: event.slug,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        location: event.location,
      }));
  },
});
