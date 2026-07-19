import { expect, test } from "vitest";
import { generateRecurringDates } from "./recurrence";

test("every Wed & Sat from a Wednesday through the following month-end yields the right count", () => {
  // 2026-07-01 is a Wednesday; range runs through 2026-08-31 (month-end of the
  // following month).
  const results = generateRecurringDates({
    weekdays: [3, 6],
    fromDate: "2026-07-01",
    untilDate: "2026-08-31",
    startTime: "09:00",
    endTime: "10:00",
  });

  let expectedCount = 0;
  const cursor = new Date(2026, 6, 1);
  const until = new Date(2026, 7, 31).getTime();
  while (cursor.getTime() <= until) {
    const dow = cursor.getDay();
    if (dow === 3 || dow === 6) expectedCount++;
    cursor.setDate(cursor.getDate() + 1);
  }

  expect(results).toHaveLength(expectedCount);
  for (const { startsAt } of results) {
    const dow = new Date(startsAt).getDay();
    expect([3, 6]).toContain(dow);
  }
});

test("applies the given start/end time-of-day to every generated slot", () => {
  const results = generateRecurringDates({
    weekdays: [3],
    fromDate: "2026-07-01",
    untilDate: "2026-07-01",
    startTime: "12:30",
    endTime: "14:45",
  });

  expect(results).toHaveLength(1);
  const { startsAt, endsAt } = results[0];
  expect(startsAt).toBe(new Date(2026, 6, 1, 12, 30).getTime());
  expect(endsAt).toBe(new Date(2026, 6, 1, 14, 45).getTime());
  expect(new Date(startsAt).getHours()).toBe(12);
  expect(new Date(startsAt).getMinutes()).toBe(30);
  expect(new Date(endsAt).getHours()).toBe(14);
  expect(new Date(endsAt).getMinutes()).toBe(45);
});

test("returns [] for empty weekdays", () => {
  const results = generateRecurringDates({
    weekdays: [],
    fromDate: "2026-07-01",
    untilDate: "2026-07-31",
    startTime: "09:00",
    endTime: "10:00",
  });
  expect(results).toEqual([]);
});

test("returns [] when untilDate is before fromDate", () => {
  const results = generateRecurringDates({
    weekdays: [1, 2, 3, 4, 5],
    fromDate: "2026-07-31",
    untilDate: "2026-07-01",
    startTime: "09:00",
    endTime: "10:00",
  });
  expect(results).toEqual([]);
});

test("a range with exactly one matching weekday yields a single result", () => {
  // 2026-07-01 through 2026-07-07 contains exactly one Wednesday (the 1st).
  const results = generateRecurringDates({
    weekdays: [3],
    fromDate: "2026-07-01",
    untilDate: "2026-07-07",
    startTime: "09:00",
    endTime: "10:00",
  });
  expect(results).toHaveLength(1);
  expect(results[0].startsAt).toBe(new Date(2026, 6, 1, 9, 0).getTime());
});

test("results are strictly ascending by startsAt", () => {
  const results = generateRecurringDates({
    weekdays: [1, 3, 5],
    fromDate: "2026-07-01",
    untilDate: "2026-08-15",
    startTime: "09:00",
    endTime: "10:00",
  });
  expect(results.length).toBeGreaterThan(1);
  for (let i = 1; i < results.length; i++) {
    expect(results[i].startsAt).toBeGreaterThan(results[i - 1].startsAt);
  }
});
