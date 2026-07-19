# Organizer Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the header bell a real organizer notification center (live unread badge + dropdown) generated from attendee activity, and wire the Help button to a small dropdown.

**Architecture:** A `notifications` table, organizer-scoped. A shared `createNotification` helper is called inline (same transaction) from the existing public `rsvp`/`cancelRsvp` mutations. Reactive Convex queries drive the badge and list in real time. Three tasks: (1) backend data layer + read/write API, (2) generation triggers in `rsvps.ts`, (3) frontend bell + Help menu.

**Tech Stack:** Convex (queries/mutations, indexes, `getAuthOrganizerId`), TanStack Router, `@convex-dev/react-query`, shadcn/ui DropdownMenu, date-fns, Vitest + convex-test (edge-runtime).

## Global Constraints

- Notifications are **organizer-scoped** and use a **single shared `read` flag** (team-shared read state).
- Generation is **transactional** with the activity (inline `ctx.db.insert`, not scheduled) and must fire **only on genuinely new rows** — never on the `rsvp` dedupe/repeat-submission early returns.
- **Sold out** fires only when a confirm fills the last seat: pre-insert `seatsTaken + 1 === event.capacity`.
- Queries resolve the caller via `getAuthOrganizerId`; unauthenticated → `list` returns `[]`, `unreadCount` returns `0`; mutations throw `"Not authenticated"`. `markRead` rejects a notification whose `organizerId` isn't the caller's org.
- Convex test files begin with `// @vitest-environment edge-runtime`, pass `import.meta.glob("./**/*.*s")` as modules, and (because they exercise `rsvp`, which calls the rate limiter) use the `rawConvexTest` + `registerRateLimiter` wrapper and the `asOrganizer`/`seedPublishedEvent` helpers exactly as in `convex/rsvps.test.ts`.

## File Structure

- Modify: `convex/schema.ts` — add the `notifications` table.
- Create: `convex/notifications.ts` — `createNotification` helper + `list`/`unreadCount` queries + `markRead`/`markAllRead` mutations.
- Modify: `convex/rsvps.ts` — call `createNotification` from `rsvp` (confirmed/waitlist/sold-out) and `cancelRsvp` (cancellation).
- Create: `convex/notifications.test.ts` — data-layer tests (Task 1) + generation tests (Task 2).
- Create: `src/components/notifications-menu.tsx` — the bell dropdown.
- Modify: `src/components/app-header.tsx` — mount `NotificationsMenu`; wire Help to a dropdown.

---

