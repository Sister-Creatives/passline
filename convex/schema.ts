import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export const rsvpStatus = v.union(
  v.literal("confirmed"),
  v.literal("waitlisted"),
  v.literal("confirmed_pending_claim"),
  v.literal("checked_in"),
  v.literal("cancelled"),
);

export default defineSchema({
  // Convex Auth tables (users, authSessions, authAccounts, etc.).
  ...authTables,

  organizers: defineTable({
    name: v.string(),
    email: v.string(),
    image: v.optional(v.string()),
  }).index("by_email", ["email"]),

  events: defineTable({
    organizerId: v.id("organizers"),
    title: v.string(),
    description: v.string(),
    startsAt: v.number(),
    endsAt: v.number(),
    location: v.string(),
    capacity: v.number(),
    status: v.union(v.literal("draft"), v.literal("published")),
    slug: v.string(),
    currency: v.optional(v.string()), // ISO 4217; code default "USD"
    feeMode: v.optional(v.union(v.literal("pass"), v.literal("absorb"))),
  })
    .index("by_organizer", ["organizerId"])
    .index("by_slug", ["slug"]),

  rsvps: defineTable({
    eventId: v.id("events"),
    name: v.string(),
    email: v.string(),
    token: v.string(),
    status: rsvpStatus,
    waitlistPosition: v.optional(v.number()),
    claimExpiresAt: v.optional(v.number()),
    // Set by rsvps.checkIn when the attendee is scanned in at the door. Kept
    // separate from `_creationTime` (which reflects the original RSVP, not
    // the check-in event) so the door dashboard's "recent check-ins" list can
    // sort by actual arrival time.
    checkedInAt: v.optional(v.number()),
  })
    .index("by_event", ["eventId"])
    .index("by_event_and_status", ["eventId", "status"])
    .index("by_token", ["token"]),

  ticketTypes: defineTable({
    eventId: v.id("events"),
    name: v.string(),
    kind: v.union(v.literal("paid"), v.literal("free"), v.literal("donation")),
    priceCents: v.number(),
    capacity: v.optional(v.number()),
    sold: v.number(),
    badge: v.optional(v.string()),
    minPerOrder: v.optional(v.number()),
    maxPerOrder: v.optional(v.number()),
    visibility: v.union(v.literal("visible"), v.literal("hidden")),
    sortOrder: v.number(),
    status: v.union(v.literal("active"), v.literal("archived")),
    gateAlert: v.optional(v.string()),
  }).index("by_event", ["eventId"]),

  apiKeys: defineTable({
    organizerId: v.id("organizers"),
    name: v.string(), // human label, e.g. "Production storefront"
    keyHash: v.string(), // lowercase hex SHA-256 of the full secret
    prefix: v.string(), // "pl_live_" — shown in the UI
    lastFour: v.string(), // last 4 chars of the secret, for display
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_organizer", ["organizerId"])
    .index("by_hash", ["keyHash"]),

  webhooks: defineTable({
    organizerId: v.id("organizers"),
    url: v.string(),
    secret: v.string(), // "whsec_" + 40 hex, shown once at creation
    subscribedEvents: v.array(v.string()), // e.g. ["ticket_type.created", "ticket_type.updated", "ticket_type.deleted"]
    active: v.boolean(),
    createdAt: v.number(),
  }).index("by_organizer", ["organizerId"]),

  webhookDeliveries: defineTable({
    webhookId: v.id("webhooks"),
    organizerId: v.id("organizers"),
    eventType: v.string(),
    payload: v.string(), // serialized JSON body that was signed
    status: v.union(
      v.literal("pending"),
      v.literal("delivered"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    lastAttemptAt: v.optional(v.number()),
    responseStatus: v.optional(v.number()),
  })
    .index("by_webhook", ["webhookId"])
    .index("by_organizer", ["organizerId"]),

  orders: defineTable({
    eventId: v.id("events"),
    organizerId: v.id("organizers"), // denormalized from the event for org-scoped queries
    buyerName: v.string(),
    buyerEmail: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("cancelled"),
    ),
    currency: v.string(),
    feeMode: v.union(v.literal("pass"), v.literal("absorb")),
    subtotalCents: v.number(),
    feeCents: v.number(),
    totalCents: v.number(),
    payoutCents: v.number(),
    token: v.string(), // opaque order token for buyer-facing lookup
    createdAt: v.number(),
    paidAt: v.optional(v.number()),
    discountCents: v.optional(v.number()),
    grossSubtotalCents: v.optional(v.number()),
    promoCode: v.optional(v.string()),
  })
    .index("by_event", ["eventId"])
    .index("by_organizer", ["organizerId"])
    .index("by_token", ["token"]),

  orderItems: defineTable({
    orderId: v.id("orders"),
    ticketTypeId: v.id("ticketTypes"),
    quantity: v.number(),
    unitPriceCents: v.number(), // snapshot of the price at purchase time
  }).index("by_order", ["orderId"]),

  tickets: defineTable({
    orderId: v.id("orders"),
    eventId: v.id("events"),
    ticketTypeId: v.id("ticketTypes"),
    code: v.string(), // unique QR/scan code
    status: v.union(
      v.literal("valid"),
      v.literal("checked_in"),
      v.literal("cancelled"),
    ),
    attendeeName: v.optional(v.string()),
    createdAt: v.number(),
    checkedInAt: v.optional(v.number()),
  })
    .index("by_order", ["orderId"])
    .index("by_event", ["eventId"])
    .index("by_code", ["code"]),

  promoCodes: defineTable({
    eventId: v.id("events"),
    organizerId: v.id("organizers"),
    code: v.string(), // stored UPPERCASE; matched case-insensitively
    discountKind: v.union(v.literal("percent"), v.literal("fixed")),
    percentBps: v.optional(v.number()), // when kind "percent": 1000 = 10%
    fixedCents: v.optional(v.number()), // when kind "fixed": flat cents off the subtotal
    maxRedemptions: v.optional(v.number()), // undefined = unlimited
    timesRedeemed: v.number(),
    active: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_event_and_code", ["eventId", "code"]),
});
