import { defineApp } from "convex/server";
import resend from "@convex-dev/resend/convex.config";

// Register the Resend component so transactional email (RSVP confirmations and
// waitlist claim links) can be enqueued through it. See convex/email.ts.
const app = defineApp();
app.use(resend);
export default app;
