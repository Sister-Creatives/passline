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
