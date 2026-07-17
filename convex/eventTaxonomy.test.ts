import { expect, test } from "vitest";
import { isEventCategory, isEventType, isValidSlug } from "./lib/eventTaxonomy";

test("isValidSlug accepts lowercase hyphenated slugs, single chars, and the 80-char boundary", () => {
  expect(isValidSlug("my-event")).toBe(true);
  expect(isValidSlug("a")).toBe(true);
  expect(isValidSlug("a".repeat(80))).toBe(true);
});

test("isValidSlug rejects uppercase, spaces, leading/trailing hyphens, double hyphens, empty, and >80 chars", () => {
  expect(isValidSlug("My-Event")).toBe(false);
  expect(isValidSlug("has spaces")).toBe(false);
  expect(isValidSlug("-leading")).toBe(false);
  expect(isValidSlug("trailing-")).toBe(false);
  expect(isValidSlug("double--hyphen")).toBe(false);
  expect(isValidSlug("")).toBe(false);
  expect(isValidSlug("a".repeat(81))).toBe(false);
});

test("isEventType accepts a valid member and rejects an invalid or empty string", () => {
  expect(isEventType("Conference")).toBe(true);
  expect(isEventType("Not A Type")).toBe(false);
  expect(isEventType("")).toBe(false);
});

test("isEventCategory accepts a valid member and rejects an invalid or empty string", () => {
  expect(isEventCategory("Music")).toBe(true);
  expect(isEventCategory("Not A Category")).toBe(false);
  expect(isEventCategory("")).toBe(false);
});
