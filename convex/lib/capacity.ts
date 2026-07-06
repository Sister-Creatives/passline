import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { SEAT_HOLDING_STATUSES } from "./constants";

/**
 * Count seats currently consumed against an event's capacity.
 *
 * Capacity is derived, never stored as a counter: this counts `rsvps` rows
 * whose status is seat-holding (confirmed, confirmed_pending_claim, or
 * checked_in), so it always reflects the true current state of the table.
 */
export async function countSeatsTaken(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<"events">,
): Promise<number> {
  const rows = await ctx.db
    .query("rsvps")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  return rows.filter((r) => (SEAT_HOLDING_STATUSES as readonly string[]).includes(r.status))
    .length;
}

/**
 * Compute the next waitlist position for an event.
 *
 * One past the current max `waitlistPosition` among waitlisted rows (0 if
 * none), so positions stay sequential even if earlier waitlisted rows are
 * later removed or promoted.
 */
export async function nextWaitlistPosition(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<"events">,
): Promise<number> {
  const waitlisted = await ctx.db
    .query("rsvps")
    .withIndex("by_event_and_status", (q) => q.eq("eventId", eventId).eq("status", "waitlisted"))
    .collect();
  const max = waitlisted.reduce((m, r) => Math.max(m, r.waitlistPosition ?? 0), 0);
  return max + 1;
}
