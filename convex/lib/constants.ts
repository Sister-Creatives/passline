// Statuses that consume a seat against event capacity.
export const SEAT_HOLDING_STATUSES = [
  "confirmed",
  "confirmed_pending_claim",
  "checked_in",
] as const;

// Window an auto-promoted attendee has to claim their freed seat.
export const CLAIM_WINDOW_MS = 30 * 60 * 1000;

// Platform booking fee, in basis points (300 = 3%).
export const FEE_BPS = 300;
