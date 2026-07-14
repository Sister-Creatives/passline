// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

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

type TicketTypeOverrides = {
  capacity?: number;
  minPerOrder?: number;
  maxPerOrder?: number;
  visibility?: "visible" | "hidden";
};

async function makePaidTicketType(
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  eventId: Id<"events">,
  priceCents: number,
  overrides: TicketTypeOverrides = {},
) {
  return as.mutation(api.ticketTypes.create, {
    eventId,
    name: "General",
    kind: "paid",
    priceCents,
    ...overrides,
  });
}

async function makeFreeTicketType(
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  eventId: Id<"events">,
  overrides: TicketTypeOverrides = {},
) {
  return as.mutation(api.ticketTypes.create, {
    eventId,
    name: "Free",
    kind: "free",
    priceCents: 0,
    ...overrides,
  });
}

async function makePercentPromoCode(
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  eventId: Id<"events">,
  code: string,
  percentBps: number,
  maxRedemptions?: number,
) {
  return as.mutation(api.promoCodes.create, {
    eventId,
    code,
    discountKind: "percent",
    percentBps,
    maxRedemptions,
  });
}

async function makeFixedPromoCode(
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  eventId: Id<"events">,
  code: string,
  fixedCents: number,
  maxRedemptions?: number,
) {
  return as.mutation(api.promoCodes.create, {
    eventId,
    code,
    discountKind: "fixed",
    fixedCents,
    maxRedemptions,
  });
}

async function makeAddOn(
  as: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  eventId: Id<"events">,
  priceCents: number,
  overrides: { capacity?: number; name?: string } = {},
) {
  return as.mutation(api.addOns.create, {
    eventId,
    name: overrides.name ?? "T-shirt",
    priceCents,
    capacity: overrides.capacity,
  });
}

test("createOrder reserves capacity by incrementing sold and returns a pending order for a paid cart", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000, { capacity: 10 });

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 3 }],
    buyerName: "Buyer One",
    buyerEmail: "buyer@example.com",
  });

  expect(result.status).toBe("pending");
  expect(result.currency).toBe("USD");
  // subtotal = 3000, fee = 3000 * 300 / 10000 = 90, total = 3090 (feeMode defaults to "pass")
  expect(result.totalCents).toBe(3090);

  const ticketType = await t.run((ctx) => ctx.db.get(ticketTypeId));
  expect(ticketType?.sold).toBe(3);

  const order = await t.run((ctx) => ctx.db.get(result.orderId));
  expect(order?.status).toBe("pending");
  expect(order?.subtotalCents).toBe(3000);
  expect(order?.feeCents).toBe(90);
  expect(order?.totalCents).toBe(3090);
  expect(order?.payoutCents).toBe(3000);
  expect(order?.token).toMatch(/^ord_[0-9a-f]{32}$/);

  const items = await t.run((ctx) =>
    ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", result.orderId)).collect(),
  );
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ ticketTypeId, quantity: 3, unitPriceCents: 1000 });

  const tickets = await t.run((ctx) =>
    ctx.db.query("tickets").withIndex("by_order", (q) => q.eq("orderId", result.orderId)).collect(),
  );
  expect(tickets).toHaveLength(0); // paid cart: no tickets issued yet
});

test("createOrder rejects overselling a ticket type's own capacity", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000, { capacity: 5 });

  await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 5 }],
    buyerName: "Buyer One",
    buyerEmail: "buyer1@example.com",
  });

  await expect(
    t.mutation(api.orders.createOrder, {
      eventId,
      items: [{ ticketTypeId, quantity: 1 }],
      buyerName: "Buyer Two",
      buyerEmail: "buyer2@example.com",
    }),
  ).rejects.toThrow();

  const ticketType = await t.run((ctx) => ctx.db.get(ticketTypeId));
  expect(ticketType?.sold).toBe(5); // unchanged by the rejected order
});

test("createOrder rejects overselling the event's overall capacity even when the type has no cap", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 5); // tight event cap, no per-type cap
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000);

  await expect(
    t.mutation(api.orders.createOrder, {
      eventId,
      items: [{ ticketTypeId, quantity: 6 }],
      buyerName: "Buyer One",
      buyerEmail: "buyer1@example.com",
    }),
  ).rejects.toThrow();

  const ticketType = await t.run((ctx) => ctx.db.get(ticketTypeId));
  expect(ticketType?.sold).toBe(0);
});

