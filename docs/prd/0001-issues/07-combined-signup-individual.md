# Issue 07 — Combined signup form for individual tier (anon path)

**Labels**: `needs-triage`, `enhancement`, `frontend`
**Type**: AFK

## Parent

PRD: `docs/prd/0001-enterprise-account-tiers.md` §5.8 (individual path), US1.3 partial
Related: Issue #80

## What to build

Refactor flow `/become-creator` để anon submit signup + application trong 1 form (chỉ tier `individual`). Đặt nền cho slice 8 mở rộng các tier enterprise. Slice này CHƯA close #80 (đợi đầy đủ enterprise tier ở slice 8).

End-to-end deliverable:
- `src/lib/pendingAccountApplication.ts` (rename từ `pendingCreatorApplication`):
  - Helpers `save / get / clear` với key `pendingAccountApplication`.
  - Schema: `{ requested_tier_code, motivation?, experience?, sample_url?, metadata? }`.
- `src/pages/BecomeCreatorPage.tsx` anon path:
  - Combined form: name, email, password (auth) + motivation, experience, sample_url (common, optional).
  - `requested_tier_code` hardcoded = `'individual'`.
  - Submit: validate auth fields → `localStorage.set('pendingAccountApplication', payload)` → `supabase.auth.signUp` → redirect `/check-email`.
- `src/pages/LoginPage.tsx`: post-login, nếu `localStorage.pendingAccountApplication` có → redirect `/become-creator`.
- `src/pages/BecomeCreatorPage.tsx` authenticated path:
  - Mount với pending payload + chưa có application → call `submit_account_application` → clear localStorage → show pending card.
  - Edge cases (đã có pending DB → bỏ qua localStorage; đã là creator → show "đã là creator" panel).
- i18n: `becomeCreator.combined.*` keys (cho tier individual lúc này; slice 8 mở rộng).
- Unit tests: `pendingAccountApplication` save/get/clear; BecomeCreatorPage anon flow render + submit; LoginPage redirect logic.

## Acceptance criteria

- [ ] Anon `/become-creator` thấy form 6 field (name/email/password/motivation/experience/sample).
- [ ] Auth fields required, common fields optional.
- [ ] Submit → localStorage có payload + redirect `/check-email`.
- [ ] Sau verify email + login với localStorage có pending → redirect `/become-creator` → auto-submit application → clear localStorage → show pending card.
- [ ] Existing learner (đã login) vào `/become-creator` thấy form không có auth section.
- [ ] Existing creator individual vào `/become-creator` không submit duplicate (slice 8 sẽ thêm upgrade UX).
- [ ] Email trùng error: KHÔNG clear localStorage.
- [ ] Tests pass cho 4 case trên.

## Blocked by

- Issue 06
