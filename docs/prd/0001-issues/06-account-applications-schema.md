# Issue 06 — account_applications schema rename + tier metadata + admin queue UI

**Labels**: `needs-triage`, `enhancement`, `database`, `frontend`
**Type**: AFK

## Parent

PRD: `docs/prd/0001-enterprise-account-tiers.md` §5.2, §5.3, §5.4, US3.1, US3.2, US3.3

## What to build

Mở rộng `creator_applications` thành `account_applications` với `requested_tier_code` + `metadata jsonb`. Thêm RPC submit (supersede pending) + approve (downgrade-check + role transition logic) + reject. Admin queue UI hiện cột tier + render metadata theo tier.

End-to-end deliverable:
- Migration `022_account_applications.sql`:
  - `ALTER TABLE creator_applications RENAME TO account_applications`.
  - Thêm cột `requested_tier_code text NOT NULL DEFAULT 'individual' REFERENCES account_tiers(code)`, `metadata jsonb NOT NULL DEFAULT '{}'::jsonb`.
  - Mở rộng status enum: thêm `'superseded'`.
  - Update RLS policies (cho phép user select đơn của mình; admin select all).
  - RPC `submit_account_application(payload jsonb)`: lock user row → set existing pending → `superseded` → insert new pending → return id. Validate tier-specific required fields theo `requested_tier_code` (business: business_name+registration_no; athlete: federation_or_team; training_center: center_address+center_size).
  - RPC `approve_account_application(app_id uuid)`: assert admin; lock app+user; reject nếu user.role=admin; downgrade-violation check như issue 03; if user.role='learner' → set role='creator' + tier; if user.role='creator' → chỉ đổi tier; set app status='approved'.
  - RPC `reject_account_application(app_id uuid, reason text)`: assert admin; set status='rejected' + reason.
- `src/lib/accountApplicationApi.ts`: wrappers cho 3 RPC + `fetchMyApplication`, `fetchAllApplications`.
- `src/pages/admin/AdminCreatorApplicationsPage.tsx` → rename hiển thị `AdminApplicationsPage`:
  - Cột "Tier yêu cầu" với badge.
  - Filter dropdown theo tier.
  - Detail dialog: render `metadata` keys-values theo từng tier (business_name, federation_or_team, ...).
- i18n: `admin.applications.*` mở rộng cho tier + metadata field labels.
- SQL tests: `scripts/test-application-supersede.sql`, `scripts/test-application-approve.sql` (cover learner→creator, creator→creator upgrade tier, downgrade-block).

## Acceptance criteria

- [ ] Tất cả `creator_applications` cũ migrate thành `account_applications` với `requested_tier_code='individual'`.
- [ ] Submit application lần 2 trong khi pending: app cũ → `superseded`, app mới → `pending`.
- [ ] Approve app `requested_tier='business'` cho user `role='learner'` → user thành `role='creator', tier='business'`.
- [ ] Approve app cho user `role='creator', tier='individual'` → chỉ tier đổi, role giữ nguyên.
- [ ] Approve app gây downgrade vi phạm chapter limit → raise.
- [ ] Reject yêu cầu reason không trống.
- [ ] AdminApplicationsPage hiển thị cột tier + metadata trong detail.
- [ ] Tier-specific required fields validate ở RPC level (không chỉ client).

## Blocked by

- Issue 02b