test("createOrder rejects an unpublished (draft) event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await as.mutation(api.events.createEvent, {
    title: "Draft Event",
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity: 100,
  });
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000);

  await expect(
    t.mutation(api.orders.createOrder, {
      eventId,
      items: [{ ticketTypeId, quantity: 1 }],
      buyerName: "Buyer",
      buyerEmail: "buyer@example.com",
    }),
  ).rejects.toThrow();
});

test("createOrder rejects an archived ticket type", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await t.run((ctx) =>
    ctx.db.insert("ticketTypes", {
      eventId,
      name: "Archived",
      kind: "paid",
      priceCents: 1000,
      sold: 0,
      sortOrder: 0,
      visibility: "visible",
      status: "archived",
    }),
  );

  await expect(
    t.mutation(api.orders.createOrder, {
      eventId,
      items: [{ ticketTypeId, quantity: 1 }],
      buyerName: "Buyer",
      buyerEmail: "buyer@example.com",
    }),
  ).rejects.toThrow();
});

test("createOrder rejects a hidden ticket type", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000, { visibility: "hidden" });

  await expect(
    t.mutation(api.orders.createOrder, {
      eventId,
      items: [{ ticketTypeId, quantity: 1 }],
      buyerName: "Buyer",
      buyerEmail: "buyer@example.com",
    }),
  ).rejects.toThrow();
});

test("createOrder rejects a hidden ticket type when the accessCode is wrong", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000, { visibility: "hidden" });
  await as.mutation(api.accessCodes.create, { eventId, code: "VIP", ticketTypeIds: [ticketTypeId] });

  await expect(
    t.mutation(api.orders.createOrder, {
      eventId,
      items: [{ ticketTypeId, quantity: 1 }],
      buyerName: "Buyer",
      buyerEmail: "buyer@example.com",
      accessCode: "NOTVIP",
    }),
  ).rejects.toThrow("This ticket requires a valid access code");

  const ticketType = await t.run((ctx) => ctx.db.get(ticketTypeId));
  expect(ticketType?.sold).toBe(0);
});

test("createOrder succeeds for a hidden ticket type when the accessCode unlocks it", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000, { visibility: "hidden" });
  await as.mutation(api.accessCodes.create, { eventId, code: "VIP", ticketTypeIds: [ticketTypeId] });

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
    accessCode: "vip", // lowercase -- resolution is case-insensitive, mirroring accessCodes.create
  });

  expect(result.status).toBe("pending");
  const ticketType = await t.run((ctx) => ctx.db.get(ticketTypeId));
  expect(ticketType?.sold).toBe(1);
});

test("createOrder leaves a visible ticket type unaffected by an accessCode (present, absent, or wrong)", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000); // default visibility: "visible"

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
    accessCode: "BOGUS", // no such code exists -- must not block a visible type
  });

  expect(result.status).toBe("pending");
  const ticketType = await t.run((ctx) => ctx.db.get(ticketTypeId));
  expect(ticketType?.sold).toBe(1);
});

test("createOrder rejects a ticket type that belongs to a different event", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const otherEventId = await makePublishedEvent(as, 100);
  const foreignTicketTypeId = await makePaidTicketType(as, otherEventId, 1000);

  await expect(
    t.mutation(api.orders.createOrder, {
      eventId,
      items: [{ ticketTypeId: foreignTicketTypeId, quantity: 1 }],
      buyerName: "Buyer",
      buyerEmail: "buyer@example.com",
    }),
  ).rejects.toThrow();
});

test("createOrder rejects a quantity below minPerOrder", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000, { minPerOrder: 2 });

  await expect(
    t.mutation(api.orders.createOrder, {
      eventId,
      items: [{ ticketTypeId, quantity: 1 }],
      buyerName: "Buyer",
      buyerEmail: "buyer@example.com",
    }),
  ).rejects.toThrow();
});

test("createOrder rejects a quantity above maxPerOrder", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000, { maxPerOrder: 4 });

  await expect(
    t.mutation(api.orders.createOrder, {
      eventId,
      items: [{ ticketTypeId, quantity: 5 }],
      buyerName: "Buyer",
      buyerEmail: "buyer@example.com",
    }),
  ).rejects.toThrow();
});

