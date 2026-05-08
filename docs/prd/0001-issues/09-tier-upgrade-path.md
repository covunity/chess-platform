# Issue 09 — Tier upgrade path for existing creator

**Labels**: `needs-triage`, `enhancement`, `frontend`
**Type**: AFK

## Parent

PRD: `docs/prd/0001-enterprise-account-tiers.md` US2.1, US2.2, US2.3, decision E-17

## What to build

Cho creator hiện hữu (`role='creator'`, `tier='individual'`) nâng tier lên enterprise qua entry point `/become-creator` (decision E-17 — single entry point, không có settings page riêng). Thêm CTA dashboard creator để user phát hiện được tính năng.

End-to-end deliverable:
- `src/pages/BecomeCreatorPage.tsx` authenticated path mở rộng:
  - Nếu `profile.role='creator' AND profile.account_tier_id='individual'`: render form đầy đủ KHÔNG có auth section. Tier selector hiện 3 enterprise tier (ẩn individual vì redundant). Header banner i18n "Nâng cấp lên Doanh nghiệp".
  - Nếu `profile.role='creator' AND profile.account_tier_id != 'individual'`: panel "Đã là enterprise creator", không render form.
  - Submit → `submit_account_application` → supersede pending cũ (RPC đã handle ở slice 6) → show pending card.
- Dashboard creator (`src/pages/creator/CreatorDashboardPage.tsx` hoặc tương đương):
  - CTA card "Nâng cấp tài khoản doanh nghiệp" hiện chỉ khi `tier='individual'`. Click → `/become-creator`.
- i18n: `becomeCreator.upgradeBanner`, `creator.dashboard.upgradeCta`.
- Tests:
  - Creator individual login + vào `/become-creator` → form upgrade hiện 3 tier enterprise.
  - Creator business login + vào `/become-creator` → panel "đã enterprise".
  - Submit upgrade → application mới `pending`, application cũ (nếu có) → `superseded`.
  - Approve upgrade → `account_tier_id` đổi, `role` không đổi.
  - Dashboard CTA hiện/ẩn đúng theo tier.

## Acceptance criteria

- [ ] Creator individual thấy form upgrade với 3 tier enterprise + banner upgrade.
- [ ] Creator individual KHÔNG thấy auth section (đã đăng nhập).
- [ ] Creator enterprise thấy panel "đã là enterprise" thay vì form.
- [ ] Submit upgrade tạo application mới `pending`.
- [ ] Existing pending application → `superseded` khi submit upgrade mới.
- [ ] Admin approve upgrade → tier đổi, role giữ nguyên `creator`.
- [ ] Dashboard CTA hiện cho tier `individual`, ẩn cho enterprise.
- [ ] Tests pass cho 5 case trên.

## Blocked by

- Issue 08
