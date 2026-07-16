// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { recomputeEventStats } from "./lib/eventStats";

const modules = import.meta.glob("./**/*.*s");

async function asOrganizer(t: TestConvex<typeof schema>, email: string) {
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, name: email });
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3.6e6 });
    return { userId, sessionId };
  });
  return { as: t.withIdentity({ subject: `${userId}|${sessionId}` }) };
}

// NOTE: this covers `backfillEventStats`'s per-row logic (`recomputeEventStats`, which
// `migrateOne` wraps), NOT the @convex-dev/migrations batch runner itself -- convex-test
// does not drive the component runner, so the runner path is verified operationally
// (a manual `npx convex run migrations:backfillEventStats` against dev) rather than here.
test("recomputeEventStats (backfillEventStats's per-row logic) corrects a stale counter", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Stale", description: "x", startsAt: 1, endsAt: 2, location: "H", capacity: 10,
  });

  // Insert seat-holding rsvps directly and force the counter stale (0),
  // simulating pre-denormalization data.
  await t.run(async (ctx) => {
    await ctx.db.insert("rsvps", { eventId, name: "A", email: "a@x.co", token: "t1", status: "confirmed" });
    await ctx.db.insert("rsvps", { eventId, name: "B", email: "b@x.co", token: "t2", status: "confirmed" });
    await ctx.db.patch(eventId, { seatsTaken: 0 });
  });

  // Exercise the per-row logic the migration runs (recomputeEventStats), which is what
  // `backfillEventStats.migrateOne` calls for each event.
  await t.run(async (ctx) => {
    await recomputeEventStats(ctx, eventId);
  });

  expect((await t.run((ctx) => ctx.db.get(eventId)))!.seatsTaken).toBe(2);
});