test("createOrder rejects maxPerOrder when the same ticket type is split across line items", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000, { maxPerOrder: 4 });

  await expect(
    t.mutation(api.orders.createOrder, {
      eventId,
      items: [
        { ticketTypeId, quantity: 3 },
        { ticketTypeId, quantity: 3 },
      ],
      buyerName: "Buyer",
      buyerEmail: "buyer@example.com",
    }),
  ).rejects.toThrow();

  const ticketType = await t.run((ctx) => ctx.db.get(ticketTypeId));
  expect(ticketType?.sold).toBe(0); // rejected before any capacity was reserved
});

test("createOrder rejects an empty cart", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);

  await expect(
    t.mutation(api.orders.createOrder, {
      eventId,
      items: [],
      buyerName: "Buyer",
      buyerEmail: "buyer@example.com",
    }),
  ).rejects.toThrow();
});

// --- add-ons (F11.3) -------------------------------------------------------

test("createOrder with add-on items reserves add-on sold and includes them in subtotal/totalCents", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000, { capacity: 10 });
  const addOnId = await makeAddOn(as, eventId, 500, { capacity: 10 });

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 2 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
    addOnItems: [{ addOnId, quantity: 3 }],
  });

  // ticket gross 2000 + add-on gross 1500 = 3500 gross; fee = 3500*300/10000 = 105; total = 3605
  expect(result.status).toBe("pending");
  expect(result.totalCents).toBe(3605);

  const order = await t.run((ctx) => ctx.db.get(result.orderId));
  expect(order?.grossSubtotalCents).toBe(3500);
  expect(order?.subtotalCents).toBe(3500);
  expect(order?.feeCents).toBe(105);
  expect(order?.totalCents).toBe(3605);

  const addOn = await t.run((ctx) => ctx.db.get(addOnId));
  expect(addOn?.sold).toBe(3);

  const orderAddOnRows = await t.run((ctx) =>
    ctx.db.query("orderAddOns").withIndex("by_order", (q) => q.eq("orderId", result.orderId)).collect(),
  );
  expect(orderAddOnRows).toHaveLength(1);
  expect(orderAddOnRows[0]).toMatchObject({ addOnId, quantity: 3, unitPriceCents: 500 });

  const ticketType = await t.run((ctx) => ctx.db.get(ticketTypeId));
  expect(ticketType?.sold).toBe(2);
});

test("an add-on-only order (no tickets) succeeds", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const addOnId = await makeAddOn(as, eventId, 500, { capacity: 10 });

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
    addOnItems: [{ addOnId, quantity: 2 }],
  });

  // gross = 1000, fee = 1000*300/10000 = 30, total = 1030
  expect(result.status).toBe("pending");
  expect(result.totalCents).toBe(1030);

  const addOn = await t.run((ctx) => ctx.db.get(addOnId));
  expect(addOn?.sold).toBe(2);

  const items = await t.run((ctx) =>
    ctx.db.query("orderItems").withIndex("by_order", (q) => q.eq("orderId", result.orderId)).collect(),
  );
  expect(items).toHaveLength(0);
});

test("createOrder rejects an over-cap add-on and leaves sold untouched", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const addOnId = await makeAddOn(as, eventId, 500, { capacity: 2 });

  await expect(
    t.mutation(api.orders.createOrder, {
      eventId,
      items: [],
      buyerName: "Buyer",
      buyerEmail: "buyer@example.com",
      addOnItems: [{ addOnId, quantity: 3 }],
    }),
  ).rejects.toThrow();

  const addOn = await t.run((ctx) => ctx.db.get(addOnId));
  expect(addOn?.sold).toBe(0);
});

test("cancelOrder releases add-on capacity along with ticket-type capacity", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000, { capacity: 10 });
  const addOnId = await makeAddOn(as, eventId, 500, { capacity: 5 });

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
    addOnItems: [{ addOnId, quantity: 2 }],
  });
  expect(result.status).toBe("pending");

  let addOn = await t.run((ctx) => ctx.db.get(addOnId));
  expect(addOn?.sold).toBe(2);

  await as.mutation(api.orders.cancelOrder, { orderId: result.orderId });

  const order = await t.run((ctx) => ctx.db.get(result.orderId));
  expect(order?.status).toBe("cancelled");

  addOn = await t.run((ctx) => ctx.db.get(addOnId));
  expect(addOn?.sold).toBe(0);

  const ticketType = await t.run((ctx) => ctx.db.get(ticketTypeId));
  expect(ticketType?.sold).toBe(0);
});