### Task 1: Notifications table + read/write API

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/notifications.ts`
- Test: `convex/notifications.test.ts`

**Interfaces:**
- Produces:
  - `createNotification(ctx: MutationCtx, args: { organizerId: Id<"organizers">; type: NotificationType; title: string; body: string; eventId?: Id<"events"> }) => Promise<void>` (exported helper; used by Task 2)
  - `api.notifications.list () => Doc<"notifications">[]` (newest ≤30 for the caller's org)
  - `api.notifications.unreadCount () => number`
  - `api.notifications.markRead ({ notificationId: Id<"notifications"> }) => null`
  - `api.notifications.markAllRead () => null`
  - Type: `NotificationType = "rsvp" | "waitlist" | "sold_out" | "cancellation"`

- [ ] **Step 1: Add the schema table.** In `convex/schema.ts` add to the tables object:

```ts
  notifications: defineTable({
    organizerId: v.id("organizers"),
    type: v.union(
      v.literal("rsvp"),
      v.literal("waitlist"),
      v.literal("sold_out"),
      v.literal("cancellation"),
    ),
    title: v.string(),
    body: v.string(),
    eventId: v.optional(v.id("events")),
    read: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_organizer", ["organizerId", "createdAt"])
    .index("by_organizer_unread", ["organizerId", "read"]),
```

Run: `./node_modules/.bin/convex codegen` — expect it to regenerate `_generated` without error.

- [ ] **Step 2: Write `convex/notifications.ts`.**

```ts
import { v } from "convex/values";
import { query, mutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthOrganizerId } from "./auth";

const LIST_LIMIT = 30;

export const notificationType = v.union(
  v.literal("rsvp"),
  v.literal("waitlist"),
  v.literal("sold_out"),
  v.literal("cancellation"),
);
export type NotificationType = "rsvp" | "waitlist" | "sold_out" | "cancellation";

/**
 * Insert a notification for an organizer. Called inline (same transaction) from
 * the activity that triggers it, so a notification only exists if the activity
 * actually committed.
 */
export async function createNotification(
  ctx: MutationCtx,
  args: {
    organizerId: Id<"organizers">;
    type: NotificationType;
    title: string;
    body: string;
    eventId?: Id<"events">;
  },
): Promise<void> {
  await ctx.db.insert("notifications", {
    organizerId: args.organizerId,
    type: args.type,
    title: args.title,
    body: args.body,
    eventId: args.eventId,
    read: false,
    createdAt: Date.now(),
  });
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return [];
    return await ctx.db
      .query("notifications")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .order("desc")
      .take(LIST_LIMIT);
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) return 0;
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_organizer_unread", (q) =>
        q.eq("organizerId", organizerId).eq("read", false),
      )
      .collect();
    return unread.length;
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_organizer_unread", (q) =>
        q.eq("organizerId", organizerId).eq("read", false),
      )
      .collect();
    for (const n of unread) {
      await ctx.db.patch(n._id, { read: true });
    }
    return null;
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");
    const notification = await ctx.db.get(notificationId);
    if (!notification || notification.organizerId !== organizerId) {
      throw new Error("Not found");
    }
    await ctx.db.patch(notificationId, { read: true });
    return null;
  },
});
```

- [ ] **Step 3: Write data-layer tests** in `convex/notifications.test.ts`. Seed notification rows directly (no rsvp needed yet):

```ts
// @vitest-environment edge-runtime
import { convexTest as rawConvexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.*s");

function convexTest(schemaArg: typeof schema, modulesArg: typeof modules) {
  const t = rawConvexTest(schemaArg, modulesArg);
  registerRateLimiter(t);
  return t;
}

async function asOrganizer(t: TestConvex<typeof schema>, email: string) {
  const { userId, sessionId, organizerId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, name: email });
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 3600_000,
    });
    const organizerId = await ctx.db.insert("organizers", { name: email, email });
    await ctx.db.insert("memberships", {
      organizerId,
      email: email.toLowerCase(),
      userId,
      role: "owner",
      createdAt: Date.now(),
    });
    return { userId, sessionId, organizerId };
  });
  return { as: t.withIdentity({ subject: `${userId}|${sessionId}` }), organizerId };
}

async function seedNotif(
  t: TestConvex<typeof schema>,
  organizerId: Id<"organizers">,
  overrides: Partial<{ read: boolean; createdAt: number; type: string; title: string; body: string }> = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("notifications", {
      organizerId,
      type: (overrides.type as any) ?? "rsvp",
      title: overrides.title ?? "New RSVP",
      body: overrides.body ?? "Someone RSVP'd",
      read: overrides.read ?? false,
      createdAt: overrides.createdAt ?? Date.now(),
    }),
  );
}

test("list returns the org's notifications newest-first, capped, org-scoped", async () => {
  const t = convexTest(schema, modules);
  const { as, organizerId } = await asOrganizer(t, "a@example.com");
  const other = await asOrganizer(t, "b@example.com");
  await seedNotif(t, organizerId, { createdAt: 100, body: "older" });
  await seedNotif(t, organizerId, { createdAt: 200, body: "newer" });
  await seedNotif(t, other.organizerId, { body: "not mine" });

  const list = await as.query(api.notifications.list, {});
  expect(list).toHaveLength(2);
  expect(list[0].body).toEqual("newer");
  expect(list.every((n) => n.organizerId === organizerId)).toBe(true);
});

test("unreadCount counts only the org's unread", async () => {
  const t = convexTest(schema, modules);
  const { as, organizerId } = await asOrganizer(t, "a@example.com");
  await seedNotif(t, organizerId, { read: false });
  await seedNotif(t, organizerId, { read: false });
  await seedNotif(t, organizerId, { read: true });
  expect(await as.query(api.notifications.unreadCount, {})).toEqual(2);
});

