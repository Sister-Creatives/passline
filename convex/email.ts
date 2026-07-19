import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { Resend } from "@convex-dev/resend";
import { components } from "./_generated/api";

// Resend component client. The API key is read from RESEND_API_KEY at send time
// (see the guard in each handler below), so constructing this at module load is
// safe even when the key is absent.
export const resend = new Resend(components.resend, {});

// Sender identity. Requires a domain verified in Resend before live sends work;
// until then the RESEND_API_KEY guard keeps these handlers a clean no-op.
const FROM = "Passline <events@passline.app>";

// Escapes the characters that matter for safe interpolation into HTML markup.
// Applied to attendee-supplied fields (e.g. `name`) before they go into an
// email's `html` body -- defense-in-depth, since an attendee's own name is
// today only ever emailed back to that same attendee. Never applied to
// `eventTitle`, which is organizer-authored and may intentionally contain
// inline tags (<i>, <em>, <br>, <strong>).
export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Live email delivery is a deferred runtime concern: RESEND_API_KEY, APP_URL,
// and a verified sender domain are only needed to actually send. When the key is
// absent (codegen, typecheck, tests, previews) the scheduled action runs as a
// no-op instead of throwing, so the killer-feature mutations that schedule these
// emails stay unaffected.
function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Confirmation email for an attendee who got a seat. Scheduled from the `rsvp`
 * mutation on the confirmed branch.
 */
export const sendConfirmationEmail = internalAction({
  args: {
    email: v.string(),
    name: v.string(),
    eventTitle: v.string(),
    token: v.string(),
  },
  handler: async (ctx, { email, name, eventTitle, token }) => {
    if (!emailConfigured()) return;
    const url = `${process.env.APP_URL}/rsvp/${token}`;
    await resend.sendEmail(ctx, {
      from: FROM,
      to: email,
      subject: `You are confirmed for ${eventTitle}`,
      html: `<p>Hi ${escapeHtml(name)}, you are confirmed for ${eventTitle}. Manage your RSVP here: <a href="${url}">${url}</a></p>`,
    });
  },
});

/**
 * Waitlist notice for an attendee who joined a full event. Scheduled from the
 * `rsvp` mutation on the waitlisted branch.
 */
export const sendWaitlistEmail = internalAction({
  args: {
    email: v.string(),
    name: v.string(),
    eventTitle: v.string(),
    waitlistPosition: v.number(),
  },
  handler: async (ctx, { email, name, eventTitle, waitlistPosition }) => {
    if (!emailConfigured()) return;
    await resend.sendEmail(ctx, {
      from: FROM,
      to: email,
      subject: `You are on the waitlist for ${eventTitle}`,
      html: `<p>Hi ${escapeHtml(name)}, ${eventTitle} is currently full. You are number ${waitlistPosition} on the waitlist; we will email you a claim link if a spot opens.</p>`,
    });
  },
});

/**
 * Verification code for an in-progress email change. Scheduled from
 * `startEmailChange` in convex/account.ts.
 */
export const sendEmailChangeCode = internalAction({
  args: { to: v.string(), code: v.string() },
  handler: async (ctx, { to, code }) => {
    if (!emailConfigured()) return;
    await resend.sendEmail(ctx, {
      from: FROM,
      to,
      subject: "Confirm your new Passline email",
      html: `Your Passline verification code is <strong>${escapeHtml(code)}</strong>. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    });
  },
});

/**
 * Claim-link email for an attendee promoted off the waitlist. Scheduled from
 * `promoteNext` in convex/waitlist.ts; the link is time-limited by the claim
 * window enforced in claimSpot / the sweep.
 */
export const sendClaimEmail = internalAction({
  args: {
    email: v.string(),
    name: v.string(),
    eventTitle: v.string(),
    claimUrl: v.string(),
  },
  handler: async (ctx, { email, name, eventTitle, claimUrl }) => {
    if (!emailConfigured()) return;
    await resend.sendEmail(ctx, {
      from: FROM,
      to: email,
      subject: `A spot opened for ${eventTitle} - claim it`,
      html: `<p>Hi ${escapeHtml(name)}, a spot just opened for ${eventTitle}. Claim it before the window closes: <a href="${claimUrl}">${claimUrl}</a></p>`,
    });
  },
});