test("refundOrder releases add-on capacity along with ticket-type capacity", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makeFreeTicketType(as, eventId, { capacity: 10 });
  const addOnId = await makeAddOn(as, eventId, 500, { capacity: 5 });

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
    addOnItems: [{ addOnId, quantity: 2 }],
  });
  // Total is nonzero (the paid add-on), so the order stays pending -- mark it
  // paid explicitly (mirrors a real payment confirmation) so refundOrder is
  // reachable.
  expect(result.status).toBe("pending");
  await t.mutation(internal.orders.markOrderPaid, { orderId: result.orderId });

  let addOn = await t.run((ctx) => ctx.db.get(addOnId));
  expect(addOn?.sold).toBe(2);

  await as.mutation(api.orders.refundOrder, { orderId: result.orderId });

  const order = await t.run((ctx) => ctx.db.get(result.orderId));
  expect(order?.status).toBe("refunded");

  addOn = await t.run((ctx) => ctx.db.get(addOnId));
  expect(addOn?.sold).toBe(0);

  const ticketType = await t.run((ctx) => ctx.db.get(ticketTypeId));
  expect(ticketType?.sold).toBe(0);
});

test("getOrder returns the order's add-ons joined with their names", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makeFreeTicketType(as, eventId);
  const addOnId = await makeAddOn(as, eventId, 300, { name: "Parking pass" });

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
    addOnItems: [{ addOnId, quantity: 2 }],
  });

  const found = await t.query(api.orders.getOrder, { token: result.token });
  expect(found?.addOns).toHaveLength(1);
  expect(found?.addOns[0]).toMatchObject({
    addOnId,
    quantity: 2,
    unitPriceCents: 300,
    name: "Parking pass",
  });
});

test("a free cart is paid immediately with one ticket issued per unit", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makeFreeTicketType(as, eventId);

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 2 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
  });

  expect(result.status).toBe("paid");
  expect(result.totalCents).toBe(0);

  const order = await t.run((ctx) => ctx.db.get(result.orderId));
  expect(order?.status).toBe("paid");
  expect(order?.paidAt).toBeTypeOf("number");

  const tickets = await t.run((ctx) =>
    ctx.db.query("tickets").withIndex("by_order", (q) => q.eq("orderId", result.orderId)).collect(),
  );
  expect(tickets).toHaveLength(2);
  for (const ticket of tickets) {
    expect(ticket.status).toBe("valid");
    expect(ticket.code).toMatch(/^tkt_[0-9a-f]{32}$/);
    expect(ticket.eventId).toBe(eventId);
    expect(ticket.ticketTypeId).toBe(ticketTypeId);
  }
  // Codes are unique.
  expect(new Set(tickets.map((tk) => tk.code)).size).toBe(2);
});

test("a paid cart stays pending with no tickets issued", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1500);

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
  });

  expect(result.status).toBe("pending");
  const order = await t.run((ctx) => ctx.db.get(result.orderId));
  expect(order?.status).toBe("pending");
  expect(order?.paidAt).toBeUndefined();

  const tickets = await t.run((ctx) =>
    ctx.db.query("tickets").withIndex("by_order", (q) => q.eq("orderId", result.orderId)).collect(),
  );
  expect(tickets).toHaveLength(0);
});

test("markOrderPaid issues tickets and sets paid", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1500);

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 3 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
  });
  expect(result.status).toBe("pending");

  await t.mutation(internal.orders.markOrderPaid, { orderId: result.orderId });

  const order = await t.run((ctx) => ctx.db.get(result.orderId));
  expect(order?.status).toBe("paid");
  expect(order?.paidAt).toBeTypeOf("number");

  const tickets = await t.run((ctx) =>
    ctx.db.query("tickets").withIndex("by_order", (q) => q.eq("orderId", result.orderId)).collect(),
  );
  expect(tickets).toHaveLength(3);
});

