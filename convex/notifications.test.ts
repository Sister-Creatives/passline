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
