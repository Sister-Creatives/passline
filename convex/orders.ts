import {
  mutation,
  query,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthOrganizerId } from "./auth";
import { computeOrderAmounts, type OrderLineItem } from "./lib/fees";
import { resolveAndComputeDiscount } from "./promoCodes";
import { validateAndSnapshotAnswers } from "./checkoutQuestions";
import { unlockedTicketTypeIds } from "./accessCodes";
import { recordAudit } from "./audit";

/** 16 random bytes -> 32 lowercase hex chars, prefixed to form an opaque token/code. */
function randomToken(prefix: string): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}${hex}`;
}

/** Load an event and enforce that it belongs to the authenticated organizer. */
async function requireOwnedEvent(ctx: QueryCtx | MutationCtx, eventId: Id<"events">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const event = await ctx.db.get(eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return event;
}

/** Load an order and enforce that its event belongs to the authenticated organizer. */
async function requireOwnedOrder(ctx: QueryCtx | MutationCtx, orderId: Id<"orders">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const order = await ctx.db.get(orderId);
  if (!order) throw new Error("Not found");
  const event = await ctx.db.get(order.eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return order;
}

/**
 * Issue one `tickets` row per unit across the order's items and mark the
 * order `paid`. Plain helper (not a Convex function) shared by `createOrder`'s
 * free ($0 total) path and `markOrderPaid`, so both fulfill orders exactly
 * the same way.
 */
async function issueTicketsAndMarkPaid(ctx: MutationCtx, order: Doc<"orders">) {
  const items = await ctx.db
    .query("orderItems")
    .withIndex("by_order", (q) => q.eq("orderId", order._id))
    .collect();
  for (const item of items) {
    // F10: a seated line item was reserved with specific seats at
    // `buildOrder` time (stamped onto the orderItem) -- issue exactly one
    // ticket per seat, each stamped with that seat's id + a human label. A GA
    // (or session) item has no `seatIds` and falls through to the original
    // quantity loop, byte-identical to before.
    if (item.seatIds && item.seatIds.length > 0) {
      for (const seatId of item.seatIds) {
        const seat = await ctx.db.get(seatId);
        await ctx.db.insert("tickets", {
          orderId: order._id,
          eventId: order.eventId,
          ticketTypeId: item.ticketTypeId,
          code: randomToken("tkt_"),
          status: "valid",
          createdAt: Date.now(),
          sessionId: order.sessionId,
          seatId,
          seatLabel: seat ? `${seat.section} ${seat.row}${seat.number}` : undefined,
        });
      }
      continue;
    }
    for (let i = 0; i < item.quantity; i++) {
      await ctx.db.insert("tickets", {
        orderId: order._id,
        eventId: order.eventId,
        ticketTypeId: item.ticketTypeId,
        code: randomToken("tkt_"),
        status: "valid",
        createdAt: Date.now(),
        // F13: stamp the order's session (undefined for a single event) onto
        // every ticket it issues, so a ticket's session is always derivable
        // without a join back through its order.
        sessionId: order.sessionId,
      });
    }
  }
  await ctx.db.patch(order._id, { status: "paid", paidAt: Date.now() });
}

const orderItemInput = v.object({
  ticketTypeId: v.id("ticketTypes"),
  // F10: a seated ticket type derives its quantity from `seatIds.length`
  // instead, so `quantity` is optional at the wire level -- `buildOrder`
  // itself still requires it (and validates it) for a GA item.
  quantity: v.optional(v.number()),
  seatIds: v.optional(v.array(v.id("seats"))),
});

const addOnItemInput = v.object({
  addOnId: v.id("addOns"),
  quantity: v.number(),
});

const answerInput = v.object({
  questionId: v.id("checkoutQuestions"),
  value: v.string(),
});

type BuildOrderArgs = {
  eventId: Id<"events">;
  items: {
    ticketTypeId: Id<"ticketTypes">;
    quantity?: number;
    // F10: non-empty and required for a seated ticket type (one seat per
    // ticket); rejected on a GA (non-seated) item.
    seatIds?: Id<"seats">[];
  }[];
  addOnItems?: { addOnId: Id<"addOns">; quantity: number }[];
  buyerName: string;
  buyerEmail: string;
  promoCode?: string;
  accessCode?: string;
  answers?: { questionId: Id<"checkoutQuestions">; value: string }[];
  /**
   * F13: which of the event's `eventSessions` this order is for. Required
   * (and validated) when the event has ≥ 1 session; rejected when it has
   * none -- see the session-loading block at the top of `buildOrder`.
   */
  sessionId?: Id<"eventSessions">;
  /**
   * When true, the stored order carries zero platform fee regardless of the
   * event's `feeMode` -- `feeCents` is forced to 0 and `totalCents` down to
   * `subtotalCents` (the organizer's payout equals the subtotal too, since
   * there's no fee to absorb). Used by `createBoxOfficeOrder` for cash sales
   * (F18); `createOrder`'s public checkout never sets this.
   */
  feeOverrideZero?: boolean;
};

/**
 * Shared order-building core (F18 extraction) behind both the public
 * `createOrder` checkout and the organizer-facing `createBoxOfficeOrder`:
 * validates every item against its ticket type and the event's overall
 * capacity, reserves that capacity by incrementing each type's `sold`,
 * computes totals/fees, and inserts the order + its items. Optional
 * `answers` to the event's checkout questions (F5) are validated via
 * `validateAndSnapshotAnswers` and stored as `orderResponses` rows. Optional
 * `accessCode` (F4b) unlocks `hidden` ticket types for this checkout only --
 * this is the real gate, since a hidden type can never be bought without its
 * code even via the raw HTTP API. Optional `addOnItems` (F11.3) sells
 * event-level add-ons alongside (or instead of) tickets -- they contribute to
 * the same subtotal/fee math and reserve their own per-add-on capacity, but
 * issue no `tickets` rows and don't count against the event's overall
 * capacity (only ticket items do).
 *
 * Deliberately stops short of issuing tickets / marking the order paid --
 * that's the caller's job (`createOrder` does it inline only for a $0 total;
 * `createBoxOfficeOrder` always does it immediately), so this helper's own
 * job is just "validate the cart and persist a pending order for it."
 * Plain helper (not a Convex function), like `issueTicketsAndMarkPaid` --
 * runs in the caller's own mutation transaction.
 */
async function buildOrder(
  ctx: MutationCtx,
  {
    eventId,
    items,
    addOnItems,
    buyerName,
    buyerEmail,
    promoCode,
    accessCode,
    answers,
    sessionId,
    feeOverrideZero,
  }: BuildOrderArgs,
): Promise<{ orderId: Id<"orders">; order: Doc<"orders"> }> {
  const event = await ctx.db.get(eventId);
  if (!event || event.status !== "published") throw new Error("Event not found");
  // The cart may be tickets, add-ons, or both -- only a fully-empty cart
  // (neither) is rejected.
  if (items.length === 0 && (addOnItems === undefined || addOnItems.length === 0)) {
    throw new Error("Cart is empty");
  }

  // F13: multi-session events. An event is multi-session iff it has >= 1
  // `eventSessions` row -- when it does, every order MUST target one of
  // them (capacity is enforced there instead, below), and a session-less
  // event rejects a sessionId outright so it can never accidentally start
  // tracking session-scoped state. This is the only branch point in
  // `buildOrder` -- for a single (session-less) event, `session` stays
  // `undefined` throughout and every check below runs byte-identically to
  // before.
  const sessions = await ctx.db
    .query("eventSessions")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  let session: Doc<"eventSessions"> | undefined;
  if (sessions.length > 0) {
    if (!sessionId) throw new Error("This event requires a session");
    session = sessions.find((s) => s._id === sessionId);
    if (!session) throw new Error("Session not found for this event");
  } else if (sessionId) {
    throw new Error("This event has no sessions");
  }

  // F10: a ticket type is "seated" iff it has >= 1 `seats` row. Determined
  // once per distinct ticketTypeId referenced by the cart (an item can
  // legally omit `quantity` or `seatIds` depending on which kind it turns
  // out to be, so this has to run before either is validated below).
  // Seated ticket types can't be combined with a session this slice.
  const distinctTicketTypeIds = [...new Set(items.map((item) => item.ticketTypeId))];
  const seatedTicketTypeIds = new Set<Id<"ticketTypes">>();
  for (const ticketTypeId of distinctTicketTypeIds) {
    const anySeat = await ctx.db
      .query("seats")
      .withIndex("by_ticketType", (q) => q.eq("ticketTypeId", ticketTypeId))
      .first();
    if (anySeat) seatedTicketTypeIds.add(ticketTypeId);
  }
  if (session && seatedTicketTypeIds.size > 0) {
    throw new Error("Seated tickets can't be combined with sessions");
  }

  const unlocked = accessCode
    ? await unlockedTicketTypeIds(ctx, eventId, accessCode)
    : new Set<Id<"ticketTypes">>();

  // Validate before any capacity/promo side effects, so a rejected answer
  // (missing required question, invalid select value) leaves no partial
  // state behind -- mirrors how min/maxPerOrder checks below run before
  // any `sold` counters are patched.
  const answerSnapshots = await validateAndSnapshotAnswers(ctx, eventId, answers ?? []);

  const ticketTypes = await ctx.db
    .query("ticketTypes")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  const ticketTypesById = new Map(ticketTypes.map((t) => [t._id, t]));
  const alreadySold = ticketTypes.reduce((sum, t) => sum + t.sold, 0);

  // Aggregate the cart by ticketTypeId first, so a cart that lists the same
  // ticket type across multiple line items is validated (min/max/capacity)
  // against its combined quantity rather than bypassing per-type limits.
  // F10: a seated item is aggregated by seatIds (de-duped) instead of a
  // numeric quantity -- its quantity is derived below as the de-duped count.
  const quantityByTicketType = new Map<Id<"ticketTypes">, number>();
  const seatIdsByTicketType = new Map<Id<"ticketTypes">, Set<Id<"seats">>>();
  for (const item of items) {
    if (seatedTicketTypeIds.has(item.ticketTypeId)) {
      if (!item.seatIds || item.seatIds.length === 0) {
        throw new Error("Seated ticket types require seatIds");
      }
      const set = seatIdsByTicketType.get(item.ticketTypeId) ?? new Set<Id<"seats">>();
      for (const seatId of item.seatIds) set.add(seatId);
      seatIdsByTicketType.set(item.ticketTypeId, set);
      continue;
    }
    if (item.seatIds && item.seatIds.length > 0) {
      throw new Error("This ticket type does not support seat selection");
    }
    // `?? NaN` so a GA item that omits `quantity` altogether fails the
    // integer check below (rather than TS narrowing away `undefined`).
    const quantity = item.quantity ?? NaN;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error("Quantity must be a whole number of at least 1");
    }
    quantityByTicketType.set(
      item.ticketTypeId,
      (quantityByTicketType.get(item.ticketTypeId) ?? 0) + quantity,
    );
  }

  // Validate every referenced seat -- exists, belongs to this ticketTypeId +
  // eventId, and is still `available` -- entirely before any mutation below,
  // so a rejected seat (already sold / wrong type / wrong event) leaves the
  // cart's reservations completely untouched (no partial mutation). Folding
  // the de-duped count into `quantityByTicketType` here (rather than earlier)
  // means a seated type's quantity is always exactly its distinct seat count.
  const seatsById = new Map<Id<"seats">, Doc<"seats">>();
  for (const [ticketTypeId, seatIdSet] of seatIdsByTicketType) {
    for (const seatId of seatIdSet) {
      const seat = await ctx.db.get(seatId);
      if (!seat || seat.eventId !== eventId || seat.ticketTypeId !== ticketTypeId) {
        throw new Error("Seat not found for this ticket type");
      }
      if (seat.status !== "available") {
        throw new Error(`Seat ${seat.section} ${seat.row}${seat.number} is no longer available`);
      }
      seatsById.set(seatId, seat);
    }
    quantityByTicketType.set(ticketTypeId, seatIdSet.size);
  }

  const lineItems: (OrderLineItem & { ticketTypeId: Id<"ticketTypes"> })[] = [];
  let totalRequested = 0;

  for (const [ticketTypeId, totalQuantity] of quantityByTicketType) {
    const ticketType = ticketTypesById.get(ticketTypeId);
    if (!ticketType) throw new Error("Ticket type not found");
    if (ticketType.status !== "active") {
      throw new Error(`${ticketType.name} is not available for purchase`);
    }
    // `visible` types are always allowed; a `hidden` type requires its id
    // to be among those unlocked by a valid, active accessCode.
    if (ticketType.visibility === "hidden" && !unlocked.has(ticketTypeId)) {
      throw new Error("This ticket requires a valid access code");
    }
    if (ticketType.minPerOrder !== undefined && totalQuantity < ticketType.minPerOrder) {
      throw new Error(`Minimum order quantity for ${ticketType.name} is ${ticketType.minPerOrder}`);
    }
    if (ticketType.maxPerOrder !== undefined && totalQuantity > ticketType.maxPerOrder) {
      throw new Error(`Maximum order quantity for ${ticketType.name} is ${ticketType.maxPerOrder}`);
    }
    // A multi-session event's ticket types are pure pricing tiers across
    // sessions -- their own `capacity` (if any) is not enforced; only the
    // session's is, below. A single event enforces it exactly as before.
    // F10: a seated type's per-type numeric cap is skipped too -- its seat
    // inventory (validated above) is the capacity.
    if (
      !session &&
      !seatedTicketTypeIds.has(ticketTypeId) &&
      ticketType.capacity !== undefined &&
      ticketType.sold + totalQuantity > ticketType.capacity
    ) {
      throw new Error(`Not enough remaining capacity for ${ticketType.name}`);
    }

    totalRequested += totalQuantity;
    lineItems.push({
      ticketTypeId,
      unitPriceCents: ticketType.priceCents,
      quantity: totalQuantity,
    });
  }

  // Capacity gate: a multi-session event enforces only its session's
  // capacity (its own event.capacity is unused for it); a single event
  // enforces the event-wide capacity exactly as before.
  if (session) {
    if (session.sold + totalRequested > session.capacity) {
      throw new Error("Not enough remaining capacity for this session");
    }
  } else if (alreadySold + totalRequested > event.capacity) {
    throw new Error("Not enough remaining event capacity");
  }

  // Aggregate add-on items by addOnId (mirrors the ticket-type aggregation
  // above) and validate each against the event's add-ons + per-add-on
  // capacity. Add-ons are event-level only -- `by_event` scoping here means
  // an addOnId belonging to a different event simply isn't in the map, so
  // it falls through to "Add-on not found" below.
  const addOns = await ctx.db
    .query("addOns")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  const addOnsById = new Map(addOns.map((a) => [a._id, a]));

  const quantityByAddOn = new Map<Id<"addOns">, number>();
  for (const item of addOnItems ?? []) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new Error("Quantity must be a whole number of at least 1");
    }
    quantityByAddOn.set(item.addOnId, (quantityByAddOn.get(item.addOnId) ?? 0) + item.quantity);
  }

  const addOnLineItems: (OrderLineItem & { addOnId: Id<"addOns"> })[] = [];
  for (const [addOnId, totalQuantity] of quantityByAddOn) {
    const addOn = addOnsById.get(addOnId);
    if (!addOn) throw new Error("Add-on not found");
    if (!addOn.active) throw new Error(`${addOn.name} is not available for purchase`);
    if (addOn.capacity !== undefined && addOn.sold + totalQuantity > addOn.capacity) {
      throw new Error(`Not enough remaining capacity for ${addOn.name}`);
    }
    addOnLineItems.push({ addOnId, unitPriceCents: addOn.priceCents, quantity: totalQuantity });
  }

  // grossSubtotalCents = ticket gross + add-on gross; computeOrderAmounts
  // runs on the combined cart so a promo discount and the booking fee both
  // apply to the combined subtotal exactly as they would for tickets alone.
  const combinedLineItems: OrderLineItem[] = [...lineItems, ...addOnLineItems];
  const grossSubtotalCents = combinedLineItems.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0,
  );

  let promoCodeId: Id<"promoCodes"> | undefined;
  let discountCents = 0;
  const normalizedPromoCode = promoCode?.trim().toUpperCase();
  if (normalizedPromoCode) {
    const resolved = await resolveAndComputeDiscount(ctx, eventId, normalizedPromoCode, grossSubtotalCents);
    promoCodeId = resolved.promoCodeId;
    discountCents = resolved.discountCents;
  }

  const feeMode = event.feeMode ?? "pass";
  let amounts = computeOrderAmounts(combinedLineItems, feeMode, discountCents);
  // Cash box-office sales (F18) incur zero platform fee: force feeCents to 0
  // and collapse totalCents down to subtotalCents (the buyer owes exactly the
  // subtotal), regardless of the event's own feeMode. payoutCents also
  // becomes the subtotal -- there's no fee left to pass or absorb.
  if (feeOverrideZero) {
    amounts = {
      ...amounts,
      feeCents: 0,
      totalCents: amounts.subtotalCents,
      payoutCents: amounts.subtotalCents,
    };
  }
  const currency = event.currency ?? "USD";
  const token = randomToken("ord_");

  const orderId = await ctx.db.insert("orders", {
    eventId,
    organizerId: event.organizerId,
    buyerName,
    buyerEmail,
    status: "pending",
    currency,
    feeMode,
    subtotalCents: amounts.subtotalCents,
    feeCents: amounts.feeCents,
    totalCents: amounts.totalCents,
    payoutCents: amounts.payoutCents,
    grossSubtotalCents: amounts.grossSubtotalCents,
    discountCents: amounts.discountCents,
    promoCode: normalizedPromoCode,
    token,
    createdAt: Date.now(),
    sessionId: session?._id,
  });

  for (const item of lineItems) {
    const seatIdSet = seatIdsByTicketType.get(item.ticketTypeId);
    await ctx.db.insert("orderItems", {
      orderId,
      ticketTypeId: item.ticketTypeId,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      seatIds: seatIdSet ? [...seatIdSet] : undefined,
    });
  }

  for (const item of addOnLineItems) {
    await ctx.db.insert("orderAddOns", {
      orderId,
      addOnId: item.addOnId,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
    });
  }

  for (const snapshot of answerSnapshots) {
    await ctx.db.insert("orderResponses", {
      orderId,
      eventId,
      questionId: snapshot.questionId,
      label: snapshot.label,
      value: snapshot.value,
    });
  }

  // Atomically record the redemption: re-read the promo row in this same
  // mutation (rather than trusting the count from resolveAndComputeDiscount
  // above) and reject if incrementing would exceed maxRedemptions. Because
  // the resolve-check and this increment both read+write the same row
  // within one mutation, Convex's OCC serializes concurrent redemptions of
  // the same code -- a losing concurrent mutation retries, re-reads the
  // now-updated count, and throws here instead of overselling the cap.
  if (promoCodeId) {
    const promoCodeRow = await ctx.db.get(promoCodeId);
    if (!promoCodeRow) throw new Error("Invalid promo code");
    if (
      promoCodeRow.maxRedemptions !== undefined &&
      promoCodeRow.timesRedeemed >= promoCodeRow.maxRedemptions
    ) {
      throw new Error("Promo code has been fully redeemed");
    }
    await ctx.db.patch(promoCodeId, { timesRedeemed: promoCodeRow.timesRedeemed + 1 });
  }

  // Reserve capacity: patch each distinct ticket type once with its final
  // tally (current `sold` + the aggregate quantity reserved for it in this cart).
  for (const item of lineItems) {
    const ticketType = ticketTypesById.get(item.ticketTypeId);
    if (!ticketType) throw new Error("Ticket type not found");
    await ctx.db.patch(item.ticketTypeId, { sold: ticketType.sold + item.quantity });
  }

  // Reserve session capacity (multi-session events only): the session, not
  // the ticket types, is the inventory unit here -- their capacity check was
  // skipped above, but `sold` is still tallied per type for reporting.
  if (session) {
    await ctx.db.patch(session._id, { sold: session.sold + totalRequested });
  }

  // Reserve add-on capacity, mirroring the ticket-type reservation above.
  for (const item of addOnLineItems) {
    const addOn = addOnsById.get(item.addOnId);
    if (!addOn) throw new Error("Add-on not found");
    await ctx.db.patch(item.addOnId, { sold: addOn.sold + item.quantity });
  }

  // F10: reserve every purchased seat by flipping it to `sold` -- last, so
  // every validation above (including each seat's own availability) has
  // already passed and this order is guaranteed to persist.
  for (const seatId of seatsById.keys()) {
    await ctx.db.patch(seatId, { status: "sold" });
  }

  const order = await ctx.db.get(orderId);
  if (!order) throw new Error("Order not found");
  return { orderId, order };
}

/**
 * Public checkout mutation -- no account required (buyers have no account,
 * mirroring the public RSVP flow in convex/rsvps.ts). Thin wrapper around
 * `buildOrder` (F18 extraction) with `feeOverrideZero: false` -- the public
 * checkout always uses the event's own `feeMode`. A $0 total (an all-free
 * cart, or a promo/discount that zeroes it) is fulfilled inline here --
 * tickets are issued and the order is marked `paid` in the same mutation, so
 * a free "checkout" needs no payment step at all; a nonzero total stays
 * `pending` for F3b's payment-confirmation seam (`markOrderPaid`).
 */
export const createOrder = mutation({
  args: {
    eventId: v.id("events"),
    items: v.array(orderItemInput),
    buyerName: v.string(),
    buyerEmail: v.string(),
    promoCode: v.optional(v.string()),
    answers: v.optional(v.array(answerInput)),
    accessCode: v.optional(v.string()),
    addOnItems: v.optional(v.array(addOnItemInput)),
    sessionId: v.optional(v.id("eventSessions")), // F13: required iff the event has sessions
  },
  handler: async (
    ctx,
    { eventId, items, buyerName, buyerEmail, promoCode, answers, accessCode, addOnItems, sessionId },
  ) => {
    const { orderId, order } = await buildOrder(ctx, {
      eventId,
      items,
      addOnItems,
      buyerName,
      buyerEmail,
      promoCode,
      accessCode,
      answers,
      sessionId,
      feeOverrideZero: false,
    });

    let status: "pending" | "paid" = "pending";
    if (order.totalCents === 0) {
      await issueTicketsAndMarkPaid(ctx, order);
      status = "paid";
    }

    return { orderId, token: order.token, totalCents: order.totalCents, currency: order.currency, status };
  },
});

/**
 * Organizer-facing box-office sale (F18): sells tickets/add-ons at the door,
 * where payment is collected externally (cash or card) rather than online.
 * Built on the same `buildOrder` core as the public `createOrder`, so a
 * box-office cart gets identical validation (capacity, active/visible types,
 * access-code gate, min/max) -- it just skips promo codes, access codes, and
 * checkout-question answers, none of which apply to a door sale. A cash sale
 * is zero-fee (`feeOverrideZero`); a card sale keeps the event's normal fee.
 * Unlike `createOrder`, tickets are always issued immediately (there's no
 * "pending" state for a door sale -- payment already happened in person), and
 * the order is tagged `source: "box_office"` + the chosen `paymentMethod` so
 * it's distinguishable from an online order in the dashboard.
 */
export const createBoxOfficeOrder = mutation({
  args: {
    eventId: v.id("events"),
    items: v.array(orderItemInput),
    addOnItems: v.optional(v.array(addOnItemInput)),
    buyerName: v.string(),
    buyerEmail: v.optional(v.string()),
    paymentMethod: v.union(v.literal("cash"), v.literal("card")),
    sessionId: v.optional(v.id("eventSessions")), // F13: required iff the event has sessions
  },
  handler: async (
    ctx,
    { eventId, items, addOnItems, buyerName, buyerEmail, paymentMethod, sessionId },
  ) => {
    const event = await requireOwnedEvent(ctx, eventId);

    const { orderId, order } = await buildOrder(ctx, {
      eventId,
      items,
      addOnItems,
      buyerName,
      buyerEmail: buyerEmail ?? "",
      sessionId,
      feeOverrideZero: paymentMethod === "cash",
    });

    await ctx.db.patch(orderId, { source: "box_office", paymentMethod });
    const patchedOrder = await ctx.db.get(orderId);
    if (!patchedOrder) throw new Error("Order not found");
    await issueTicketsAndMarkPaid(ctx, patchedOrder);

    await recordAudit(ctx, {
      organizerId: event.organizerId,
      eventId,
      action: "order.box_office",
      summary: `Box office sale to ${buyerName} (${paymentMethod}): ${order.totalCents} cents`,
    });

    return { orderId, token: order.token, totalCents: order.totalCents };
  },
});

/**
 * F3b's payment-confirmation seam: called once a payment processor confirms
 * an order's charge succeeded, to issue tickets and mark the order paid.
 * Idempotent -- a second call against an already-`paid` order is a no-op, so
 * a retried/duplicate webhook delivery never double-issues tickets. Also a
 * no-op against a `cancelled` order: its reserved capacity was already
 * released by `cancelOrder`, so resurrecting it here would oversell.
 */
export const markOrderPaid = internalMutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.db.get(orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "pending") return null; // idempotent: paid → no-op; cancelled → no-op (capacity already released)
    await issueTicketsAndMarkPaid(ctx, order);
    return null;
  },
});

/**
 * Cancel a `pending` order (owner-only, via the order's event) and release
 * the capacity it had reserved. Cancelling a `paid` order is a refund, out of
 * scope here (F6) -- only a `pending` order may be cancelled this way.
 */
export const cancelOrder = mutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const order = await requireOwnedOrder(ctx, orderId);
    if (order.status !== "pending") throw new Error("Only a pending order can be cancelled");

    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .collect();

    // F13: `buildOrder` always increments each order item's `ticketType.sold`
    // (issued-ticket count), and additionally increments `session.sold` (the
    // capacity gate) for a multi-session order -- so release must mirror both
    // unconditionally: always release the ticket types, and additionally
    // release the session when the order targeted one.
    for (const item of items) {
      const ticketType = await ctx.db.get(item.ticketTypeId);
      if (ticketType) {
        await ctx.db.patch(item.ticketTypeId, { sold: Math.max(0, ticketType.sold - item.quantity) });
      }
    }
    if (order.sessionId) {
      const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
      const session = await ctx.db.get(order.sessionId);
      if (session) {
        await ctx.db.patch(order.sessionId, { sold: Math.max(0, session.sold - totalQuantity) });
      }
    }

    // Release add-on capacity, mirroring the ticket-type release above.
    const orderAddOns = await ctx.db
      .query("orderAddOns")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .collect();
    for (const item of orderAddOns) {
      const addOn = await ctx.db.get(item.addOnId);
      if (addOn) {
        await ctx.db.patch(item.addOnId, { sold: Math.max(0, addOn.sold - item.quantity) });
      }
    }

    // F10: release any seats this order reserved. A pending order never had
    // tickets issued for it (that happens at payment confirmation), so the
    // seatIds stamped onto each orderItem at `buildOrder` time -- not the
    // tickets table -- are the only record of which seats to free.
    for (const item of items) {
      for (const seatId of item.seatIds ?? []) {
        const seat = await ctx.db.get(seatId);
        if (seat) {
          await ctx.db.patch(seatId, { status: "available" });
        }
      }
    }

    // Restore the promo redemption consumed at createOrder, so a cancelled
    // pending order doesn't permanently burn a limited-use code without a sale.
    if (order.promoCode) {
      const promo = await ctx.db
        .query("promoCodes")
        .withIndex("by_event_and_code", (q) => q.eq("eventId", order.eventId).eq("code", order.promoCode!))
        .unique();
      if (promo && promo.timesRedeemed > 0) {
        await ctx.db.patch(promo._id, { timesRedeemed: promo.timesRedeemed - 1 });
      }
    }

    await ctx.db.patch(orderId, { status: "cancelled" });
    return null;
  },
});

/**
 * Public order lookup by token, for a buyer's checkout confirmation page and
 * the self-service order page (F6). Mirrors rsvps.getRsvpByToken: the token
 * is an unguessable secret minted by `createOrder` and handed only to the
 * buyer who owns it, so an unauthenticated lookup-by-token is the intended
 * design. Returns null (not a throw) when no order has that token. Also
 * returns the order's `orderResponses` (F5 checkout question answers) and
 * its `event` (nullable -- an organizer can delete an event without deleting
 * its past orders, so an order can outlive its event), so a self-service
 * page can show the event title without a second round trip. Also returns
 * `addOns` (F11.3): the order's `orderAddOns` joined with each add-on's
 * current `name` (not a purchase-time snapshot -- only `unitPriceCents` is
 * snapshotted on the line item itself).
 */
export const getOrder = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const order = await ctx.db
      .query("orders")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!order) return null;
    const event = await ctx.db.get(order.eventId);
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .collect();
    const tickets = await ctx.db
      .query("tickets")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .collect();
    const orderResponses = await ctx.db
      .query("orderResponses")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .collect();
    const orderAddOns = await ctx.db
      .query("orderAddOns")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .collect();
    const addOns = await Promise.all(
      orderAddOns.map(async (row) => {
        const addOn = await ctx.db.get(row.addOnId);
        return { ...row, name: addOn?.name ?? "Unknown add-on" };
      }),
    );
    // F13: the order already carries `sessionId`; also resolve its session's
    // date/label (just those fields, not the raw `sold`/`capacity` counters)
    // so a self-service order page can show which session was booked without
    // a second round trip.
    const eventSession = order.sessionId ? await ctx.db.get(order.sessionId) : null;
    const session = eventSession
      ? { startsAt: eventSession.startsAt, endsAt: eventSession.endsAt, label: eventSession.label }
      : null;
    return { order, event, items, tickets, orderResponses, addOns, session };
  },
});

/**
 * Refund a `paid` order (owner-only, via the order's event): cancels every
 * non-cancelled ticket, releases the capacity reserved by the order's items
 * (mirroring `cancelOrder`'s release), restores a used promo code's
 * `timesRedeemed`, and marks the order `refunded`. Idempotent -- a
 * `cancelled`/already-`refunded` order returns early with no further effect,
 * so a retried call never double-releases capacity. A `pending` order is
 * rejected -- it was never fulfilled, so `cancelOrder` (not a refund) is the
 * right call for it.
 *
 * F3b: issue the Stripe refund for a nonzero order here (money-back) -- F6
 * does the inventory/record only.
 */
export const refundOrder = mutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const order = await requireOwnedOrder(ctx, orderId);
    if (order.status === "cancelled" || order.status === "refunded") return null; // idempotent no-op
    if (order.status === "pending") throw new Error("Use cancelOrder for a pending order");

    const tickets = await ctx.db
      .query("tickets")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .collect();
    for (const ticket of tickets) {
      if (ticket.status !== "cancelled") {
        await ctx.db.patch(ticket._id, { status: "cancelled" });
      }
      // F10: a refunded order already has tickets (unlike cancelOrder's
      // pending order), so each seat-tied ticket's own `seatId` is the
      // release record here.
      if (ticket.seatId) {
        await ctx.db.patch(ticket.seatId, { status: "available" });
      }
    }

    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .collect();

    // F13: mirrors cancelOrder -- always release the ticket types, and
    // additionally release the session when the order targeted one, since
    // `buildOrder` increments both for a multi-session order.
    for (const item of items) {
      const ticketType = await ctx.db.get(item.ticketTypeId);
      if (ticketType) {
        await ctx.db.patch(item.ticketTypeId, { sold: Math.max(0, ticketType.sold - item.quantity) });
      }
    }
    if (order.sessionId) {
      const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
      const session = await ctx.db.get(order.sessionId);
      if (session) {
        await ctx.db.patch(order.sessionId, { sold: Math.max(0, session.sold - totalQuantity) });
      }
    }

    // Release add-on capacity, mirroring cancelOrder.
    const orderAddOns = await ctx.db
      .query("orderAddOns")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .collect();
    for (const item of orderAddOns) {
      const addOn = await ctx.db.get(item.addOnId);
      if (addOn) {
        await ctx.db.patch(item.addOnId, { sold: Math.max(0, addOn.sold - item.quantity) });
      }
    }

    // Restore the promo redemption consumed at createOrder, mirroring cancelOrder.
    if (order.promoCode) {
      const promo = await ctx.db
        .query("promoCodes")
        .withIndex("by_event_and_code", (q) => q.eq("eventId", order.eventId).eq("code", order.promoCode!))
        .unique();
      if (promo && promo.timesRedeemed > 0) {
        await ctx.db.patch(promo._id, { timesRedeemed: promo.timesRedeemed - 1 });
      }
    }

    await ctx.db.patch(orderId, { status: "refunded", refundedAt: Date.now() });
    await recordAudit(ctx, {
      organizerId: order.organizerId,
      eventId: order.eventId,
      action: "order.refunded",
      summary: `Refunded order ${order.token.slice(0, 12)}`,
    });
    return null;
  },
});

/**
 * Owner-only: an event's orders, newest first, for the dashboard Orders tab.
 * Each order is annotated with `itemCount` (the sum of its order items'
 * quantities) so the dashboard can show item counts without an N+1 query per
 * row.
 */
export const listOrdersForEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireOwnedEvent(ctx, eventId);
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .order("desc")
      .collect();

    return Promise.all(
      orders.map(async (order) => {
        const items = await ctx.db
          .query("orderItems")
          .withIndex("by_order", (q) => q.eq("orderId", order._id))
          .collect();
        const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
        return { ...order, itemCount };
      }),
    );
  },
});
