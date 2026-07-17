import { mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Public (buyer-facing, no auth) -- reassign a ticket's attendee. Mirrors the
 * `orders.getOrder({token})` / `rsvps` public-token pattern: the order token
 * is an unguessable secret handed only to the buyer, so a lookup by token is
 * the intended authorization. Requires the ticket to belong to the order the
 * token resolves to and to be `valid` -- a `checked_in` ticket has already
 * been used at the door and a `cancelled` one no longer exists for the
 * attendee, so neither can be transferred. `attendeeName` must be non-empty
 * after trimming.
 */
export const transferTicket = mutation({
  args: {
    orderToken: v.string(),
    ticketId: v.id("tickets"),
    attendeeName: v.string(),
    attendeeEmail: v.optional(v.string()),
  },
  handler: async (ctx, { orderToken, ticketId, attendeeName, attendeeEmail }) => {
    const order = await ctx.db
      .query("orders")
      .withIndex("by_token", (q) => q.eq("token", orderToken))
      .unique();
    if (!order) throw new Error("Order not found");

    const ticket = await ctx.db.get(ticketId);
    if (!ticket || ticket.orderId !== order._id) throw new Error("Ticket not found");
    if (ticket.status !== "valid") throw new Error("Only a valid ticket can be transferred");

    const trimmedName = attendeeName.trim();
    if (!trimmedName) throw new Error("Attendee name is required");

    await ctx.db.patch(ticketId, { attendeeName: trimmedName, attendeeEmail });
    return null;
  },
});
