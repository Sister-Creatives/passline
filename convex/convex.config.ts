import { defineApp } from "convex/server";
import resend from "@convex-dev/resend/convex.config";
import migrations from "@convex-dev/migrations/convex.config";

// Register the Resend component so transactional email (RSVP confirmations and
// waitlist claim links) can be enqueued through it. See convex/email.ts.
// Register the migrations component for one-off backfills (see convex/migrations.ts).
const app = defineApp();
app.use(resend);
app.use(migrations);
export default app;
