import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitize organizer-authored rich-text HTML before it is rendered on the
 * PUBLIC event page. The description is written in the Tiptap editor and stored
 * verbatim, so it must be sanitized on the way out — never trust stored HTML.
 *
 * The allowlist is exactly what the editor can produce (formatting, lists,
 * headings, links); everything else — scripts, styles, event handlers,
 * iframes, images, arbitrary attributes — is stripped. `isomorphic-dompurify`
 * runs the same allowlist on the server (SSR, via jsdom) and the client.
 */
const ALLOWED_TAGS = [
  "p", "br", "strong", "b", "em", "i", "s", "u",
  "ul", "ol", "li", "blockquote", "h2", "h3", "h4",
  "code", "pre", "a", "hr",
];
const ALLOWED_ATTR = ["href", "target", "rel"];

// Any link that survives sanitization opens safely in a new tab. Added once at
// module load (DOMPurify is a singleton), so it applies to every sanitize call.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function sanitizeRichText(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Block javascript:/data: URLs on links; allow only web, mail, tel, anchors.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|#|\/)/i,
  });
}

/** Distinguishes editor HTML from legacy plain-text descriptions. */
export function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}
