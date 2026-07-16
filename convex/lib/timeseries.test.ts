import { expect, test } from "vitest";
import { buildDateWindow, toUtcDateString, fromUtcDateString, TIMESERIES_DAYS } from "./timeseries";

test("buildDateWindow returns `days` UTC date strings, oldest first, ending today", () => {
  const now = Date.UTC(2026, 6, 16, 9, 30); // 2026-07-16T09:30Z
  const window = buildDateWindow(now, 30);
  expect(window).toHaveLength(30);
  expect(window[29]).toBe("2026-07-16");
  expect(window[0]).toBe("2026-06-17");
  // strictly increasing, one UTC day apart
  for (let i = 1; i < window.length; i++) {
    expect(fromUtcDateString(window[i]) - fromUtcDateString(window[i - 1])).toBe(24 * 60 * 60 * 1000);
  }
});

test("buildDateWindow defaults to TIMESERIES_DAYS", () => {
  const window = buildDateWindow(Date.UTC(2026, 0, 1));
  expect(window).toHaveLength(TIMESERIES_DAYS);
});

test("toUtcDateString/fromUtcDateString round-trip at UTC midnight", () => {
  expect(toUtcDateString(fromUtcDateString("2026-07-16"))).toBe("2026-07-16");
});
