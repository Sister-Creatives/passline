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
    // Legacy URL (auto-seeded from the auth user's avatar in `ensureOrganizer`).
    // Read-only fallback: `imageId` wins when set. Never written with a new value.
    image: v.optional(v.string()),
    imageId: v.optional(v.id("_storage")),
    defaultLocation: v.optional(v.string()),
    defaultCapacity: v.optional(v.number()),
    defaultCurrency: v.optional(v.string()),
    defaultFeeMode: v.optional(v.union(v.literal("pass"), v.literal("absorb"))),
  }).index("by_email", ["email"]),

  memberships: defineTable({
    organizerId: v.id("organizers"),
    email: v.string(), // normalized lowercase
    userId: v.optional(v.id("users")), // linked on first sign-in; unset = pending
    role: v.union(v.literal("owner"), v.literal("member")),
    createdAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_organizer", ["organizerId"]),

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
    // Opaque, unguessable per-event token that opens a draft on the public
    // read path (see convex/lib/preview.ts). Optional: existing events get
    // one lazily via `ensurePreviewToken`; new ones get one at creation.
    previewToken: v.optional(v.string()),
    currency: v.optional(v.string()), // ISO 4217; code default "USD"
    feeMode: v.optional(v.union(v.literal("pass"), v.literal("absorb"))),
    metaPixelId: v.optional(v.string()),
    googleAnalyticsId: v.optional(v.string()),
    gtmId: v.optional(v.string()),
    sharingDescription: v.optional(v.string()), // <= 160 chars; search/social meta
    eventType: v.optional(v.string()),          // one of EVENT_TYPES
    eventCategory: v.optional(v.string()),      // one of EVENT_CATEGORIES
    keywords: v.optional(v.array(v.string())),  // <= 10, trimmed, de-duped, non-empty
    hostProfileId: v.optional(v.id("hostProfiles")),
    // Explicit creation time. Real events leave this unset (surfaces fall back
    // to `_creationTime`); seed/import data sets it to backdate history.
    createdAt: v.optional(v.number()),
    // Denormalized stats, maintained by recomputeEventStats on every write that
    // can move them (see convex/lib/eventStats.ts). Optional so the schema
    // deploys before the backfill; reads treat undefined as 0.
    seatsTaken: v.optional(v.number()),
    ticketsSold: v.optional(v.number()),
    revenueCents: v.optional(v.number()),
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
    // Explicit registration time. Real RSVPs leave this unset (surfaces fall
    // back to `_creationTime`); seed/import data sets it to backdate history.
    createdAt: v.optional(v.number()),
  })
    .index("by_event", ["eventId"])
    .index("by_event_and_status", ["eventId", "status"])
    .index("by_token", ["token"]),

  eventSessions: defineTable({
    eventId: v.id("events"),
    organizerId: v.id("organizers"),
    startsAt: v.number(),
    endsAt: v.number(),
    capacity: v.number(), // per-session capacity (integer >= 1)
    sold: v.number(), // reserved seats for this session
    label: v.optional(v.string()), // e.g. "Matinee"
    sortOrder: v.number(),
  }).index("by_event", ["eventId"]),

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
    // Undefined = legacy full-access key (backward compat); otherwise the
    // exact set of API_SCOPES this key is allowed to use.
    scopes: v.optional(v.array(v.string())),
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
      v.literal("refunded"),
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
    refundedAt: v.optional(v.number()),
    paymentMethod: v.optional(
      v.union(v.literal("cash"), v.literal("card"), v.literal("online")),
    ),
    source: v.optional(v.union(v.literal("online"), v.literal("box_office"))),
    sessionId: v.optional(v.id("eventSessions")),
  })
    .index("by_event", ["eventId"])
    .index("by_organizer", ["organizerId"])
    .index("by_token", ["token"]),

  orderItems: defineTable({
    orderId: v.id("orders"),
    ticketTypeId: v.id("ticketTypes"),
    quantity: v.number(),
    unitPriceCents: v.number(), // snapshot of the price at purchase time
    // F10: the specific seats this line item reserved, for a seated ticket
    // type. Undefined for a GA item. Persisted here (not just on the seat
    // rows themselves) so ticket issuance -- which can happen well after
    // `buildOrder` reserves the seats, e.g. at payment confirmation -- and
    // cancelOrder's release both know exactly which seats belong to this
    // order without a reverse lookup.
    seatIds: v.optional(v.array(v.id("seats"))),
  }).index("by_order", ["orderId"]),

  seats: defineTable({
    eventId: v.id("events"),
    organizerId: v.id("organizers"),
    ticketTypeId: v.id("ticketTypes"), // the pricing tier for this seat
    section: v.string(),
    row: v.string(), // "A", "B", …
    number: v.number(), // 1..seatsPerRow
    status: v.union(v.literal("available"), v.literal("sold")),
    sortOrder: v.number(), // stable ordering across a section
  })
    .index("by_event", ["eventId"])
    .index("by_ticketType", ["ticketTypeId"]),

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
    attendeeEmail: v.optional(v.string()),
    createdAt: v.number(),
    checkedInAt: v.optional(v.number()),
    checkedOutAt: v.optional(v.number()),
    sessionId: v.optional(v.id("eventSessions")),
    seatId: v.optional(v.id("seats")),
    seatLabel: v.optional(v.string()),
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

  accessCodes: defineTable({
    eventId: v.id("events"),
    organizerId: v.id("organizers"),
    code: v.string(), // UPPERCASE, unique per event
    ticketTypeIds: v.array(v.id("ticketTypes")), // the hidden types this code unlocks
    active: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_event_and_code", ["eventId", "code"]),

  checkoutQuestions: defineTable({
    eventId: v.id("events"),
    organizerId: v.id("organizers"),
    label: v.string(),
    kind: v.union(v.literal("text"), v.literal("select"), v.literal("checkbox")),
    options: v.optional(v.array(v.string())), // required + non-empty when kind === "select"
    required: v.boolean(),
    sortOrder: v.number(),
    active: v.boolean(),
    createdAt: v.number(),
  }).index("by_event", ["eventId"]),

  orderResponses: defineTable({
    orderId: v.id("orders"),
    eventId: v.id("events"),
    questionId: v.id("checkoutQuestions"),
    label: v.string(), // snapshot of the question label at purchase time
    value: v.string(), // text; for checkbox "true"/"false"; for select the chosen option
  }).index("by_order", ["orderId"]),

  emailCampaigns: defineTable({
    eventId: v.id("events"),
    organizerId: v.id("organizers"),
    subject: v.string(),
    body: v.string(), // organizer-authored (trusted; may contain HTML)
    recipientCount: v.number(),
    createdAt: v.number(),
  }).index("by_event", ["eventId"]),

  addOns: defineTable({
    eventId: v.id("events"),
    organizerId: v.id("organizers"),
    name: v.string(),
    priceCents: v.number(), // integer cents, > 0 (add-ons are paid)
    capacity: v.optional(v.number()), // per-add-on cap; undefined = uncapped
    sold: v.number(),
    sortOrder: v.number(),
    active: v.boolean(),
  }).index("by_event", ["eventId"]),

  orderAddOns: defineTable({
    orderId: v.id("orders"),
    addOnId: v.id("addOns"),
    quantity: v.number(),
    unitPriceCents: v.number(), // snapshot at purchase
  }).index("by_order", ["orderId"]),

  eventContent: defineTable({
    eventId: v.id("events"),
    organizerId: v.id("organizers"),
    coverImageUrl: v.optional(v.string()),
    coverImageId: v.optional(v.id("_storage")),
    gallery: v.optional(
      v.array(v.object({ storageId: v.id("_storage"), alt: v.optional(v.string()) })),
    ),
    brandColor: v.optional(v.string()), // "#RRGGBB", validated via lib/eventContent.isValidHexColor
    ctaLabel: v.optional(v.string()), // e.g. "Register", "Donate", "RSVP" — replaces the default button text
    videoUrl: v.optional(v.string()), // a YouTube/Vimeo watch URL
    agenda: v.array(
      v.object({
        time: v.string(),
        title: v.string(),
        description: v.optional(v.string()),
      }),
    ),
    speakers: v.array(
      v.object({
        name: v.string(),
        title: v.optional(v.string()),
        bio: v.optional(v.string()),
        imageUrl: v.optional(v.string()),
      }),
    ),
    faqs: v.array(v.object({ question: v.string(), answer: v.string() })),
    coverImageAlt: v.optional(v.string()),
    accessibility: v.optional(
      v.object({
        wheelchairAccessible: v.optional(v.boolean()),
        signLanguage: v.optional(v.boolean()),
        closedCaptions: v.optional(v.boolean()),
        hearingLoop: v.optional(v.boolean()),
        accessibleParking: v.optional(v.boolean()),
        assistanceAnimalsWelcome: v.optional(v.boolean()),
        notes: v.optional(v.string()),
      }),
    ),
  }).index("by_event", ["eventId"]),

  auditLogs: defineTable({
    organizerId: v.id("organizers"), // the actor (single-user today; a member id can be added later)
    eventId: v.optional(v.id("events")),
    action: v.string(), // stable code, e.g. "event.published", "ticket_type.created"
    summary: v.string(), // human-readable, e.g. 'Created ticket type "Adult"'
    createdAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_organizer", ["organizerId"]),

  hostProfiles: defineTable({
    organizerId: v.id("organizers"),
    name: v.string(),
    bio: v.optional(v.string()), // <= 600 chars
    // Legacy https URL. Read-only fallback: `logoId` wins when set.
    logoUrl: v.optional(v.string()),
    logoId: v.optional(v.id("_storage")),
    websiteUrl: v.optional(v.string()), // https URL (validated)
    createdAt: v.number(),
  }).index("by_organizer", ["organizerId"]),

  virtualHubs: defineTable({
    eventId: v.id("events"),
    organizerId: v.id("organizers"),
    enabled: v.boolean(),
    heading: v.optional(v.string()),
    description: v.optional(v.string()),
    videoUrl: v.optional(v.string()), // YouTube/Vimeo, via parseVideoEmbed
    meetingUrl: v.optional(v.string()), // organizer-supplied https link (Zoom/Meet/…) — rendered as a link (href), never script
    resources: v.array(v.object({ title: v.string(), url: v.string() })),
    accessPassword: v.optional(v.string()), // optional shared password for non-ticket-holders
  }).index("by_event", ["eventId"]),

  emailChangeRequests: defineTable({
    userId: v.id("users"),
    newEmail: v.string(), // normalized lowercase
    codeHash: v.string(), // SHA-256 hex of the 6-digit code
    expiresAt: v.number(),
    attempts: v.number(),
  }).index("by_user", ["userId"]),
});