test("markOrderPaid is idempotent: a second call does not duplicate tickets", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1500);

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 2 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
  });

  await t.mutation(internal.orders.markOrderPaid, { orderId: result.orderId });
  const firstPaidAt = (await t.run((ctx) => ctx.db.get(result.orderId)))?.paidAt;

  await t.mutation(internal.orders.markOrderPaid, { orderId: result.orderId });
  const order = await t.run((ctx) => ctx.db.get(result.orderId));
  expect(order?.paidAt).toBe(firstPaidAt); // untouched by the second call

  const tickets = await t.run((ctx) =>
    ctx.db.query("tickets").withIndex("by_order", (q) => q.eq("orderId", result.orderId)).collect(),
  );
  expect(tickets).toHaveLength(2); // still 2, not 4
});

test("cancelOrder releases capacity and cancels a pending order", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000, { capacity: 10 });

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 4 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
  });

  let ticketType = await t.run((ctx) => ctx.db.get(ticketTypeId));
  expect(ticketType?.sold).toBe(4);

  await as.mutation(api.orders.cancelOrder, { orderId: result.orderId });

  const order = await t.run((ctx) => ctx.db.get(result.orderId));
  expect(order?.status).toBe("cancelled");

  ticketType = await t.run((ctx) => ctx.db.get(ticketTypeId));
  expect(ticketType?.sold).toBe(0);
});

test("cancelOrder is owner-only", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await makePublishedEvent(asAda, 100);
  const ticketTypeId = await makePaidTicketType(asAda, eventId, 1000);
  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
  });

  await expect(asBob.mutation(api.orders.cancelOrder, { orderId: result.orderId })).rejects.toThrow();
  await expect(t.mutation(api.orders.cancelOrder, { orderId: result.orderId })).rejects.toThrow(); // unauthenticated

  const order = await t.run((ctx) => ctx.db.get(result.orderId));
  expect(order?.status).toBe("pending"); // untouched
});

test("cancelOrder rejects a paid order", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makeFreeTicketType(as, eventId);

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
  });
  expect(result.status).toBe("paid");

  await expect(as.mutation(api.orders.cancelOrder, { orderId: result.orderId })).rejects.toThrow();

  const order = await t.run((ctx) => ctx.db.get(result.orderId));
  expect(order?.status).toBe("paid"); // untouched
});

test("markOrderPaid does not resurrect a cancelled order", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000, { capacity: 10 });

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 3 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
  });
  expect(result.status).toBe("pending");

  await as.mutation(api.orders.cancelOrder, { orderId: result.orderId });
  let order = await t.run((ctx) => ctx.db.get(result.orderId));
  expect(order?.status).toBe("cancelled");

  await t.mutation(internal.orders.markOrderPaid, { orderId: result.orderId });

  order = await t.run((ctx) => ctx.db.get(result.orderId));
  expect(order?.status).toBe("cancelled"); // not resurrected to paid by a late/duplicate payment call

  const tickets = await t.run((ctx) =>
    ctx.db.query("tickets").withIndex("by_order", (q) => q.eq("orderId", result.orderId)).collect(),
  );
  expect(tickets).toHaveLength(0);
});

test("cancelOrder restores the promo code's redemption count", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000, { capacity: 10 });
  const promoCodeId = await makePercentPromoCode(as, eventId, "SAVE10", 1000, 2);

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
    promoCode: "save10",
  });

  let promo = await t.run((ctx) => ctx.db.get(promoCodeId));
  expect(promo?.timesRedeemed).toBe(1);

  await as.mutation(api.orders.cancelOrder, { orderId: result.orderId });

  const order = await t.run((ctx) => ctx.db.get(result.orderId));
  expect(order?.status).toBe("cancelled");

  promo = await t.run((ctx) => ctx.db.get(promoCodeId));
  expect(promo?.timesRedeemed).toBe(0);
});

test("getOrder returns the order with its items and tickets by token", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makeFreeTicketType(as, eventId);

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 2 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
  });

  const found = await t.query(api.orders.getOrder, { token: result.token });
  expect(found?.order._id).toBe(result.orderId);
  expect(found?.items).toHaveLength(1);
  expect(found?.tickets).toHaveLength(2);
  expect(found?.orderResponses).toEqual([]); // no checkout questions on this event

  const notFound = await t.query(api.orders.getOrder, { token: "ord_doesnotexist" });
  expect(notFound).toBeNull();
});

