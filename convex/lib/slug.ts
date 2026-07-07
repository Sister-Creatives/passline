/**
 * Build a URL-safe, unique-ish slug from an event title.
 *
 * The title is lowercased and stripped down to `[a-z0-9-]`, then a short salt
 * (typically `crypto.randomUUID()`) is appended so two events with the same
 * title never collide on the `by_slug` index.
 */
export function slugify(title: string, salt: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "event"}-${salt.slice(0, 6)}`;
}
