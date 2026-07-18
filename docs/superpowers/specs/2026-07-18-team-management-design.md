# Passline → Team management (multi-user orgs)

- **Date:** 2026-07-18
- **Status:** Design — awaiting approval
- **Slice:** Add multi-user teams to an organization: a memberships model, add-by-email
  membership (auto-join on sign-in), Owner/Member roles, and enforcement on sensitive
  actions. Replaces the `settings/team` "Coming soon" stub.

## 1. Goal

Let an organization have more than one user. Today `organizers` is 1 row per user email
and doubles as both the org tenant and the user. This introduces a real membership layer
so several users can operate one org, with an owner who controls the team and settings.

## 2. Product decisions (agreed)

- **Add by email → auto-join on sign-in.** The owner adds a teammate's email + role; a
  membership is created immediately. When that person signs in with that email, they are
  in the org. **No invitation emails, tokens, accept pages, or expiry.**
- **Roles: Owner + Member.** Owner manages the team and org/payment settings and can
  delete events. Members can run events, attendees, marketing, scanning — everything
  except team management, settings edits, and deleting events.
- **Enforcement only on sensitive actions** (team mgmt, settings, destructive), not a
  rewrite of every mutation.

## 3. Two consequences to sign off on

1. **One org per person (v1).** Resolution is by email → a single membership, so a person
   belongs to exactly one org. Adding an email that already belongs to *any* team is
   rejected with a clear message. (Multi-org / org-switching is future work.)
2. **Members can't edit org/payment settings or delete events.** Those become owner-only.
   A member opening Settings sees the fields read-only (or the save disabled) with a note.

## 4. Identity model

Keep `organizers` as the **organization tenant** (its `name`/`image`/`default*` are
org-level; its `email` is the original owner's, retained as-is). Add:

```ts
memberships: defineTable({
  organizerId: v.id("organizers"),
  email: v.string(),              // normalized lowercase — the member/invited email
  userId: v.optional(v.id("users")), // linked on that person's first sign-in
  role: v.union(v.literal("owner"), v.literal("member")),
  createdAt: v.number(),
})
  .index("by_email", ["email"])
  .index("by_organizer", ["organizerId"])
```

`userId` is `undefined` while a membership is *pending* (added but the person hasn't signed
in yet) and set once they do — that's the only "pending vs active" signal; no status enum.

## 5. Auth resolution (the load-bearing change)

`getAuthOrganizerId(ctx)` keeps its exact signature/return (`Id<"organizers"> | null`) so
**no caller changes** — only its internals:

```
userId = getAuthUserId(); if none → null
email = users.get(userId).email (lowercased); if none → null
membership = memberships.by_email(email).first()
if membership → return membership.organizerId
// LEGACY FALLBACK (belt-and-suspenders): a pre-migration owner whose membership
// hasn't been backfilled yet still has an organizers row with their email.
legacy = organizers.by_email(email).unique()
return legacy?._id ?? null
```

The legacy fallback is what makes this change safe to ship without a hard ordering
dependency on the migration, and keeps every existing test green (they seed the authed
org via `ensureOrganizer`, and the fallback covers any that insert `organizers`
directly). It only ever grants access to someone who already owns an `organizers` row
under their own email — i.e. a creator/owner — so it cannot leak cross-tenant access.

New helpers in `convex/auth.ts`:
- `getMyMembership(ctx)` → `{ organizerId, role } | null` (the current user's membership).
- `requireOwner(ctx)` → returns `organizerId`, throws `"Only an owner can do this"` if the
  current user's role isn't `owner` (or has no membership).

## 6. Onboarding rewrite — `organizers.ensureOrganizer`

Runs on sign-in (from AuthGuard). New logic:
- `membership = memberships.by_email(email).first()`
  - exists → if `userId` unset, patch it to the current user (links a pending invite);
    return `membership.organizerId`.
- none → brand-new solo user: insert `organizers` (as today) **and** an `owner` membership
  for this email+user; return the new `organizerId`.

This preserves solo onboarding and makes an invited email join the existing org instead of
spawning a new one.

## 7. Migration (required, one-off)

`convex/migrations.ts` (or extend it) via `@convex-dev/migrations`: for every existing
`organizers` row with no membership, insert an `owner` membership
`{ organizerId, email: organizer.email.toLowerCase(), role: "owner", createdAt }`. Without
this, existing users resolve to `null` and lose access. `ensureOrganizer` is also
self-healing (a signed-in owner with an organizer-by-email but no membership gets one),
but the migration backfills everyone up front.

## 8. Team API — `convex/team.ts` (new)

- `listTeam()` (any member) → `{ members: [{ _id, email, role, pending: boolean }], myRole }`,
  the org's memberships (pending = `userId` unset). Names/avatars aren't stored per member
  in v1 — show email + role.
- `addMember({ email, role })` (owner) — normalize email; reject if it already has a
  membership in this or any org (`"That email already belongs to a team"`); insert a
  pending membership.
- `updateRole({ membershipId, role })` (owner) — reject demoting the last owner.
- `removeMember({ membershipId })` (owner) — reject removing the last owner; an owner may
  remove themselves only if another owner exists.
- `getMyIdentity()` (any signed-in user) → `{ email, name }` from the `users` row — the
  member's *own* identity (distinct from `getMe`, which returns the org). Used by the
  Account section and to highlight "you" in the team list.

## 9. Enforcement (sensitive actions only)

Add `requireOwner` gates to:
- `organizers.updateProfile`, `organizers.setImage` (org identity). *(Note:
  `updatePreferences` from the settings-enhance branch is not on this branch's `main`; its
  gate lands as a one-line follow-up when that merges.)*
- `events.deleteEvent`.
- All of `team.ts`'s mutating endpoints.

Everything else stays member-accessible. UI mirrors this: Settings save controls and the
event Delete action are disabled with a note for members.

## 10. Client

- `src/routes/settings/team.tsx` (rewrite): Members card (list with role badges, "you"
  marker, pending tag), an owner-only "Add teammate" form (email + role select), and
  owner-only per-member controls (change role, remove). Members see a read-only list plus a
  note that only owners manage the team.
- Settings profile page + event Delete button: disable for non-owners with a short note
  (small, targeted edits).

## 11. Testing (heavy — this touches auth)

- `auth`/`organizers`: `ensureOrganizer` creates org + owner membership for a new user;
  a second sign-in returns the same org; a user whose email has a pending membership joins
  that org (no new org) and links `userId`; `getAuthOrganizerId` resolves via membership.
- `team`: `addMember` creates a pending membership; adding an existing member/other-org
  email throws; `removeMember`/`updateRole` block removing/demoting the last owner; a
  member (non-owner) calling any team mutation or `deleteEvent`/`updateProfile` throws
  `"Only an owner"`.
- `migration`: backfills exactly one owner membership per pre-existing organizer and is
  idempotent (re-running adds none).

## 12. Risks

- **Auth is global.** Changing `getAuthOrganizerId` affects every scoped function. Mitigated
  by keeping its return identical and by the migration + self-healing `ensureOrganizer`.
  This is the highest-risk change in the codebase and warrants the heavy test set above.
- **Cannot be visually verified right now** (browser disconnected). Auth changes are the
  worst kind to ship unseen; the test suite is the safety net, and a real sign-in/sign-out
  smoke test should happen before this is trusted in production.
- **`getMe` returns the org, not the member.** A member's nav shows the org identity; their
  personal email surfaces via `getMyIdentity` in the Account section and team list. Full
  per-member identity in the nav is deferred.
