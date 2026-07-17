import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getAuthOrganizerId } from "./auth";
import { slugify } from "./lib/slug";
import { countSeatsTaken } from "./lib/capacity";
import { promoteNext } from "./waitlist";
import { recordAudit } from "./audit";
import { computeReadiness } from "./lib/readiness";
import { isEventCategory, isEventType, isValidSlug } from "./lib/eventTaxonomy";
import { SEAT_HOLDING_STATUSES } from "./lib/constants";
import { buildDateWindow, fromUtcDateString, toUtcDateString } from "./lib/timeseries";
import { buildPaceSpark } from "./lib/pace";

const CURRENCY_RE = /^[A-Z]{3}$/;
const MAX_KEYWORDS = 10;
const MAX_SHARING_DESCRIPTION_LENGTH = 160;

/** Trim a string; an empty (or omitted) value normalizes to `undefined` (i.e. "clear this field"), matching the `eventContent.ts` idiom. */
function normalizeOptionalString(s: string | undefined): string | undefined {
  const trimmed = s?.trim();
  return trimmed ? trimmed : undefined;
}

/** Trim every entry, drop empties, de-dupe (case-sensitive, first occurrence wins). */
function cleanKeywords(raw: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const keyword of raw) {
    const trimmed = keyword.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    cleaned.push(trimmed);
  }
  return cleaned;
}

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

/**
 * Load the child docs `computeReadiness` needs for an event. Sequential reads
 * (no Date.now()/randomness) keep the mutation transaction deterministic.
 */
async function loadReadinessInputs(ctx: QueryCtx | MutationCtx, eventId: Id<"events">) {
  const ticketTypes = await ctx.db
    .query("ticketTypes").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect();
  const seats = await ctx.db
    .query("seats").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect();
  const accessCodes = await ctx.db
    .query("accessCodes").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect();
  const eventContent = await ctx.db
    .query("eventContent").withIndex("by_event", (q) => q.eq("eventId", eventId)).unique();
  return { ticketTypes, seats, accessCodes, eventContent };
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
      seatsTaken: 0,
      ticketsSold: 0,
      revenueCents: 0,
    });
    return eventId;
  },
});

