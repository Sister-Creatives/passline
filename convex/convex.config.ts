import { defineApp } from "convex/server";
import resend from "@convex-dev/resend/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

// Register the Resend component so transactional email (RSVP confirmations and
// waitlist claim links) can be enqueued through it. See convex/email.ts.
const app = defineApp();
app.use(resend);
// Register the rate limiter component, used to defend-in-depth against a bot
// hammering the public `rsvp` mutation. See convex/rateLimits.ts.
app.use(rateLimiter);
export default app;
