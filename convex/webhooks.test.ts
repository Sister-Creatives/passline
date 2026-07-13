// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { hmacSha256Hex, emitTicketTypeEvent } from "./webhooks";

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

test("create validates https + subscribedEvents subset, stores + returns the secret once", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});

  await expect(
    as.mutation(api.webhooks.create, {
      url: "http://insecure.example.com/hook",
      subscribedEvents: ["ticket_type.created"],
    }),
  ).rejects.toThrow();

  await expect(
    as.mutation(api.webhooks.create, {
      url: "https://example.com/hook",
      subscribedEvents: [],
    }),
  ).rejects.toThrow();

  await expect(
    as.mutation(api.webhooks.create, {
      url: "https://example.com/hook",
      subscribedEvents: ["ticket_type.created", "order.paid"],
    }),
  ).rejects.toThrow();

  const { id, secret } = await as.mutation(api.webhooks.create, {
    url: "https://example.com/hook",
    subscribedEvents: ["ticket_type.created", "ticket_type.updated"],
  });

  expect(secret).toMatch(/^whsec_[0-9a-f]{40}$/);

  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row).not.toBeNull();
  expect(row!.url).toBe("https://example.com/hook");
  expect(row!.secret).toBe(secret);
  expect(row!.subscribedEvents).toEqual(["ticket_type.created", "ticket_type.updated"]);
  expect(row!.active).toBe(true);
});

test("create rejects unauthenticated callers", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.mutation(api.webhooks.create, {
      url: "https://example.com/hook",
      subscribedEvents: ["ticket_type.created"],
    }),
  ).rejects.toThrow();
});

test("list returns metadata only (never the secret) and is scoped to the caller's org", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});

  await asAda.mutation(api.webhooks.create, {
    url: "https://ada.example.com/hook",
    subscribedEvents: ["ticket_type.created"],
  });
  await asBob.mutation(api.webhooks.create, {
    url: "https://bob.example.com/hook",
    subscribedEvents: ["ticket_type.deleted"],
  });

  const adaHooks = await asAda.query(api.webhooks.list, {});
  expect(adaHooks).toHaveLength(1);
  expect(adaHooks[0].url).toBe("https://ada.example.com/hook");
  expect(adaHooks[0]).not.toHaveProperty("secret");

  const bobHooks = await asBob.query(api.webhooks.list, {});
  expect(bobHooks).toHaveLength(1);
  expect(bobHooks[0].url).toBe("https://bob.example.com/hook");
});

test("remove is owner-only", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});

  const { id } = await asAda.mutation(api.webhooks.create, {
    url: "https://example.com/hook",
    subscribedEvents: ["ticket_type.created"],
  });

  await expect(asBob.mutation(api.webhooks.remove, { webhookId: id })).rejects.toThrow();
  await expect(t.mutation(api.webhooks.remove, { webhookId: id })).rejects.toThrow();

  const before = await t.run((ctx) => ctx.db.get(id));
  expect(before).not.toBeNull();

  await asAda.mutation(api.webhooks.remove, { webhookId: id });

  const after = await t.run((ctx) => ctx.db.get(id));
  expect(after).toBeNull();
});

test("hmacSha256Hex matches a known HMAC-SHA256 test vector", async () => {
  const hex = await hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog");
  expect(hex).toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
});

test("emitTicketTypeEvent inserts a pending delivery only for active webhooks subscribed to the event type", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  const adaOrgId = await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});

  // Subscribed + active -> should receive a delivery.
  const { id: subscribed } = await asAda.mutation(api.webhooks.create, {
    url: "https://subscribed.example.com/hook",
    subscribedEvents: ["ticket_type.created"],
  });
  // Active but not subscribed to this event type -> no delivery.
  await asAda.mutation(api.webhooks.create, {
    url: "https://unsubscribed.example.com/hook",
    subscribedEvents: ["ticket_type.updated"],
  });
  // Subscribed but deactivated -> no delivery.
  const { id: inactiveId } = await asAda.mutation(api.webhooks.create, {
    url: "https://inactive.example.com/hook",
    subscribedEvents: ["ticket_type.created"],
  });
  await t.run((ctx) => ctx.db.patch(inactiveId, { active: false }));
  // Subscribed + active, but a different organizer -> no delivery.
  await asBob.mutation(api.webhooks.create, {
    url: "https://other-org.example.com/hook",
    subscribedEvents: ["ticket_type.created"],
  });

  const payload = JSON.stringify({ id: "tt_123", name: "Adult" });
  await t.run((ctx) => emitTicketTypeEvent(ctx, adaOrgId, "ticket_type.created", payload));

  const adaDeliveries = await t.run((ctx) =>
    ctx.db
      .query("webhookDeliveries")
      .withIndex("by_organizer", (q) => q.eq("organizerId", adaOrgId))
      .collect(),
  );
  expect(adaDeliveries).toHaveLength(1);
  expect(adaDeliveries[0].webhookId).toBe(subscribed);
  expect(adaDeliveries[0].eventType).toBe("ticket_type.created");
  expect(adaDeliveries[0].payload).toBe(payload);
  expect(adaDeliveries[0].status).toBe("pending");
  expect(adaDeliveries[0].attempts).toBe(0);

  // Confirmed no cross-org leakage into Bob's deliveries either.
  const allDeliveries = await t.run((ctx) => ctx.db.query("webhookDeliveries").collect());
  expect(allDeliveries).toHaveLength(1);

  // The delivery action was scheduled (not asserted beyond existence — no
  // mock server; see spec §7 note).
  const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(scheduled.length).toBeGreaterThan(0);
});
