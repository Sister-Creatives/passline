# F1: Dashboard Shell + Ticket Types — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ticketTypes` model (paid/free/donation) with a full Convex CRUD API and a management UI, mounted inside a new Passline dashboard shell with a collapsible grouped sidebar.

**Architecture:** Convex holds the ticketing engine — one new `ticketTypes` table and one `convex/ticketTypes.ts` module whose functions are the future public API. The frontend gets a shared `DashboardLayout` (AuthGuard + the installed shadcn AppShell sidebar) wrapping the management pages; ticket types are managed from a tab on the event page. Additive only: the RSVP/waitlist/check-in path is untouched.

**Tech Stack:** Convex (queries/mutations, `convex-test` + Vitest edge-runtime), TanStack Start/Router (React 19, SSR), shadcn/ui (`radix-nova`, Tailwind v4), react-hook-form + zod, `@convex-dev/react-query`.

## Global Constraints

- **shadcn/ui for all UI.** Forms use the project's existing `@/components/ui/form` API (`Form`/`FormField`/`FormItem`/`FormLabel`/`FormControl`/`FormMessage`) — matching `EventForm.tsx`, **not** FieldGroup/Field.
- **Loading states use shadcn `Skeleton`** — never spinners or `"Loading…"` text.
- **Money is integer cents** (`priceCents`); currency is per-event (`events.currency`, code default `"USD"`). No floats in the data model.
- **Convex functions are organizer-authenticated and event-ownership-checked** via `getAuthOrganizerId` (from `convex/auth.ts`), mirroring `requireOwnedEvent` in `convex/events.ts`.
- **Package manager is `pnpm`.** Run Convex tests with `pnpm test`; typecheck with `pnpm exec tsc --noEmit`; build with `pnpm build`.
- **TDD for all Convex/util code**: failing test → run red → implement → run green → commit. Frontend component tasks are verified by `tsc` + build + manual drive (the codebase has no component-test harness; do not invent one).

## File Structure

**Create:**
- `convex/ticketTypes.ts` — ticket-type queries/mutations + validation helper (the API seam).
- `convex/ticketTypes.test.ts` — convex-test suite.
- `src/lib/format-money.ts` — `formatMoney(cents, currency)`.
- `src/lib/format-money.test.ts` — util test.
- `src/components/DashboardLayout.tsx` — `AuthGuard` + `AppShell` wrapper for management pages.
- `src/components/TicketTypesPanel.tsx` — list + Skeleton + Empty + create/edit Sheet + delete + reorder.
- `src/routes/settings/profile.tsx`, `payments.tsx`, `team.tsx`, `api-webhooks.tsx` — stub Settings pages.

**Modify:**
- `convex/schema.ts` — add `ticketTypes` table + `events.currency`.
- `convex/organizers.ts` — add `getMe` query.
- `src/components/app-shared.tsx` — replace demo nav data with real Passline nav.
- `src/components/app-sidebar.tsx` — render the collapsible Settings group; wire real routes.
- `src/components/nav-user.tsx` — real organizer (name/email) + working sign-out.
- `src/routes/dashboard.tsx` — Overview page inside `DashboardLayout` (retire the `@efferd` analytics demo).
- `src/routes/events/index.tsx` — wrap in `DashboardLayout`; Skeleton fallback.
- `src/routes/events/$id.index.tsx` — wrap body in shadcn `Tabs`; add a "Ticket types" tab rendering `TicketTypesPanel`.

---

## Task 1: Schema — `ticketTypes` table + `events.currency`

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add the field and table**

In `convex/schema.ts`, add `currency` to the `events` table definition (after `slug`):

```ts
    slug: v.string(),
    currency: v.optional(v.string()), // ISO 4217; code default "USD"
```

Add this table after the `rsvps` table (before the closing `});`):

```ts
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
```

- [ ] **Step 2: Regenerate Convex types and typecheck**

Run: `pnpm exec convex codegen && pnpm exec tsc --noEmit`
Expected: no errors (new `Doc<"ticketTypes">` type is generated).

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts convex/_generated
git commit -m "feat(ticketing): add ticketTypes table and events.currency"
```

---

## Task 2: `ticketTypes.create` + validation

**Files:**
- Create: `convex/ticketTypes.ts`
- Test: `convex/ticketTypes.test.ts`

**Interfaces:**
- Consumes: `getAuthOrganizerId` from `./auth`.
- Produces: `api.ticketTypes.create({ eventId, name, kind, priceCents, capacity?, badge?, minPerOrder?, maxPerOrder?, visibility? }) → Id<"ticketTypes">`; the internal helpers `requireOwnedEvent`, `requireOwnedTicketType`, `validateTicketTypeInput` used by Tasks 3–6.

- [ ] **Step 1: Write the failing test**

Create `convex/ticketTypes.test.ts`:

```ts
// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");

// Mirrors convex/events.test.ts: insert a real users row + session and hand
// withIdentity a matching subject so getAuthUserId resolves.
async function asOrganizer(t: TestConvex<typeof schema>, email: string) {
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, name: email });
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 1000 * 60 * 60,
    });
    return { userId, sessionId };
  });
  return { as: t.withIdentity({ subject: `${userId}|${sessionId}` }), userId };
}

