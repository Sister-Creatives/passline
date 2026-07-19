import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

/**
 * Defense-in-depth rate limiting for public, unauthenticated mutations.
 *
 * `rsvp` is keyed by the attendee's email (see convex/rsvps.ts) rather than by
 * IP, since IP is not available inside a Convex mutation -- edge/DDoS
 * protection at the hosting layer is a separate concern, not solved here.
 *
 * Token bucket (not fixed window) so a burst of legitimate repeat requests
 * from one email -- e.g. the dedupe path in `rsvp`, which returns the
 * existing ticket on a repeat submission -- isn't punished as harshly as a
 * sustained flood, and so tests can exhaust/observe the limit deterministically
 * without waiting for a fixed window to roll over. Capacity of 5 is
 * comfortably above the 1-2 repeat calls any legitimate dedupe/idempotency
 * flow makes in the test suite, while a bot hammering the same email is cut
 * off after 5 attempts and refills slowly (3/minute) after that.
 */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  rsvp: { kind: "token bucket", rate: 3, period: MINUTE, capacity: 5 },
  emailChange: { kind: "token bucket", rate: 3, period: MINUTE, capacity: 5 },
});
