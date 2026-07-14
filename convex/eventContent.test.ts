import { expect, test } from "vitest";
import { isValidHexColor, parseVideoEmbed } from "./lib/eventContent";

// --- isValidHexColor ----------------------------------------------------

test("isValidHexColor accepts a well-formed 6-digit hex color", () => {
  expect(isValidHexColor("#1a2b3c")).toBe(true);
  expect(isValidHexColor("#ABCDEF")).toBe(true);
});

test("isValidHexColor rejects a named color", () => {
  expect(isValidHexColor("red")).toBe(false);
});

test("isValidHexColor rejects a 3-digit shorthand hex", () => {
  expect(isValidHexColor("#fff")).toBe(false);
});

test("isValidHexColor rejects an injection string", () => {
  expect(isValidHexColor('#fff"><script>alert(1)</script>')).toBe(false);
  expect(isValidHexColor("#123456; background:url(javascript:alert(1))")).toBe(false);
});

// --- parseVideoEmbed -----------------------------------------------------

test("parseVideoEmbed extracts the id from a YouTube watch?v= URL", () => {
  expect(parseVideoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
    provider: "youtube",
    id: "dQw4w9WgXcQ",
  });
});

test("parseVideoEmbed extracts the id from a youtu.be short URL", () => {
  expect(parseVideoEmbed("https://youtu.be/dQw4w9WgXcQ")).toEqual({
    provider: "youtube",
    id: "dQw4w9WgXcQ",
  });
});

test("parseVideoEmbed extracts the id from a YouTube /embed/ URL", () => {
  expect(parseVideoEmbed("https://www.youtube.com/embed/dQw4w9WgXcQ")).toEqual({
    provider: "youtube",
    id: "dQw4w9WgXcQ",
  });
});

test("parseVideoEmbed extracts the id from a Vimeo URL", () => {
  expect(parseVideoEmbed("https://vimeo.com/76979871")).toEqual({
    provider: "vimeo",
    id: "76979871",
  });
});

test("parseVideoEmbed rejects an arbitrary non-video URL", () => {
  expect(parseVideoEmbed("https://example.com/video")).toBeNull();
});

test("parseVideoEmbed rejects a malformed URL", () => {
  expect(parseVideoEmbed("not a url")).toBeNull();
});

test("parseVideoEmbed rejects a YouTube URL whose id contains unsafe characters", () => {
  expect(parseVideoEmbed('https://www.youtube.com/watch?v=abc"><script>')).toBeNull();
});

test("parseVideoEmbed rejects a Vimeo URL whose id isn't purely digits", () => {
  expect(parseVideoEmbed("https://vimeo.com/abc123")).toBeNull();
});

test("parseVideoEmbed rejects a javascript: URL", () => {
  expect(parseVideoEmbed("javascript:alert(1)")).toBeNull();
});