async function makeEvent(as: ReturnType<TestConvex<typeof schema>["withIdentity"]>, capacity = 100) {
  return as.mutation(api.events.createEvent, {
    title: "Ticketed Event",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity,
  });
}

test("create inserts a ticket type with sold=0, active, appended sortOrder", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);

  const first = await as.mutation(api.ticketTypes.create, {
    eventId,
    name: "Adult",
    kind: "paid",
    priceCents: 2500,
    capacity: 40,
  });
  const second = await as.mutation(api.ticketTypes.create, {
    eventId,
    name: "Child",
    kind: "free",
    priceCents: 0,
  });

  const rows = await t.run((ctx) =>
    ctx.db.query("ticketTypes").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect(),
  );
  const adult = rows.find((r) => r._id === first)!;
  const child = rows.find((r) => r._id === second)!;
  expect(adult.sold).toBe(0);
  expect(adult.status).toBe("active");
  expect(adult.visibility).toBe("visible");
  expect(adult.sortOrder).toBe(0);
  expect(child.sortOrder).toBe(1);
});

test("create rejects a free ticket with a nonzero price", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await expect(
    as.mutation(api.ticketTypes.create, { eventId, name: "Bad", kind: "free", priceCents: 500 }),
  ).rejects.toThrow();
});

test("create rejects a per-type capacity above the event capacity", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as, 50);
  await expect(
    as.mutation(api.ticketTypes.create, { eventId, name: "Too big", kind: "paid", priceCents: 100, capacity: 51 }),
  ).rejects.toThrow();
});

test("create rejects an empty name and a negative price", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await expect(
    as.mutation(api.ticketTypes.create, { eventId, name: "   ", kind: "paid", priceCents: 100 }),
  ).rejects.toThrow();
  await expect(
    as.mutation(api.ticketTypes.create, { eventId, name: "Neg", kind: "paid", priceCents: -1 }),
  ).rejects.toThrow();
});

test("create rejects a second organizer and unauthenticated callers", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  await expect(
    asBob.mutation(api.ticketTypes.create, { eventId, name: "Hijack", kind: "paid", priceCents: 100 }),
  ).rejects.toThrow();
  await expect(
    t.mutation(api.ticketTypes.create, { eventId, name: "Anon", kind: "paid", priceCents: 100 }),
  ).rejects.toThrow();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test convex/ticketTypes.test.ts`
Expected: FAIL (`api.ticketTypes` does not exist).

- [ ] **Step 3: Implement `convex/ticketTypes.ts`**

```ts
import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getAuthOrganizerId } from "./auth";

const kindValidator = v.union(v.literal("paid"), v.literal("free"), v.literal("donation"));
const visibilityValidator = v.union(v.literal("visible"), v.literal("hidden"));

/** Load an event and enforce that it belongs to the authenticated organizer. */
async function requireOwnedEvent(ctx: QueryCtx | MutationCtx, eventId: Id<"events">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const event = await ctx.db.get(eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return event;
}

/** Load a ticket type + its event, enforcing organizer ownership of the event. */
async function requireOwnedTicketType(ctx: QueryCtx | MutationCtx, ticketTypeId: Id<"ticketTypes">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const ticketType = await ctx.db.get(ticketTypeId);
  if (!ticketType) throw new Error("Not found");
  const event = await ctx.db.get(ticketType.eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return { ticketType, event };
}

type TicketTypeInput = {
  name: string;
  kind: "paid" | "free" | "donation";
  priceCents: number;
  capacity?: number;
  minPerOrder?: number;
  maxPerOrder?: number;
};

/** Shared invariant checks for create + update (throws on the first violation). */
function validateTicketTypeInput(input: TicketTypeInput, eventCapacity: number) {
  if (input.name.trim().length === 0) throw new Error("Name is required");
  if (!Number.isInteger(input.priceCents) || input.priceCents < 0) {
    throw new Error("Price must be a whole number of cents of at least 0");
  }
  if (input.kind === "free" && input.priceCents !== 0) {
    throw new Error("Free ticket types must have a price of 0");
  }
  if (input.capacity !== undefined) {
    if (!Number.isInteger(input.capacity) || input.capacity < 1) {
      throw new Error("Capacity must be a whole number of at least 1");
    }
    if (input.capacity > eventCapacity) {
      throw new Error(`Capacity cannot exceed the event capacity of ${eventCapacity}`);
    }
  }
  if (
    input.minPerOrder !== undefined &&
    input.maxPerOrder !== undefined &&
    input.minPerOrder > input.maxPerOrder
  ) {
    throw new Error("Min per order cannot exceed max per order");
  }
}

export const create = mutation({
  args: {
    eventId: v.id("events"),
    name: v.string(),
    kind: kindValidator,
    priceCents: v.number(),
    capacity: v.optional(v.number()),
    badge: v.optional(v.string()),
    minPerOrder: v.optional(v.number()),
    maxPerOrder: v.optional(v.number()),
    visibility: v.optional(visibilityValidator),
  },
  handler: async (ctx, args) => {
    const event = await requireOwnedEvent(ctx, args.eventId);
    validateTicketTypeInput(args, event.capacity);
    const existing = await ctx.db
      .query("ticketTypes")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    const sortOrder = existing.reduce((max, t) => Math.max(max, t.sortOrder), -1) + 1;
    return await ctx.db.insert("ticketTypes", {
      eventId: args.eventId,
      name: args.name.trim(),
      kind: args.kind,
      priceCents: args.priceCents,
      capacity: args.capacity,
      sold: 0,
      badge: args.badge,
      minPerOrder: args.minPerOrder,
      maxPerOrder: args.maxPerOrder,
      visibility: args.visibility ?? "visible",
      sortOrder,
      status: "active",
    });
  },
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test convex/ticketTypes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add convex/ticketTypes.ts convex/ticketTypes.test.ts
git commit -m "feat(ticketing): ticketTypes.create with validation and ownership"
```

---

## Task 3: `ticketTypes.listForEvent`

**Files:**
- Modify: `convex/ticketTypes.ts`, `convex/ticketTypes.test.ts`

**Interfaces:**
- Produces: `api.ticketTypes.listForEvent({ eventId }) → Doc<"ticketTypes">[]` sorted ascending by `sortOrder`.

- [ ] **Step 1: Add the failing test** (append to `ticketTypes.test.ts`):

```ts
test("listForEvent returns the owner's ticket types sorted by sortOrder", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  await as.mutation(api.ticketTypes.create, { eventId, name: "A", kind: "paid", priceCents: 100 });
  await as.mutation(api.ticketTypes.create, { eventId, name: "B", kind: "paid", priceCents: 200 });
  const list = await as.query(api.ticketTypes.listForEvent, { eventId });
  expect(list.map((t) => t.name)).toEqual(["A", "B"]);
});

test("listForEvent rejects a non-owner", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  await expect(asBob.query(api.ticketTypes.listForEvent, { eventId })).rejects.toThrow();
});
```

- [ ] **Step 2: Run to verify fail** — `pnpm test convex/ticketTypes.test.ts` → FAIL (`listForEvent` undefined).

- [ ] **Step 3: Implement** (append to `ticketTypes.ts`):

```ts
export const listForEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireOwnedEvent(ctx, eventId);
    const types = await ctx.db
      .query("ticketTypes")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    return types.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});
