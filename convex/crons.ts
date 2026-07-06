import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Expire unclaimed seat holds and re-offer their seats to the next waitlister.
crons.interval(
  "expire waitlist claims",
  { minutes: 1 },
  internal.waitlist.sweepExpiredClaimsNow,
  {},
);

export default crons;
