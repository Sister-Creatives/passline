import {
  mutation,
  query,
  internalAction,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { getAuthOrganizerId } from "./auth";
import { resend } from "./email";

/** Load an event and enforce that it belongs to the authenticated organizer. */
async function requireOwnedEvent(ctx: QueryCtx | MutationCtx, eventId: Id<"events">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const event = await ctx.db.get(eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return event;
}

// Mirrors convex/email.ts: sender identity + the RESEND_API_KEY guard that
// makes delivery a clean no-op until a domain is verified and the key is set.
const FROM = "Passline <events@passline.app>";

function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Strip a tracking-pixel id down to the characters a Meta Pixel / GA / GTM id
 * ever legitimately contains. Applied both when persisting (defense in depth)
 * and, per F9 spec §5, again right before interpolating the id into a public
 * page's inline `<script>` -- so a stored id can never break out of the
 * script tag it's injected into.
 */
export function sanitizePixelId(id: string): string {
  return id.replace(/[^A-Za-z0-9-]/g, "");
}

/**
 * Trim a tracking-pixel input and treat an empty (or omitted) value as
 * "clear this field" -- an explicit `undefined` in a Convex `patch` removes
 * the optional column, mirroring the badge/gateAlert clearing pattern in
 * `ticketTypes.update`.
 */
function normalizePixelId(id: string | undefined): string | undefined {
  const trimmed = id?.trim();
  return trimmed ? sanitizePixelId(trimmed) : undefined;
}

/**
 * Owner-only: collect the distinct recipient emails for an event (buyers of
 * non-cancelled orders, ticket attendees, and legacy rsvps), record an
 * `emailCampaigns` row, and -- if there is at least one recipient -- schedule
 * `deliverCampaign` to actually send. Recording the campaign even when there
 * are zero recipients keeps the "sent campaigns" list an honest record of
 * every send attempt, not just the ones that reached someone.
 */
export const sendEventEmail = mutation({
  args: {
    eventId: v.id("events"),
    subject: v.string(),
    body: v.string(),
  },
  handler: async (ctx, { eventId, subject, body }) => {
    const event = await requireOwnedEvent(ctx, eventId);

    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();
    if (!trimmedSubject) throw new Error("Subject is required");
    if (!trimmedBody) throw new Error("Body is required");

    const [orders, tickets, rsvps] = await Promise.all([
      ctx.db.query("orders").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
      ctx.db.query("tickets").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
      ctx.db.query("rsvps").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
    ]);

    const emails = new Set<string>();
    for (const order of orders) {
      if (order.status !== "cancelled") emails.add(order.buyerEmail);
    }
    for (const ticket of tickets) {
      if (ticket.attendeeEmail) emails.add(ticket.attendeeEmail);
    }
    for (const rsvp of rsvps) {
      emails.add(rsvp.email);
    }
    const recipients = Array.from(emails);

    await ctx.db.insert("emailCampaigns", {
      eventId,
      organizerId: event.organizerId,
      subject: trimmedSubject,
      body: trimmedBody,
      recipientCount: recipients.length,
      createdAt: Date.now(),
    });

    if (recipients.length > 0) {
      await ctx.scheduler.runAfter(0, internal.marketing.deliverCampaign, {
        recipients,
        subject: trimmedSubject,
        body: trimmedBody,
      });
    }

    return { recipientCount: recipients.length };
  },
});

/**
 * Deliver a campaign to its recipient list via Resend. Guarded exactly like
 * `convex/email.ts`'s handlers: a clean no-op when `RESEND_API_KEY` is unset,
 * so scheduling this from `sendEventEmail` is safe in every environment.
 * `body` is organizer-authored and trusted (like `eventTitle` elsewhere), so
 * it is wrapped, not escaped, into the outgoing HTML.
 */
export const deliverCampaign = internalAction({
  args: {
    recipients: v.array(v.string()),
    subject: v.string(),
    body: v.string(),
  },
  handler: async (ctx, { recipients, subject, body }) => {
    if (!emailConfigured()) return;
    for (const recipient of recipients) {
      if (!recipient) continue;
      await resend.sendEmail(ctx, {
        from: FROM,
        to: recipient,
        subject,
        html: `<div>${body}</div><p style="color:#888;font-size:12px;margin-top:24px;">You are receiving this because you have a ticket or RSVP for this event on Passline.</p>`,
      });
    }
  },
});

/** Owner-only: an event's sent campaigns, newest first. */
export const listCampaigns = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireOwnedEvent(ctx, eventId);
    return ctx.db
      .query("emailCampaigns")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .order("desc")
      .collect();
  },
});

/** Owner-only: the event's current tracking-pixel configuration. */
export const getEventMarketing = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await requireOwnedEvent(ctx, eventId);
    return {
      metaPixelId: event.metaPixelId,
      googleAnalyticsId: event.googleAnalyticsId,
      gtmId: event.gtmId,
    };
  },
});

/**
 * Owner-only: patch an event's tracking-pixel ids. Each field is trimmed and
 * sanitized; an empty string (or an omitted field) clears it, mirroring the
 * optional-field clearing pattern used elsewhere (e.g. `ticketTypes.update`).
 */
export const updateTrackingPixels = mutation({
  args: {
    eventId: v.id("events"),
    metaPixelId: v.optional(v.string()),
    googleAnalyticsId: v.optional(v.string()),
    gtmId: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, metaPixelId, googleAnalyticsId, gtmId }) => {
    await requireOwnedEvent(ctx, eventId);
    await ctx.db.patch(eventId, {
      metaPixelId: normalizePixelId(metaPixelId),
      googleAnalyticsId: normalizePixelId(googleAnalyticsId),
      gtmId: normalizePixelId(gtmId),
    });
    return null;
  },
});
