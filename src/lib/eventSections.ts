export type EventSectionGroup = "build" | "manage";

// Kept in sync by hand with `SectionKey` in `convex/lib/readiness.ts` — backend
// code can't import from `src/`, so update both when adding/removing a section.
export type EventSectionKey =
  | "details" | "tickets" | "sessions" | "seating" | "addons" | "promo"
  | "access" | "questions" | "page" | "hub" | "accessibility"
  | "orders" | "attendees" | "analytics" | "marketing" | "activity";

export type EventSection = { key: EventSectionKey; label: string; group: EventSectionGroup };

/** Ordered nav: BUILD sections (setup) then MANAGE sections (post-publish ops). */
export const EVENT_SECTIONS: EventSection[] = [
  { key: "details", label: "Details", group: "build" },
  { key: "tickets", label: "Ticket types", group: "build" },
  { key: "sessions", label: "Sessions", group: "build" },
  { key: "seating", label: "Seating", group: "build" },
  { key: "addons", label: "Add-ons", group: "build" },
  { key: "promo", label: "Promo codes", group: "build" },
  { key: "access", label: "Access codes", group: "build" },
  { key: "questions", label: "Questions", group: "build" },
  { key: "page", label: "Page & design", group: "build" },
  { key: "hub", label: "Virtual hub", group: "build" },
  { key: "accessibility", label: "Accessibility", group: "build" },
  { key: "orders", label: "Orders", group: "manage" },
  { key: "attendees", label: "Attendees", group: "manage" },
  { key: "analytics", label: "Analytics", group: "manage" },
  { key: "marketing", label: "Marketing", group: "manage" },
  { key: "activity", label: "Activity", group: "manage" },
];

const KEYS = new Set<string>(EVENT_SECTIONS.map((s) => s.key));

export function isEventSectionKey(value: unknown): value is EventSectionKey {
  return typeof value === "string" && KEYS.has(value);
}
