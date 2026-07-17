import { expect, test } from "vitest";
import { csvField } from "./csv";

test("wraps a plain value in double quotes", () => {
  expect(csvField("hello")).toBe('"hello"');
});

test("doubles embedded quotes", () => {
  expect(csvField('say "hi"')).toBe('"say ""hi"""');
});

test("neutralizes a leading formula trigger with a single quote inside the quotes", () => {
  expect(csvField('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"');
  expect(csvField("+1234")).toBe("\"'+1234\"");
  expect(csvField("-1234")).toBe("\"'-1234\"");
  expect(csvField("@example")).toBe("\"'@example\"");
});
