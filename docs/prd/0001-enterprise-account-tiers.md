# PRD-0001: Enterprise Account Tiers + Combined Signup

> Status: Draft · Owner: @haunguyen1064 · Created: 2026-05-08 · Branch: `claude/add-enterprise-accounts-CVpTR`
> Related: ADR-0002 (sẽ tạo), Issue #80
> Replaces deferred item "Sub-tier business accounts" trong CLAUDE.md §7

---

## 1. Background & Problem

Nền tảng hiện có 3 role: `admin`, `creator`, `learner`. Mọi creator chịu cùng platform fee và không bị giới hạn số chương / khoá học. Khi mở rộng tới các đối tác doanh nghiệp:

- Doanh nghiệp thường, vận động viên, trung tâm đào tạo có nhu cầu khác nhau (thương hiệu, nhiều chương, nhiều khoá).
- Mức phí nền tảng nên khác nhau theo nhóm để có thể đàm phán/khuyến mãi.
- Visitor đang phải đăng ký learner trước rồi mới apply creator (Issue #80) — thêm flow business càng làm rối nếu không gộp.

## 2. Goals

- G1. Cho phép user đăng ký 1 trong 4 tier: `individual`, `business`, `athlete`, `training_center` ngay từ landing.
- G2. Mỗi tier có `platform_fee_pct` và `max_chapters_per_course` riêng, cấu hình được qua DB không cần deploy.
- G3. Snapshot phí lên `orders` lúc tạo đơn để payout không bị retroactive khi tier đổi sau này.
- G4. Enforce chapter limit ở cả DB (trigger) và UI.
- G5. Gộp Issue #80: combined signup form trên `/become-creator` cho mọi tier, anon submit được.
- G6. Code robust, dễ thêm tier mới mà không phải migration enum.

## 3. Non-goals (Phase 1 mở rộng)

- Tự động xác minh giấy tờ doanh nghiệp (chỉ dùng form text).
- Bucket riêng để upload tài liệu enterprise.
- Multi-user-per-organization (1 business account = 1 user).
- Đổi tier cho admin (admin luôn `individual`).
- Audit log lịch sử đổi tier.
- Email notify khi application duyệt/reject (theo CLAUDE.md D-14).
- Refund khi đổi tier giữa chừng.
- Public profile cho enterprise creator (CLAUDE.md D-16 vẫn lock).

## 4. Personas & User Stories

### P1 — Visitor (anon) muốn đăng ký doanh nghiệp
- US1.1: Click CTA "Trở thành Creator/Doanh nghiệp" → `/become-creator` thấy 4 card tier với fee % và max chapters.
- US1.2: Chọn tier `business`, điền name/email/password + business_name + business_registration_no → submit → tới `/check-email`.
- US1.3: Verify email, login → application tự động được nộp, thấy panel "Đang chờ duyệt".

### P2 — Creator individual hiện tại muốn nâng tier
- US2.1: Truy cập `/become-creator` đã đăng nhập → form không có ô auth, có tier selector + tier-specific fields.
- US2.2: Submit application business → application individual cũ (nếu pending) tự supersede, application mới ghi `requested_tier_code='business'`.
- US2.3: Sau khi admin duyệt, role giữ nguyên `creator`, `account_tier_id` chuyển thành `business`.

### P3 — Admin duyệt application
- US3.1: Vào `/admin/creator-applications` (rename hiển thị `/admin/account-applications`) → bảng có cột tier.
- US3.2: Mở detail → thấy `metadata` (business_name, federation, ...) tương ứng tier.
- US3.3: Approve → user được set `role='creator'` + `account_tier_id` = `requested_tier_code`. Reject yêu cầu reason.

### P4 — Admin quản lý user
- US4.1: Trang AdminUsers cột "Tier" với badge.
- US4.2: Đổi tier qua dialog. Nếu downgrade vi phạm chapter limit → confirm dialog cảnh báo, RPC raise → UI show error i18n.
- US4.3: Hàng có `role='admin'` không hiện nút đổi tier.

### P5 — Creator tạo course / chapter
- US5.1: Trang NewCourse hiện preview "Phí 15%, bạn nhận 85%" theo tier hiện tại + price nhập.
- US5.2: CourseEditor sidebar hiện "X / Y chương đã dùng". Khi đạt Y, nút "Thêm chương" disable + tooltip i18n.
- US5.3: Nếu lén bypass UI gọi insert → DB trigger raise.

### P6 — Learner mua course
- US6.1: Click Purchase → RPC `create_order_with_fee_snapshot` ghi đơn với `platform_fee_pct`, `platform_fee_amount`, `creator_payout_amount` snapshot từ tier hiện tại của creator.
- US6.2: Free course (price=0) → snapshot 0/0/0, instant active enrollment.

## 5. Functional Requirements

### 5.1 Account tier model

| Field | Loại | Mô tả |
|-------|------|-------|
| `account_tiers.code` | text PK | `individual`, `business`, `athlete`, `training_center` |
| `account_tiers.name_vi` | text | Hiển thị Vietnamese |
| `account_tiers.platform_fee_pct` | numeric(5,2) | 0–100, áp dụng floor |
| `account_tiers.max_chapters_per_course` | int >0 | Hard limit |
| `account_tiers.is_enterprise` | bool | UI groupings |
| `account_tiers.requires_approval` | bool | Hiện tại = true cho tất cả |
| `account_tiers.display_order` | int | Sort UI |

`users.account_tier_id` (text NOT NULL DEFAULT `'individual'`) FK → `account_tiers.code`.

**Constraint**: trigger BEFORE INSERT/UPDATE trên `users` raise nếu `role='admin' AND account_tier_id != 'individual'`.

### 5.2 Application model

`account_applications` (rename từ `creator_applications`):

| Field | Loại | Mô tả |
|-------|------|-------|
| `id` | uuid PK | |
| `user_id` | uuid FK users | |
| `requested_tier_code` | text FK account_tiers | NOT NULL DEFAULT `'individual'` |
| `status` | text | `pending` / `approved` / `rejected` / `superseded` |
| `motivation`, `experience`, `sample_url` | text nullable | Common fields, optional cho mọi tier |
| `metadata` | jsonb NOT NULL DEFAULT `'{}'` | Tier-specific fields |
| `rejection_reason` | text nullable | |
| `created_at`, `decided_at` | timestamptz | |

**Required tier-specific fields (validated client + RPC)**:
- `individual`: không bắt field nào (rủi ro spam ghi nhận, phòng chống ở Phase sau)
- `business`: `metadata.business_name`, `metadata.business_registration_no`
- `athlete`: `metadata.federation_or_team`
- `training_center`: `metadata.center_address`, `metadata.center_size` (int)

### 5.3 Submit application logic

RPC `submit_account_application(payload jsonb)`:
1. Lock user row.
2. Nếu user đã có application với `status='pending'` → set `status='superseded'`, `decided_at=now()`.
3. Insert application mới với `status='pending'`.
4. Return new application id.

### 5.4 Approve/reject

RPC `approve_account_application(app_id uuid)`:
1. Validate caller có `role='admin'`.
2. Lock application row + user row.
3. Validate user.role ≠ admin (admin không qua flow này).
4. Validate downgrade không vi phạm: cho mỗi course do user sở hữu, đếm chapters ≤ tier mới `max_chapters_per_course`. Nếu vi phạm → raise `tier_downgrade_violates_chapter_limit`.
5. Nếu user.role = `learner`: set `role='creator'`, `account_tier_id = requested_tier_code`.
6. Nếu user.role = `creator`: chỉ đổi `account_tier_id`.
7. Set `application.status='approved'`, `decided_at=now()`.

RPC `reject_account_application(app_id uuid, reason text)` — chỉ đổi status + reason.

### 5.5 Direct admin tier change

RPC `change_user_account_tier(user_id uuid, new_tier text)`:
- Validate caller là admin, target không phải admin.
- Cùng downgrade-violation check như §5.4.4.
- Update `users.account_tier_id`.

### 5.6 Chapter limit enforcement

Trigger BEFORE INSERT trên `chapters`:
1. SELECT creator_id từ `courses` join `users.account_tier_id` join `account_tiers.max_chapters_per_course`.
2. SELECT count(*) FROM `chapters` WHERE `course_id = NEW.course_id`.
3. Nếu count ≥ max → raise `chapter_limit_exceeded`.

UI counter trong `CourseEditorPage` đọc tier qua `useAccountTiers()` + AuthContext, hiển thị `X/Y chương` và disable nút "Thêm chương" tại Y.

### 5.7 Order fee snapshot

`orders` thêm cột:

| Field | Loại |
|-------|------|
| `platform_fee_pct` | numeric(5,2) NOT NULL DEFAULT 0 |
| `platform_fee_amount` | int NOT NULL DEFAULT 0 |
| `creator_payout_amount` | int NOT NULL DEFAULT 0 |
| `account_tier_code` | text FK account_tiers nullable |

RPC `create_order_with_fee_snapshot(course_id uuid)`:
1. Lock course row, đọc `price`, `creator_id`.
2. Đọc creator's `account_tier_id` → tier `platform_fee_pct`.
3. Nếu price = 0: snapshot 0/0/0, tier_code vẫn lưu.
4. Nếu price > 0: `fee = floor(price * pct / 100)`, `payout = price - fee`.
5. Insert order `pending` (paid course) hoặc `active` (free course, đồng thời insert enrollment).
6. Return order row.

Client không insert `orders` trực tiếp nữa.

### 5.8 Combined signup form (Issue #80 generalized)

Route `/become-creator` (canonical) + alias `/register-business?tier={business|athlete|training_center}`.

**Anon path**:
- Tier selector (4 cards) ở đầu, click → đổi state.
- Auth section: name, email, password.
- Common section: motivation, experience, sample_url (đều optional).
- Tier-specific section: render fields theo tier đang chọn, required validation tương ứng.
- Submit:
  1. Client validate auth + tier-specific.
  2. `localStorage.setItem('pendingAccountApplication', { requested_tier_code, motivation, experience, sample_url, metadata })`.
  3. Nếu tier=`business` → `users.name` sẽ được auto-set = `metadata.business_name` ở bước application submit (decision E-15).
  4. `supabase.auth.signUp({ email, password, options: { data: { name } } })`.
  5. Redirect `/check-email`.

**Authenticated path**:
- Đã có application pending: hiện pending card, không render form.
- Đã là creator + tier=individual: render form không có auth section, ghi đè business_name vào users.name nếu tier business được chọn (call `updateProfile`).
- Đã là creator + tier ≠ individual: hiện "Đã là enterprise creator" panel.
- Mount với localStorage có pending payload + chưa có application: auto-submit qua `submit_account_application`, clear localStorage, hiện pending card.

**Login flow**:
- `LoginPage` post-login: nếu `localStorage.pendingAccountApplication` tồn tại → redirect `/become-creator`.

### 5.9 Admin UI

- `AdminApplicationsPage`: cột "Tier yêu cầu" badge; detail dialog render `metadata` keys-values theo tier.
- `AdminUsersPage`: cột "Tier" badge; nút "Đổi tier" mở dialog (ẩn cho admin); dialog list tier từ `useAccountTiers`; submit gọi `change_user_account_tier`; error `tier_downgrade_violates_chapter_limit` show i18n message với tên course vi phạm.

## 6. Non-functional Requirements

- Mọi RPC trong này dùng `SECURITY DEFINER` với explicit role check.
- Không thêm round-trip: `useAccountTiers` cache 1 lần per session (tiers ít đổi).
- Public RLS read trên `account_tiers` cho phép anon load tier list trước khi đăng nhập (no leak vì đây là marketing info).
- Tất cả string mới dùng i18n key (CLAUDE.md D-02).
- Form mobile-friendly (CLAUDE.md §13).

## 7. Data Migration

Migrations mới (số tiếp theo):
- `018_account_tiers.sql`
- `019_users_account_tier.sql`
- `020_chapter_limit_trigger.sql`
- `021_orders_fee_snapshot.sql`
- `022_account_applications.sql`

**Existing data**:
- Mọi user hiện có → set `account_tier_id='individual'` (mặc định cột).
- Bảng `creator_applications` → rename `account_applications`, default `requested_tier_code='individual'` cho row cũ.
- Mọi order hiện có → set fee/payout = 0 (chưa có tier infra trước đây), `account_tier_code=NULL`.

Vì repo chưa có production data (CLAUDE.md "chưa có người dùng"), không cần backfill phức tạp.

## 8. Edge cases

| # | Tình huống | Behavior |
|---|------------|----------|
| EC1 | Anon submit → email trùng | Server error, KHÔNG clear localStorage (cho retry, theo #80) |
| EC2 | Anon submit → không verify email, signup lại email khác | localStorage clobbered bởi signup mới — acceptable |
| EC3 | User login với pending localStorage + đã có application pending DB | Bỏ qua localStorage, clear, hiện pending card |
| EC4 | Creator individual → nộp business → admin reject | Status=rejected, user vẫn role=creator + tier=individual |
| EC5 | Admin downgrade tier có course vi phạm | RPC raise; admin UI hiện toast với danh sách course vi phạm |
| EC6 | 2 admin cùng approve 1 application | Row lock; admin thứ 2 thấy "already decided" |
| EC7 | Chapter limit boundary: course có 9/10, user submit chapter thứ 10 | OK (count < max, sau insert count = max) |
| EC8 | Free course tier business | Snapshot 0/0/0 dù tier có pct=15% |
| EC9 | Admin tự đổi role từ admin → learner cho mình | Out of scope; không có UI cho action này |
| EC10 | RPC approve gặp user.role=admin (data corruption) | Raise lỗi rõ ràng |

## 9. Acceptance Criteria

### Functional
- [ ] 4 tier có trong DB sau migration; admin select tier dropdown thấy đủ 4.
- [ ] Anon `/become-creator` thấy tier selector + form combined; chọn business → thấy field business_name/registration_no required.
- [ ] Submit anon thành công → `/check-email`; sau verify + login → application tự nộp, hiện pending.
- [ ] Submit application lần 2 trong khi pending → application 1 chuyển `superseded`, application 2 là `pending`.
- [ ] Approve application chuyển user role+tier đúng theo logic §5.4.
- [ ] Reject yêu cầu reason; user.role/tier không đổi.
- [ ] AdminUsers ẩn nút "Đổi tier" cho admin.
- [ ] Trigger DB raise khi chapter vượt limit; UI counter hiển thị đúng + disable nút.
- [ ] Order tạo qua RPC có 4 cột snapshot điền đúng theo công thức floor.
- [ ] Free course → order snapshot 0/0/0 + auto-active enrollment.

### i18n
- [ ] Không có hardcoded string trong file mới.
- [ ] Tất cả key tier/application/error có trong `vi.json`.

### Tests
- [ ] Unit: `computeFeeFloor` cho biên 0 / không chia hết / pct=100 / pct=0.
- [ ] Unit: `pendingAccountApplication` save/get/clear.
- [ ] SQL test: chapter limit trigger reject khi vượt.
- [ ] SQL test: order RPC snapshot đúng floor.
- [ ] SQL test: tier downgrade block khi vi phạm.

### Documentation
- [ ] ADR-0002 viết.
- [ ] CLAUDE.md §4/§5/§7 cập nhật.
- [ ] Issue #80 closed bởi PR ship combined form.

## 10. Rollout

Theo §"Rollout" của plan đã chốt:
1. ADR + CLAUDE.md
2. Migration 018+019 + admin-lock trigger
3. TS types + AuthContext + `useAccountTiers`
4. Migration 020 + chapter counter UI
5. Migration 021 + đổi orderApi sang RPC + fee preview UI
6. Migration 022 + accountApplicationApi
7. Refactor `pendingAccountApplication` + BecomeCreatorPage combined + LoginPage redirect (close #80)
8. AdminApplicationsPage + AdminUsersPage updates
9. i18n + tests + polish

Mỗi bước commit riêng, build pass.

## 11. Open Questions / Risks

- **Spam application**: tier individual không bắt field nào → admin có thể bị ngập đơn. Mitigation: thêm rate-limit (1 đơn / user / 24h) khi cần — Phase sau.
- **Placeholder fee/limit**: cần BizDev xác nhận con số chính thức trước public launch.
- **Multi-org Phase 2**: nếu sau này 1 business có nhiều coach, schema phải refactor sang `organizations` table — design hiện tại không cản trở (account_tier ở users level OK).
- **Tier change UX cho creator**: chưa có entry point trong settings; user phải biết URL `/become-creator`. Có thể thêm CTA "Nâng cấp lên Doanh nghiệp" trong dashboard creator nếu tier=individual — đề xuất ship trong cùng PR.

---

> **Sign-off**: Khi PRD này được merge cùng ADR-0002, plan trở thành nguồn duy nhất cho implementation. Mọi thay đổi sau đó cần PR riêng cập nhật cả 2 file.
