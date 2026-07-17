// @vitest-environment edge-runtime
import { convexTest as rawConvexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { escapeHtml } from "./email";

// Passed explicitly for the same pnpm module-resolution reason documented in
// schema.test.ts.
const modules = import.meta.glob("./**/*.*s");

// `rsvp` now calls the rate limiter component synchronously (before its
// dedupe/insert work -- see convex/rateLimits.ts and convex/rsvps.ts), so
// every test instance needs that component registered. Wrapping convex-test's
// constructor here means every `convexTest(schema, modules)` call below gets
// it for free, with no changes to the test bodies themselves.
function convexTest(schemaArg: typeof schema, modulesArg: typeof modules) {
  const t = rawConvexTest(schemaArg, modulesArg);
  registerRateLimiter(t);
  return t;
}

// Authenticate as an organizer by inserting a real users + session row and
// handing withIdentity the `${userId}|${sessionId}` subject Convex Auth uses
// (see auth.test.ts for the derivation). RESEND_API_KEY is intentionally unset
// here, so the scheduled email actions are clean no-ops -- these tests assert
// that the mutations SCHEDULE the right emails, not that any email is sent.
async function asOrganizer(t: TestConvex<typeof schema>, email: string) {
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, name: email });
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 1000 * 60 * 60,
    });
    return { userId, sessionId };
  });
  return { as: t.withIdentity({ subject: `${userId}|${sessionId}` }) };
}

async function seedPublishedEvent(
  t: TestConvex<typeof schema>,
  title: string,
  capacity: number,
) {
  const { as } = await asOrganizer(t, "organizer@example.com");
  await as.mutation(api.organizers.ensureOrganizer, {});
  const eventId = await as.mutation(api.events.createEvent, {
    title,
    description: "x",
    startsAt: 1,
    endsAt: 2,
    location: "x",
    capacity,
  });
  await as.mutation(api.events.publishEvent, { eventId });
  const ev = await t.run((ctx) => ctx.db.get(eventId));
  return ev!.slug;
}

function scheduled(t: TestConvex<typeof schema>) {
  return t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
}

test("confirming an RSVP schedules a confirmation email with title and token", async () => {
  const t = convexTest(schema, modules);
  const slug = await seedPublishedEvent(t, "Emailed", 1);

  const res = await t.mutation(api.rsvps.rsvp, { slug, name: "Ada", email: "ada@x.com" });
  expect(res.status).toBe("confirmed");

  const jobs = await scheduled(t);
  const confirmation = jobs.find((j) => j.name.includes("sendConfirmationEmail"));
  expect(confirmation).toBeDefined();
  const args = confirmation!.args[0] as { eventTitle: string; token: string; email: string };
  expect(args.eventTitle).toBe("Emailed");
  expect(args.token).toBe(res.token);
  expect(args.email).toBe("ada@x.com");
});

test("joining a full event schedules a waitlist email", async () => {
  const t = convexTest(schema, modules);
  const slug = await seedPublishedEvent(t, "Full House", 1);

  await t.mutation(api.rsvps.rsvp, { slug, name: "A", email: "a@x.com" });
  const b = await t.mutation(api.rsvps.rsvp, { slug, name: "B", email: "b@x.com" });
  expect(b.status).toBe("waitlisted");

  const jobs = await scheduled(t);
  expect(jobs.some((j) => j.name.includes("sendWaitlistEmail"))).toBe(true);
});

test("cancelling a seat promotes the next waitlister and schedules a claim email", async () => {
  const t = convexTest(schema, modules);
  const slug = await seedPublishedEvent(t, "Claim Me", 1);

  const a = await t.mutation(api.rsvps.rsvp, { slug, name: "A", email: "a@x.com" });
  const b = await t.mutation(api.rsvps.rsvp, { slug, name: "B", email: "b@x.com" });
  expect(a.status).toBe("confirmed");
  expect(b.status).toBe("waitlisted");

  await t.mutation(api.rsvps.cancelRsvp, { token: a.token });

  const jobs = await scheduled(t);
  const claim = jobs.find((j) => j.name.includes("sendClaimEmail"));
  expect(claim).toBeDefined();
  const args = claim!.args[0] as { email: string; eventTitle: string; claimUrl: string };
  expect(args.email).toBe("b@x.com");
  expect(args.eventTitle).toBe("Claim Me");
  expect(args.claimUrl).toContain(`/claim/${b.token}`);
});

test("escapeHtml escapes the characters that matter for HTML interpolation", () => {
  expect(escapeHtml(`<script>alert('hi & "bye"')</script>`)).toBe(
    "&lt;script&gt;alert(&#39;hi &amp; &quot;bye&quot;&#39;)&lt;/script&gt;",
  );
});

test("escapeHtml leaves plain names untouched", () => {
  expect(escapeHtml("Ada Lovelace")).toBe("Ada Lovelace");
});
