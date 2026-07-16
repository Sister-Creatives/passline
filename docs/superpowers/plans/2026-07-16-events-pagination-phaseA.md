# Events Pagination — Phase A (Denormalization Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Denormalize `seatsTaken` / `ticketsSold` / `revenueCents` onto the `events` doc, keep them correct via one idempotent helper wired into every write-path, and backfill existing data — with no UX change.

**Architecture:** A single `recomputeEventStats(ctx, eventId)` recomputes the three counters from that event's children and patches the event. It is called after every mutation that can move a counter (mapped in the spec), initialised to 0 on event creation, and applied to all existing events by a `@convex-dev/migrations` backfill.

**Tech Stack:** Convex (mutations, schema, `@convex-dev/migrations`), Vitest + convex-test.

## Global Constraints

- **Seat-holding statuses** = `SEAT_HOLDING_STATUSES` (`convex/lib/constants.ts`) = `["confirmed", "confirmed_pending_claim", "checked_in"]`. `seatsTaken` counts rsvps in this set only.
- **`ticketsSold`** = non-cancelled tickets (`status !== "cancelled"`) whose `orderId` belongs to a **paid** order. **`revenueCents`** = sum of `payoutCents` over **paid** orders (`status === "paid"`).
- **Root tsconfig has `noUnusedLocals` + `noUnusedParameters` ON** — `npx tsc --noEmit` fails on any unused import/local/param; must exit 0.
- **New schema fields are `v.optional(v.number())`** — additive/backward-compatible; reads treat `undefined` as `0`.
- **`recomputeEventStats` is the single source of truth** — recompute-from-children (idempotent, drift-proof), never incremental deltas.
- Package manager pnpm. Tests: `pnpm test`. Typecheck: `npx tsc --noEmit`.
- No em/en dashes in any user-facing string (not applicable to this backend-only phase, but hold the line in comments/messages: use `-` or `--`).

---

## File Structure

**Create:**
- `convex/lib/eventStats.ts` — `recomputeEventStats(ctx, eventId)`.
- `convex/lib/eventStats.test.ts` — helper unit test.
- `convex/migrations.ts` — migrations runner + `backfillEventStats`.

**Modify:**
- `convex/schema.ts` — add 3 optional fields to `events`.
- `convex/convex.config.ts` — register the migrations component.
- `convex/events.ts` — init counters to 0 in `createEvent` (line ~80) and `duplicateEvent` (line ~492).
- `convex/rsvps.ts` — recompute in `rsvp` and `cancelRsvp`.
- `convex/waitlist.ts` — recompute per distinct event in `sweep`.
- `convex/orders.ts` — recompute in `createOrder`, `createBoxOfficeOrder`, `markOrderPaid`, `refundOrder`.
- `convex/seed.ts` — recompute per seeded event.
- `convex/events.test.ts` (or new test files) — wiring tests per task.
- `package.json` — add `@convex-dev/migrations`.

---

## Task 1: Schema fields, `recomputeEventStats` helper, create/duplicate init

**Files:**
- Modify: `convex/schema.ts` (events table, after `createAt`/existing fields, before the `.index(...)` chain)
- Create: `convex/lib/eventStats.ts`
- Create: `convex/lib/eventStats.test.ts`
- Modify: `convex/events.ts:80` (createEvent insert), `convex/events.ts:492` (duplicateEvent insert)

**Interfaces:**
- Produces: `recomputeEventStats(ctx: MutationCtx, eventId: Id<"events">): Promise<void>` in `convex/lib/eventStats.ts`. Reads the event's rsvps/orders/tickets, patches `{ seatsTaken, ticketsSold, revenueCents }`. No-op if the event is gone.
- Produces: `events` docs now carry optional `seatsTaken`, `ticketsSold`, `revenueCents`.

- [ ] **Step 1: Add the schema fields**

In `convex/schema.ts`, inside `events: defineTable({ ... })`, add after the existing `createdAt` field:

```ts
    // Denormalized stats, maintained by recomputeEventStats on every write that
    // can move them (see convex/lib/eventStats.ts). Optional so the schema
    // deploys before the backfill; reads treat undefined as 0.
    seatsTaken: v.optional(v.number()),
    ticketsSold: v.optional(v.number()),
    revenueCents: v.optional(v.number()),
```

