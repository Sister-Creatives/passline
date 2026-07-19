import { expect, test } from "vitest";
import { looksLikeHtml, sanitizeRichText } from "./sanitize";

test("keeps the formatting tags the editor produces", () => {
  const html = "<p><strong>Bold</strong> and <em>italic</em></p><ul><li>one</li></ul><h2>Heading</h2>";
  const clean = sanitizeRichText(html);
  expect(clean).toContain("<strong>Bold</strong>");
  expect(clean).toContain("<em>italic</em>");
  expect(clean).toContain("<li>one</li>");
  expect(clean).toContain("<h2>Heading</h2>");
});

test("strips script tags and their content", () => {
  const clean = sanitizeRichText('<p>hi</p><script>alert("xss")</script>');
  expect(clean).toContain("<p>hi</p>");
  expect(clean.toLowerCase()).not.toContain("<script");
  expect(clean).not.toContain("alert");
});

test("strips inline event handlers", () => {
  const clean = sanitizeRichText('<p onclick="steal()">click</p>');
  expect(clean).not.toContain("onclick");
  expect(clean).toContain("click");
});

test("drops disallowed tags (img, iframe)", () => {
  const clean = sanitizeRichText('<p>x</p><img src="x"><iframe src="evil"></iframe>');
  expect(clean.toLowerCase()).not.toContain("<img");
  expect(clean.toLowerCase()).not.toContain("<iframe");
});

test("removes javascript: links but keeps http links (opened safely)", () => {
  const evil = sanitizeRichText('<a href="javascript:alert(1)">x</a>');
  expect(evil).not.toContain("javascript:");
  const good = sanitizeRichText('<a href="https://example.com">x</a>');
  expect(good).toContain('href="https://example.com"');
  expect(good).toContain('rel="noopener noreferrer"');
  expect(good).toContain('target="_blank"');
});

test("looksLikeHtml distinguishes editor HTML from plain text", () => {
  expect(looksLikeHtml("<p>hello</p>")).toBe(true);
  expect(looksLikeHtml("just a plain\nline break description")).toBe(false);
});
