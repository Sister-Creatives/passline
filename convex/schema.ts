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
  })
    .index("by_event", ["eventId"])
    .index("by_event_and_status", ["eventId", "status"])
    .index("by_token", ["token"]),
});
