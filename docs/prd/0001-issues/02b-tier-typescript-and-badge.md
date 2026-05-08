# Issue 02b — Tier TypeScript layer + AdminUsers tier badge (read-only)

**Labels**: `needs-triage`, `enhancement`, `frontend`
**Type**: AFK

## Parent

PRD: `docs/prd/0001-enterprise-account-tiers.md` §4 (US4.1 read-only badge)

## What to build

Thêm TS types và hook để load `account_tiers` ở client. Surface tier ở AdminUsersPage làm badge (read-only, chưa có nút đổi). End-to-end demoable: admin login → `/admin/users` → thấy cột "Tier" với badge tên Vietnamese cho mỗi user.

End-to-end deliverable:
- `src/lib/accountTiers.ts`:
  - `export type AccountTierCode = 'individual'|'business'|'athlete'|'training_center'`.
  - `export interface AccountTier { code, name_vi, platform_fee_pct, max_chapters_per_course, is_enterprise, requires_approval, display_order }`.
  - `fetchAccountTiers(client)` → cached 1 lần per session.
  - `useAccountTiers()` hook return `{ tiers, loading, getTier(code) }`.
  - `computeFeeFloor(price, pct)` helper (sẽ dùng kỹ ở slice 5; ship sớm để có unit test).
- `src/context/AuthContext.tsx`: thêm `account_tier_id: AccountTierCode` vào `UserProfile`, mở rộng SELECT query.
- `src/pages/admin/AdminUsersPage.tsx`: thêm cột "Tier" hiển thị badge `name_vi` từ `useAccountTiers`. Color khác cho enterprise tier.
- i18n: `src/locales/vi.json` thêm `accountTier.individual / business / athlete / trainingCenter`, `admin.users.tierColumn`.
- Unit tests: `computeFeeFloor.test.ts` (biên 0/100/lẻ), `accountTiers.test.ts` (fetch + cache).

## Acceptance criteria

- [ ] `useAccountTiers()` chỉ gọi network 1 lần per session, return data đúng schema.
- [ ] `UserProfile.account_tier_id` populated khi login.
- [ ] AdminUsersPage hiện cột Tier với badge cho 100% user (default `individual`).
- [ ] Không có hardcoded string trong file mới.
- [ ] Unit tests pass cho `computeFeeFloor`, `fetchAccountTiers`.

## Blocked by

- Issue 02a
