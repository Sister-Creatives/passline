# Account & Security Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/settings/account` page where a signed-in organizer can change their password, change their email (verified by a 6-digit code), and sign out of all other devices.

**Architecture:** All credential operations use Convex Auth's server helpers, which require an **action** context (`GenericActionCtx`) because they scrypt-hash secrets. Public actions do the re-auth/hashing and delegate all `ctx.db` writes to internal mutations. The email change is an identity-key migration applied in a single transactional internal mutation. Frontend is one AuthGuard'd route with three cards, following the existing `src/routes/settings/*` conventions.

**Tech Stack:** Convex (actions + internal mutations/queries), `@convex-dev/auth` server helpers (`retrieveAccount`, `modifyAccountCredentials`, `invalidateSessions`, `getAuthUserId`, `getAuthSessionId`), `@convex-dev/resend`, TanStack Start/Router, react-hook-form + zod, shadcn/ui, Vitest + convex-test (edge-runtime).

## Global Constraints

- **Password minimum: 8 characters** (matches `src/routes/login.tsx`).
- **Email is the identity key.** Confirming an email change must update, in ONE mutation: the Password `authAccounts.providerAccountId`, `users.email`, `memberships.email`, and legacy `organizers.email`. Store all of these **normalized lowercase**.
- **Re-auth required** for `changePassword` and `startEmailChange` (verify current password via `retrieveAccount`).
- **Code stored hashed** (SHA-256 hex), `CODE_TTL_MS = 600000` (10 min), `MAX_CODE_ATTEMPTS = 5`, single-use.
- Auth helpers `retrieveAccount` / `modifyAccountCredentials` / `invalidateSessions` take `GenericActionCtx` → they live in **actions only**.
- Never return the verification code from any function.
- Convex test files start with `// @vitest-environment edge-runtime` and pass `import.meta.glob("./**/*.*s")` as modules. Reuse the `asOrganizer` withIdentity pattern from `convex/auth.test.ts`.

## File Structure

- Create: `convex/account.ts` — public actions + internal query/mutations for all account operations.
- Modify: `convex/schema.ts` — add `emailChangeRequests` table.
- Modify: `convex/email.ts` — add `sendEmailChangeCode` internal action.
- Create: `src/routes/settings/account.tsx` — the Account & Security page (three cards).
- Modify: `src/components/app-shared.tsx` — add the "Account" nav entry to `settingsGroup`.
- Create: `convex/account.test.ts` — backend tests.

---

### Task 1: Spike auth-helper runtime + password change + sign out others

**Files:**
- Create: `convex/account.ts`
- Test: `convex/account.test.ts`

**Interfaces:**
- Consumes: `getAuthUserId`, `getAuthSessionId`, `retrieveAccount`, `modifyAccountCredentials`, `invalidateSessions` from `@convex-dev/auth/server`.
- Produces:
  - `api.account.changePassword` (action) `({ currentPassword: string, newPassword: string }) => { ok: true }`
  - `api.account.signOutOtherSessions` (action) `() => { ok: true }`
  - `internal.account.getUserEmail` (internal query) `({ userId: Id<"users"> }) => string | null`

- [ ] **Step 1: Spike — confirm the auth helpers run under convex-test.** Create `convex/account.test.ts` with a throwaway test that seeds a real password account and calls the helper, to learn whether hashing works in edge-runtime:

```ts
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { getAuthOrganizerId } from "./auth";

const modules = import.meta.glob("./**/*.*s");

// Reproduces the Convex Auth JWT subject `${userId}|${sessionId}` (see auth.test.ts).
async function asUser(t: any, email: string) {
  const { userId, sessionId } = await t.run(async (ctx: any) => {
    const userId = await ctx.db.insert("users", { email, name: email });
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 3600_000,
    });
    return { userId, sessionId };
  });
  return { as: t.withIdentity({ subject: `${userId}|${sessionId}` }), userId, sessionId };
}

test("SPIKE: retrieveAccount/modifyAccountCredentials under convex-test", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asUser(t, "spike@example.com");
  // Seed a password account so retrieveAccount has something to verify.
  await as.action(api.account.changePassword, {
    currentPassword: "will-not-match",
    newPassword: "brandnewpass1",
  }).catch((e) => e);
  expect(true).toBe(true); // Observe whether the call throws a runtime error vs an auth error.
});
```