- [ ] **Step 2: Write the failing helper test**

Create `convex/lib/eventStats.test.ts`:

```ts
// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { recomputeEventStats } from "./eventStats";

const modules = import.meta.glob("../**/*.*s");

async function asOrganizer(t: TestConvex<typeof schema>, email: string) {
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, name: email });
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 1000 * 60 * 60,
    });
    return { userId, sessionId };
  });
  return { as: t.withIdentity({ subject: `${userId}|${sessionId}` }) };
}

test("recomputeEventStats writes seatsTaken/ticketsSold/revenueCents from children", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Mixer", description: "x", startsAt: 100, endsAt: 200, location: "Hall", capacity: 50,
  });
  const organizerId = (await t.run((ctx) => ctx.db.get(eventId)))!.organizerId;

  await t.run(async (ctx) => {
    // 2 seat-holding rsvps + 1 waitlisted (not counted).
    await ctx.db.insert("rsvps", { eventId, name: "A", email: "a@x.co", token: "t1", status: "confirmed" });
    await ctx.db.insert("rsvps", { eventId, name: "B", email: "b@x.co", token: "t2", status: "checked_in" });
    await ctx.db.insert("rsvps", { eventId, name: "C", email: "c@x.co", token: "t3", status: "waitlisted", waitlistPosition: 1 });
    // 1 paid order (payout 2000) with 1 valid ticket; 1 pending order (excluded).
    const ttId = await ctx.db.insert("ticketTypes", {
      eventId, name: "GA", kind: "paid", priceCents: 2000, sold: 0, visibility: "visible", sortOrder: 0, status: "active",
    });
    const base = { eventId, organizerId, buyerName: "Bo", buyerEmail: "bo@x.co", currency: "USD",
      feeMode: "absorb" as const, subtotalCents: 2000, feeCents: 0, totalCents: 2000, createdAt: Date.now() };
    const paid = await ctx.db.insert("orders", { ...base, status: "paid", payoutCents: 2000, token: "o1", paidAt: Date.now() });
    await ctx.db.insert("orders", { ...base, status: "pending", payoutCents: 2000, token: "o2" });
    await ctx.db.insert("tickets", { orderId: paid, eventId, ticketTypeId: ttId, code: "TK1", status: "valid", createdAt: Date.now() });
    await recomputeEventStats(ctx, eventId);
  });

  const ev = await t.run((ctx) => ctx.db.get(eventId));
  expect(ev?.seatsTaken).toBe(2);
  expect(ev?.ticketsSold).toBe(1);
  expect(ev?.revenueCents).toBe(2000);
});

test("createEvent initialises the counters to 0", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Empty", description: "x", startsAt: 1, endsAt: 2, location: "x", capacity: 5,
  });
  const ev = await t.run((ctx) => ctx.db.get(eventId));
  expect(ev?.seatsTaken).toBe(0);
  expect(ev?.ticketsSold).toBe(0);
  expect(ev?.revenueCents).toBe(0);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm test convex/lib/eventStats.test.ts`
Expected: FAIL — cannot resolve `./eventStats` (and counters undefined).

- [ ] **Step 4: Implement the helper**

Create `convex/lib/eventStats.ts`:

```ts
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { SEAT_HOLDING_STATUSES } from "./constants";

/**
 * Recompute an event's denormalized stats from its children and patch the doc.
 *
 * `seatsTaken` = rsvps in a seat-holding status; `revenueCents` = sum of
 * payoutCents over paid orders; `ticketsSold` = non-cancelled tickets on those
 * paid orders. Idempotent (recompute-from-children, never incremental), so it
 * is safe to call after any write, more than once, and from the backfill. A
 * no-op if the event has been deleted.
 */
export async function recomputeEventStats(
  ctx: MutationCtx,
  eventId: Id<"events">,
): Promise<void> {
  const event = await ctx.db.get(eventId);
  if (!event) return;

  const rsvps = await ctx.db
    .query("rsvps")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  const seatsTaken = rsvps.filter((r) =>
    (SEAT_HOLDING_STATUSES as readonly string[]).includes(r.status),
  ).length;

  const orders = await ctx.db
    .query("orders")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  const paidOrders = orders.filter((o) => o.status === "paid");
  const paidOrderIds = new Set(paidOrders.map((o) => o._id));
  const revenueCents = paidOrders.reduce((sum, o) => sum + o.payoutCents, 0);

  const tickets = await ctx.db
    .query("tickets")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  const ticketsSold = tickets.filter(
    (t) => t.status !== "cancelled" && paidOrderIds.has(t.orderId),
  ).length;

  await ctx.db.patch(eventId, { seatsTaken, ticketsSold, revenueCents });
}
```

