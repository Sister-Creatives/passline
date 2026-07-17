export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const TIMESERIES_DAYS = 30;

/** UTC "YYYY-MM-DD" for a given epoch-ms timestamp. */
export function toUtcDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Epoch-ms (UTC midnight) for a "YYYY-MM-DD" date string. */
export function fromUtcDateString(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** The last `days` UTC-day date strings (including today), oldest first. */
export function buildDateWindow(now: number, days: number = TIMESERIES_DAYS): string[] {
  const todayMs = fromUtcDateString(toUtcDateString(now));
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(toUtcDateString(todayMs - i * MS_PER_DAY));
  return out;
}