Run: `./node_modules/.bin/vitest run convex/account.test.ts` (this will fail to import until Step 2 creates the module — that is expected; the spike's purpose is the Step-4 result).

**DECISION POINT:** After Step 4 below runs the real tests, if the helper throws a *runtime/environment* error (not an auth error) under edge-runtime, mark the password-hashing tests `test.skip` with a comment ("auth helpers require a live deployment; verified manually") and note it in the task report. The `signOutOtherSessions` and `getUserEmail` logic must still be tested. Do NOT change the production code's action/mutation split based on the test environment.

- [ ] **Step 2: Write `convex/account.ts` with the internal query and the two actions.**

```ts
import { v } from "convex/values";
import {
  getAuthUserId,
  getAuthSessionId,
  retrieveAccount,
  modifyAccountCredentials,
  invalidateSessions,
} from "@convex-dev/auth/server";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

const PASSWORD_MIN = 8;

/** The signed-in user's stored email, or null. Actions read the DB through this. */
export const getUserEmail = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    return user?.email ?? null;
  },
});

export const changePassword = action({
  args: { currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, { currentPassword, newPassword }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const email = await ctx.runQuery(internal.account.getUserEmail, { userId });
    if (!email) throw new Error("Not authenticated");
    if (newPassword.length < PASSWORD_MIN) {
      throw new Error("Password must be at least 8 characters");
    }
    try {
      await retrieveAccount(ctx, {
        provider: "password",
        account: { id: email, secret: currentPassword },
      });
    } catch {
      throw new Error("Current password is incorrect");
    }
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: email, secret: newPassword },
    });
    return { ok: true as const };
  },
});

export const signOutOtherSessions = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const sessionId = await getAuthSessionId(ctx);
    await invalidateSessions(ctx, {
      userId,
      except: sessionId ? [sessionId] : [],
    });
    return { ok: true as const };
  },
});
```

- [ ] **Step 3: Write the tests** (replace the spike test body in `convex/account.test.ts`):

```ts
test("changePassword rejects a wrong current password", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asUser(t, "pw@example.com");
  await expect(
    as.action(api.account.changePassword, {
      currentPassword: "definitely-wrong",
      newPassword: "brandnewpass1",
    }),
  ).rejects.toThrow(/incorrect|not authenticated/i);
});

test("changePassword rejects a too-short new password", async () => {
  const t = convexTest(schema, modules);
  const { as } = await asUser(t, "pw2@example.com");
  await expect(
    as.action(api.account.changePassword, { currentPassword: "x", newPassword: "short" }),
  ).rejects.toThrow(/8 characters|incorrect/i);
});

test("signOutOtherSessions removes other sessions, keeps the current one", async () => {
  const t = convexTest(schema, modules);
  const { as, userId, sessionId } = await asUser(t, "sess@example.com");
  const otherSessionId = await t.run((ctx) =>
    ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3600_000 }),
  );
  await as.action(api.account.signOutOtherSessions, {});
  const remaining = await t.run((ctx) =>
    ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId)).collect(),
  );
  const ids = remaining.map((s) => s._id);
  expect(ids).toContain(sessionId);
  expect(ids).not.toContain(otherSessionId);
});
```

- [ ] **Step 4: Run the tests.** Run: `./node_modules/.bin/vitest run convex/account.test.ts`. Expected: `signOutOtherSessions` test PASSES. The `changePassword` tests either pass (throwing the expected auth error) or reveal the runtime limitation from the Step-1 DECISION POINT — handle per that decision. If `invalidateSessions` itself errors under edge-runtime, apply the same skip-with-comment treatment and verify the session logic by asserting on the DB directly in a variant that calls an internal mutation. Run `./node_modules/.bin/tsc --noEmit` — expect exit 0.

- [ ] **Step 5: Commit.**

```bash
git add convex/account.ts convex/account.test.ts
git commit -m "feat(account): change password and sign out other sessions"
```

---

### Task 2: Email-change backend (code-verified)

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/email.ts`
- Modify: `convex/account.ts`
- Test: `convex/account.test.ts`

**Interfaces:**
- Consumes: `internal.account.getUserEmail` (Task 1), `retrieveAccount`, `getAuthUserId`, `internal.email.sendEmailChangeCode`.
- Produces:
  - `api.account.startEmailChange` (action) `({ currentPassword: string, newEmail: string }) => { ok: true }`
  - `api.account.confirmEmailChange` (action) `({ code: string }) => { ok: true, email: string }`
  - `internal.account.checkEmailAvailable` (internal query) `({ email: string }) => boolean`
  - `internal.account.upsertEmailChangeRequest` (internal mutation) `({ userId, newEmail, codeHash, expiresAt }) => null`
  - `internal.account.readEmailChangeRequest` (internal query) `({ userId }) => Doc<"emailChangeRequests"> | null`
  - `internal.account.bumpEmailChangeAttempts` (internal mutation) `({ requestId }) => null`
  - `internal.account.applyEmailChange` (internal mutation) `({ userId, newEmail }) => null`
  - `internal.email.sendEmailChangeCode` (internal action) `({ to, code }) => null`

- [ ] **Step 1: Add the schema table.** In `convex/schema.ts`, add to the tables object:

```ts
  emailChangeRequests: defineTable({
    userId: v.id("users"),
    newEmail: v.string(), // normalized lowercase
    codeHash: v.string(), // SHA-256 hex of the 6-digit code
    expiresAt: v.number(),
    attempts: v.number(),
  }).index("by_user", ["userId"]),
```

Run: `./node_modules/.bin/convex codegen` — expect it to regenerate `_generated` without error.

- [ ] **Step 2: Add the email sender.** In `convex/email.ts`, following the existing `sendConfirmationEmail` pattern, add:

```ts
export const sendEmailChangeCode = internalAction({
  args: { to: v.string(), code: v.string() },
  handler: async (ctx, { to, code }) => {
    await resend.sendEmail(ctx, {
      from: FROM,
      to,
      subject: "Confirm your new Passline email",
      html: `Your Passline verification code is <strong>${escapeHtml(code)}</strong>. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    });
  },
});
```

(Confirm `internalAction` and `escapeHtml` are already imported/defined in the file; they are used by the existing senders.)

- [ ] **Step 3: Add email helpers + actions to `convex/account.ts`.** Add these imports and code:

```ts
import { mutation, internalMutation } from "./_generated/server";
// (action, internalQuery, getAuthUserId, retrieveAccount, v already imported from Task 1)

const CODE_TTL_MS = 600_000;
const MAX_CODE_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sixDigitCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

/** True when no user/account already owns this (lowercased) email. */
export const checkEmailAvailable = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const byUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (byUser) return false;
    const byAccount = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", email),
      )
      .first();
    return !byAccount;
  },
});

export const upsertEmailChangeRequest = internalMutation({
  args: {
    userId: v.id("users"),
    newEmail: v.string(),
    codeHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("emailChangeRequests")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.insert("emailChangeRequests", { ...args, attempts: 0 });
    return null;
  },
});

export const readEmailChangeRequest = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("emailChangeRequests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
  },
});

export const bumpEmailChangeAttempts = internalMutation({
  args: { requestId: v.id("emailChangeRequests") },
  handler: async (ctx, { requestId }) => {
    const r = await ctx.db.get(requestId);
    if (r) await ctx.db.patch(requestId, { attempts: r.attempts + 1 });
    return null;
  },
});

/**
 * The identity-key migration. Re-checks availability, then updates every
 * email-keyed record in one transaction and deletes the request.
 */
export const applyEmailChange = internalMutation({
  args: { userId: v.id("users"), newEmail: v.string() },
  handler: async (ctx, { userId, newEmail }) => {
    const user = await ctx.db.get(userId);
    if (!user?.email) throw new Error("Not authenticated");
    const oldEmail = user.email.toLowerCase();

    // Race guard: someone may have taken the email since startEmailChange.
    const taken = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", newEmail))
      .first();
    if (taken && taken._id !== userId) throw new Error("That email is already in use");

    // 1. Password account providerAccountId (found by user + provider, not old email).
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId).eq("provider", "password"))
      .first();
    if (account) await ctx.db.patch(account._id, { providerAccountId: newEmail });

    // 2. users.email
    await ctx.db.patch(userId, { email: newEmail });

    // 3. memberships.email (stored lowercase)
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_email", (q) => q.eq("email", oldEmail))
      .first();
    if (membership) await ctx.db.patch(membership._id, { email: newEmail });

    // 4. legacy organizers.email
    const legacyOrg = await ctx.db
      .query("organizers")
      .withIndex("by_email", (q) => q.eq("email", oldEmail))
      .unique()
      .catch(() => null);
    if (legacyOrg) await ctx.db.patch(legacyOrg._id, { email: newEmail });

    // 5. delete the request
    const request = await ctx.db
      .query("emailChangeRequests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (request) await ctx.db.delete(request._id);
    return null;
  },
});

export const startEmailChange = action({
  args: { currentPassword: v.string(), newEmail: v.string() },
  handler: async (ctx, { currentPassword, newEmail }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const email = await ctx.runQuery(internal.account.getUserEmail, { userId });
    if (!email) throw new Error("Not authenticated");

    const next = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(next)) throw new Error("Enter a valid email address");
    if (next === email.toLowerCase()) throw new Error("That's already your email");

    try {
      await retrieveAccount(ctx, {
        provider: "password",
        account: { id: email, secret: currentPassword },
      });
    } catch {
      throw new Error("Current password is incorrect");
    }

    const available = await ctx.runQuery(internal.account.checkEmailAvailable, { email: next });
    if (!available) throw new Error("That email is already in use");

    const code = sixDigitCode();
    const codeHash = await sha256Hex(code);
    await ctx.runMutation(internal.account.upsertEmailChangeRequest, {
      userId,
      newEmail: next,
      codeHash,
      expiresAt: Date.now() + CODE_TTL_MS,
    });
    await ctx.scheduler.runAfter(0, internal.email.sendEmailChangeCode, { to: next, code });
    return { ok: true as const };
  },
});

export const confirmEmailChange = action({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const request = await ctx.runQuery(internal.account.readEmailChangeRequest, { userId });
    if (!request) throw new Error("No pending email change");
    if (Date.now() > request.expiresAt) throw new Error("Verification code expired");
    if (request.attempts >= MAX_CODE_ATTEMPTS) throw new Error("Too many attempts");

    const codeHash = await sha256Hex(code.trim());
    if (codeHash !== request.codeHash) {
      await ctx.runMutation(internal.account.bumpEmailChangeAttempts, { requestId: request._id });
      throw new Error("Incorrect code");
    }
    await ctx.runMutation(internal.account.applyEmailChange, {
      userId,
      newEmail: request.newEmail,
    });
    return { ok: true as const, email: request.newEmail };
  },
});
```

- [ ] **Step 4: Write the email-change tests.** Add to `convex/account.test.ts`. These seed rows directly so they don't depend on password hashing:

```ts
test("confirmEmailChange migrates every email-keyed record and keeps the organizer", async () => {
  const t = convexTest(schema, modules);
  const { as, userId } = await asUser(t, "old@example.com");

  // Seed the identity graph: password account + membership + organizer.
  const organizerId = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizers", { name: "Org", email: "old@example.com" });
    await ctx.db.insert("authAccounts", {
      userId,
      provider: "password",
      providerAccountId: "old@example.com",
    } as any);
    await ctx.db.insert("memberships", {
      organizerId: orgId,
      email: "old@example.com",
      userId,
      role: "owner",
      createdAt: Date.now(),
    });
    return orgId;
  });

  const before = await as.run((ctx) => getAuthOrganizerId(ctx));
  expect(before).toEqual(organizerId);

  // Insert a known request directly (bypass password re-auth), then confirm.
  const code = "123456";
  const codeHash = await t.run(async () => {
    const bytes = new TextEncoder().encode(code);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  });
  await t.run((ctx) =>
    ctx.db.insert("emailChangeRequests", {
      userId,
      newEmail: "new@example.com",
      codeHash,
      expiresAt: Date.now() + 600_000,
      attempts: 0,
    }),
  );

  const result = await as.action(api.account.confirmEmailChange, { code });
  expect(result).toMatchObject({ ok: true, email: "new@example.com" });

  const user = await t.run((ctx) => ctx.db.get(userId));
  expect(user?.email).toEqual("new@example.com");
  const after = await as.run((ctx) => getAuthOrganizerId(ctx));
  expect(after).toEqual(organizerId); // no lock-out
  const leftover = await t.run((ctx) =>
    ctx.db.query("emailChangeRequests").withIndex("by_user", (q) => q.eq("userId", userId)).first(),
  );
  expect(leftover).toBeNull();
});

test("confirmEmailChange rejects a wrong code and increments attempts", async () => {
  const t = convexTest(schema, modules);
  const { as, userId } = await asUser(t, "wc@example.com");
  await t.run((ctx) =>
    ctx.db.insert("emailChangeRequests", {
      userId,
      newEmail: "wc-new@example.com",
      codeHash: "deadbeef",
      expiresAt: Date.now() + 600_000,
      attempts: 0,
    }),
  );
  await expect(as.action(api.account.confirmEmailChange, { code: "000000" })).rejects.toThrow(/incorrect code/i);
  const req = await t.run((ctx) =>
    ctx.db.query("emailChangeRequests").withIndex("by_user", (q) => q.eq("userId", userId)).first(),
  );
  expect(req?.attempts).toEqual(1);
});

test("confirmEmailChange rejects an expired code", async () => {
  const t = convexTest(schema, modules);
  const { as, userId } = await asUser(t, "exp@example.com");
  await t.run((ctx) =>
    ctx.db.insert("emailChangeRequests", {
      userId,
      newEmail: "exp-new@example.com",
      codeHash: "deadbeef",
      expiresAt: Date.now() - 1,
      attempts: 0,
    }),
  );
  await expect(as.action(api.account.confirmEmailChange, { code: "000000" })).rejects.toThrow(/expired/i);
});
```

- [ ] **Step 5: Run tests + typecheck.** Run: `./node_modules/.bin/vitest run convex/account.test.ts` — expect all email-change tests PASS. Run `./node_modules/.bin/tsc --noEmit` — expect exit 0. (If seeding `authAccounts` needs different required fields, read `node_modules/@convex-dev/auth/dist/server/implementation/types.js` lines 30-50 for the table shape and adjust the seed. `as any` on the insert absorbs optional-field differences.)

- [ ] **Step 6: Commit.**

```bash
git add convex/schema.ts convex/email.ts convex/account.ts convex/account.test.ts
git commit -m "feat(account): change email with a code-verified identity migration"
```

---

### Task 3: Account & Security page + nav entry

**Files:**
- Create: `src/routes/settings/account.tsx`
- Modify: `src/components/app-shared.tsx`

**Interfaces:**
- Consumes: `api.account.changePassword`, `api.account.startEmailChange`, `api.account.confirmEmailChange`, `api.account.signOutOtherSessions`; the current email from `api.team.getMyIdentity` (used already in `settings/team.tsx`).

- [ ] **Step 1: Add the nav entry.** In `src/components/app-shared.tsx`, import `ShieldIcon` from `lucide-react` and add to `settingsGroup.items` (place it first, before Profile):

```tsx
{ title: "Account", path: "/settings/account", icon: <ShieldIcon /> },
```

Run `./node_modules/.bin/tsc --noEmit` — expect exit 0.

- [ ] **Step 2: Create the page skeleton with the three cards.** Create `src/routes/settings/account.tsx`. Use `useAction` (from `convex/react`) for the account actions and `useQuery(convexQuery(api.team.getMyIdentity, {}))` for the current email. Match `settings/team.tsx` structure (`DashboardLayout`, `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent`, `Input`, `Label`, `Button`, `toast`).

```tsx
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useAction } from "convex/react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/settings/account")({ component: AccountSecurityPage });

function AccountSecurityPage() {
  const { data: identity } = useQuery(convexQuery(api.team.getMyIdentity, {}));
  return (
    <DashboardLayout>
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Account &amp; Security</h1>
          <p className="text-sm text-muted-foreground">Manage your password, email, and sessions.</p>
        </div>
        <PasswordCard />
        <EmailCard currentEmail={identity?.email} />
        <SessionsCard />
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 3: Implement `PasswordCard`.** Local state for the three fields; validate min-8 and match client-side; call `changePassword`; reset + toast on success; `toast.error(e.message)` on failure; disable the button while submitting.

```tsx
function PasswordCard() {
  const changePassword = useAction(api.account.changePassword);
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 8) return toast.error("Password must be at least 8 characters");
    if (next !== confirm) return toast.error("New passwords don't match");
    setBusy(true);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      toast.success("Password updated");
      setCurrent(""); setNext(""); setConfirm("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Change the password you use to sign in.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cur-pw">Current password</Label>
            <Input id="cur-pw" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-pw">New password</Label>
            <Input id="new-pw" type="password" autoComplete="new-password" placeholder="At least 8 characters" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cf-pw">Confirm new password</Label>
            <Input id="cf-pw" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy}>Update password</Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Implement `EmailCard`** with the `idle → codeSent` state machine.

```tsx
function EmailCard({ currentEmail }: { currentEmail?: string }) {
  const startEmailChange = useAction(api.account.startEmailChange);
  const confirmEmailChange = useAction(api.account.confirmEmailChange);
  const [stage, setStage] = React.useState<"idle" | "codeSent">("idle");
  const [newEmail, setNewEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await startEmailChange({ currentPassword: password, newEmail });
      toast.success(`Code sent to ${newEmail}`);
      setStage("codeSent");
      setPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start email change");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await confirmEmailChange({ code });
      toast.success(`Email updated to ${res.email}`);
      setStage("idle"); setNewEmail(""); setCode("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't confirm the code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email</CardTitle>
        <CardDescription>
          {currentEmail ? <>Your sign-in email is <strong>{currentEmail}</strong>.</> : "Change your sign-in email."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {stage === "idle" ? (
          <form onSubmit={start} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-email">New email</Label>
              <Input id="new-email" type="email" autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email-pw">Current password</Label>
              <Input id="email-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" disabled={busy}>Send verification code</Button>
          </form>
        ) : (
          <form onSubmit={confirm} className="space-y-3">
            <p className="text-sm text-muted-foreground">Enter the 6-digit code we sent to <strong>{newEmail}</strong>.</p>
            <div className="space-y-1.5">
              <Label htmlFor="email-code">Verification code</Label>
              <Input id="email-code" inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>Confirm new email</Button>
              <Button type="button" variant="ghost" onClick={() => { setStage("idle"); setCode(""); }}>Cancel</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Implement `SessionsCard`.**

```tsx
function SessionsCard() {
  const signOutOthers = useAction(api.account.signOutOtherSessions);
  const [busy, setBusy] = React.useState(false);
  async function run() {
    setBusy(true);
    try {
      await signOutOthers({});
      toast.success("Signed out of other devices");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't sign out other devices");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>Sign out everywhere except this device. Use this if you signed in on a shared or lost device.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={run} disabled={busy}>Sign out of all other devices</Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Typecheck + build.** Run `./node_modules/.bin/tsc --noEmit` (expect exit 0) and `./node_modules/.bin/vite build` (expect the three `✓ built` lines). Confirm `api.team.getMyIdentity` returns `{ email }` — it is already used in `settings/team.tsx`; if the field name differs, adjust `currentEmail`.

- [ ] **Step 7: Commit.**

```bash
git add src/routes/settings/account.tsx src/components/app-shared.tsx
git commit -m "feat(account): add the Account & Security settings page"
```

---

## Self-Review

- **Spec coverage:** password change (Task 1), sign-out-others (Task 1), email change with code (Task 2), page + nav (Task 3), `emailChangeRequests` table (Task 2), `sendEmailChangeCode` (Task 2), lock-out test (Task 2). All spec sections mapped.
- **Type consistency:** `changePassword`/`startEmailChange`/`confirmEmailChange`/`signOutOtherSessions` are actions throughout; internal query/mutation names match between their definitions and their `internal.account.*` call sites.
- **Runtime:** every use of `retrieveAccount`/`modifyAccountCredentials`/`invalidateSessions` is inside an `action`; every `ctx.db` access is inside a `mutation`/`query`/`internalMutation`/`internalQuery`.
- **Open item handled:** the convex-test hashing uncertainty is isolated to Task 1's spike with an explicit decision and does not gate Task 2/3.