test("markRead flips one and rejects a cross-org id", async () => {
  const t = convexTest(schema, modules);
  const { as, organizerId } = await asOrganizer(t, "a@example.com");
  const other = await asOrganizer(t, "b@example.com");
  const mine = await seedNotif(t, organizerId);
  const theirs = await seedNotif(t, other.organizerId);

  await as.mutation(api.notifications.markRead, { notificationId: mine });
  expect(await as.query(api.notifications.unreadCount, {})).toEqual(0);
  await expect(
    as.mutation(api.notifications.markRead, { notificationId: theirs }),
  ).rejects.toThrow(/not found/i);
});

test("markAllRead clears unread to zero", async () => {
  const t = convexTest(schema, modules);
  const { as, organizerId } = await asOrganizer(t, "a@example.com");
  await seedNotif(t, organizerId, { read: false });
  await seedNotif(t, organizerId, { read: false });
  await as.mutation(api.notifications.markAllRead, {});
  expect(await as.query(api.notifications.unreadCount, {})).toEqual(0);
});

test("list and unreadCount are empty/zero when unauthenticated", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.notifications.list, {})).toEqual([]);
  expect(await t.query(api.notifications.unreadCount, {})).toEqual(0);
});
```

- [ ] **Step 4: Run tests + typecheck.** Run: `./node_modules/.bin/vitest run convex/notifications.test.ts` — expect all PASS. Run `./node_modules/.bin/tsc --noEmit` — expect exit 0.

- [ ] **Step 5: Commit.**

```bash
git add convex/schema.ts convex/notifications.ts convex/notifications.test.ts
git commit -m "feat(notifications): notifications table and organizer-scoped read/write API"
```

---

### Task 2: Generate notifications from RSVP activity

**Files:**
- Modify: `convex/rsvps.ts`
- Test: `convex/notifications.test.ts` (add generation tests)

**Interfaces:**
- Consumes: `createNotification` from `./notifications` (Task 1).

- [ ] **Step 1: Import the helper.** At the top of `convex/rsvps.ts`, add:

```ts
import { createNotification } from "./notifications";
```

- [ ] **Step 2: Emit on the confirmed branch (incl. sold-out).** In the `rsvp` mutation's confirmed branch (`if (seatsTaken < event.capacity) { ... }`), AFTER the existing `ctx.db.insert("rsvps", {...})` and BEFORE `recomputeEventStats`, add:

```ts
      await createNotification(ctx, {
        organizerId: event.organizerId,
        type: "rsvp",
        title: "New RSVP",
        body: `${name} RSVP'd to ${event.title}`,
        eventId: event._id,
      });
      if (seatsTaken + 1 === event.capacity) {
        await createNotification(ctx, {
          organizerId: event.organizerId,
          type: "sold_out",
          title: "Event sold out",
          body: `${event.title} is now sold out`,
          eventId: event._id,
        });
      }
```

(`seatsTaken` is the pre-insert count already computed above; `event` is `Doc<"events">` so `event.organizerId` is available.)

- [ ] **Step 3: Emit on the waitlist branch.** In the waitlist branch (after `ctx.db.insert("rsvps", { ... status: "waitlisted" ... })` and before `recomputeEventStats`), add:

```ts
      await createNotification(ctx, {
        organizerId: event.organizerId,
        type: "waitlist",
        title: "New waitlist join",
        body: `${name} joined the waitlist for ${event.title}`,
        eventId: event._id,
      });
```

- [ ] **Step 4: Emit on cancellation.** In the `cancelRsvp` mutation handler, after `const row = await rsvpByToken(ctx, token);` and the `ctx.db.patch(row._id, {...})`, add (before `return null`):

```ts
    const cancelledEvent = await ctx.db.get(row.eventId);
    if (cancelledEvent) {
      await createNotification(ctx, {
        organizerId: cancelledEvent.organizerId,
        type: "cancellation",
        title: "RSVP cancelled",
        body: `An attendee cancelled their RSVP for ${cancelledEvent.title}`,
        eventId: cancelledEvent._id,
      });
    }
