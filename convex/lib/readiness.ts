import type { Doc } from "../_generated/dataModel";

/** Every section in the event editor. Rule-bearing ones appear in `sectionStatus`. */
export type SectionKey =
  | "details" | "tickets" | "sessions" | "seating" | "addons" | "promo"
  | "access" | "questions" | "page" | "hub" | "accessibility"
  | "orders" | "attendees" | "analytics" | "marketing" | "activity";

export type RuleId = "details" | "tickets" | "seating" | "date" | "cover" | "page";
export type RuleSeverity = "required" | "recommended";
export type RuleStatus = "pass" | "fail";
export type SectionStatus = "complete" | "warning" | "incomplete";

export type ReadinessRule = {
  id: RuleId;
  section: SectionKey;
  label: string;
  severity: RuleSeverity;
  status: RuleStatus;
};

export type EventReadiness = {
  rules: ReadinessRule[];
  /** Only rule-bearing sections (details, tickets, page, and seating when in use). */
  sectionStatus: Partial<Record<SectionKey, SectionStatus>>;
  requiredTotal: number;
  requiredPassing: number;
  blockersRemaining: number;
  canPublish: boolean;
};

// Structural inputs: the real Convex Docs satisfy these Picks, and unit tests
// can pass minimal literals without constructing a full Doc.
type EventInput = Pick<Doc<"events">, "title" | "description" | "location" | "startsAt" | "endsAt">;
type TicketTypeInput = Pick<Doc<"ticketTypes">, "_id" | "status" | "visibility" | "capacity">;
type SeatInput = Pick<Doc<"seats">, "ticketTypeId">;
type AccessCodeInput = Pick<Doc<"accessCodes">, "active">;
type EventContentInput = Pick<Doc<"eventContent">, "coverImageUrl" | "agenda" | "speakers" | "faqs">;

/**
 * Compute an event's publish-readiness. Pure: reads only the fields above and
 * the injected `now`, so it is the single source of truth for both the UI
 * checklist (`getEventReadiness`) and the server gate (`publishEvent`).
 *
 * Required rules (block publish): `details`; `tickets` (a way in exists);
 * `seating` (only when the event uses reserved seating). Recommended rules
 * (warn only): `date`, `cover`, `page`.
 */
export function computeReadiness(input: {
  event: EventInput;
  ticketTypes: TicketTypeInput[];
  seats: SeatInput[];
  accessCodes: AccessCodeInput[];
  eventContent: EventContentInput | null;
  now: number;
}): EventReadiness {
  const { event, ticketTypes, seats, accessCodes, eventContent, now } = input;

  const detailsOk =
    event.title.trim() !== "" &&
    event.description.trim() !== "" &&
    event.location.trim() !== "" &&
    event.endsAt > event.startsAt;

  // "A way in": no ticket types (free RSVP), or a visible active type, or an
  // active access code that unlocks hidden types (invite-only event).
  const hasTypes = ticketTypes.length > 0;
  const hasVisibleActive = ticketTypes.some((t) => t.status === "active" && t.visibility === "visible");
  const hasActiveCode = accessCodes.some((c) => c.active);
  const ticketsOk = !hasTypes || hasVisibleActive || hasActiveCode;

  // Seating coherence — only relevant once the event has a seat map.
  const seatingEnabled = seats.length > 0;
  let seatingOk = true;
  if (seatingEnabled) {
    for (const type of ticketTypes) {
      const seatCount = seats.filter((s) => s.ticketTypeId === type._id).length;
      if (seatCount > 0) {
        const needed = type.capacity ?? seatCount;
        if (seatCount < needed) seatingOk = false;
      }
    }
  }

  const dateOk = event.endsAt > now;
  const coverOk = Boolean(eventContent?.coverImageUrl);
  const pageOk =
    eventContent != null &&
    (eventContent.agenda.length > 0 || eventContent.speakers.length > 0 || eventContent.faqs.length > 0);

  const rules: ReadinessRule[] = [
    { id: "details", section: "details", severity: "required", label: "Add a title, description, location, and a valid date range", status: detailsOk ? "pass" : "fail" },
    { id: "tickets", section: "tickets", severity: "required", label: "Add a ticket type buyers can access", status: ticketsOk ? "pass" : "fail" },
  ];
  if (seatingEnabled) {
    rules.push({ id: "seating", section: "seating", severity: "required", label: "Map enough seats for each seated ticket type", status: seatingOk ? "pass" : "fail" });
  }
  rules.push(
    { id: "date", section: "details", severity: "recommended", label: "Set an end date in the future", status: dateOk ? "pass" : "fail" },
    { id: "cover", section: "page", severity: "recommended", label: "Add a cover image", status: coverOk ? "pass" : "fail" },
    { id: "page", section: "page", severity: "recommended", label: "Add an agenda, speakers, or FAQs", status: pageOk ? "pass" : "fail" },
  );

  const sectionStatus: Partial<Record<SectionKey, SectionStatus>> = {};
  for (const section of new Set(rules.map((r) => r.section))) {
    const secRules = rules.filter((r) => r.section === section);
    const requiredFail = secRules.some((r) => r.severity === "required" && r.status === "fail");
    const recommendedFail = secRules.some((r) => r.severity === "recommended" && r.status === "fail");
    sectionStatus[section] = requiredFail ? "incomplete" : recommendedFail ? "warning" : "complete";
  }

  const requiredRules = rules.filter((r) => r.severity === "required");
  const requiredPassing = requiredRules.filter((r) => r.status === "pass").length;
  const requiredTotal = requiredRules.length;
  const blockersRemaining = requiredTotal - requiredPassing;

  return { rules, sectionStatus, requiredTotal, requiredPassing, blockersRemaining, canPublish: blockersRemaining === 0 };
}