export const publishEvent = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await requireOwnedEvent(ctx, eventId);
    const { ticketTypes, seats, accessCodes, eventContent } = await loadReadinessInputs(ctx, eventId);
    const readiness = computeReadiness({
      event, ticketTypes, seats, accessCodes, eventContent, now: Date.now(),
    });
    if (!readiness.canPublish) {
      const blocker = readiness.rules.find((r) => r.severity === "required" && r.status === "fail");
      throw new Error(`Cannot publish: ${blocker?.label ?? "the event is not ready"}`);
    }
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
    currency: v.optional(v.string()),
    slug: v.optional(v.string()),
    eventType: v.optional(v.string()),
    eventCategory: v.optional(v.string()),
    keywords: v.optional(v.array(v.string())),
    sharingDescription: v.optional(v.string()),
    hostProfileId: v.optional(v.union(v.id("hostProfiles"), v.null())),
  },
  handler: async (
    ctx,
    {
      eventId, title, description, startsAt, endsAt, location, capacity,
      currency, slug, eventType, eventCategory, keywords, sharingDescription, hostProfileId,
    },
  ) => {
    const event = await requireOwnedEvent(ctx, eventId);
    if (capacity < 1) throw new Error("Capacity must be at least 1");

    const seatsTaken = await countSeatsTaken(ctx, eventId);
    if (capacity < seatsTaken) {
      throw new Error(`Capacity cannot be below the ${seatsTaken} seats already taken`);
    }

    // Only fields the caller actually provided end up as keys here -- an
    // omitted arg must leave the stored value untouched, while an explicit
    // empty string/array (where applicable) clears the field to `undefined`.
    const extraPatch: {
      currency?: string;
      slug?: string;
      eventType?: string | undefined;
      eventCategory?: string | undefined;
      keywords?: string[] | undefined;
      sharingDescription?: string | undefined;
      hostProfileId?: Id<"hostProfiles"> | undefined;
    } = {};

    if (currency !== undefined) {
      if (!CURRENCY_RE.test(currency)) throw new Error("Invalid currency code");
      extraPatch.currency = currency;
    }

    if (slug !== undefined && slug !== event.slug) {
      if (!isValidSlug(slug)) throw new Error("Invalid URL slug");
      const existing = await ctx.db
        .query("events")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
      if (existing && existing._id !== eventId) throw new Error("That URL is already taken");
      extraPatch.slug = slug;
    }

    if (eventType !== undefined) {
      if (eventType === "") {
        extraPatch.eventType = undefined;
      } else if (!isEventType(eventType)) {
        throw new Error("Invalid event type");
      } else {
        extraPatch.eventType = eventType;
      }
    }

    if (eventCategory !== undefined) {
      if (eventCategory === "") {
        extraPatch.eventCategory = undefined;
      } else if (!isEventCategory(eventCategory)) {
        throw new Error("Invalid event category");
      } else {
        extraPatch.eventCategory = eventCategory;
      }
    }

    if (keywords !== undefined) {
      const cleaned = cleanKeywords(keywords);
      if (cleaned.length > MAX_KEYWORDS) throw new Error(`Too many keywords (max ${MAX_KEYWORDS})`);
      extraPatch.keywords = cleaned.length > 0 ? cleaned : undefined;
    }

    if (sharingDescription !== undefined) {
      if (sharingDescription.length > MAX_SHARING_DESCRIPTION_LENGTH) {
        throw new Error("Sharing description must be 160 characters or fewer");
      }
      extraPatch.sharingDescription = normalizeOptionalString(sharingDescription);
    }

    if (hostProfileId !== undefined) {
      if (hostProfileId === null) {
        extraPatch.hostProfileId = undefined;
      } else {
        const profile = await ctx.db.get(hostProfileId);
        if (!profile || profile.organizerId !== event.organizerId) {
          throw new Error("Host profile not found");
        }
        extraPatch.hostProfileId = hostProfileId;
      }
    }

    await ctx.db.patch(eventId, { title, description, startsAt, endsAt, location, capacity, ...extraPatch });

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
 * Owner-scoped events list enriched for the `/events` cockpit.
 *
 * Per event: raw display fields plus a live `seatsTaken` (seat-holding RSVPs,
 * matching `countSeatsTaken`), the paid-channel `ticketsSold` / `revenueCents`,
 * a cumulative "pace to capacity" registration series (`spark`, right edge ==
 * `seatsTaken`), a cumulative paid-revenue series (`revenueSpark`, right edge ==
 * `revenueCents`), and a 30d-vs-prior-30d registration `deltaPct` (null when the
 * prior window is empty). Fans out over `by_event` like `dashboard.getOverview`,
 * kept per-event rather than flattened. Returns [] when unauthenticated.
 */
export const listMyEventsWithStats = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return [];

    const events = await ctx.db
      .query("events")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .order("desc")
      .collect();

    const window = buildDateWindow(now);
    const windowStartMs = fromUtcDateString(window[0]);

    return Promise.all(
      events.map(async (e) => {
        const [rsvps, tickets, orders] = await Promise.all([
          ctx.db.query("rsvps").withIndex("by_event", (q) => q.eq("eventId", e._id)).collect(),
          ctx.db.query("tickets").withIndex("by_event", (q) => q.eq("eventId", e._id)).collect(),
          ctx.db.query("orders").withIndex("by_event", (q) => q.eq("eventId", e._id)).collect(),
        ]);

        const { spark, deltaPct } = buildPaceSpark(rsvps, now);
        const seatsTaken = rsvps.filter((r) =>
          (SEAT_HOLDING_STATUSES as readonly string[]).includes(r.status),
        ).length;

        // Paid channel: revenue + tickets sold, and a cumulative revenue spark.
        const paidOrders = orders.filter((o) => o.status === "paid");
        const paidOrderIds = new Set(paidOrders.map((o) => o._id));
        const revenueCents = paidOrders.reduce((sum, o) => sum + o.payoutCents, 0);
        const ticketsSold = tickets.filter((t) => paidOrderIds.has(t.orderId)).length;

        const revByDay = new Map(window.map((d) => [d, 0]));
        let revBaseline = 0;
        for (const o of paidOrders) {
          const t = o.paidAt ?? o.createdAt;
          const key = toUtcDateString(t);
          if (t < windowStartMs || !revByDay.has(key)) revBaseline += o.payoutCents;
          else revByDay.set(key, revByDay.get(key)! + o.payoutCents);
        }
        let revRunning = revBaseline;
        const revenueSpark = window.map((d) => (revRunning += revByDay.get(d)!));

        return {
          _id: e._id,
          title: e.title,
          slug: e.slug,
          location: e.location,
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          status: e.status,
          capacity: e.capacity,
          currency: e.currency ?? "USD",
          seatsTaken,
          ticketsSold,
          revenueCents,
          spark,
          revenueSpark,
          deltaPct,
        };
      }),
    );
  },
});