```

- [ ] **Step 5: Add generation tests** to `convex/notifications.test.ts`. Add this `seedPublishedEvent` helper (mirrors `convex/rsvps.test.ts`) and tests:

```ts
async function seedPublishedEvent(t: TestConvex<typeof schema>, capacity: number) {
  const { as, organizerId } = await asOrganizer(t, "host@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Room", description: "x", startsAt: 1, endsAt: 2, location: "x", capacity,
  });
  await as.mutation(api.events.publishEvent, { eventId });
  const slug = await t.run(async (ctx) => (await ctx.db.get(eventId))!.slug);
  return { as, organizerId, eventId, slug };
}

test("a confirmed RSVP creates one rsvp notification; a dedupe repeat creates none", async () => {
  const t = convexTest(schema, modules);
  const { as, slug } = await seedPublishedEvent(t, 5);
  await t.mutation(api.rsvps.rsvp, { slug, name: "Jane", email: "jane@x.com" });
  await t.mutation(api.rsvps.rsvp, { slug, name: "Jane", email: "jane@x.com" }); // dedupe
  const list = await as.query(api.notifications.list, {});
  expect(list.filter((n) => n.type === "rsvp")).toHaveLength(1);
  expect(list[0].body).toContain("Jane");
});

test("the RSVP that fills the last seat also creates a sold_out notification", async () => {
  const t = convexTest(schema, modules);
  const { as, slug } = await seedPublishedEvent(t, 1);
  await t.mutation(api.rsvps.rsvp, { slug, name: "Jane", email: "jane@x.com" });
  const types = (await as.query(api.notifications.list, {})).map((n) => n.type).sort();
  expect(types).toEqual(["rsvp", "sold_out"].sort());
});

test("an RSVP that lands on the waitlist creates a waitlist notification", async () => {
  const t = convexTest(schema, modules);
  const { as, slug } = await seedPublishedEvent(t, 1);
  await t.mutation(api.rsvps.rsvp, { slug, name: "Jane", email: "jane@x.com" }); // fills seat
  await t.mutation(api.rsvps.rsvp, { slug, name: "Bob", email: "bob@x.com" });   // waitlisted
  const list = await as.query(api.notifications.list, {});
  expect(list.some((n) => n.type === "waitlist" && n.body.includes("Bob"))).toBe(true);
});

test("cancelling an RSVP creates a cancellation notification", async () => {
  const t = convexTest(schema, modules);
  const { as, slug } = await seedPublishedEvent(t, 5);
  const { token } = await t.mutation(api.rsvps.rsvp, { slug, name: "Jane", email: "jane@x.com" });
  await t.mutation(api.rsvps.cancelRsvp, { token });
  const list = await as.query(api.notifications.list, {});
  expect(list.some((n) => n.type === "cancellation")).toBe(true);
});
```

- [ ] **Step 6: Run tests + typecheck.** Run: `./node_modules/.bin/vitest run convex/notifications.test.ts` — expect all PASS. Run: `./node_modules/.bin/vitest run convex/rsvps.test.ts` — expect existing rsvp tests still PASS (the inline inserts don't change rsvp's return values). Run `./node_modules/.bin/tsc --noEmit` — exit 0.

- [ ] **Step 7: Commit.**

```bash
git add convex/rsvps.ts convex/notifications.test.ts
git commit -m "feat(notifications): generate notifications from RSVP, waitlist, sold-out, cancellation"
```

---

### Task 3: Header bell dropdown + Help menu

**Files:**
- Create: `src/components/notifications-menu.tsx`
- Modify: `src/components/app-header.tsx`

**Interfaces:**
- Consumes: `api.notifications.list`, `api.notifications.unreadCount`, `api.notifications.markRead`, `api.notifications.markAllRead`; `useCommandPalette` from `@/components/command-palette`.

- [ ] **Step 1: Create `src/components/notifications-menu.tsx`.**

```tsx
"use client";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { BellIcon, CalendarPlusIcon, UserMinusIcon, CircleCheckIcon, ClockIcon } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ICONS = {
  rsvp: CalendarPlusIcon,
  waitlist: ClockIcon,
  sold_out: CircleCheckIcon,
  cancellation: UserMinusIcon,
} as const;