```

- [ ] **Step 4: Run to verify pass** — `pnpm test convex/ticketTypes.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/ticketTypes.ts convex/ticketTypes.test.ts
git commit -m "feat(ticketing): ticketTypes.listForEvent"
```

---

## Task 4: `ticketTypes.update`

**Files:** Modify `convex/ticketTypes.ts`, `convex/ticketTypes.test.ts`

**Interfaces:**
- Produces: `api.ticketTypes.update({ ticketTypeId, name, kind, priceCents, capacity?, badge?, minPerOrder?, maxPerOrder?, visibility }) → null`. Re-validates invariants; clears optional fields when omitted.

- [ ] **Step 1: Add the failing test:**

```ts
test("update changes fields and re-validates", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const id = await as.mutation(api.ticketTypes.create, { eventId, name: "A", kind: "paid", priceCents: 100, capacity: 10 });
  await as.mutation(api.ticketTypes.update, {
    ticketTypeId: id, name: "A2", kind: "paid", priceCents: 250, visibility: "hidden",
  });
  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row?.name).toBe("A2");
  expect(row?.priceCents).toBe(250);
  expect(row?.visibility).toBe("hidden");
  expect(row?.capacity).toBeUndefined(); // omitted → cleared
  await expect(
    as.mutation(api.ticketTypes.update, { ticketTypeId: id, name: "A2", kind: "free", priceCents: 250, visibility: "visible" }),
  ).rejects.toThrow(); // free must be 0
});

