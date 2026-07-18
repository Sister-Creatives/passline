import { Migrations } from "@convex-dev/migrations";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { recomputeEventStats } from "./lib/eventStats";

export const migrations = new Migrations<DataModel>(components.migrations);
export const run = migrations.runner();

// Backfill the denormalized event counters for all existing events.
export const backfillEventStats = migrations.define({
  table: "events",
  migrateOne: async (ctx, event) => {
    await recomputeEventStats(ctx, event._id);
  },
});

// Backfill an owner membership for every pre-existing organizer that doesn't
// already have one. Idempotent: re-running adds no duplicates.
export const backfillOwnerMemberships = migrations.define({
  table: "organizers",
  migrateOne: async (ctx, organizer) => {
    const email = organizer.email.toLowerCase();
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizer._id))
      .filter((q) => q.eq(q.field("role"), "owner"))
      .first();
    if (existing) return;
    await ctx.db.insert("memberships", {
      organizerId: organizer._id,
      email,
      role: "owner",
      createdAt: Date.now(),
    });
  },
});
