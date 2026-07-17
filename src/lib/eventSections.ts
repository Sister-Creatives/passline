export type EventSectionGroup = "edit" | "manage";

// Kept in sync by hand with `SectionKey` in `convex/lib/readiness.ts` — backend
// code can't import from `src/`, so update both when adding/removing a section.
export type EventSectionKey =
  | "details" | "tickets" | "sessions" | "seating" | "addons" | "promo"
  | "access" | "questions" | "page" | "hub" | "accessibility"
  | "orders" | "attendees" | "analytics" | "marketing" | "activity";

export type EventSection = { key: EventSectionKey; label: string; group: EventSectionGroup };

export const EVENT_SECTION_GROUPS: { key: EventSectionGroup; label: string }[] = [
  { key: "edit", label: "Edit event" },
  { key: "manage", label: "Manage event" },
];

/** Ordered nav: EDIT sections (setup) then MANAGE sections (post-publish ops). */
export const EVENT_SECTIONS: EventSection[] = [
  { key: "details", label: "Details", group: "edit" },
  { key: "tickets", label: "Ticket types", group: "edit" },
  { key: "sessions", label: "Sessions", group: "edit" },
  { key: "seating", label: "Seating", group: "edit" },
  { key: "addons", label: "Add-ons", group: "edit" },
  { key: "promo", label: "Promo codes", group: "edit" },
  { key: "access", label: "Access codes", group: "edit" },
  { key: "questions", label: "Questions", group: "edit" },
  { key: "page", label: "Page & design", group: "edit" },
  { key: "hub", label: "Virtual hub", group: "edit" },
  { key: "accessibility", label: "Accessibility", group: "edit" },
  { key: "orders", label: "Orders", group: "manage" },
  { key: "attendees", label: "Attendees", group: "manage" },
  { key: "analytics", label: "Analytics", group: "manage" },
  { key: "marketing", label: "Promote", group: "manage" },
  { key: "activity", label: "Activity", group: "manage" },
];

const KEYS = new Set<string>(EVENT_SECTIONS.map((s) => s.key));

export function isEventSectionKey(value: unknown): value is EventSectionKey {
  return typeof value === "string" && KEYS.has(value);
}