test("update rejects a non-owner", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  const id = await asAda.mutation(api.ticketTypes.create, { eventId, name: "A", kind: "paid", priceCents: 100 });
  await expect(
    asBob.mutation(api.ticketTypes.update, { ticketTypeId: id, name: "X", kind: "paid", priceCents: 1, visibility: "visible" }),
  ).rejects.toThrow();
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement** (append):

```ts
export const update = mutation({
  args: {
    ticketTypeId: v.id("ticketTypes"),
    name: v.string(),
    kind: kindValidator,
    priceCents: v.number(),
    capacity: v.optional(v.number()),
    badge: v.optional(v.string()),
    minPerOrder: v.optional(v.number()),
    maxPerOrder: v.optional(v.number()),
    visibility: visibilityValidator,
  },
  handler: async (ctx, args) => {
    const { event } = await requireOwnedTicketType(ctx, args.ticketTypeId);
    validateTicketTypeInput(args, event.capacity);
    await ctx.db.patch(args.ticketTypeId, {
      name: args.name.trim(),
      kind: args.kind,
      priceCents: args.priceCents,
      capacity: args.capacity,
      badge: args.badge,
      minPerOrder: args.minPerOrder,
      maxPerOrder: args.maxPerOrder,
      visibility: args.visibility,
    });
    return null;
  },
});
```

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add convex/ticketTypes.ts convex/ticketTypes.test.ts
git commit -m "feat(ticketing): ticketTypes.update"
```

---

## Task 5: `ticketTypes.remove`

**Files:** Modify `convex/ticketTypes.ts`, `convex/ticketTypes.test.ts`

**Interfaces:** Produces `api.ticketTypes.remove({ ticketTypeId }) → null`.

- [ ] **Step 1: Add the failing test:**

```ts
test("remove deletes the ticket type; non-owner is rejected", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(asAda);
  const id = await asAda.mutation(api.ticketTypes.create, { eventId, name: "A", kind: "paid", priceCents: 100 });
  await expect(asBob.mutation(api.ticketTypes.remove, { ticketTypeId: id })).rejects.toThrow();
  await asAda.mutation(api.ticketTypes.remove, { ticketTypeId: id });
  const gone = await t.run((ctx) => ctx.db.get(id));
  expect(gone).toBeNull();
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement** (append):

```ts
export const remove = mutation({
  args: { ticketTypeId: v.id("ticketTypes") },
  handler: async (ctx, { ticketTypeId }) => {
    await requireOwnedTicketType(ctx, ticketTypeId);
    await ctx.db.delete(ticketTypeId);
    return null;
  },
});
```

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add convex/ticketTypes.ts convex/ticketTypes.test.ts
git commit -m "feat(ticketing): ticketTypes.remove"
```

---

## Task 6: `ticketTypes.reorder`

**Files:** Modify `convex/ticketTypes.ts`, `convex/ticketTypes.test.ts`

**Interfaces:** Produces `api.ticketTypes.reorder({ eventId, orderedIds }) → null`. `orderedIds` must be a permutation of the event's ticket-type ids; rewrites `sortOrder` to array index.

- [ ] **Step 1: Add the failing test:**

```ts
test("reorder rewrites sortOrder to the given order", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const a = await as.mutation(api.ticketTypes.create, { eventId, name: "A", kind: "paid", priceCents: 100 });
  const b = await as.mutation(api.ticketTypes.create, { eventId, name: "B", kind: "paid", priceCents: 200 });
  await as.mutation(api.ticketTypes.reorder, { eventId, orderedIds: [b, a] });
  const list = await as.query(api.ticketTypes.listForEvent, { eventId });
  expect(list.map((t) => t.name)).toEqual(["B", "A"]);
});

test("reorder rejects a non-permutation", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makeEvent(as);
  const a = await as.mutation(api.ticketTypes.create, { eventId, name: "A", kind: "paid", priceCents: 100 });
  await as.mutation(api.ticketTypes.create, { eventId, name: "B", kind: "paid", priceCents: 200 });
  await expect(as.mutation(api.ticketTypes.reorder, { eventId, orderedIds: [a] })).rejects.toThrow();
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement** (append):

```ts
export const reorder = mutation({
  args: { eventId: v.id("events"), orderedIds: v.array(v.id("ticketTypes")) },
  handler: async (ctx, { eventId, orderedIds }) => {
    await requireOwnedEvent(ctx, eventId);
    const types = await ctx.db
      .query("ticketTypes")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    const idSet = new Set(types.map((t) => t._id));
    if (orderedIds.length !== types.length || !orderedIds.every((id) => idSet.has(id))) {
      throw new Error("orderedIds must be a permutation of the event's ticket types");
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await ctx.db.patch(orderedIds[i], { sortOrder: i });
    }
    return null;
  },
});
```

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add convex/ticketTypes.ts convex/ticketTypes.test.ts
git commit -m "feat(ticketing): ticketTypes.reorder"
```

---

## Task 7: `organizers.getMe` query

**Files:** Modify `convex/organizers.ts`; Test `convex/organizers.test.ts` (create).

**Interfaces:** Produces `api.organizers.getMe({}) → Doc<"organizers"> | null` — the authenticated organizer, or null if unauthenticated/none.

- [ ] **Step 1: Write the failing test** — create `convex/organizers.test.ts`:

```ts
// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");

async function asOrganizer(t: TestConvex<typeof schema>, email: string) {
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, name: email });
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 });
    return { userId, sessionId };
  });
  return t.withIdentity({ subject: `${userId}|${sessionId}` });
}

test("getMe returns the authenticated organizer, null when signed out", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.organizers.getMe, {})).toBeNull();
  const as = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const me = await as.query(api.organizers.getMe, {});
  expect(me?.email).toBe("ada@example.com");
});
```

- [ ] **Step 2: Run to verify fail** — `pnpm test convex/organizers.test.ts` → FAIL.

- [ ] **Step 3: Implement** — in `convex/organizers.ts`, add `query` to the import and append:

```ts
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getAuthOrganizerId } from "./auth";

export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return null;
    return await ctx.db.get(organizerId);
  },
});
```

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add convex/organizers.ts convex/organizers.test.ts
git commit -m "feat(organizers): getMe query for the authenticated organizer"
```

---

## Task 8: `formatMoney` util

**Files:** Create `src/lib/format-money.ts`, `src/lib/format-money.test.ts`

**Interfaces:** Produces `formatMoney(cents: number, currency: string) → string`.

- [ ] **Step 1: Write the failing test** — `src/lib/format-money.test.ts`:

```ts
import { expect, test } from "vitest";
import { formatMoney } from "./format-money";

test("formats integer cents as a currency string", () => {
  expect(formatMoney(2500, "USD")).toBe("$25.00");
  expect(formatMoney(0, "USD")).toBe("$0.00");
  expect(formatMoney(199, "USD")).toBe("$1.99");
});
```

- [ ] **Step 2: Run to verify fail** — `pnpm test src/lib/format-money.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `src/lib/format-money.ts`:

```ts
/**
 * Format integer minor units (cents) as a currency string. Locale is pinned to
 * en-US for a deterministic dashboard display; per-locale formatting is a later
 * i18n concern.
 */
