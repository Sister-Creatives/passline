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
  }).index("by_event", ["eventId"]),
});
