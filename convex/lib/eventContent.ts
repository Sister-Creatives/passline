/**
 * Validation/parsing helpers for the F12 event-content ("Page") feature.
 *
 * Both helpers guard the *only* organizer-supplied values that ever get
 * interpolated into markup on the public page (brand colour into a CSS
 * variable / inline style, video id into an iframe `src`) -- see F12 spec
 * §4 and §9. Everything else (cover/speaker image URLs) only ever lands in
 * an `<img src>`, which is safe for arbitrary strings.
 */

export type VideoEmbed = { provider: "youtube" | "vimeo"; id: string };

// Charsets the parsed id is constrained to, so it can be safely interpolated
// into an iframe `src` with no further escaping.
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]+$/;
const VIMEO_ID_RE = /^[0-9]+$/;

/** `"#RRGGBB"` only -- lowercase or uppercase hex, exactly 6 digits. */
export function isValidHexColor(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s);
}

/**
 * Parse a YouTube or Vimeo watch URL into a `{ provider, id }` pair whose
 * `id` is guaranteed to match the safe charset above, or `null` if `url`
 * isn't a recognized, well-formed embed of one of those two providers.
 *
 * Recognized forms:
 *  - YouTube: `.../watch?v=<id>`, `youtu.be/<id>`, `.../embed/<id>`
 *  - Vimeo:   `vimeo.com/<digits>`
 *
 * Anything else -- including a malformed URL, an unsupported host, or a
 * value smuggled into the id segment that doesn't match the safe charset --
 * returns `null` rather than being forwarded (no arbitrary-URL embedding).
 */
export function parseVideoEmbed(url: string): VideoEmbed | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const v = parsed.searchParams.get("v");
    if (v && YOUTUBE_ID_RE.test(v)) return { provider: "youtube", id: v };

    const embedMatch = /^\/embed\/([^/]+)$/.exec(parsed.pathname);
    if (embedMatch && YOUTUBE_ID_RE.test(embedMatch[1])) {
      return { provider: "youtube", id: embedMatch[1] };
    }
    return null;
  }

  if (host === "youtu.be") {
    const id = parsed.pathname.replace(/^\//, "");
    return YOUTUBE_ID_RE.test(id) ? { provider: "youtube", id } : null;
  }

  if (host === "vimeo.com") {
    const id = parsed.pathname.replace(/^\//, "");
    return VIMEO_ID_RE.test(id) ? { provider: "vimeo", id } : null;
  }

  return null;
}
