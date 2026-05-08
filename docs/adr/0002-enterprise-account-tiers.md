# ADR-0002 — Enterprise Account Tiers for Creators

- **Status:** Accepted
- **Date:** 2026-05-08
- **PRD:** `docs/prd/0001-enterprise-account-tiers.md`
- **Related issues:** #80 (combined signup), #83–#92 (implementation slices)

## Context

The platform originally has a flat creator model: every creator pays the same platform fee (20 %) and has no chapter limit per course. As the platform grows toward business, athlete, and training-center partners, a single-tier model is insufficient:

- Different partners need different fee rates negotiated without a new deploy.
- Organisations (businesses, training centres) typically produce larger courses and need higher chapter limits.
- Visitor sign-up for creators requires three separate steps today (sign up as learner → `/become-creator` → submit form). Issue #80 tracked the need to collapse this into a single combined form. Generalising to multiple tiers makes solving Issue #80 worth doing correctly.

## Decision

Introduce an `account_tiers` lookup table orthogonal to the existing `role` column. Each creator has one `account_tier_id`; admin is always locked to `individual`.

Key architectural choices (E-01 → E-20):

| Code | Decision |
|------|----------|
| E-01 | `account_tiers` is a DB lookup table (text PK), **not** a Postgres enum — new tiers require only an INSERT, no `ALTER TYPE`. |
| E-02 | Tier codes are short lowercase strings (`individual`, `business`, `athlete`, `training_center`) — human-readable FK values, stable across environments. |
| E-03 | Four seed tiers shipped with migration: `individual` (20 % / 10 ch), `business` (15 % / 30 ch), `athlete` (10 % / 15 ch), `training_center` (10 % / 50 ch). Values are placeholders pending BizDev sign-off before public launch. |
| E-04 | `users.account_tier_id` defaults to `'individual'` — all existing users are unaffected by the migration. |
| E-05 | DB trigger `enforce_admin_individual_tier` on `users` raises on `INSERT OR UPDATE` if `role = 'admin' AND account_tier_id != 'individual'`. Admin accounts are always locked to individual tier. |
| E-06 | Chapter limit (`max_chapters_per_course`) is stored per tier row, not in a global `config` entry — each tier is self-describing. |
| E-07 | Platform fee and creator payout are **snapshotted** onto `orders` at creation time (`platform_fee_pct`, `platform_fee_amount`, `creator_payout_amount`). Changing a creator's tier later does not retroactively alter past orders. |
| E-08 | Fee formula uses `floor()`: `fee = floor(price * pct / 100)`. Integer arithmetic avoids floating-point rounding across different locales. |
| E-09 | New RPC `create_order_with_fee_snapshot` handles order creation. Client code never INSERTs into `orders` directly. Free courses (price = 0) produce snapshot 0/0/0 and auto-activate enrollment in the same transaction. |
| E-10 | AdminUsersPage hides the "Change tier" action for rows where `role = 'admin'`. |
| E-11 | Tier downgrade is blocked if any of the creator's courses already exceeds the new tier's `max_chapters_per_course`. The RPC raises `tier_downgrade_violates_chapter_limit` with course details; the UI surfaces these to the admin. |
| E-12 | `creator_applications` table is renamed to `account_applications`; a new `requested_tier_code` column (FK → `account_tiers`) replaces the implicit "apply to be individual creator" assumption. |
| E-13 | RLS on `account_tiers` grants public SELECT (anon) — tier list is marketing information needed before sign-up, not sensitive data. INSERT/UPDATE/DELETE remain admin-only. |
| E-14 | A new `superseded` application status is added. Submitting a new application while one is pending automatically marks the old one `superseded`. |
| E-15 | For the `business` tier, `users.name` is set to `metadata.business_name` at application-submit time — the account name is the business name. |
| E-16 | The localStorage key for pending applications is `pendingAccountApplication` (renamed from `pendingCreatorApplication` in Issue #80). |
| E-17 | `/become-creator` is the **single entry point** for all creator signup and tier-upgrade flows. No separate settings page is added in Phase 1. |
| E-18 | Tier-specific required fields (`business_name`, `business_registration_no`, `federation_or_team`, `center_address`, `center_size`) are stored in a `metadata jsonb` column on `account_applications`, not in separate tables per tier. |
| E-19 | Tier-specific required fields are validated at **both** the client layer and the RPC layer (`submit_account_application`). Client validation for fast UX; RPC validation as authoritative backstop. |
| E-20 | Tier upgrade for existing creators: only `account_tier_id` is updated; `role` remains `creator`. Downgrading to individual is allowed only if chapter counts don't violate the new limit. |

### Schema summary

```
account_tiers (code PK, name_vi, platform_fee_pct, max_chapters_per_course,
               is_enterprise, requires_approval, display_order, created_at)

users.account_tier_id  text NOT NULL DEFAULT 'individual' FK → account_tiers(code)

account_applications (id, user_id FK, requested_tier_code FK, status,
                      motivation?, experience?, sample_url?,
                      metadata jsonb, rejection_reason?, created_at, decided_at)
  status ∈ { pending, approved, rejected, superseded }

orders += (platform_fee_pct, platform_fee_amount, creator_payout_amount,
           account_tier_code FK nullable)
```

## Consequences

### Positive
- Adding a 5th tier (e.g. `team`) requires only one SQL INSERT — no code deploy.
- Fee rates are DB-configurable; BizDev can negotiate custom rates without engineering.
- Order payout figures are stable regardless of future tier changes or fee adjustments.
- Combined signup form (Issue #80) is solved as a by-product of generalising to multi-tier.
- Chapter limits are enforced at both UI and DB layers — prevents data inconsistency from API abuse.

### Negative / risks
- `account_applications` rename is a breaking schema change — any external integrations hitting the old table name must be updated (none exist in Phase 1).
- `jsonb` metadata is schemaless — tier-specific field validation must be maintained in both the RPC and client. Adding a new required field to an existing tier requires a migration comment or RPC update.
- `floor()` can produce slightly different payouts than a naive percentage — creators should be informed during onboarding.
- Placeholder fee/chapter-limit values must be confirmed with BizDev before public launch (`-- TODO` comments in migration seed).

## Alternatives considered

### Alt A — Postgres enum for tiers
Rejected: adding a new tier requires `ALTER TYPE … ADD VALUE` which is DDL and cannot be rolled back in a transaction on some Postgres versions. A lookup table is more ops-friendly.

### Alt B — Separate `creator_profile` table per tier
Rejected: too much schema fragmentation. A `jsonb metadata` column on `account_applications` is sufficient for Phase 1 and avoids N tables that all join back to `users`.

### Alt C — Store fee rates in `config` table (existing)
Rejected: `config` is a flat key-value store; it cannot hold per-tier values without encoding tier names into keys (`platform_fee_pct_business = 15`), which is brittle. A dedicated table with a proper PK is the right model.

### Alt D — Single `/settings` page for tier upgrades
Rejected (E-17): adding a new top-level settings page adds navigation complexity in Phase 1. Re-using `/become-creator` keeps the surface area small; a CTA from the creator dashboard links there.

## Implementation references

- PRD: `docs/prd/0001-enterprise-account-tiers.md`
- Migrations: `supabase/migrations/018_account_tiers.sql`, `019_users_account_tier.sql`, `020–023_*.sql`
- TS types + hook: `src/lib/accountTiers.ts`
- Application API: `src/lib/accountApplicationApi.ts`
- Combined form: `src/pages/BecomeCreatorPage.tsx`