- [ ] **Step 5: Initialise counters on create/duplicate**

In `convex/events.ts`, the `createEvent` insert at line ~80 (`const eventId = await ctx.db.insert("events", { ... })`) — add to the inserted object:

```ts
    seatsTaken: 0,
    ticketsSold: 0,
    revenueCents: 0,
```

Do the same for the `duplicateEvent` insert at line ~492 (`const newEventId = await ctx.db.insert("events", { ... })`). (A duplicate deliberately copies no rsvps/orders/tickets, so 0 is correct.)

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm test convex/lib/eventStats.test.ts`
Expected: PASS (2 tests). Then `npx tsc --noEmit` → no errors.

- [ ] **Step 7: Commit**

```bash
git add convex/schema.ts convex/lib/eventStats.ts convex/lib/eventStats.test.ts convex/events.ts
git commit -m "feat(events): denormalized event stat counters + recomputeEventStats"
```

---

## Task 2: Wire recompute into RSVP + waitlist paths

**Files:**
- Modify: `convex/rsvps.ts` (`rsvp` handler end ~line 113/131; `cancelRsvp` ~line 151)
- Modify: `convex/waitlist.ts` (`sweep` ~lines 65-92)
- Test: `convex/rsvps.test.ts` (append) or a new `convex/eventStats.wiring.test.ts`

**Interfaces:**
- Consumes: `recomputeEventStats` from `./lib/eventStats`.

- [ ] **Step 1: Write the failing wiring tests**

Append to `convex/rsvps.test.ts` (follow its existing `asOrganizer`/setup helpers; if it lacks them, use the `asOrganizer` from Task 1's test):

```ts
test("rsvp confirm raises seatsTaken; cancel with a waitlister nets to zero", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Tiny", description: "x", startsAt: 100, endsAt: 200, location: "Hall", capacity: 1,
  });
  const slug = (await t.run((ctx) => ctx.db.get(eventId)))!.slug;
  await as.mutation(api.events.publishEvent, { eventId });

  const first = await t.mutation(api.rsvps.rsvp, { slug, name: "A", email: "a@x.co" });
  expect(first.status).toBe("confirmed");
  expect((await t.run((ctx) => ctx.db.get(eventId)))!.seatsTaken).toBe(1);

  // Second RSVP is waitlisted (capacity 1).
  const second = await t.mutation(api.rsvps.rsvp, { slug, name: "B", email: "b@x.co" });
  expect(second.status).toBe("waitlisted");
  expect((await t.run((ctx) => ctx.db.get(eventId)))!.seatsTaken).toBe(1);

  // Cancel A -> promoteNext moves B into a seat-holding hold -> net seatsTaken stays 1.
  await t.mutation(api.rsvps.cancelRsvp, { token: first.token });
  expect((await t.run((ctx) => ctx.db.get(eventId)))!.seatsTaken).toBe(1);
});

