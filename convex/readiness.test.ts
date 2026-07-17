// @vitest-environment edge-runtime
import { expect, test } from "vitest";
import { computeReadiness } from "./lib/readiness";
import type { Id } from "./_generated/dataModel";

const TT1 = "tt1" as Id<"ticketTypes">;

// Minimal structural fixtures — computeReadiness reads only these fields.
function baseEvent(over: Partial<{ title: string; description: string; location: string; startsAt: number; endsAt: number }> = {}) {
  return { title: "Party", description: "Fun", location: "Hall", startsAt: 10, endsAt: 20, ...over };
}
function tt(over: Partial<{ _id: Id<"ticketTypes">; status: "active" | "archived"; visibility: "visible" | "hidden"; capacity: number | undefined }> = {}) {
  return { _id: TT1, status: "active" as const, visibility: "visible" as const, capacity: undefined, ...over };
}
const NOW = 15; // between startsAt(10) and endsAt(20) so `date` (endsAt > now) passes by default

test("an event with no ticket types publishes as free RSVP", () => {
  const r = computeReadiness({ event: baseEvent(), ticketTypes: [], seats: [], accessCodes: [], eventContent: null, now: NOW });
  expect(r.canPublish).toBe(true);
  expect(r.blockersRemaining).toBe(0);
  expect(r.sectionStatus.tickets).toBe("complete");
  expect(r.sectionStatus.details).toBe("complete");
});

test("a hidden ticket type with no access code blocks publish", () => {
  const r = computeReadiness({ event: baseEvent(), ticketTypes: [tt({ visibility: "hidden" })], seats: [], accessCodes: [], eventContent: null, now: NOW });
  expect(r.canPublish).toBe(false);
  expect(r.sectionStatus.tickets).toBe("incomplete");
  expect(r.rules.find((x) => x.id === "tickets")?.status).toBe("fail");
});

test("an active access code unlocks a hidden type", () => {
  const r = computeReadiness({ event: baseEvent(), ticketTypes: [tt({ visibility: "hidden" })], seats: [], accessCodes: [{ active: true }], eventContent: null, now: NOW });
  expect(r.canPublish).toBe(true);
  expect(r.sectionStatus.tickets).toBe("complete");
});

test("a visible active type publishes; an archived-only set blocks", () => {
  expect(computeReadiness({ event: baseEvent(), ticketTypes: [tt()], seats: [], accessCodes: [], eventContent: null, now: NOW }).canPublish).toBe(true);
  const archived = computeReadiness({ event: baseEvent(), ticketTypes: [tt({ status: "archived" })], seats: [], accessCodes: [], eventContent: null, now: NOW });
  expect(archived.canPublish).toBe(false);
});

test("a past end date is a warning, not a blocker", () => {
  const r = computeReadiness({ event: baseEvent(), ticketTypes: [tt()], seats: [], accessCodes: [], eventContent: null, now: 999 });
  expect(r.canPublish).toBe(true);
  expect(r.sectionStatus.details).toBe("warning");
  expect(r.rules.find((x) => x.id === "date")?.status).toBe("fail");
});

test("seating: a seated type with fewer seats than its capacity blocks; enough passes", () => {
  const seats4 = [TT1, TT1, TT1, TT1].map((ticketTypeId) => ({ ticketTypeId }));
  const under = computeReadiness({ event: baseEvent(), ticketTypes: [tt({ capacity: 10 })], seats: seats4, accessCodes: [], eventContent: null, now: NOW });
  expect(under.canPublish).toBe(false);
  expect(under.sectionStatus.seating).toBe("incomplete");
  const ok = computeReadiness({ event: baseEvent(), ticketTypes: [tt({ capacity: 4 })], seats: seats4, accessCodes: [], eventContent: null, now: NOW });
  expect(ok.canPublish).toBe(true);
  expect(ok.sectionStatus.seating).toBe("complete");
});

test("the seating rule is absent when the event has no seats", () => {
  const r = computeReadiness({ event: baseEvent(), ticketTypes: [tt()], seats: [], accessCodes: [], eventContent: null, now: NOW });
  expect(r.sectionStatus.seating).toBeUndefined();
  expect(r.rules.some((x) => x.id === "seating")).toBe(false);
});

test("cover/page are warnings on the page section and never block", () => {
  const bare = computeReadiness({ event: baseEvent(), ticketTypes: [tt()], seats: [], accessCodes: [], eventContent: null, now: NOW });
  expect(bare.canPublish).toBe(true);
  expect(bare.sectionStatus.page).toBe("warning");
  const rich = computeReadiness({
    event: baseEvent(), ticketTypes: [tt()], seats: [], accessCodes: [], now: NOW,
    eventContent: { coverImageUrl: "https://x/y.jpg", agenda: [], speakers: [], faqs: [{ question: "q", answer: "a" }] },
  });
  expect(rich.sectionStatus.page).toBe("complete");
});

test("details is incomplete when a required field is blank", () => {
  const r = computeReadiness({ event: baseEvent({ title: "  " }), ticketTypes: [tt()], seats: [], accessCodes: [], eventContent: null, now: NOW });
  expect(r.canPublish).toBe(false);
  expect(r.sectionStatus.details).toBe("incomplete");
});
