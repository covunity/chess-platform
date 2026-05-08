# Issue 08 — Enterprise tiers in combined signup form (closes #80)

**Labels**: `needs-triage`, `enhancement`, `frontend`
**Type**: AFK

## Parent

PRD: `docs/prd/0001-enterprise-account-tiers.md` §5.8 (full), US1.1, US1.2, US1.3
Closes: Issue #80

## What to build

Mở rộng `BecomeCreatorPage` form từ slice 7 với tier selector và tier-specific fields cho `business`, `athlete`, `training_center`. Business signup ghi `business_name` vào `users.name` (decision E-15). Route alias `/register-business?tier={code}` pre-select tier.

End-to-end deliverable:
- `src/pages/BecomeCreatorPage.tsx`:
  - Tier selector ở đầu form: 4 card từ `useAccountTiers`, hiển thị `name_vi` + fee % + `max_chapters_per_course`. Click → set `requested_tier_code` state.
  - Tier-specific section render conditional theo tier đang chọn:
    - `individual`: không thêm field.
    - `business`: `business_name` (required), `business_registration_no` (required).
    - `athlete`: `federation_or_team` (required).
    - `training_center`: `center_address` (required), `center_size` int (required).
  - Submit:
    - Validate tier-specific required fields.
    - Tier=business: `users.name` = `business_name` (truyền vào `signUp` options.data.name).
    - Lưu `metadata` jsonb vào localStorage payload.
- Route alias `/register-business`:
  - Component reuse `BecomeCreatorPage`, query param `?tier=business|athlete|training_center` pre-select tier.
  - Add to `src/App.tsx` (hoặc nơi đặt routes).
- i18n: `becomeCreator.tierSelector.*`, `becomeCreator.fields.businessName / registrationNo / federation / centerAddress / centerSize`.
- AdminApplicationsPage detail dialog (đã có ở slice 6) verify hiển thị metadata cho 3 tier mới đầy đủ.
- Tests: render từng tier, validate required, submit flow cho mỗi tier, route alias pre-select.

## Acceptance criteria

- [ ] Tier selector hiển thị 4 card với fee/max chapters.
- [ ] Chọn `business` → form hiện 2 field tier-specific required.
- [ ] Chọn `athlete` → 1 field required.
- [ ] Chọn `training_center` → 2 field required (1 number).
- [ ] Validation chặn submit nếu tier-specific required trống.
- [ ] Anon submit business: `users.name` sau verify = `business_name`.
- [ ] `/register-business?tier=athlete` mở form với tier athlete được pre-select.
- [ ] AdminApplicationsPage detail thấy đủ metadata mỗi tier.
- [ ] Tests pass cho 4 tier × (anon / authenticated).
- [ ] Issue #80 acceptance criteria đầy đủ (combined form cho mọi tier).

## Blocked by

- Issue 07