// NOTE: sweep is seat-count-NEUTRAL. When a claim expires, the holder is sent to the
// back of the waitlist and then immediately re-promoted (Convex read-your-writes lets
// promoteNext see the row it just re-waitlisted), so a lone waitlister reclaims the seat
// and seatsTaken stays 1 -- it does NOT drop to 0. The sweep recompute is therefore a
// defensive per-event self-heal; to make its fan-out observable, corrupt the denormalized
// counter first and assert sweep heals it, across two events.
test("sweep recomputes seatsTaken for every affected event (per-event fan-out)", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const mk = async (title: string) => {
    const id = await as.mutation(api.events.createEvent, {
      title, description: "x", startsAt: 100, endsAt: 200, location: "H", capacity: 1,
    });
    await as.mutation(api.events.publishEvent, { eventId: id });
    return { id, slug: (await t.run((ctx) => ctx.db.get(id)))!.slug };
  };
  const e1 = await mk("E1");
  const e2 = await mk("E2");
  for (const e of [e1, e2]) {
    await t.mutation(api.rsvps.rsvp, { slug: e.slug, name: "A", email: `a@${e.slug}.co` });
    await t.mutation(api.rsvps.rsvp, { slug: e.slug, name: "B", email: `b@${e.slug}.co` });
    // Cancel A -> B is promoted into a confirmed_pending_claim hold (seatsTaken stays 1).
    const rows = await t.run((ctx) =>
      ctx.db.query("rsvps").withIndex("by_event", (q) => q.eq("eventId", e.id)).collect(),
    );
    const a = rows.find((r) => r.status === "confirmed")!;
    await t.mutation(api.rsvps.cancelRsvp, { token: a.token });
  }
  // Corrupt both denormalized counters so the per-event recompute's effect is observable.
  await t.run(async (ctx) => {
    await ctx.db.patch(e1.id, { seatsTaken: 99 });
    await ctx.db.patch(e2.id, { seatsTaken: 99 });
  });
  // Sweep far in the future expires both holds; recompute must heal both counters back to 1.
  await t.mutation(internal.waitlist.sweepExpiredClaims, { now: Date.now() + 60 * 60 * 1000 });
  expect((await t.run((ctx) => ctx.db.get(e1.id)))!.seatsTaken).toBe(1);
  expect((await t.run((ctx) => ctx.db.get(e2.id)))!.seatsTaken).toBe(1);
});
```

Ensure the test file imports `internal` (`import { internal } from "./_generated/api";`) and `schema`/`api`/`convexTest` as the existing tests do.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test convex/rsvps.test.ts`
Expected: FAIL — `seatsTaken` is `undefined`/stale because recompute is not wired in yet.

- [ ] **Step 3: Wire `rsvps.ts`**

Add the import at the top of `convex/rsvps.ts`:

```ts
import { recomputeEventStats } from "./lib/eventStats";
```

In the `rsvp` mutation, after each successful insert branch, recompute before returning. Concretely, on the confirmed branch (around line 113, after the confirmed insert, before `return { status: "confirmed" as const, token };`) and on the waitlist branch (around line 131, before `return { status: "waitlisted" ... }`), add:

```ts
    await recomputeEventStats(ctx, event._id);
```

(Simplest and safe: recompute once just before each of those two returns, using the `event` already in scope.)

In `cancelRsvp`, after the `promoteNext` call at line ~151, before `return null;`:

```ts
    await recomputeEventStats(ctx, row.eventId);
```

So it captures the net effect of the cancel + any promotion.

- [ ] **Step 4: Wire `waitlist.ts` `sweep`**

Add the import at the top of `convex/waitlist.ts`:

```ts
import { recomputeEventStats } from "./lib/eventStats";
```

In `sweep`, collect every touched event id and recompute each once after the loop. Replace the loop body's end and add a final pass:

```ts
  const touched = new Set<Id<"events">>();
  let reprocessed = 0;
  for (const hold of holds) {
    if ((hold.claimExpiresAt ?? 0) >= now) continue;

    const waitlisted = await ctx.db
      .query("rsvps")
      .withIndex("by_event_and_status", (q) =>
        q.eq("eventId", hold.eventId).eq("status", "waitlisted"),
      )
      .collect();
    const maxPosition = waitlisted.reduce((m, r) => Math.max(m, r.waitlistPosition ?? 0), 0);

    await ctx.db.patch(hold._id, {
      status: "waitlisted",
      waitlistPosition: maxPosition + 1,
      claimExpiresAt: undefined,
    });
    await promoteNext(ctx, hold.eventId, now);
    touched.add(hold.eventId);
    reprocessed++;
  }
  for (const eventId of touched) {
    await recomputeEventStats(ctx, eventId);
  }
  return reprocessed;
```

