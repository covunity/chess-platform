# ADR-0003: Server-side staging of pending account application (cross-tab UX fix)

**Date:** 2026-05-09
**Status:** Accepted
**Issue:** #105

---

## Context

When an anonymous user fills out `/become-creator`, the form payload is saved to
`localStorage['pendingAccountApplication']` before calling `supabase.auth.signUp`.
After sign-up, the user is redirected to `/check-email`.

If the user clicks the verification link in a **different browser tab, window, or
device** (e.g., the email app on mobile opens Chrome while the original sign-up
was in Safari), the new tab has no access to the original tab's `localStorage`.
The auto-submit `useEffect` in `BecomeCreatorPage` finds nothing and the
application payload is silently lost.

## Options considered

### Option A — Server-side staging via `user_metadata` (chosen)

Pass the pending payload as `options.data.pending_application` when calling
`supabase.auth.signUp`. Supabase stores this in `auth.users.raw_user_meta_data`,
which is accessible from any session after email verification.

After the user verifies and logs in, `BecomeCreatorPage` checks
`user.user_metadata.pending_application` as a fallback if `localStorage` is empty.
After a successful auto-submit, the metadata key is cleared via
`supabase.auth.updateUser({ data: { pending_application: null } })`.

### Option B — Opaque token + DB draft table

Store the payload in a `pending_application_drafts` table with a UUID token,
append `?draft=<token>` to the verification email link (custom Supabase email template).

Rejected: requires custom email templates (out of scope for Phase 1) and a new
migration + RLS policy for the draft table. Higher complexity, similar result.

### Option C — Banner fallback only (no cross-tab recovery)

Show a banner in the empty form: "Did you sign up before? Resume your application."
The user would re-fill the form manually.

Rejected: poor UX, violates the acceptance criteria that the application must
be created automatically.

## Decision

**Option A** — use `user_metadata` as a server-side staging area.

Key properties of this approach:
- Zero additional DB tables or migrations.
- Payload reaches the server at sign-up time and is available from any session.
- 24-hour expiry (`expires_at` epoch field) prevents metadata accumulation.
- `clearPendingApplicationFromMetadata(supabase)` clears the key after submit
  (best-effort; stale metadata is harmless after expiry).
- `localStorage` path is preserved as the primary path (same-browser scenario
  continues to work exactly as before).

## Consequences

- `AuthContext.signUp` accepts an optional `extraData` parameter merged into
  `options.data` — backward-compatible change.
- `pendingAccountApplication.ts` gains three new exports:
  - `getPendingApplicationFromUserMetadata` — reads and validates from user metadata.
  - `clearPendingApplicationFromMetadata` — best-effort metadata cleanup.
  - `expires_at` field added to `PendingAccountApplication` interface; `save`
    always stamps a 24-hour expiry.
- The auto-submit `useEffect` in `BecomeCreatorPage` falls back to metadata only
  when `localStorage` returns null — existing same-browser behaviour is unchanged.
