# Issue 02a — Account tier database schema + admin-lock trigger

**Labels**: `needs-triage`, `enhancement`, `database`
**Type**: AFK

## Parent

PRD: `docs/prd/0001-enterprise-account-tiers.md` §5.1, §7

## What to build

Tạo bảng `account_tiers` lookup + cột `users.account_tier_id`. Thiết lập invariant: admin luôn `tier=individual`. Public read RLS để anon load tier list cho /become-creator (decision E-13).

End-to-end deliverable:
- Migration `018_account_tiers.sql`:
  - Bảng `account_tiers` với các cột: `code text PK`, `name_vi text`, `platform_fee_pct numeric(5,2)`, `max_chapters_per_course int`, `is_enterprise bool`, `requires_approval bool`, `display_order int`, `created_at timestamptz`.
  - Seed 4 row placeholder: `individual` (20% / 10), `business` (15% / 30), `athlete` (10% / 15), `training_center` (10% / 50). Comment SQL `-- TODO: Confirm with BizDev before public launch`.
  - RLS: SELECT public (anon được đọc), INSERT/UPDATE/DELETE chỉ admin.
- Migration `019_users_account_tier.sql`:
  - `ALTER TABLE users ADD COLUMN account_tier_id text NOT NULL DEFAULT 'individual' REFERENCES account_tiers(code)`.
  - Trigger `enforce_admin_individual_tier()` BEFORE INSERT OR UPDATE trên `users`: nếu `NEW.role='admin' AND NEW.account_tier_id != 'individual'` thì RAISE EXCEPTION.
- Manual SQL test script `scripts/test-account-tier-schema.sql`:
  - Anon SELECT từ `account_tiers` thành công.
  - Anon UPDATE/INSERT bị reject.
  - Cập nhật `users.account_tier_id='business'` cho admin row → RAISE.

## Acceptance criteria

- [ ] Migrations 018 và 019 chạy idempotent (CREATE IF NOT EXISTS hoặc tương đương).
- [ ] 4 tier seed có sẵn sau migration.
- [ ] Anon Supabase client `SELECT * FROM account_tiers` trả 4 row.
- [ ] Anon UPDATE bị RLS chặn.
- [ ] Trigger raise khi cố set `account_tier_id != 'individual'` cho user `role='admin'`.
- [ ] `scripts/test-account-tier-schema.sql` chạy pass tất cả assertion.

## Blocked by

- Issue 01 (ADR ghi quyết định trước khi schema land — soft dep, có thể parallel)
