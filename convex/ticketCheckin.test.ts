// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.*s");

// Mirrors convex/orders.test.ts: insert a real users row + session and hand
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
  return { as: t.withIdentity({ subject: `${userId}|${sessionId}` }) };
}

async function makePublishedEvent(
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  capacity = 100,
) {
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Ticketed Event",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity,
  });
  await as.mutation(api.events.publishEvent, { eventId });
  return eventId;
}

async function makeFreeTicketType(
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  eventId: Id<"events">,
  gateAlert?: string,
) {
  return as.mutation(api.ticketTypes.create, {
    eventId,
    name: "General",
    kind: "free",
    priceCents: 0,
    gateAlert,
  });
}

/** Issue `quantity` free tickets on the event and return their codes. */
async function issueTickets(
  t: TestConvex<typeof schema>,
  eventId: Id<"events">,
  ticketTypeId: Id<"ticketTypes">,
  quantity: number,
) {
  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
  });
  const tickets = await t.run((ctx) =>
    ctx.db
      .query("tickets")
      .withIndex("by_order", (q) => q.eq("orderId", result.orderId))
      .collect(),
  );
  return tickets;
}

/** Full setup: an organizer with a published event, a free ticket type with a
 * gate alert, and one issued (valid) ticket. */
async function setup(gateAlert = "Check 18+ ID") {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as);
  const ticketTypeId = await makeFreeTicketType(as, eventId, gateAlert);
  const [ticket] = await issueTickets(t, eventId, ticketTypeId, 1);
  return { t, as, eventId, ticketTypeId, ticket };
}

test("checkInTicket checks in a valid ticket: ok + checked_in + checkedInAt set", async () => {
  const { t, as, ticket } = await setup("Check 18+ ID");

  const result = await as.mutation(api.ticketCheckin.checkInTicket, { code: ticket.code });
  expect(result.result).toBe("ok");
  if (result.result !== "ok") throw new Error("expected ok");
  expect(result.ticketTypeName).toBe("General");
  expect(result.gateAlert).toBe("Check 18+ ID");
  expect(result.ticket.status).toBe("checked_in");
  expect(typeof result.ticket.checkedInAt).toBe("number");

  const row = await t.run((ctx) => ctx.db.get(ticket._id));
  expect(row?.status).toBe("checked_in");
  expect(typeof row?.checkedInAt).toBe("number");
});

test("checkInTicket re-scanning a checked-in ticket returns already (no second transition)", async () => {
  const { as, ticket } = await setup("Check 18+ ID");

  const first = await as.mutation(api.ticketCheckin.checkInTicket, { code: ticket.code });
  expect(first.result).toBe("ok");
  if (first.result !== "ok") throw new Error("expected ok");
  const firstCheckedInAt = first.ticket.checkedInAt;

  const second = await as.mutation(api.ticketCheckin.checkInTicket, { code: ticket.code });
  expect(second.result).toBe("already");
  if (second.result !== "already") throw new Error("expected already");
  expect(second.checkedInAt).toBe(firstCheckedInAt);
  expect(second.gateAlert).toBe("Check 18+ ID");
});

test("checkInTicket on a cancelled ticket returns cancelled", async () => {
  const { t, as, ticket } = await setup();
  await t.run((ctx) => ctx.db.patch(ticket._id, { status: "cancelled" }));

  const result = await as.mutation(api.ticketCheckin.checkInTicket, { code: ticket.code });
  expect(result.result).toBe("cancelled");
  if (result.result !== "cancelled") throw new Error("expected cancelled");
  expect(result.ticket.status).toBe("cancelled");
});

test("checkInTicket on an unknown code returns not_found", async () => {
  const { as } = await setup();

  const result = await as.mutation(api.ticketCheckin.checkInTicket, { code: "tkt_does_not_exist" });
  expect(result).toEqual({ result: "not_found" });
});

test("checkInTicket on another organizer's ticket returns not_found (no cross-org leak)", async () => {
  const { t, ticket } = await setup();
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});

  const result = await asBob.mutation(api.ticketCheckin.checkInTicket, { code: ticket.code });
  expect(result).toEqual({ result: "not_found" });

  // Bob's failed lookup must not have mutated Ada's ticket.
  const row = await t.run((ctx) => ctx.db.get(ticket._id));
  expect(row?.status).toBe("valid");
});

test("checkInTicket rejects an unauthenticated caller", async () => {
  const { t, ticket } = await setup();

  await expect(t.mutation(api.ticketCheckin.checkInTicket, { code: ticket.code })).rejects.toThrow();
});

test("undoCheckIn reverts a checked-in ticket to valid and clears checkedInAt", async () => {
  const { t, as, ticket } = await setup();

  await as.mutation(api.ticketCheckin.checkInTicket, { code: ticket.code });
  await as.mutation(api.ticketCheckin.undoCheckIn, { ticketId: ticket._id });

  const row = await t.run((ctx) => ctx.db.get(ticket._id));
  expect(row?.status).toBe("valid");
  expect(row?.checkedInAt).toBeUndefined();
});

test("undoCheckIn is owner-only: rejects a non-owner and an unauthenticated caller", async () => {
  const { t, as, ticket } = await setup();
  await as.mutation(api.ticketCheckin.checkInTicket, { code: ticket.code });

  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});
  await expect(
    asBob.mutation(api.ticketCheckin.undoCheckIn, { ticketId: ticket._id }),
  ).rejects.toThrow();
  await expect(
    t.mutation(api.ticketCheckin.undoCheckIn, { ticketId: ticket._id }),
  ).rejects.toThrow();

  // Neither rejected call mutated the ticket.
  const row = await t.run((ctx) => ctx.db.get(ticket._id));
  expect(row?.status).toBe("checked_in");
});

test("getTicketByCode returns the ticket + type name + gate alert, owner-only, null when unknown", async () => {
  const { t, as, ticket } = await setup("VIP entrance only");

  const found = await as.query(api.ticketCheckin.getTicketByCode, { code: ticket.code });
  expect(found?.ticket._id).toBe(ticket._id);
  expect(found?.ticketTypeName).toBe("General");
  expect(found?.gateAlert).toBe("VIP entrance only");

  const missing = await as.query(api.ticketCheckin.getTicketByCode, { code: "tkt_nope" });
  expect(missing).toBeNull();

  await expect(t.query(api.ticketCheckin.getTicketByCode, { code: ticket.code })).rejects.toThrow();
});

test("getScanState counts total non-cancelled vs checked-in, owner-only", async () => {
  const { t, as, eventId, ticketTypeId } = await setup();
  // setup() already issued 1 ticket; issue 2 more (3 valid total).
  const more = await issueTickets(t, eventId, ticketTypeId, 2);

  let state = await as.query(api.ticketCheckin.getScanState, { eventId });
  expect(state).toEqual({ total: 3, checkedIn: 0 });

  await as.mutation(api.ticketCheckin.checkInTicket, { code: more[0].code });
  state = await as.query(api.ticketCheckin.getScanState, { eventId });
  expect(state).toEqual({ total: 3, checkedIn: 1 });

  // A cancelled ticket drops out of the total (and was never checked in).
  await t.run((ctx) => ctx.db.patch(more[1]._id, { status: "cancelled" }));
  state = await as.query(api.ticketCheckin.getScanState, { eventId });
  expect(state).toEqual({ total: 2, checkedIn: 1 });

  await expect(t.query(api.ticketCheckin.getScanState, { eventId })).rejects.toThrow();
});
