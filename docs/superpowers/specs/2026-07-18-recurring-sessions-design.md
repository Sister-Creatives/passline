# Passline → Recurring session dates

- **Date:** 2026-07-18
- **Status:** Approved design
- **Slice:** Add a "generate recurring dates" flow to the existing event **sessions**
  feature, so an organizer defines a weekly pattern once instead of adding each date by
  hand.

## 1. Goal

Events already support multiple **sessions** (`eventSessions`: dated slots with their own
capacity; `SessionsPanel` UI; `eventSessions.create`). Adding "every Wed & Sat this month"
today means creating each slot manually. This adds a recurrence generator that creates them
all at once, with a preview.

## 2. Scope (agreed)

**In:** weekly-on-chosen-weekdays until a date. Pick weekdays + a date range + a start &
end time + capacity (+ optional label); preview the exact dates; create them all in one
mutation.

**Out:** intervals ("every other week"), monthly, end-after-N-occurrences, editing a series
as a unit (each generated session is just a normal session afterwards), timezones beyond the
organizer's local browser time.

## 3. Date generation — `src/lib/recurrence.ts` (pure, client-side, tested)

Client-side so each slot's epoch ms is computed in the organizer's **local** timezone,
exactly like the manual form (which builds `Date` from a local `datetime`). Signature:

```ts
export interface RecurrenceSpec {
  weekdays: number[]; // 0=Sun .. 6=Sat, non-empty
  fromDate: string;   // "YYYY-MM-DD"
  untilDate: string;  // "YYYY-MM-DD", inclusive
  startTime: string;  // "HH:MM"
  endTime: string;    // "HH:MM"
}
export function generateRecurringDates(spec: RecurrenceSpec): { startsAt: number; endsAt: number }[];
```

Behavior: walk each calendar day from `fromDate` to `untilDate` inclusive; for each day whose
`getDay()` is in `weekdays`, emit `{ startsAt: local(y,mo,d, startHH,startMM), endsAt:
local(y,mo,d, endHH,endMM) }` (both via `new Date(y, mo, d, hh, mm).getTime()`). Ascending
order (natural). Returns `[]` for empty weekdays or `untilDate < fromDate`. Hard cap at 366
entries defensively.

## 4. Backend — `convex/eventSessions.ts` `createRecurring`

```ts
createRecurring({
  eventId: v.id("events"),
  sessions: v.array(v.object({ startsAt: v.number(), endsAt: v.number() })),
  capacity: v.number(),
  label: v.optional(v.string()),
}) // → { created: number }
```

Owner-only (`requireOwnedEvent`). Reject an empty array (`"Add at least one date"`) and more
than **100** sessions per call (`"Too many dates at once (max 100)"`) so one call can't
balloon a transaction. Validate `capacity` once (`validateSessionCapacity`) and each
window (`validateSessionWindow`, i.e. `endsAt > startsAt`). Insert all in the single
(transactional) mutation, continuing `sortOrder` from the current max like `create` does,
one increment per inserted row. Return `{ created }`. Convex runs the mutation atomically,
so a bad row rejects the whole batch — no half-created series.

## 5. Frontend — `SessionsPanel.tsx`

A second dialog beside "Add session", triggered by a **"Repeat…"** button: 
- **Weekday chips** — Su Mo Tu We Th Fr Sa toggles (at least one required).
- **From / Until** dates — the shadcn `Popover` + `Calendar` date picker (same primitives
  `DateTimePicker` uses).
- **Start / End time** — `Input type="time"`.
- **Capacity** — number; **Label** — optional.
- **Live preview** — "Creates N sessions" and the first several dates, recomputed from
  `generateRecurringDates` as the fields change. Disabled/error when N is 0 or > 100, or
  end time ≤ start time.
- Submit → `createRecurring({ eventId, sessions: generateRecurringDates(spec), capacity, label })`
  → toast `Created N sessions` → close; the list refetches reactively.

## 6. Testing

- `src/lib/recurrence.test.ts`: every-Wed-&-Sat over a month yields the right count and the
  right weekdays; the time-of-day is applied; empty weekdays and reversed range yield `[]`;
  a single day in range yields one; ascending order.
- `convex/eventSessions.test.ts`: `createRecurring` inserts N sessions with continued
  `sortOrder`; empty array throws; > 100 throws; a window with `endsAt <= startsAt` throws
  and creates none (atomic); non-owner throws.

## 7. Risks

- **Timezone.** Generating client-side keeps slots in the organizer's local time, matching
  the manual form. If the browser's timezone differs from the venue's, both flows are equally
  affected — not a regression, and out of scope here.
- **Atomicity.** All-or-nothing is deliberate: a partially created series is worse than a
  clear rejection. The 100 cap keeps the transaction bounded.