export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
```

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/format-money.ts src/lib/format-money.test.ts
git commit -m "feat(ui): formatMoney util"
```

---

## Task 9: Dashboard shell — layout, real sidebar nav, nav-user, Overview, Settings stubs

**Files:**
- Create: `src/components/DashboardLayout.tsx`, `src/routes/settings/profile.tsx`, `src/routes/settings/payments.tsx`, `src/routes/settings/team.tsx`, `src/routes/settings/api-webhooks.tsx`
- Modify: `src/components/app-shared.tsx`, `src/components/app-sidebar.tsx`, `src/components/nav-user.tsx`, `src/routes/dashboard.tsx`, `src/routes/events/index.tsx`

**Interfaces:** Produces `<DashboardLayout>` wrapping management pages with `AuthGuard` + `AppShell`.

- [ ] **Step 1: `DashboardLayout`** — create `src/components/DashboardLayout.tsx`:

```tsx
import { AuthGuard } from "@/components/AuthGuard";
import { AppShell } from "@/components/app-shell";

/** Auth-gated management layout: the shadcn sidebar shell around a page body. */
export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AppShell>{children}</AppShell>
    </AuthGuard>
  );
}
```

- [ ] **Step 2: Real nav data** — replace the body of `src/components/app-shared.tsx` with real Passline nav. Keep the exported type names (`SidebarNavItem`, `SidebarNavGroup`, `navGroups`, `navLinks`) so `app-sidebar.tsx`/`app-header.tsx` keep compiling; add a `settingsGroup`:

```tsx
import type { ReactNode } from "react";
import { LayoutDashboardIcon, CalendarIcon, SettingsIcon, UserIcon, CreditCardIcon, UsersIcon, PlugIcon } from "lucide-react";

export type SidebarNavItem = { title: string; path: string; icon?: ReactNode; isActive?: boolean };
export type SidebarNavGroup = { label: string; items: SidebarNavItem[] };

export const primaryNav: SidebarNavItem[] = [
  { title: "Overview", path: "/dashboard", icon: <LayoutDashboardIcon /> },
  { title: "Events", path: "/events", icon: <CalendarIcon /> },
];

export const settingsGroup = {
  title: "Settings",
  icon: <SettingsIcon />,
  items: [
    { title: "Organization profile", path: "/settings/profile", icon: <UserIcon /> },
    { title: "Payments", path: "/settings/payments", icon: <CreditCardIcon /> },
    { title: "Team", path: "/settings/team", icon: <UsersIcon /> },
    { title: "API & webhooks", path: "/settings/api-webhooks", icon: <PlugIcon /> },
  ] satisfies SidebarNavItem[],
};

// Back-compat exports still referenced by app-header.tsx.
export const navGroups: SidebarNavGroup[] = [{ label: "Menu", items: primaryNav }];
export const navLinks: SidebarNavItem[] = [...primaryNav, ...settingsGroup.items];
```

- [ ] **Step 3: Sidebar with collapsible Settings group** — replace `src/components/app-sidebar.tsx` body with real routes + a `Collapsible` + `SidebarMenuSub` group. Use TanStack `Link` and `useRouterState` for active state:

```tsx
"use client";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub,
  SidebarMenuSubButton, SidebarMenuSubItem, SidebarRail,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { primaryNav, settingsGroup } from "@/components/app-shared";
import { NavUser } from "@/components/nav-user";

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const settingsOpen = settingsGroup.items.some((i) => pathname.startsWith(i.path));

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="h-(--app-header-height,3rem) flex-row items-center px-3">
        <span className="font-semibold">Passline</span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {primaryNav.map((item) => (
              <SidebarMenuItem key={item.path}>
                <SidebarMenuButton asChild isActive={pathname === item.path} tooltip={item.title}>
                  <Link to={item.path}>
                    {item.icon}
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}

            <Collapsible defaultOpen={settingsOpen} className="group/collapsible">
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={settingsGroup.title}>
                    {settingsGroup.icon}
                    <span>{settingsGroup.title}</span>
                    <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {settingsGroup.items.map((sub) => (
                      <SidebarMenuSubItem key={sub.path}>
                        <SidebarMenuSubButton asChild isActive={pathname.startsWith(sub.path)}>
                          <Link to={sub.path}>
                            <span>{sub.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
```

If `@/components/ui/collapsible` does not exist yet, add it first: `pnpm dlx shadcn@latest add collapsible`.

- [ ] **Step 4: Real `nav-user`** — replace `src/components/nav-user.tsx` to read the organizer and sign out:

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useAuthActions } from "@convex-dev/auth/react";
import { LogOutIcon } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";

export function NavUser() {
  const { data: me, isPending } = useQuery(convexQuery(api.organizers.getMe, {}));
  const { signOut } = useAuthActions();

  if (isPending) return <Skeleton className="h-8 w-full" />;
  const name = me?.name ?? "Organizer";
  const email = me?.email ?? "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded-md p-1 text-left hover:bg-sidebar-accent">
          <Avatar className="size-8">
            {me?.image ? <AvatarImage src={me.image} /> : null}
            <AvatarFallback>{name.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{name}</div>
            <div className="truncate text-xs text-muted-foreground">{email}</div>
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" className="cursor-pointer" onSelect={() => signOut()}>
            <LogOutIcon />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 5: Overview page** — replace `src/routes/dashboard.tsx`:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../convex/_generated/api";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/dashboard")({ component: OverviewPage });

function OverviewPage() {
  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Overview</h1>
        <OverviewCards />
      </div>
    </DashboardLayout>
  );
}