/**
 * Owner-scoped KPI totals for the `/events` cockpit, summed from the
 * denormalized event counters (O(events), no child reads). Numbers only;
 * 30-day trend charts live on `/dashboard`. `now` is a client arg so the
 * upcoming/past boundary is reactive. Zeroed when unauthenticated.
 */
export const getMyEventsKpis = query({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) {
      return { total: 0, published: 0, draft: 0, upcoming: 0, attendees: 0, revenueCents: 0, ticketsSold: 0, currency: "USD" };
    }
    const events = await ctx.db
      .query("events")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .collect();
    const published = events.filter((e) => e.status === "published").length;
    return {
      total: events.length,
      published,
      draft: events.length - published,
      upcoming: events.filter((e) => e.endsAt >= now).length,
      attendees: events.reduce((s, e) => s + (e.seatsTaken ?? 0), 0),
      revenueCents: events.reduce((s, e) => s + (e.revenueCents ?? 0), 0),
      ticketsSold: events.reduce((s, e) => s + (e.ticketsSold ?? 0), 0),
      currency: events[0]?.currency ?? "USD",
    };
  },
});

/**
 * Server-side, in-memory paginated events list for the `/events` cockpit.
 *
 * Loads the organizer's event docs (cheap -- stats are denormalized), filters
 * by tab (endsAt vs now) + status + case-insensitive title/location search,
 * sorts by the chosen key, slices out page `page`, and enriches ONLY that
 * page's rows with their pace `spark` + `deltaPct` (per-row rsvps read). Returns
 * an empty page when unauthenticated. `now` is a client arg for the tab boundary.
 */
export const listMyEventsPage = query({
  args: {
    tab: v.union(v.literal("upcoming"), v.literal("past"), v.literal("all")),
    status: v.union(v.literal("all"), v.literal("published"), v.literal("draft")),
    sort: v.union(v.literal("date"), v.literal("fill"), v.literal("name")),
    search: v.string(),
    page: v.number(),
    pageSize: v.number(),
    now: v.number(),
  },
  handler: async (ctx, { tab, status, sort, search, page, pageSize, now }) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return { rows: [], page: 1, pageCount: 0, total: 0 };

    const all = await ctx.db
      .query("events")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .collect();

    const q = search.trim().toLowerCase();
    const filtered = all.filter((e) => {
      const inTab =
        tab === "all" ? true : tab === "upcoming" ? e.endsAt >= now : e.endsAt < now;
      const inStatus = status === "all" || e.status === status;
      const inSearch =
        q === "" || e.title.toLowerCase().includes(q) || e.location.toLowerCase().includes(q);
      return inTab && inStatus && inSearch;
    });

    const fillOf = (e: (typeof all)[number]) =>
      e.capacity > 0 ? (e.seatsTaken ?? 0) / e.capacity : 0;
    filtered.sort((a, b) => {
      if (sort === "name") return a.title.localeCompare(b.title);
      if (sort === "fill") return fillOf(b) - fillOf(a);
      // date: upcoming soonest-first (asc); past/all most-recent-first (desc)
      return tab === "upcoming" ? a.startsAt - b.startsAt : b.startsAt - a.startsAt;
    });

    const total = filtered.length;
    const pageCount = Math.ceil(total / pageSize);
    const clampedPage = Math.min(Math.max(1, page), Math.max(1, pageCount));
    const slice = filtered.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);

    const rows = await Promise.all(
      slice.map(async (e) => {
        const rsvps = await ctx.db
          .query("rsvps")
          .withIndex("by_event", (qq) => qq.eq("eventId", e._id))
          .collect();
        const { spark, deltaPct } = buildPaceSpark(rsvps, now);
        return {
          _id: e._id,
          title: e.title,
          slug: e.slug,
          location: e.location,
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          status: e.status,
          capacity: e.capacity,
          currency: e.currency ?? "USD",
          seatsTaken: e.seatsTaken ?? 0,
          ticketsSold: e.ticketsSold ?? 0,
          revenueCents: e.revenueCents ?? 0,
          spark,
          deltaPct,
        };
      }),
    );

    return { rows, page: clampedPage, pageCount, total };
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

/** Owner-only publish-readiness report, reactive so the builder rail updates live. */
export const getEventReadiness = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await requireOwnedEvent(ctx, eventId);
    const { ticketTypes, seats, accessCodes, eventContent } = await loadReadinessInputs(ctx, eventId);
    return computeReadiness({ event, ticketTypes, seats, accessCodes, eventContent, now: Date.now() });
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
      seatsTaken: 0,
      ticketsSold: 0,
      revenueCents: 0,
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
