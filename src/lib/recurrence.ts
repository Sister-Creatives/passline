export interface RecurrenceSpec {
  weekdays: number[]; // 0=Sun .. 6=Sat
  fromDate: string; // "YYYY-MM-DD"
  untilDate: string; // "YYYY-MM-DD", inclusive
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
}

const MAX_OCCURRENCES = 366;

/**
 * Walks every calendar day from `fromDate` to `untilDate` (inclusive) and, for
 * each day whose weekday is in `weekdays`, emits a `{ startsAt, endsAt }` pair
 * built from that day plus `startTime`/`endTime`.
 *
 * Dates are parsed as **local** calendar days (`new Date(y, mo - 1, d)`), not
 * `new Date("YYYY-MM-DD")` (which parses as UTC midnight). This matters
 * because the generated slots must land in the organizer's local time, just
 * like the manual "add session" form -- otherwise a slot typed as "9am" could
 * land on a different day or hour once converted from UTC.
 */
export function generateRecurringDates(
  spec: RecurrenceSpec,
): { startsAt: number; endsAt: number }[] {
  const { weekdays, fromDate, untilDate, startTime, endTime } = spec;
  if (!weekdays || weekdays.length === 0) return [];

  const from = parseLocalDate(fromDate);
  const until = parseLocalDate(untilDate);
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  if (!from || !until || !start || !end) return [];
  if (until.getTime() < from.getTime()) return [];

  const weekdaySet = new Set(weekdays);
  const results: { startsAt: number; endsAt: number }[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const untilTime = until.getTime();

  while (cursor.getTime() <= untilTime && results.length < MAX_OCCURRENCES) {
    if (weekdaySet.has(cursor.getDay())) {
      const y = cursor.getFullYear();
      const mo = cursor.getMonth();
      const d = cursor.getDate();
      results.push({
        startsAt: new Date(y, mo, d, start.hh, start.mm).getTime(),
        endsAt: new Date(y, mo, d, end.hh, end.mm).getTime(),
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return results;
}

function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, mo, d] = match;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function parseTime(value: string): { hh: number; mm: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}
