import { expect, test } from "vitest";
import { formatMoney } from "./format-money";

test("formats integer cents as a currency string", () => {
  expect(formatMoney(2500, "USD")).toBe("$25.00");
  expect(formatMoney(0, "USD")).toBe("$0.00");
  expect(formatMoney(199, "USD")).toBe("$1.99");
});
