# Passline → Account & Security settings

- **Date:** 2026-07-19
- **Status:** Approved design
- **Slice:** A `/settings/account` ("Account & Security") page where a signed-in organizer can
  change their password, change their email (verified by a 6-digit code), and sign out of
  all other devices. Two-factor auth is explicitly **out of scope** for this spec (a later phase).

## 1. Goal

Give organizers self-service control over their account credentials and sessions, built on the
existing Convex Auth **Password** provider. No new auth provider, no OAuth.

## 2. Scope

**In:**
- Change password (re-auth with current password).
- Change email, verified with a 6-digit code sent to the **new** address.
- "Sign out of all other devices."
- A new settings page + nav entry.

**Out (future phases):**
- TOTP / two-factor auth (requires reworking the sign-in flow — its own spec).
- A per-device active-session list (Convex Auth stores no device/IP metadata, so there is
  nothing to list; we offer a single revoke-others action instead).
- Account deletion.

## 3. Security invariants

- Every sensitive change (**password change**, **start email change**) requires re-authenticating
  with the **current password**, verified server-side via Convex Auth's `retrieveAccount`.
- The email-change code is stored **hashed** (never plaintext), with a short TTL and a capped
  number of verification attempts.
- The new email must not already be in use by any account.
- Email is the identity key (`users.email` → `memberships.email` → organizer, plus the Password
  account's `providerAccountId` and the legacy `organizers.email`). Confirming an email change
  updates **all** of these in **one transactional mutation**, so the user can never end up in a
  half-migrated state that locks them out.
- Changing password or email does **not** invalidate the current session (sessions are keyed on
  `userId`, not email). Revoking other devices is a separate, explicit action.

## 4. Data model (additive, no migration)

New table in `convex/schema.ts`:

```ts
emailChangeRequests: defineTable({
  userId: v.id("users"),
  newEmail: v.string(),      // normalized lowercase
  codeHash: v.string(),      // SHA-256 hex of the 6-digit code
  expiresAt: v.number(),     // epoch ms
  attempts: v.number(),      // failed confirmations, capped
}).index("by_user", ["userId"]),
```

At most one live request per user: `startEmailChange` deletes any existing row for the user
before inserting the new one.

Constants: `CODE_TTL_MS = 10 * 60 * 1000`, `MAX_CODE_ATTEMPTS = 5`.

## 5. Server — `convex/account.ts` (new)

All functions resolve the caller via `getAuthUserId(ctx)`; unauthenticated → throw `"Not authenticated"`.

### Runtime note (resolve in Task 1)
`retrieveAccount` / `modifyAccountCredentials` hash secrets (scrypt). Task 1 confirms whether they
run in a Convex **mutation** or must live in an **action**. If an action is required, the
password-verifying entry points become actions that call internal mutations for DB writes; the
function *contracts below are unchanged*, only their `mutation`/`action` wrapper differs.
Time (`expiresAt`) and randomness (code, code compare) are computed where `Date.now()` and
`crypto.getRandomValues` are available (action, or a mutation arg following the codebase's existing
`now: v.number()` convention — Task decides based on the runtime split).

### `changePassword({ currentPassword, newPassword })`
- Load user; `email = user.email` (throw if missing).
- `retrieveAccount(ctx, { provider: "password", account: { id: email, secret: currentPassword } })`
  — throws on mismatch; map to `"Current password is incorrect"`.
- Reject `newPassword` shorter than 8 chars (`"Password must be at least 8 characters"`).
- `modifyAccountCredentials(ctx, { provider: "password", account: { id: email, secret: newPassword } })`.
- Return `{ ok: true }`.

### `startEmailChange({ currentPassword, newEmail })`
- Re-auth: `retrieveAccount(...)` with `currentPassword` (→ `"Current password is incorrect"`).
- Normalize `newEmail` to lowercase; validate format (basic email regex); reject if equal to
  current email (`"That's already your email"`).
- Reject if already in use: any `users` row with that email, any `authAccounts` with
  `providerAccountId === newEmail` for provider `password`, or any `memberships` by that email
  belonging to a different user → `"That email is already in use"`.
- Generate a 6-digit code (`crypto.getRandomValues`), compute `codeHash` (SHA-256 hex),
  `expiresAt = now + CODE_TTL_MS`, `attempts = 0`. Delete any existing request for the user; insert.
- Schedule `internal.email.sendEmailChangeCode({ to: newEmail, code })`.
- Return `{ ok: true }` (never return the code).

### `confirmEmailChange({ code })`
- Load the user's request (`by_user`); throw `"No pending email change"` if none.
- If `now > expiresAt`: delete request, throw `"Verification code expired"`.
- If `attempts >= MAX_CODE_ATTEMPTS`: delete request, throw `"Too many attempts"`.
- Compare SHA-256 of `code` to `codeHash`. Mismatch → increment `attempts`, throw `"Incorrect code"`.
- On match, in this single mutation:
  1. Update the Password `authAccounts` row (`providerAccountId` old→new).
  2. `users.email` old→new.
  3. `memberships` row matched by old email → set `email = newEmail`.
  4. Legacy: any `organizers` row with the old email → set `email = newEmail`.
  5. Delete the request.
- Return `{ ok: true, email: newEmail }`.

### `signOutOtherSessions()`
- `userId = getAuthUserId`; `sessionId = getAuthSessionId(ctx)`.
- `invalidateSessions(ctx, { userId, except: [sessionId] })`.
- Return `{ ok: true }`.

## 6. Server — `convex/email.ts` (extend)

Add `sendEmailChangeCode` as an `internalAction` mirroring the existing senders (same `FROM`,
`resend.sendEmail`):

```ts
export const sendEmailChangeCode = internalAction({
  args: { to: v.string(), code: v.string() },
  handler: async (ctx, { to, code }) => {
    await resend.sendEmail(ctx, {
      from: FROM,
      to,
      subject: "Confirm your new Passline email",
      html: `Your verification code is <strong>${escapeHtml(code)}</strong>. It expires in 10 minutes.`,
    });
  },
});
```

## 7. Client — `src/routes/settings/account.tsx` (new)

AuthGuard'd like the other settings routes. Uses `useMutation`/`useAction` (per the runtime split)
and `toast`. Three `Card`s:

- **Password** — react-hook-form + zod: `currentPassword`, `newPassword` (min 8), `confirmPassword`
  (must match). Submit → `changePassword`; on success reset the form and toast "Password updated".
- **Email** — shows current email. "Change email" reveals `newEmail` + `currentPassword` → `startEmailChange`.
  On success, switch to a 6-digit code entry (`InputOTP` if present, else a plain input) → `confirmEmailChange`.
  State machine: `idle → codeSent → done`. Toasts: "Code sent to <newEmail>", "Email updated".
  A "Resend code" / "Cancel" affordance in the `codeSent` state.
- **Sessions** — one line of copy + "Sign out of all other devices" button → `signOutOtherSessions`,
  toast "Signed out of other devices".

Each mutation error surfaces via `toast.error(error.message)`.

## 8. Navigation — `src/components/app-shared.tsx`

Add to `settingsGroup.items`: `{ title: "Account", path: "/settings/account", icon: <ShieldIcon /> }`
(import `ShieldIcon` from lucide). This surfaces in the sidebar settings submenu and the command
palette automatically.

## 9. Testing

Convex tests (`convex/account.test.ts`, edge-runtime, reuse the `asOrganizer` `withIdentity` helper
from `auth.test.ts`):

- **Password:** wrong current password → error; correct → `retrieveAccount` succeeds with the new
  password afterward. (If the auth helpers can't hash under edge-runtime `convexTest`, Task 1 marks
  these as node-runtime tests or documents the limitation — the migration logic below stays testable
  regardless.)
- **startEmailChange:** wrong password → error; new email already used → error; success creates a
  request row and schedules the send.
- **confirmEmailChange:** wrong code increments `attempts` and errors; expired → error; success
  updates `users.email`, the `authAccounts.providerAccountId`, and `memberships.email`, deletes the
  request, and — the key assertion — **`getAuthOrganizerId` resolves the same organizer id before
  and after** the change (proves no lock-out). Seed `authAccounts`/`memberships` rows directly so
  this test doesn't depend on password hashing.
- **signOutOtherSessions:** with two `authSessions` for the user, the non-current one is removed and
  the current one remains.

Frontend: a light render/interaction test is optional; the security-critical logic is server-side.

## 10. Risks

- **Identity-key migration (email change).** Mitigated by doing all four updates in one transactional
  mutation and by the before/after `getAuthOrganizerId` test.
- **Auth-helper runtime.** `retrieveAccount`/`modifyAccountCredentials` may force an action split;
  isolated to Task 1, contracts unchanged.
- **Leaked/guessed code.** Mitigated by hashing, 10-minute TTL, 5-attempt cap, and single-use
  (request deleted on success/expiry).

## 11. Task ordering (for the plan)

1. **Spike + password change** — confirm the auth-helper runtime; ship `changePassword` +
   `signOutOtherSessions` with tests.
2. **Email-change backend** — schema table, `startEmailChange`/`confirmEmailChange`,
   `sendEmailChangeCode`, migration + lock-out tests.
3. **Frontend page + nav** — `/settings/account`, three cards, `settingsGroup` entry.
