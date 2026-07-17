import type { Doc } from "../_generated/dataModel";
import { SEAT_HOLDING_STATUSES } from "./constants";
import { buildDateWindow, fromUtcDateString, toUtcDateString, MS_PER_DAY } from "./timeseries";

/**
 * Cumulative "pace to capacity" spark (seat-holding registrations, right edge ==
 * seatsTaken) plus a 30d-vs-prior-30d registration delta, for one event's rsvps.
 * Registrations older than the 30-day window seed the baseline so the final
 * point still equals the total seat-holding count.
 */
export function buildPaceSpark(
  rsvps: Doc<"rsvps">[],
  now: number,
): { spark: number[]; deltaPct: number | null } {
  const window = buildDateWindow(now);
  const windowStartMs = fromUtcDateString(window[0]);
  const seatHolding = (s: string) => (SEAT_HOLDING_STATUSES as readonly string[]).includes(s);
  const seats = rsvps.filter((r) => seatHolding(r.status));
  const regTime = (r: Doc<"rsvps">) => r.createdAt ?? r._creationTime;

  const dayCounts = new Map(window.map((d) => [d, 0]));
  let baseline = 0;
  for (const r of seats) {
    const t = regTime(r);
    const key = toUtcDateString(t);
    if (t < windowStartMs || !dayCounts.has(key)) baseline += 1;
    else dayCounts.set(key, dayCounts.get(key)! + 1);
  }
  let running = baseline;
  const spark = window.map((d) => (running += dayCounts.get(d)!));

  const windowMs = 30 * MS_PER_DAY;
  const curStart = now - windowMs;
  const prevStart = now - 2 * windowMs;
  const cur = seats.filter((r) => regTime(r) >= curStart).length;
  const prev = seats.filter((r) => {
    const t = regTime(r);
    return t >= prevStart && t < curStart;
  }).length;
  const deltaPct = prev === 0 ? null : ((cur - prev) / prev) * 100;

  return { spark, deltaPct };
}