export function NotificationsMenu() {
  const navigate = useNavigate();
  const { data: notifications = [] } = useQuery(convexQuery(api.notifications.list, {}));
  const { data: unread = 0 } = useQuery(convexQuery(api.notifications.unreadCount, {}));
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);

  function openNotification(n: Doc<"notifications">) {
    if (!n.read) void markRead({ notificationId: n._id });
    if (n.eventId) {
      void navigate({ to: "/events/$id", params: { id: n.eventId }, search: { section: "attendees" } });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="Notifications" size="icon-sm" variant="ghost" className="relative text-muted-foreground">
          <BellIcon />
          {unread > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unread > 0 ? (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => void markAllRead({})}
            >
              Mark all read
            </button>
          ) : null}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">You're all caught up.</p>
          ) : (
            notifications.map((n) => {
              const Icon = ICONS[n.type];
              return (
                <button
                  key={n._id}
                  type="button"
                  onClick={() => openNotification(n)}
                  className="flex w-full items-start gap-2.5 border-b border-border/50 px-3 py-2.5 text-left last:border-0 hover:bg-accent"
                >
                  <span className="mt-0.5 text-muted-foreground"><Icon className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{n.title}</span>
                      {!n.read ? <span className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{n.body}</span>
                    <span className="block text-[11px] text-muted-foreground/70">
                      {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Wire the header.** In `src/components/app-header.tsx`:
  1. Replace the imports line `import { HelpCircleIcon, BellIcon } from "lucide-react";` with `import { HelpCircleIcon } from "lucide-react";` and add `import { NotificationsMenu } from "@/components/notifications-menu";`, `import { useCommandPalette } from "@/components/command-palette";`, and the dropdown imports `import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuShortcut } from "@/components/ui/dropdown-menu";`.
  2. Replace the entire **Notifications** `<Tooltip>…</Tooltip>` block (the one wrapping the `BellIcon` button) with `<NotificationsMenu />`.
  3. Replace the entire **Help** `<Tooltip>…</Tooltip>` block with the dropdown below. It needs `const { setOpen } = useCommandPalette();` added at the top of the `AppHeader` component body:

```tsx
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label="Help" size="icon-sm" variant="ghost" className="text-muted-foreground">
              <HelpCircleIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => setOpen(true)}>
              Command menu
              <DropdownMenuShortcut>⌘K</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href="mailto:support@passline.app">Contact support</a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
```

- [ ] **Step 3: Verify `useCommandPalette` is in scope.** `AppHeader` must render inside `CommandPaletteProvider`. Confirm by checking the component tree (the provider wraps the app shell). If `AppHeader` is NOT inside the provider, report as DONE_WITH_CONCERNS rather than moving the provider — the controller will advise. (It is expected to be in scope; `app-search.tsx` already calls `useCommandPalette` from the same sidebar tree.)

- [ ] **Step 4: Typecheck + build.** Run `./node_modules/.bin/vite build` (regenerates the route tree if needed; expect the `✓ built` lines) then `./node_modules/.bin/tsc --noEmit` (exit 0).

- [ ] **Step 5: Commit.**

```bash
git add src/components/notifications-menu.tsx src/components/app-header.tsx
git commit -m "feat(notifications): header bell dropdown with live badge, and Help menu"
```

---

## Self-Review

- **Spec coverage:** table (T1), four triggers incl. sold-out-on-last-seat and no-dedupe (T2), org-scoped `list`/`unreadCount`/`markRead`/`markAllRead` (T1), bell dropdown with badge/list/mark-all-read/click-through/empty state (T3), Help dropdown (T3). All spec sections mapped.
- **Type consistency:** `createNotification`'s arg shape in T1 matches every call site in T2; `NotificationType` union matches the schema literals; `api.notifications.*` names match between definition (T1) and frontend (T3).
- **No placeholders:** every step has concrete code and commands. `support@passline.app` is the spec-approved placeholder address.
- **Ordering:** T1 (data layer, tested by direct seeding) → T2 (generation, tested via `rsvp`/`cancelRsvp`) → T3 (frontend). Each ends in an independently testable, committable deliverable.
