import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getAuthOrganizerId } from "./auth";

const discountKindValidator = v.union(v.literal("percent"), v.literal("fixed"));

/** Load an event and enforce that it belongs to the authenticated organizer. */
async function requireOwnedEvent(ctx: QueryCtx | MutationCtx, eventId: Id<"events">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const event = await ctx.db.get(eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return event;
}

/** Load a promo code + its event, enforcing organizer ownership of the event. */
async function requireOwnedPromoCode(ctx: QueryCtx | MutationCtx, promoCodeId: Id<"promoCodes">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const promoCode = await ctx.db.get(promoCodeId);
  if (!promoCode) throw new Error("Not found");
  const event = await ctx.db.get(promoCode.eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return { promoCode, event };
}

export const create = mutation({
  args: {
    eventId: v.id("events"),
    code: v.string(),
    discountKind: discountKindValidator,
    percentBps: v.optional(v.number()),
    fixedCents: v.optional(v.number()),
    maxRedemptions: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const event = await requireOwnedEvent(ctx, args.eventId);

    const code = args.code.trim().toUpperCase();
    if (code.length === 0) throw new Error("Code is required");

    if (args.discountKind === "percent") {
      if (
        args.percentBps === undefined ||
        !Number.isInteger(args.percentBps) ||
        args.percentBps < 1 ||
        args.percentBps > 10000
      ) {
        throw new Error("percentBps must be a whole number between 1 and 10000");
      }
    } else {
      if (args.fixedCents === undefined || !Number.isInteger(args.fixedCents) || args.fixedCents < 1) {
        throw new Error("fixedCents must be a whole number of at least 1");
      }
    }

    if (
      args.maxRedemptions !== undefined &&
      (!Number.isInteger(args.maxRedemptions) || args.maxRedemptions < 1)
    ) {
      throw new Error("maxRedemptions must be a whole number of at least 1");
    }

    const existing = await ctx.db
      .query("promoCodes")
      .withIndex("by_event_and_code", (q) => q.eq("eventId", args.eventId).eq("code", code))
      .unique();
    if (existing) throw new Error("A promo code with that code already exists for this event");

    return ctx.db.insert("promoCodes", {
      eventId: args.eventId,
      organizerId: event.organizerId,
      code,
      discountKind: args.discountKind,
      percentBps: args.discountKind === "percent" ? args.percentBps : undefined,
      fixedCents: args.discountKind === "fixed" ? args.fixedCents : undefined,
      maxRedemptions: args.maxRedemptions,
      timesRedeemed: 0,
      active: true,
      createdAt: Date.now(),
    });
  },
});

export const list = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireOwnedEvent(ctx, eventId);
    return ctx.db
      .query("promoCodes")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
  },
});

export const remove = mutation({
  args: { promoCodeId: v.id("promoCodes") },
  handler: async (ctx, { promoCodeId }) => {
    await requireOwnedPromoCode(ctx, promoCodeId);
    await ctx.db.delete(promoCodeId);
    return null;
  },
});

/**
 * Look up a promo code (case-insensitive) for an event and compute the
 * discount it applies to a gross subtotal. Plain helper (not a Convex
 * function) shared by the checkout path (convex/orders.ts createOrder,
 * F4.4+) so resolution + amount math live in one place. Throws on a
 * missing/inactive/exhausted code so the caller's mutation aborts (and, for
 * `createOrder`, no capacity/order rows are left half-committed).
 */
export async function resolveAndComputeDiscount(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<"events">,
  code: string,
  grossSubtotalCents: number,
): Promise<{ promoCodeId: Id<"promoCodes">; discountCents: number }> {
  const normalizedCode = code.trim().toUpperCase();
  const promoCode = await ctx.db
    .query("promoCodes")
    .withIndex("by_event_and_code", (q) => q.eq("eventId", eventId).eq("code", normalizedCode))
    .unique();
  if (!promoCode) throw new Error("Invalid promo code");
  if (!promoCode.active) throw new Error("Promo code is no longer active");
  if (promoCode.maxRedemptions !== undefined && promoCode.timesRedeemed >= promoCode.maxRedemptions) {
    throw new Error("Promo code has been fully redeemed");
  }

  const rawDiscountCents =
    promoCode.discountKind === "percent"
      ? Math.round((grossSubtotalCents * (promoCode.percentBps ?? 0)) / 10000)
      : Math.min(promoCode.fixedCents ?? 0, grossSubtotalCents);
  const discountCents = Math.min(Math.max(rawDiscountCents, 0), grossSubtotalCents);

  return { promoCodeId: promoCode._id, discountCents };
}