function OverviewCards() {
  const { data: events, isPending } = useQuery(convexQuery(api.events.listMyEvents, {}));
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardDescription>Your events</CardDescription>
          <CardTitle className="text-3xl tabular-nums">
            {isPending ? <Skeleton className="h-9 w-12" /> : events!.length}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link to="/events">Manage events</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: Settings stub routes** — create four files. Example `src/routes/settings/profile.tsx` (repeat for `payments.tsx`, `team.tsx`, `api-webhooks.tsx`, changing the route path, `Empty` title, and component name):

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

export const Route = createFileRoute("/settings/profile")({ component: SettingsProfilePage });

function SettingsProfilePage() {
  return (
    <DashboardLayout>
      <Empty className="mt-12">
        <EmptyHeader>
          <EmptyTitle>Organization profile</EmptyTitle>
          <EmptyDescription>Coming soon.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </DashboardLayout>
  );
}
```

If `@/components/ui/empty` is not installed, run `pnpm dlx shadcn@latest add empty` first. (`payments.tsx` → `/settings/payments` title "Payments"; `team.tsx` → `/settings/team` title "Team"; `api-webhooks.tsx` → `/settings/api-webhooks` title "API & webhooks".)

- [ ] **Step 7: Wrap events list + Skeleton** — in `src/routes/events/index.tsx`, wrap the returned body in `DashboardLayout` (remove the now-redundant inner `AuthGuard`, since `DashboardLayout` provides it) and replace the Suspense fallback text with skeleton rows:

```tsx
// imports: add
import { DashboardLayout } from "@/components/DashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
// EventsIndexPage becomes:
function EventsIndexPage() {
  return (
    <DashboardLayout>
      <Suspense fallback={<TableSkeleton />}>
        <EventsListContent />
      </Suspense>
    </DashboardLayout>
  );
}

function TableSkeleton() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3 p-4 sm:p-8">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}
```

(Keep `EventsListContent` unchanged; delete the old `AuthGuard` import if no longer used.)

- [ ] **Step 8: Regenerate routes, typecheck, build**

Run: `pnpm generate-routes && pnpm exec tsc --noEmit && pnpm build`
Expected: all green; new `/settings/*` routes appear in `src/routeTree.gen.ts`.

- [ ] **Step 9: Commit**

```bash
git add src/components src/routes/dashboard.tsx src/routes/events/index.tsx src/routes/settings src/routeTree.gen.ts
git commit -m "feat(dashboard): Passline shell with collapsible sidebar, real nav-user, Overview, settings stubs"
```

---

## Task 10: Ticket Types panel — list, Skeleton, Empty (mounted on the event page)

**Files:**
- Create: `src/components/TicketTypesPanel.tsx`
- Modify: `src/routes/events/$id.index.tsx` (wrap body in `Tabs`; add a "Ticket types" tab)

**Interfaces:** Consumes `api.ticketTypes.listForEvent`, `formatMoney`. Produces `<TicketTypesPanel eventId currency />` and (Task 11) the create/edit/delete/reorder controls.

- [ ] **Step 1: List + Skeleton + Empty** — create `src/components/TicketTypesPanel.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatMoney } from "@/lib/format-money";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

const KIND_LABEL = { paid: "Paid", free: "Free", donation: "Donation" } as const;

export function TicketTypesPanel({ eventId, currency }: { eventId: Id<"events">; currency: string }) {
  const { data: types, isPending } = useQuery(convexQuery(api.ticketTypes.listForEvent, { eventId }));

  if (isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (types!.length === 0) {
    return (
      <Empty className="mt-6">
        <EmptyHeader>
          <EmptyTitle>No ticket types yet</EmptyTitle>
          <EmptyDescription>Create your first ticket type to start selling.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead className="text-right">Cap</TableHead>
          <TableHead className="text-right">Sold</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {types!.map((tt) => (
          <TableRow key={tt._id}>
            <TableCell className="font-medium">
              {tt.name}
              {tt.badge ? <Badge variant="secondary" className="ml-2">{tt.badge}</Badge> : null}
            </TableCell>
            <TableCell><Badge variant="outline">{KIND_LABEL[tt.kind]}</Badge></TableCell>
            <TableCell className="text-right tabular-nums">
              {tt.kind === "free" ? "Free" : formatMoney(tt.priceCents, currency)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{tt.capacity ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{tt.sold}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Mount as a tab on the event page** — in `src/routes/events/$id.index.tsx`: import `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` from `@/components/ui/tabs`, `DashboardLayout`, and `TicketTypesPanel`. Wrap the existing page body so the current content becomes the **Overview** tab and add a **Ticket types** tab. The event's currency is `event.currency ?? "USD"`. Skeleton pattern: the existing route already suspends; keep it. Concrete shape:

```tsx
// If tabs not installed: pnpm dlx shadcn@latest add tabs
// Inside the component that already has `event` in scope, wrap the rendered body:
<DashboardLayout>
  <Tabs defaultValue="overview" className="mx-auto w-full max-w-4xl p-4 sm:p-8">
    <TabsList>
      <TabsTrigger value="overview">Overview</TabsTrigger>
      <TabsTrigger value="tickets">Ticket types</TabsTrigger>
      <TabsTrigger value="attendees">Attendees</TabsTrigger>
    </TabsList>
    <TabsContent value="overview">{/* existing event detail body */}</TabsContent>
    <TabsContent value="tickets">
      <TicketTypesPanel eventId={event._id} currency={event.currency ?? "USD"} />
    </TabsContent>
    <TabsContent value="attendees">{/* existing attendee table body */}</TabsContent>
  </Tabs>