test("createOrder with a valid percent promo code discounts the total and increments timesRedeemed", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000, { capacity: 10 });
  const promoCodeId = await makePercentPromoCode(as, eventId, "SAVE10", 1000); // 10% off

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 3 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
    promoCode: "save10", // lowercase input, matched case-insensitively
  });

  // gross = 3000, discount = 300 (10%), subtotal = 2700, fee = 2700*300/10000 = 81, total = 2781
  expect(result.status).toBe("pending");
  expect(result.totalCents).toBe(2781);

  const order = await t.run((ctx) => ctx.db.get(result.orderId));
  expect(order?.grossSubtotalCents).toBe(3000);
  expect(order?.discountCents).toBe(300);
  expect(order?.subtotalCents).toBe(2700);
  expect(order?.feeCents).toBe(81);
  expect(order?.totalCents).toBe(2781);
  expect(order?.promoCode).toBe("SAVE10");

  const promoCode = await t.run((ctx) => ctx.db.get(promoCodeId));
  expect(promoCode?.timesRedeemed).toBe(1);
});

test("createOrder rejects an exhausted promo code and leaves state untouched", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000, { capacity: 10 });
  const promoCodeId = await makePercentPromoCode(as, eventId, "ONECODE", 1000, 1);
  // Exhaust the code directly (equivalent to one prior redemption).
  await t.run((ctx) => ctx.db.patch(promoCodeId, { timesRedeemed: 1 }));

  await expect(
    t.mutation(api.orders.createOrder, {
      eventId,
      items: [{ ticketTypeId, quantity: 1 }],
      buyerName: "Buyer",
      buyerEmail: "buyer@example.com",
      promoCode: "ONECODE",
    }),
  ).rejects.toThrow();

  const promoCode = await t.run((ctx) => ctx.db.get(promoCodeId));
  expect(promoCode?.timesRedeemed).toBe(1); // unchanged by the rejected order

  const ticketType = await t.run((ctx) => ctx.db.get(ticketTypeId));
  expect(ticketType?.sold).toBe(0); // no capacity reserved by the rejected order
});

test("createOrder with a fixed promo code larger than the subtotal clamps to $0 and fulfills as free", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 500, { capacity: 10 });
  const promoCodeId = await makeFixedPromoCode(as, eventId, "BIGDISCOUNT", 1000); // more than the 500 subtotal

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
    promoCode: "BIGDISCOUNT",
  });

  expect(result.status).toBe("paid");
  expect(result.totalCents).toBe(0);

  const order = await t.run((ctx) => ctx.db.get(result.orderId));
  expect(order?.grossSubtotalCents).toBe(500);
  expect(order?.discountCents).toBe(500); // clamped to the gross subtotal, not the full 1000
  expect(order?.subtotalCents).toBe(0);
  expect(order?.feeCents).toBe(0);
  expect(order?.totalCents).toBe(0);
  expect(order?.status).toBe("paid");

  const tickets = await t.run((ctx) =>
    ctx.db.query("tickets").withIndex("by_order", (q) => q.eq("orderId", result.orderId)).collect(),
  );
  expect(tickets).toHaveLength(1);

  const promoCode = await t.run((ctx) => ctx.db.get(promoCodeId));
  expect(promoCode?.timesRedeemed).toBe(1);
});

// --- checkout questions / answers (F5.3) -------------------------------

test("createOrder rejects a cart missing an answer to a required question", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makeFreeTicketType(as, eventId);
  await as.mutation(api.checkoutQuestions.create, {
    eventId,
    label: "Company name",
    kind: "text",
    required: true,
  });

  await expect(
    t.mutation(api.orders.createOrder, {
      eventId,
      items: [{ ticketTypeId, quantity: 1 }],
      buyerName: "Buyer",
      buyerEmail: "buyer@example.com",
    }),
  ).rejects.toThrow();

  const ticketType = await t.run((ctx) => ctx.db.get(ticketTypeId));
  expect(ticketType?.sold).toBe(0); // rejected before any capacity was reserved
});

