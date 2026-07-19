import { expect, test } from "vitest";
import { canViewEvent } from "./lib/preview";
import type { Doc } from "./_generated/dataModel";

test("a published event is viewable regardless of token", () => {
  const event = { status: "published", previewToken: "prv_abc" } as Doc<"events">;
  expect(canViewEvent(event)).toBe(true);
  expect(canViewEvent(event, "prv_abc")).toBe(true);
  expect(canViewEvent(event, "wrong")).toBe(true);
});

test("a draft with a matching preview token is viewable", () => {
  const event = { status: "draft", previewToken: "prv_abc" } as Doc<"events">;
  expect(canViewEvent(event, "prv_abc")).toBe(true);
});

test("a draft with a wrong preview token is not viewable", () => {
  const event = { status: "draft", previewToken: "prv_abc" } as Doc<"events">;
  expect(canViewEvent(event, "prv_wrong")).toBe(false);
});

test("a draft with no preview token supplied is not viewable", () => {
  const event = { status: "draft", previewToken: "prv_abc" } as Doc<"events">;
  expect(canViewEvent(event)).toBe(false);
});

test("a draft that has no previewToken at all is not viewable even with a token supplied", () => {
  const event = { status: "draft" } as Doc<"events">;
  expect(canViewEvent(event, "prv_abc")).toBe(false);
});