</DashboardLayout>
```

> Implementer note: open `$id.index.tsx` and move its current attendee/detail JSX into the matching `TabsContent`, preserving all existing logic and props. Do not duplicate queries — the existing `getMyEventWithRsvps` query already provides `event` and the rsvp buckets.

- [ ] **Step 3: Regenerate routes, typecheck, build**

Run: `pnpm generate-routes && pnpm exec tsc --noEmit && pnpm build`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/components/TicketTypesPanel.tsx src/routes/events/$id.index.tsx src/routeTree.gen.ts
git commit -m "feat(ticketing): ticket types list panel on the event page"
```

---

## Task 11: Create / edit / delete / reorder controls

**Files:** Modify `src/components/TicketTypesPanel.tsx`

**Interfaces:** Consumes `api.ticketTypes.create|update|remove|reorder` via `useMutation` from `convex/react`.

- [ ] **Step 1: Add the editor Sheet + toolbar** — extend `TicketTypesPanel.tsx`. Add imports:

```tsx
import { useState } from "react";
import { useMutation } from "convex/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import type { Doc } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ChevronUp, ChevronDown, Plus, Trash2 } from "lucide-react";
```

(If missing: `pnpm dlx shadcn@latest add toggle-group`.)

- [ ] **Step 2: Form schema + editor component** — add above `TicketTypesPanel`:

```tsx
const ticketTypeFormSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    kind: z.enum(["paid", "free", "donation"]),
    price: z.string(), // dollars as string; converted to cents at submit
    capacity: z.string(),
    badge: z.string(),
    visibility: z.enum(["visible", "hidden"]),
  })
  .refine((v) => v.kind === "free" || v.price.trim() === "" || Number(v.price) >= 0, {
    message: "Price must be 0 or more",
    path: ["price"],
  });

type TicketTypeFormValues = z.infer<typeof ticketTypeFormSchema>;

function toCents(dollars: string): number {
  const n = Number(dollars);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function TicketTypeEditor({
  eventId, ticketType, onDone,
}: { eventId: Id<"events">; ticketType?: Doc<"ticketTypes">; onDone: () => void }) {
  const create = useMutation(api.ticketTypes.create);
  const update = useMutation(api.ticketTypes.update);
  const form = useForm<TicketTypeFormValues>({
    resolver: zodResolver(ticketTypeFormSchema),
    defaultValues: ticketType
      ? {
          name: ticketType.name,
          kind: ticketType.kind,
          price: String((ticketType.priceCents / 100).toFixed(2)),
          capacity: ticketType.capacity != null ? String(ticketType.capacity) : "",
          badge: ticketType.badge ?? "",
          visibility: ticketType.visibility,
        }
      : { name: "", kind: "paid", price: "", capacity: "", badge: "", visibility: "visible" },
  });
  const kind = form.watch("kind");

  async function onSubmit(values: TicketTypeFormValues) {
    const priceCents = values.kind === "free" ? 0 : toCents(values.price);
    const capacity = values.capacity.trim() === "" ? undefined : Number(values.capacity);
    const badge = values.badge.trim() === "" ? undefined : values.badge.trim();
    try {
      if (ticketType) {
        await update({ ticketTypeId: ticketType._id, name: values.name, kind: values.kind, priceCents, capacity, badge, visibility: values.visibility });
        toast.success("Ticket type updated");
      } else {
        await create({ eventId, name: values.name, kind: values.kind, priceCents, capacity, badge, visibility: values.visibility });
        toast.success("Ticket type created");
      }
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save ticket type");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem><FormLabel>Name</FormLabel><FormControl><Input placeholder="Adult" {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="kind" render={({ field }) => (
          <FormItem>
            <FormLabel>Kind</FormLabel>
            <FormControl>
              <ToggleGroup type="single" value={field.value} onValueChange={(v) => v && field.onChange(v)} variant="outline">
                <ToggleGroupItem value="paid">Paid</ToggleGroupItem>
                <ToggleGroupItem value="free">Free</ToggleGroupItem>
                <ToggleGroupItem value="donation">Donation</ToggleGroupItem>
              </ToggleGroup>
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />
        {kind !== "free" && (
          <FormField control={form.control} name="price" render={({ field }) => (
            <FormItem><FormLabel>{kind === "donation" ? "Suggested price" : "Price"}</FormLabel><FormControl><Input type="number" min={0} step="0.01" placeholder="25.00" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
        )}
        <FormField control={form.control} name="capacity" render={({ field }) => (
          <FormItem><FormLabel>Capacity (optional)</FormLabel><FormControl><Input type="number" min={1} placeholder="Uncapped" {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="badge" render={({ field }) => (
          <FormItem><FormLabel>Badge (optional)</FormLabel><FormControl><Input placeholder="Early Bird" {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {ticketType ? "Save changes" : "Create ticket type"}
        </Button>
      </form>
    </Form>
  );
}
```