test("createOrder with valid answers stores orderResponses and getOrder returns them", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makeFreeTicketType(as, eventId);
  const companyQuestionId = await as.mutation(api.checkoutQuestions.create, {
    eventId,
    label: "Company name",
    kind: "text",
    required: true,
  });
  const dietaryQuestionId = await as.mutation(api.checkoutQuestions.create, {
    eventId,
    label: "Dietary needs",
    kind: "select",
    options: ["None", "Vegetarian", "Vegan"],
    required: false,
  });

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
    answers: [
      { questionId: companyQuestionId, value: "Acme Inc" },
      { questionId: dietaryQuestionId, value: "Vegan" },
    ],
  });

  const responses = await t.run((ctx) =>
    ctx.db.query("orderResponses").withIndex("by_order", (q) => q.eq("orderId", result.orderId)).collect(),
  );
  expect(responses).toHaveLength(2);
  expect(responses).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ questionId: companyQuestionId, label: "Company name", value: "Acme Inc" }),
      expect.objectContaining({ questionId: dietaryQuestionId, label: "Dietary needs", value: "Vegan" }),
    ]),
  );

  const found = await t.query(api.orders.getOrder, { token: result.token });
  expect(found?.orderResponses).toHaveLength(2);
  expect(found?.orderResponses).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ questionId: companyQuestionId, label: "Company name", value: "Acme Inc" }),
      expect.objectContaining({ questionId: dietaryQuestionId, label: "Dietary needs", value: "Vegan" }),
    ]),
  );
});

// --- refundOrder (F6) ----------------------------------------------------

test("refundOrder cancels all tickets, releases capacity, restores promo redemption, and sets refunded/refundedAt", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makeFreeTicketType(as, eventId, { capacity: 10 });
  const promoCodeId = await makePercentPromoCode(as, eventId, "SAVE10", 1000, 5);

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 2 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
    promoCode: "save10",
  });
  expect(result.status).toBe("paid"); // free ticket type -> fulfilled immediately

  let ticketType = await t.run((ctx) => ctx.db.get(ticketTypeId));
  expect(ticketType?.sold).toBe(2);
  let promo = await t.run((ctx) => ctx.db.get(promoCodeId));
  expect(promo?.timesRedeemed).toBe(1);

  await as.mutation(api.orders.refundOrder, { orderId: result.orderId });

  const order = await t.run((ctx) => ctx.db.get(result.orderId));
  expect(order?.status).toBe("refunded");
  expect(order?.refundedAt).toBeTypeOf("number");

  const tickets = await t.run((ctx) =>
    ctx.db.query("tickets").withIndex("by_order", (q) => q.eq("orderId", result.orderId)).collect(),
  );
  expect(tickets).toHaveLength(2);
  for (const ticket of tickets) {
    expect(ticket.status).toBe("cancelled");
  }

  ticketType = await t.run((ctx) => ctx.db.get(ticketTypeId));
  expect(ticketType?.sold).toBe(0);

  promo = await t.run((ctx) => ctx.db.get(promoCodeId));
  expect(promo?.timesRedeemed).toBe(0);
});

test("refundOrder is idempotent: a second call does not double-release capacity", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makeFreeTicketType(as, eventId, { capacity: 10 });

  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 3 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
  });

  await as.mutation(api.orders.refundOrder, { orderId: result.orderId });
  const firstRefundedAt = (await t.run((ctx) => ctx.db.get(result.orderId)))?.refundedAt;

  await as.mutation(api.orders.refundOrder, { orderId: result.orderId });

  const order = await t.run((ctx) => ctx.db.get(result.orderId));
  expect(order?.status).toBe("refunded");
  expect(order?.refundedAt).toBe(firstRefundedAt); // untouched by the second call

  const ticketType = await t.run((ctx) => ctx.db.get(ticketTypeId));
  expect(ticketType?.sold).toBe(0); // not decremented below 0 by the second call
});

test("refundOrder is owner-only", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await makePublishedEvent(asAda, 100);
  const ticketTypeId = await makeFreeTicketType(asAda, eventId);
  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
  });

  await expect(asBob.mutation(api.orders.refundOrder, { orderId: result.orderId })).rejects.toThrow();
  await expect(t.mutation(api.orders.refundOrder, { orderId: result.orderId })).rejects.toThrow(); // unauthenticated

  const order = await t.run((ctx) => ctx.db.get(result.orderId));
  expect(order?.status).toBe("paid"); // untouched
});

test("refundOrder rejects a pending order", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makePaidTicketType(as, eventId, 1000);
  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
  });
  expect(result.status).toBe("pending");

  await expect(as.mutation(api.orders.refundOrder, { orderId: result.orderId })).rejects.toThrow(
    "Use cancelOrder for a pending order",
  );

  const order = await t.run((ctx) => ctx.db.get(result.orderId));
  expect(order?.status).toBe("pending"); // untouched
});

// --- transferTicket (F6) --------------------------------------------------

