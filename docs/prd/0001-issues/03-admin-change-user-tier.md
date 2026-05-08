# Issue 03 — Admin change user tier with downgrade-violation check

**Labels**: `needs-triage`, `enhancement`, `database`, `frontend`
**Type**: AFK

## Parent

PRD: `docs/prd/0001-enterprise-account-tiers.md` §5.5, US4.2, US4.3

## What to build

Cho admin đổi tier của user khác qua AdminUsersPage. Block downgrade nếu có course vi phạm chapter limit của tier mới (decision E-11). Admin row không có nút (decision E-10).

End-to-end deliverable:
- RPC `change_user_account_tier(target_user_id uuid, new_tier text)` trong migration mới `023_change_user_tier_rpc.sql`:
  - SECURITY DEFINER; assert caller `role='admin'`.
  - Lock target user row (FOR UPDATE).
  - Reject nếu target `role='admin'`.
  - Downgrade-violation check: `SELECT course_id, count(chapters) FROM chapters JOIN courses ON ... WHERE creator_id = target GROUP BY course_id HAVING count > new_tier.max_chapters_per_course`. Nếu có row → RAISE với detail course title danh sách.
  - UPDATE `users.account_tier_id`.
- `src/lib/adminApi.ts`: thêm `changeUserAccountTier(client, userId, tierCode)`.
- AdminUsersPage:
  - Action menu thêm "Đổi tier"; ẩn cho row có `role='admin'`.
  - Dialog: select tier từ `useAccountTiers`, hiện confirm với fee % và max chapters của tier mới.
  - Nếu RPC raise `tier_downgrade_violates_chapter_limit` → toast i18n liệt kê tên course vi phạm.
- i18n: `admin.users.changeTier.*`, `errors.tierDowngradeBlocked`.
- SQL test script `scripts/test-admin-change-tier.sql`: happy path + downgrade-block + admin-target-reject.

## Acceptance criteria

- [ ] AdminUsersPage có nút "Đổi tier" cho non-admin row, ẩn cho admin row.
- [ ] Đổi tier thành công cho user không vi phạm: badge update ngay, toast success.
- [ ] Downgrade tier với course vượt limit: toast lỗi, badge không đổi.
- [ ] Caller không phải admin gọi RPC trực tiếp: lỗi permission.
- [ ] SQL test pass 3 case.

## Blocked by

- Issue 02b