- [ ] **Step 3: Wire toolbar, row actions, reorder into `TicketTypesPanel`** — add local state + a `reorder`/`remove` mutation, a "New ticket type" `Sheet` in a header row above the table, and per-row Edit `Sheet` / Delete `AlertDialog` / up-down buttons. Reorder swaps neighbors and calls `reorder({ eventId, orderedIds })` with the new id order. Header + actions:

```tsx
// inside TicketTypesPanel, before the return:
const remove = useMutation(api.ticketTypes.remove);
const reorder = useMutation(api.ticketTypes.reorder);
const [editing, setEditing] = useState<Doc<"ticketTypes"> | null>(null);
const [creating, setCreating] = useState(false);

async function move(index: number, direction: -1 | 1) {
  const ids = types!.map((t) => t._id);
  const target = index + direction;
  if (target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  await reorder({ eventId, orderedIds: ids });
}
```

Header (render above the `Table`, and also above the `Empty` state):

```tsx
<div className="mb-4 flex items-center justify-between">
  <h2 className="text-lg font-medium">Ticket types</h2>
  <Sheet open={creating} onOpenChange={setCreating}>
    <SheetTrigger asChild><Button size="sm"><Plus /> New ticket type</Button></SheetTrigger>
    <SheetContent>
      <SheetHeader><SheetTitle>New ticket type</SheetTitle></SheetHeader>
      <div className="p-4">
        <TicketTypeEditor eventId={eventId} onDone={() => setCreating(false)} />
      </div>
    </SheetContent>
  </Sheet>
</div>
```

Row actions cell (append a `<TableHead />` and a trailing `<TableCell>` per row):

```tsx
<TableCell className="text-right">
  <div className="flex items-center justify-end gap-1">
    <Button variant="ghost" size="icon-sm" onClick={() => move(index, -1)} aria-label="Move up"><ChevronUp /></Button>
    <Button variant="ghost" size="icon-sm" onClick={() => move(index, 1)} aria-label="Move down"><ChevronDown /></Button>
    <Sheet open={editing?._id === tt._id} onOpenChange={(o) => setEditing(o ? tt : null)}>
      <SheetTrigger asChild><Button variant="outline" size="sm">Edit</Button></SheetTrigger>
      <SheetContent>
        <SheetHeader><SheetTitle>Edit ticket type</SheetTitle></SheetHeader>
        <div className="p-4"><TicketTypeEditor eventId={eventId} ticketType={tt} onDone={() => setEditing(null)} /></div>
      </SheetContent>
    </Sheet>
    <AlertDialog>
      <AlertDialogTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Delete"><Trash2 /></Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{tt.name}”?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={async () => { await remove({ ticketTypeId: tt._id }); toast.success("Ticket type deleted"); }}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</TableCell>
```

(Change `types!.map((tt) => ...)` to `types!.map((tt, index) => ...)` so `move` has the index.)

- [ ] **Step 4: Typecheck + build** — `pnpm exec tsc --noEmit && pnpm build` → green.

- [ ] **Step 5: Commit**

```bash
git add src/components/TicketTypesPanel.tsx
git commit -m "feat(ticketing): create, edit, delete, reorder ticket types"
```

---

## Task 12: Full verification + deploy prep

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite** — `pnpm test` → all Convex tests pass (existing + new ticketTypes/organizers).
- [ ] **Step 2: Typecheck + build** — `pnpm exec tsc --noEmit && pnpm build` → green.
- [ ] **Step 3: Drive-verify** — start the app (`pnpm dev`), sign in, open an event → **Ticket types** tab. Create a Paid ($25), a Free, and a Donation type; confirm the skeleton→content transition, the list, price formatting, edit, reorder (up/down), and delete. Confirm the collapsible **Settings** group expands and its stub pages render. Confirm `/dashboard` shows Overview (not the old analytics demo).
- [ ] **Step 4: Deploy** — hand off to the deploy workflow (Vercel + Convex prod). Confirm the deploy target with the user first (Vercel project, Convex production deployment name, env vars). Then loop to slice F2.

---

## Self-Review

- **Spec coverage:** ticketTypes model (§4 → T1), `create/list/update/remove/reorder` API (§7 → T2–T6), `formatMoney`/cents (§ conventions → T8), dashboard shell + collapsible grouped sidebar + real nav-user + skeletons (§5 → T9), ticket-types tab UI (§6 → T10–T11), retire `@efferd` analytics from `/dashboard` (§2 → T9 Step 5), TDD + build + drive (§8 → each task + T12). Covered.
- **Deviation from spec (intentional):** spec §6 mentioned `FieldGroup/Field`; the plan uses the project's actual `@/components/ui/form` API for consistency with `EventForm.tsx`/`login.tsx` (documented in Global Constraints).
- **Type consistency:** `requireOwnedEvent`/`requireOwnedTicketType`/`validateTicketTypeInput` defined in T2 and reused verbatim in T3–T6; `formatMoney(cents, currency)` defined T8, consumed T10; `getMe` defined T7, consumed T9. Consistent.
- **Placeholder scan:** the only "existing body" placeholders are in T10 Step 2, where the implementer relocates already-written JSX from `$id.index.tsx` into tab panels — an explicit move instruction, not omitted code.