test("transferTicket updates the ticket's attendee name and email", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makeFreeTicketType(as, eventId);
  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
  });

  const found = await t.query(api.orders.getOrder, { token: result.token });
  const ticketId = found!.tickets[0]._id;

  await t.mutation(api.tickets.transferTicket, {
    orderToken: result.token,
    ticketId,
    attendeeName: "Grace Hopper",
    attendeeEmail: "grace@example.com",
  });

  const ticket = await t.run((ctx) => ctx.db.get(ticketId));
  expect(ticket?.attendeeName).toBe("Grace Hopper");
  expect(ticket?.attendeeEmail).toBe("grace@example.com");
});

test("transferTicket rejects a ticket that does not belong to the token's order", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makeFreeTicketType(as, eventId);

  const orderA = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer A",
    buyerEmail: "a@example.com",
  });
  const orderB = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer B",
    buyerEmail: "b@example.com",
  });

  const foundB = await t.query(api.orders.getOrder, { token: orderB.token });
  const foreignTicketId = foundB!.tickets[0]._id;

  await expect(
    t.mutation(api.tickets.transferTicket, {
      orderToken: orderA.token, // orderA's token, orderB's ticket
      ticketId: foreignTicketId,
      attendeeName: "Someone Else",
    }),
  ).rejects.toThrow();

  const ticket = await t.run((ctx) => ctx.db.get(foreignTicketId));
  expect(ticket?.attendeeName).toBeUndefined(); // untouched
});

test("transferTicket rejects a checked_in ticket", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makeFreeTicketType(as, eventId);
  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
  });

  const found = await t.query(api.orders.getOrder, { token: result.token });
  const ticketId = found!.tickets[0]._id;
  await t.run((ctx) => ctx.db.patch(ticketId, { status: "checked_in" }));

  await expect(
    t.mutation(api.tickets.transferTicket, {
      orderToken: result.token,
      ticketId,
      attendeeName: "Someone Else",
    }),
  ).rejects.toThrow();
});

test("transferTicket rejects a cancelled ticket", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makeFreeTicketType(as, eventId);
  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
  });

  const found = await t.query(api.orders.getOrder, { token: result.token });
  const ticketId = found!.tickets[0]._id;
  await t.run((ctx) => ctx.db.patch(ticketId, { status: "cancelled" }));

  await expect(
    t.mutation(api.tickets.transferTicket, {
      orderToken: result.token,
      ticketId,
      attendeeName: "Someone Else",
    }),
  ).rejects.toThrow();
});

test("transferTicket rejects an empty attendee name", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asOrganizer(t, "ada@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await makePublishedEvent(as, 100);
  const ticketTypeId = await makeFreeTicketType(as, eventId);
  const result = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer",
    buyerEmail: "buyer@example.com",
  });

  const found = await t.query(api.orders.getOrder, { token: result.token });
  const ticketId = found!.tickets[0]._id;

  await expect(
    t.mutation(api.tickets.transferTicket, {
      orderToken: result.token,
      ticketId,
      attendeeName: "   ", // whitespace-only
    }),
  ).rejects.toThrow();

  const ticket = await t.run((ctx) => ctx.db.get(ticketId));
  expect(ticket?.attendeeName).toBeUndefined(); // untouched
});

test("listOrdersForEvent returns the event's orders newest first, owner-only", async () => {
  const t = convexTest(schema, modules);
  const { as: asAda } = await asOrganizer(t, "ada@example.com");
  await asAda.mutation(api.organizers.ensureOrganizer, {});
  const { as: asBob } = await asOrganizer(t, "bob@example.com");
  await asBob.mutation(api.organizers.ensureOrganizer, {});

  const eventId = await makePublishedEvent(asAda, 100);
  const ticketTypeId = await makePaidTicketType(asAda, eventId, 1000);

  const first = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer One",
    buyerEmail: "buyer1@example.com",
  });
  const second = await t.mutation(api.orders.createOrder, {
    eventId,
    items: [{ ticketTypeId, quantity: 1 }],
    buyerName: "Buyer Two",
    buyerEmail: "buyer2@example.com",
  });

  const list = await asAda.query(api.orders.listOrdersForEvent, { eventId });
  expect(list.map((o) => o._id)).toEqual([second.orderId, first.orderId]);

  await expect(asBob.query(api.orders.listOrdersForEvent, { eventId })).rejects.toThrow();
});