(`Id` is already imported in `waitlist.ts`.)

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm test convex/rsvps.test.ts`
Expected: PASS. Then `npx tsc --noEmit` → no errors, and `pnpm test` (full) stays green.

- [ ] **Step 6: Commit**

```bash
git add convex/rsvps.ts convex/waitlist.ts convex/rsvps.test.ts
git commit -m "feat(events): maintain seatsTaken across rsvp/cancel/waitlist-sweep"
```

---

## Task 3: Wire recompute into order paths

**Files:**
- Modify: `convex/orders.ts` (`createOrder` ~line 570, `createBoxOfficeOrder` ~line 625, `markOrderPaid` ~line 643, `refundOrder` ~line 863)
- Test: `convex/orders.test.ts` (append) or the wiring test file

**Interfaces:**
- Consumes: `recomputeEventStats` from `./lib/eventStats`.

- [ ] **Step 1: Write the failing tests**

First read `convex/orders.test.ts` and reuse the exact setup it already uses to stand up an organizer, a published event (`eventId`), and a valid **paid** ticket type (`ttId`) that `createBoxOfficeOrder` accepts — the file already creates working box-office/paid orders, so reuse that proven scaffolding rather than reconstructing `buildOrder`'s validation contract. Then append this test, whose assertions (the new behaviour) are the point:

```ts
test("box office sale raises ticketsSold + revenueCents; refund reverses both", async () => {
  // <-- set up organizer + published event `eventId` + paid ticket type `ttId`
  //     (priceCents 2000) using the SAME setup the other orders.test.ts tests use.

  // Sell 1 ticket at the door (cash = zero fee, so payout == subtotal == 2000):
  const { orderId } = await as.mutation(api.orders.createBoxOfficeOrder, {
    eventId, items: [{ ticketTypeId: ttId, quantity: 1 }], buyerName: "Bo", paymentMethod: "cash",
  });
  let ev = await t.run((ctx) => ctx.db.get(eventId));
  expect(ev!.ticketsSold).toBe(1);
  expect(ev!.revenueCents).toBe(2000);

  await as.mutation(api.orders.refundOrder, { orderId });
  ev = await t.run((ctx) => ctx.db.get(eventId));
  expect(ev!.ticketsSold).toBe(0);
  expect(ev!.revenueCents).toBe(0);
});
```

If the file has no reusable setup, build it with Task 1's `asOrganizer` + `createEvent`, then insert a `ticketTypes` row (`kind: "paid"`, `priceCents: 2000`, `capacity: 50`, `visibility: "visible"`, `sortOrder: 0`, `status: "active"`, `sold: 0`) before the sale. The assertions stay exactly as above.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test convex/orders.test.ts`
Expected: FAIL — counters not maintained yet.

- [ ] **Step 3: Wire the four order handlers**

Add the import at the top of `convex/orders.ts`:

```ts
import { recomputeEventStats } from "./lib/eventStats";
```

- `createOrder` (line ~570): immediately before `return { orderId, token: order.token, ... };`

```ts
    await recomputeEventStats(ctx, eventId);
```

- `createBoxOfficeOrder` (line ~625): immediately before `return { orderId, token: order.token, totalCents: order.totalCents };`

```ts
    await recomputeEventStats(ctx, eventId);
```

- `markOrderPaid` (line ~643): after `await issueTicketsAndMarkPaid(ctx, order);` and before `return null;` (the idempotent no-op already returned at line 642, so this only runs on the real transition):

```ts
    await recomputeEventStats(ctx, order.eventId);
```

- `refundOrder` (line ~863): after `await ctx.db.patch(orderId, { status: "refunded", refundedAt: Date.now() });` (and its audit), before the final `return null;`:

```ts
    await recomputeEventStats(ctx, order.eventId);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test convex/orders.test.ts`
Expected: PASS. Then `npx tsc --noEmit` → no errors; `pnpm test` (full) green.

- [ ] **Step 5: Commit**

```bash
git add convex/orders.ts convex/orders.test.ts
git commit -m "feat(events): maintain ticketsSold/revenueCents across order paid/refund"
```

---

## Task 4: Migrations component, backfill, and seed recompute

**Files:**
- Modify: `package.json` (add `@convex-dev/migrations`)
- Modify: `convex/convex.config.ts`
- Create: `convex/migrations.ts`
- Modify: `convex/seed.ts` (recompute per seeded event, ~after line 184 loop body)
- Test: `convex/migrations.test.ts`

**Interfaces:**
- Produces: `api.migrations.backfillEventStats` (a migration) + a runner.

