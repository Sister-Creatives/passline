/**
 * Fixed taxonomy for the F21b "Event information" fields (event type,
 * category, and slug) -- shared by backend validation (`events.updateEvent`)
 * and the edit form, which imports the option lists directly.
 *
 * The lists are fixed (Humanitix-parity, no free-form entries); `isEventType`
 * / `isEventCategory` are the single source of truth callers use to validate
 * an incoming string against them.
 */

export const EVENT_TYPES = [
  "Conference", "Workshop", "Concert or performance", "Festival", "Networking",
  "Class or course", "Sporting event", "Exhibition", "Party or social",
  "Fundraiser", "Screening", "Other",
] as const;

export const EVENT_CATEGORIES = [
  "Music", "Business & professional", "Food & drink", "Community & culture", "Arts",
  "Sports & fitness", "Health & wellbeing", "Charity & causes", "Education",
  "Family & kids", "Film & media", "Other",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export function isEventType(v: string): v is EventType { return (EVENT_TYPES as readonly string[]).includes(v); }
export function isEventCategory(v: string): v is EventCategory { return (EVENT_CATEGORIES as readonly string[]).includes(v); }

// Slug: lowercase letters/digits/hyphens, 1..80, no leading/trailing/double hyphen.
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function isValidSlug(s: string): boolean { return s.length >= 1 && s.length <= 80 && SLUG_RE.test(s); }
