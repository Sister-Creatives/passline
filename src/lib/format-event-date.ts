/**
 * Format an event's start/end window for display on the public event page and
 * the RSVP confirmation/ticket page. Shared so both stay in sync.
 */
export function formatEventDateRange(startsAt: number, endsAt: number): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const datePart = start.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const startTime = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const endTime = end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${datePart}, ${startTime} - ${endTime}`;
}