- [ ] **Step 1: Install the migrations component**

Run: `pnpm add @convex-dev/migrations`
Expected: added to `package.json` dependencies.

In `convex/convex.config.ts`, register it alongside resend:

```ts
import { defineApp } from "convex/server";
import resend from "@convex-dev/resend/convex.config";
import migrations from "@convex-dev/migrations/convex.config";

const app = defineApp();
app.use(resend);
app.use(migrations);
export default app;
```

- [ ] **Step 2: Write the failing backfill test**

Create `convex/migrations.test.ts`:

```ts
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

test("backfillEventStats recomputes counters for a stale event", async () => {
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

  // Run the backfill over all events.
  await t.run(async (ctx) => {
    // migrateOne is exercised directly via the shared helper it wraps.
    await recomputeEventStats(ctx, eventId);
  });

  expect((await t.run((ctx) => ctx.db.get(eventId)))!.seatsTaken).toBe(2);
});
```

Note: convex-test does not run the migrations component's batch runner, so this test asserts the migration's per-row logic (`recomputeEventStats`, which `migrateOne` calls). The runner itself is verified manually in Step 5.

- [ ] **Step 3: Run to verify it passes structure**

Run: `pnpm test convex/migrations.test.ts`
Expected: PASS (it exercises `recomputeEventStats`, already implemented). If it fails, fix the import path.

- [ ] **Step 4: Create the migration**

Create `convex/migrations.ts`:

```ts
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
```

(Verify the exact `Migrations` / `migrations.define` / `runner` API against the installed `@convex-dev/migrations` version's README; adjust import/signature if the installed version differs. `migrateOne`'s `ctx` is a mutation ctx, so `recomputeEventStats(ctx, event._id)` is valid.)

- [ ] **Step 5: Wire seed recompute**

In `convex/seed.ts`, the per-event config loop inserts the event (line ~184) and then its rsvps/orders/tickets. At the end of each event's loop iteration (after all of that event's children are inserted, before the next config), add:

```ts
    await recomputeEventStats(ctx, eventId);
```

Add the import at the top of `convex/seed.ts`:

```ts
import { recomputeEventStats } from "./lib/eventStats";
```

- [ ] **Step 6: Typecheck, test, and run the backfill locally**

Run: `npx tsc --noEmit` → no errors.
Run: `pnpm test` → full suite green (incl. the new migration test).
Backfill (manual, against the dev deployment): after `npx convex dev` has pushed the new functions, run the migration:

```bash
npx convex run migrations:run '{"fn": "migrations:backfillEventStats"}'
```

Expected: completes; spot-check an event doc in the Convex dashboard has non-null counters. (If the runner invocation differs for the installed version, use the command from its README; this step is operational, not a test gate.)

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml convex/convex.config.ts convex/migrations.ts convex/migrations.test.ts convex/seed.ts
git commit -m "feat(events): migrations component + backfillEventStats + seed recompute"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** schema fields + helper (T1), create/duplicate init (T1), rsvp/cancel/sweep wiring (T2), order paid/refund wiring (T3), migrations + backfill + seed (T4). The mapped `markOrderPaid` idempotency guard and `sweep` per-event fan-out are both implemented explicitly. Phase A's spec item A5 (repointing `listMyEventsWithStats` at the denormalized fields) is intentionally deferred: it is throwaway (Phase B replaces that query) and the counters are already proven by the wiring tests; the current query keeps working unchanged against the additive schema.
- **No counter double-maintenance:** `promoteNext`, `buildOrder`, `issueTicketsAndMarkPaid` are helpers and deliberately do NOT recompute; only their calling mutations do, once, after all writes.
- **Idempotency:** `recomputeEventStats` is recompute-from-children, so multiple calls and the backfill converge to the same values; `markOrderPaid`'s early return keeps recompute off the no-op path.
- **Type consistency:** `recomputeEventStats(ctx: MutationCtx, eventId: Id<"events">): Promise<void>` is imported and called with those exact types in rsvps.ts, waitlist.ts, orders.ts, seed.ts, and migrations.ts.
- **Migrations API caveat:** flagged for the implementer to verify against the installed version; the per-row logic is helper-based so the test does not depend on the component runner.
