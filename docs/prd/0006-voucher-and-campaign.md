# PRD-0006: Voucher Code + Auto-Campaign Discount System

> Status: Locked · Owner: @haunguyen1064 · Created: 2026-05-20 · Branch: `claude/add-voucher-campaign-system-yeICM`
> Phase: **Phase 2 (extension of PayOS auto-payment)** — builds on PRD-0001 (tier fee snapshot), PRD-0002 (manual QR payment flow), and PRD-0005 (PayOS automation + manual creator payout).
> Lifts: PRD-0002 non-goal §3 "❌ Coupon / discount code".

---

## 1. Background & Problem

PRD-0002 đã hoàn thiện chân **Purchase** của core loop (Create → Review → Purchase → Learn) với manual QR payment. Tuy nhiên kênh marketing và acquisition đang thiếu hai công cụ phổ biến:

- **Voucher code** — mã giảm giá nhập tay, learner phải biết code để dùng. Phù hợp cho ambassador campaign, partner referral, voucher VIP gửi qua email.
- **Campaign (auto-apply)** — chương trình khuyến mại tự động áp lên toàn bộ hoặc một tập courses, không cần code. Phù hợp cho Black Friday, Tết Sale, ra mắt khoá mới.

Không có 2 thứ này, Admin BizDev không có công cụ kích cầu mềm trong Phase 2. Issue #51 (payout KPI) và analytics Phase 2 cần dữ liệu conversion với discount để hiệu chỉnh fee rates.

PRD này lift non-goal PRD-0002 §3 và mở rộng schema `orders` + RPC `create_order_with_fee_snapshot` để hỗ trợ stacking discount.

## 2. Goals

- **G1.** Admin tạo voucher (manual code) qua trang `/admin/vouchers` với CRUD đầy đủ: code, discount, quota, per-user limit, applicable courses, date range.
- **G2.** Admin tạo campaign (auto-apply, không code) qua trang `/admin/campaigns`. Chỉ **1 campaign hoạt động tại 1 thời điểm** trên toàn platform (enforce ở DB layer).
- **G3.** Course detail page tự động hiện campaign price (strikethrough giá gốc + giá campaign) khi có campaign active match course.
- **G4.** Learner vào `/confirm-purchase/:courseId` (route mới, đứng trước `/checkout/:orderId` đã có) để nhập voucher code và xem breakdown chi tiết trước khi xác nhận tạo order.
- **G5.** Voucher + campaign stack: campaign áp trước, voucher áp sau (floor sequential). Final price = 0 → tái sử dụng D-05 free path.
- **G6.** Chi phí discount chia **pro-rata theo share**: creator và platform cùng gánh theo tỷ lệ tier fee. Không bên nào âm.
- **G7.** Snapshot toàn bộ giá + discount vào `orders` tại thời điểm tạo. Edit voucher/campaign sau đó không ảnh hưởng order đã tạo.
- **G8.** Quota voucher trừ tại order create, hoàn lại + xoá voucher_usage khi `cancel_order` HOẶC `expire_stale_orders` (pg_cron 24h, PRD-0005 §5.5). Per_user_limit chính xác sau khi order rời trạng thái pending/active.

## 3. Non-goals (Phase 2 voucher scope)

- ❌ Creator tự tạo voucher cho khoá của mình (Phase 3 cân nhắc).
- ❌ Bulk voucher code generation (`TET2026-XXXX` style). Admin nhập tay từng code.
- ❌ Voucher giảm theo `min_order_amount` threshold.
- ❌ Voucher giới hạn theo user segment (`new_user` only). Admin dùng `applicable_courses` để target.
- ❌ Cost-bearer chuyển sang creator hoặc platform riêng lẻ (`platform`, `creator` modes). Phase 2 chỉ shared_proportional.
- ❌ Auto-expiry (pg_cron) cho voucher hết hạn. Voucher đã expire chỉ bị block tại RPC, không xoá data. (Lưu ý: ORDER auto-expiry đã có sẵn nhờ PRD-0005 §5.5 — pg_cron `expire_stale_orders` chạy mỗi 30 phút, status pending → expired sau 24h.)
- ❌ Voucher referral (1 user tạo code cho người khác dùng).
- ❌ Multi-stack voucher (nhiều code cùng lúc trên 1 order). Mỗi order chỉ 1 voucher.
- ❌ A/B testing campaign hiệu quả.
- ❌ Email notification khi voucher sắp hết hạn / khi áp voucher thành công (theo D-14 defer).

## 4. Personas & User Stories

### P1 — Learner mua course với campaign auto-apply

- **US1.1**: Trên course detail page (price > 0, chưa enroll), thấy giá gốc strikethrough + giá campaign + label `Khuyến mại: {tên campaign}` nếu campaign hiện hành match course (`applicable_courses` null hoặc chứa course id).
- **US1.2**: Click `Mua khoá học` → redirect `/confirm-purchase/:courseId` (KHÔNG còn gọi `create_order_with_fee_snapshot` trực tiếp).
- **US1.3**: Tại confirm-purchase page thấy breakdown: giá gốc, discount campaign, tạm tính. Có ô "Nhập mã giảm giá" (placeholder ví dụ "WELCOME10").
- **US1.4**: Click `Đặt mua ngay` → gọi RPC `create_order_with_fee_snapshot(course_id, NULL)` (no voucher) → redirect `/checkout/:orderId` QR như flow PRD-0002.

### P2 — Learner mua với voucher code

- **US2.1**: Tại `/confirm-purchase/:courseId`, nhập code `WELCOME10` → bấm `Áp dụng`.
- **US2.2**: Client normalize uppercase trim, gọi RPC `preview_purchase(course_id, "WELCOME10")` → response có voucher_id, voucher_discount_amount, final_price.
- **US2.3**: UI cập nhật breakdown: campaign discount + voucher discount + final. Hiện banner success `Đã áp dụng mã WELCOME10 · giảm 50.000₫`.
- **US2.4**: Code invalid/expired/no-quota → toast lỗi với i18n key cụ thể (`voucher.error.notFound`, `voucher.error.expired`, `voucher.error.quotaExceeded`, `voucher.error.userLimitReached`, `voucher.error.courseNotEligible`).
- **US2.5**: Click `Đặt mua ngay` → RPC `create_order_with_fee_snapshot(course_id, "WELCOME10")` → atomic re-validate + insert order + insert voucher_usages + UPDATE vouchers.total_uses + redirect `/checkout/:orderId`.

### P3 — Learner stacking voucher trên campaign

- **US3.1**: Course 1tr, campaign -20% active, learner nhập voucher -10%.
- **US3.2**: Breakdown:
  ```
  Giá gốc:                    1.000.000₫
  Khuyến mại (Campaign -20%):  -200.000₫
  Tạm tính:                     800.000₫
  Mã giảm giá WELCOME10 (-10%): -80.000₫
  Tổng thanh toán:              720.000₫
  ```
- **US3.3**: Click `Đặt mua` → order created với `original_price=1000000, campaign_discount=200000, voucher_discount=80000, amount=720000`.

### P4 — Learner cancel pending order có voucher

- **US4.1**: Tại `/account/orders`, đơn pending có voucher → bấm `Huỷ đơn` → confirm dialog → RPC `cancel_order(id, "Người dùng huỷ")`.
- **US4.2**: RPC atomic: status='cancelled', voucher_usages.DELETE, vouchers.total_uses--.
- **US4.3**: Learner có thể tạo đơn mới với cùng voucher (nếu per_user_limit cho phép và còn quota).

### P5 — Admin tạo campaign

- **US5.1**: Vào `/admin/campaigns`, click `Tạo chiến dịch mới`.
- **US5.2**: Form: tên (max 100), mô tả, loại discount (percentage | fixed_amount), giá trị, cap (optional, chỉ cho percentage), radio "Toàn bộ khoá / Chỉ một số khoá", multi-select course với search, ngày bắt đầu, ngày kết thúc.
- **US5.3**: Submit → RPC `create_campaign(...)` validate exclusion constraint. Nếu thời gian overlap với campaign khác đang active → raise `campaign_overlap_with_existing` → UI báo "Khoảng thời gian này đã có chiến dịch khác. Hãy kết thúc chiến dịch hiện tại trước hoặc chọn ngày khác."
- **US5.4**: List campaigns hiển thị: tên, discount, scope (toàn bộ / N khoá), ngày, trạng thái (active/inactive), số đơn đã áp dụng (count từ orders.campaign_id).
- **US5.5**: Action: edit (chỉ field non-critical sau khi đã có order), deactivate (set is_active=false → giải phóng exclusion slot), delete (chỉ nếu chưa có order nào).

### P6 — Admin tạo voucher

- **US6.1**: Vào `/admin/vouchers`, click `Tạo voucher mới`.
- **US6.2**: Form: code (regex `^[A-Z0-9]{6,20}$`, auto-uppercase, unique check), loại discount, giá trị, cap (optional), radio applicable_courses, total quota, per-user limit, dates, campaign liên kết (optional FK).
- **US6.3**: Submit → RPC `create_voucher(...)` validate code unique + format.
- **US6.4**: List vouchers: code (mono), discount, quota usage (`12/100`), per-user limit, dates, status. Action: edit (limited fields), deactivate, delete (chỉ nếu total_uses=0).
- **US6.5**: Click vào row → drawer/detail xem `voucher_usages`: ai dùng, đơn nào, ngày, discount amount.

## 5. Functional Requirements

### 5.1 Schema additions

> Migration numbering: highest hiện tại = 063 (PRD-0005 PayOS). Voucher migrations dùng 064-068.

**Migration 064 — `campaigns` table**

```sql
CREATE TABLE public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  description text CHECK (description IS NULL OR length(description) <= 500),
  discount_type text NOT NULL CHECK (discount_type IN ('percentage','fixed_amount')),
  discount_value integer NOT NULL CHECK (discount_value > 0),
  max_discount_amount integer CHECK (max_discount_amount IS NULL OR max_discount_amount > 0),
  applicable_courses jsonb,  -- jsonb array of course id strings, NULL = all courses
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (discount_type = 'fixed_amount' OR discount_value <= 100)
);

CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_no_overlap
  EXCLUDE USING gist (tstzrange(starts_at, ends_at, '[]') WITH &&)
  WHERE (is_active = true);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaigns_select_active ON public.campaigns
  FOR SELECT TO authenticated, anon
  USING (is_active = true AND now() BETWEEN starts_at AND ends_at);

CREATE POLICY campaigns_admin_all ON public.campaigns
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
```

**Migration 065 — `vouchers` table**

```sql
CREATE TABLE public.vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{6,20}$'),
  discount_type text NOT NULL CHECK (discount_type IN ('percentage','fixed_amount')),
  discount_value integer NOT NULL CHECK (discount_value > 0),
  max_discount_amount integer CHECK (max_discount_amount IS NULL OR max_discount_amount > 0),
  applicable_courses jsonb,
  total_quota integer NOT NULL CHECK (total_quota > 0),
  total_uses integer NOT NULL DEFAULT 0 CHECK (total_uses >= 0),
  per_user_limit integer NOT NULL DEFAULT 1 CHECK (per_user_limit > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (total_uses <= total_quota),
  CHECK (discount_type = 'fixed_amount' OR discount_value <= 100)
);

ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;

-- NO public SELECT — voucher codes là bí mật, discovery chỉ qua RPC.
CREATE POLICY vouchers_admin_all ON public.vouchers
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
```

**Migration 066 — `voucher_usages` table**

```sql
CREATE TABLE public.voucher_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid NOT NULL REFERENCES public.vouchers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  discount_amount integer NOT NULL CHECK (discount_amount > 0),
  used_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (voucher_id, order_id)
);
CREATE INDEX idx_voucher_usages_voucher_user
  ON public.voucher_usages (voucher_id, user_id);

ALTER TABLE public.voucher_usages ENABLE ROW LEVEL SECURITY;
CREATE POLICY usages_select_own ON public.voucher_usages
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );
```

**Migration 067 — extend `orders`**

```sql
ALTER TABLE public.orders
  ADD COLUMN original_price integer NOT NULL DEFAULT 0,
  ADD COLUMN campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  ADD COLUMN campaign_discount_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN voucher_id uuid REFERENCES public.vouchers(id) ON DELETE SET NULL,
  ADD COLUMN voucher_code text,
  ADD COLUMN voucher_discount_amount integer NOT NULL DEFAULT 0;

-- Backfill original_price for existing rows
UPDATE public.orders o
  SET original_price = c.price
  FROM public.courses c
  WHERE o.course_id = c.id AND o.original_price = 0;

-- amount keeps semantics = final price paid by learner.
```

### 5.2 RPCs

**Migration 068 — RPC updates**

```sql
-- preview_purchase: READ-only, dùng cho confirm-purchase page
CREATE OR REPLACE FUNCTION public.preview_purchase(
  p_course_id uuid,
  p_voucher_code text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
-- Returns: {
--   original_price, campaign_id, campaign_name, campaign_discount_amount,
--   voucher_id, voucher_code, voucher_discount_amount,
--   final_price, platform_fee_pct, platform_fee_amount, creator_payout_amount
-- }
-- Raises voucher_* errcode nếu code invalid.
$$;
```

```sql
-- create_order_with_fee_snapshot: UPDATE signature
DROP FUNCTION public.create_order_with_fee_snapshot(uuid);
CREATE OR REPLACE FUNCTION public.create_order_with_fee_snapshot(
  p_course_id uuid,
  p_voucher_code text DEFAULT NULL
) RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER AS $$
-- Atomic transaction:
-- 1. Lock voucher row FOR UPDATE (nếu p_voucher_code != NULL)
-- 2. Re-validate voucher (active, in range, quota, per_user_limit, course eligible)
-- 3. Resolve current campaign (max 1 active match course)
-- 4. Compute discounts với pro-rata cost split
-- 5. INSERT order với snapshot đầy đủ
-- 6. INSERT voucher_usages (nếu có voucher)
-- 7. UPDATE vouchers SET total_uses = total_uses + 1
-- 8. INSERT enrollment nếu final_price = 0 (free path D-05)
-- Raises:
--   duplicate_pending_order (errcode 22023)
--   voucher_not_found / voucher_expired / voucher_inactive
--   voucher_quota_exceeded / voucher_user_limit
--   voucher_course_not_eligible
$$;
```

```sql
-- cancel_order: ADD quota return logic
CREATE OR REPLACE FUNCTION public.cancel_order(
  p_order_id uuid,
  p_reason text
) RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER AS $$
-- Existing logic (status, reason, enrollment cleanup)...
-- ADD voucher quota return block:
--   IF v_order.voucher_id IS NOT NULL THEN
--     UPDATE vouchers SET total_uses = total_uses - 1
--       WHERE id = v_order.voucher_id AND total_uses > 0;
--     DELETE FROM voucher_usages WHERE order_id = p_order_id;
--   END IF;
$$;

-- expire_stale_orders: ADD voucher quota return for each expired order
CREATE OR REPLACE FUNCTION public.expire_stale_orders()
RETURNS integer
LANGUAGE plpgsql AS $$
-- Existing logic (UPDATE orders SET status='expired' WHERE created_at < now() - 24h).
-- REWRITE để chạy theo CTE, returning expired rows + voucher_id:
--   WITH expired AS (
--     UPDATE orders SET status='expired', expired_at=now()
--     WHERE status='pending' AND created_at < now() - interval '24 hours'
--     RETURNING id, voucher_id
--   ),
--   refund_quota AS (
--     UPDATE vouchers v SET total_uses = v.total_uses - 1
--     FROM expired e
--     WHERE v.id = e.voucher_id AND v.total_uses > 0
--     RETURNING v.id
--   ),
--   refund_usages AS (
--     DELETE FROM voucher_usages u USING expired e
--     WHERE u.order_id = e.id
--   )
--   SELECT COUNT(*) FROM expired;
$$;
```

> **KHÔNG hook vào `mark_order_refunded`.** Refund_pending chỉ đạt được sau khi `cancel_order` đã chuyển order về `cancelled` (D9b: PayOS bù trừ sau khi user cancel) — voucher quota đã hoàn ngay tại bước cancel rồi. `mark_order_refunded` chỉ xử lý bank reconciliation, không cần touch voucher.

### 5.3 Stacking + pro-rata formula

```
campaign_discount = applyDiscount(original_price, campaign)
intermediate      = original_price - campaign_discount
voucher_discount  = applyDiscount(intermediate, voucher)
final_price       = max(intermediate - voucher_discount, 0)

creator_payout    = floor(final_price * (100 - platform_fee_pct) / 100)
platform_fee_amount = final_price - creator_payout
```

Trong đó `applyDiscount(price, d)`:
- `percentage`: `min(floor(price * d.value / 100), COALESCE(d.max_discount_amount, infinity))`
- `fixed_amount`: `min(d.value, price)`

Lý do pro-rata: xem ADR-0007.

### 5.4 `/confirm-purchase/:courseId` page

- Auth required. Redirect `/login?redirect=/confirm-purchase/:courseId` nếu chưa login.
- 404 nếu course không tồn tại hoặc không published.
- Nếu user đã có pending order cho course này → redirect `/checkout/:existing_id` (giữ pattern PRD-0002).
- Nếu user đã enrolled → redirect `/learn/:courseId`.
- Layout:
  - Header: course title + creator.
  - **Order summary card** (left): course thumbnail, title.
  - **Breakdown card** (right):
    - Giá gốc
    - Khuyến mại (nếu campaign active match course)
    - Mã giảm giá (input field + Áp dụng button + clear button)
    - Tổng thanh toán (big, primary color)
    - Note nhỏ: chi tiết phí (collapsible) hiển thị creator payout + platform fee.
  - **Action**: `Đặt mua ngay` (btn-accent btn-lg) + ghost link `Quay lại`.
- Mount: gọi `preview_purchase(course_id, null)` → render breakdown.
- Voucher apply: client normalize `code.toUpperCase().trim()` → gọi `preview_purchase(course_id, code)` → update breakdown hoặc show error toast.
- Submit: gọi `create_order_with_fee_snapshot(course_id, applied_voucher_code)`. Nếu raise `duplicate_pending_order` → fetch existing → redirect. Else redirect `/checkout/:new_id`.
- Free path: nếu `final_price = 0` (sau stacking), RPC tự tạo enrollment + status=active → redirect thẳng `/learn/:courseId` với toast "Đã nhận khoá học miễn phí".

### 5.5 Course detail integration

Modify `CourseDetailPage.tsx`:

- Fetch active campaign cho course này (RLS đã filter chỉ trả về campaign active + in range).
- Render giá:
  - Nếu campaign null: giá thường.
  - Nếu campaign match: strikethrough giá gốc + giá sau campaign + badge `Khuyến mại`.
- Button `Mua khoá học` → navigate `/confirm-purchase/:courseId` (không gọi RPC trực tiếp như trước).
- Banner pending order: giữ nguyên flow PRD-0002.

### 5.6 `/admin/campaigns` page

- Auth: role='admin'.
- List (table): tên, discount, scope (`Toàn bộ` hoặc `N khoá`), starts_at-ends_at, status (active/inactive badge), orders_count (count từ join orders), actions.
- Filter: status (all/active/inactive), search by name.
- Top-right: `Tạo chiến dịch mới` button.
- Form modal (create + edit shared):
  - `name` (text, required, max 100)
  - `description` (textarea, optional, max 500)
  - `discount_type` (radio: Phần trăm / Số tiền cố định)
  - `discount_value` (number, required, ≥1; nếu percentage thì ≤ 100)
  - `max_discount_amount` (number, optional, chỉ hiện khi discount_type = percentage)
  - `applicable_courses`: radio `Toàn bộ khoá` / `Chỉ một số khoá`. Khi chọn "Chỉ một số" → multi-select component có search (component `CourseMultiSelect`).
  - `starts_at`, `ends_at` (datetime-local pickers).
  - `is_active` (toggle, default true).
- Submit → RPC `create_campaign` hoặc `update_campaign`. Nếu raise `campaign_overlap_with_existing` → toast lỗi inline.
- Detail drawer: click row → drawer hiển thị stats (orders_count, total_discount_amount, conversion timeline).

### 5.7 `/admin/vouchers` page

Tương tự `/admin/campaigns` với các điểm khác biệt:

- List columns: code (mono), discount, quota usage (`12/100` + progress bar), per_user_limit, dates, status, actions.
- Form fields thêm:
  - `code` (text, required, regex `^[A-Z0-9]{6,20}$`, uppercase auto, unique check qua RPC).
  - `total_quota` (number, required, ≥1).
  - `per_user_limit` (number, required, ≥1, default 1).
  - `campaign_id` (optional FK select — dropdown danh sách campaign hiện có).
- Detail drawer: bảng `voucher_usages` (ai dùng, khi nào, giảm bao nhiêu, order code) + chart đơn giản usage over time (defer Phase 3 nếu phức tạp).
- Action: delete chỉ enable nếu `total_uses = 0`; edit code chỉ cho phép nếu `total_uses = 0`.

### 5.8 `/admin/orders` page extension

Thêm 2 cột vào bảng order detail:
- `Voucher`: voucher_code (mono) hoặc `—`.
- `Khuyến mại`: tên campaign hoặc `—`.

Thêm field vào detail drawer:
- Original price
- Campaign discount amount + tên campaign
- Voucher discount amount + code
- Final price (= amount)

### 5.9 i18n

Thêm 2 top-level namespaces vào `src/locales/vi.json`:

```
voucher: {
  label, placeholder, apply, applied, remove,
  error: { notFound, expired, inactive, quotaExceeded, userLimitReached, courseNotEligible, invalidFormat },
  ...
}

campaign: {
  banner, name, discountLabel, ...
}
```

Các trang admin dùng namespace mới `admin.campaigns.*` và `admin.vouchers.*`.

## 6. Non-functional Requirements

- **Atomicity**: create_order_with_fee_snapshot toàn bộ trong 1 transaction. Nếu RPC fail giữa chừng → rollback. Voucher quota + voucher_usages + order phải nhất quán.
- **Race condition**: 2 learner nhập cùng voucher gần đồng thời khi còn 1 quota cuối → row lock FOR UPDATE trên vouchers row đảm bảo chỉ 1 thắng. Người thua nhận `voucher_quota_exceeded`.
- **Campaign overlap**: enforce ở DB layer bằng exclusion constraint. 2 admin tạo campaign overlap đồng thời → chỉ 1 thắng, người thua nhận lỗi.
- **Final price floor**: max(0, ...) sau stacking. Free path tái sử dụng D-05.
- **Page load**: confirm-purchase page < 1.5s (1 RPC call preview_purchase).
- **Voucher code normalization**: client + RPC đều uppercase trim trước khi so sánh — tránh case sensitivity bug.
- **Idempotency**: preview_purchase là read-only, có thể gọi lặp lại bao nhiêu lần cũng được.
- **Snapshot**: order data 6 fields mới đều immutable sau khi insert. Edit voucher discount sau đó không thay đổi order amount.

## 7. Telemetry / Analytics

Log qua console.info + Supabase logs (chưa có analytics chính thức):

- `voucher.applied` — courseId, voucherCode (last 4 chars), discountAmount
- `voucher.rejected` — courseId, voucherCode (last 4 chars), errcode
- `campaign.applied` — courseId, campaignId, discountAmount
- `order.created.with_discount` — orderId, originalPrice, totalDiscount, finalPrice

Mục tiêu đo: conversion rate với voucher vs without, top voucher codes used, avg discount per order.

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Admin tạo voucher discount quá to → creator âm payout | Creator complain | Pro-rata cost split đảm bảo creator không bao giờ âm. Admin UI hiện preview "Creator nhận: X₫" trên form. |
| Voucher code dễ đoán (e.g. WELCOME) → user random thử ra | Voucher rò rỉ | Khuyến cáo admin chọn code có suffix năm/random (`WELCOME2026X`, `TET2026A1`). Phase 2 không rate-limit thử code. Phase 3 cân nhắc throttle. |
| User abandon cart với voucher → bí kíp leak quota | Quota giảm vô lý | Đã giải quyết Q4: hoàn quota + xoá usage trên cancel_order. |
| Admin tạo 2 campaign overlap | DB inconsistency | Exclusion constraint chặn atomic. |
| User edit URL `/confirm-purchase/:courseId` cho course free | Trải qua flow không cần thiết | Server-side RPC trả về final_price = 0 → auto-active + redirect, learner không bị block. |
| Voucher edit sau khi có order → order data sai | History rối | Snapshot vào orders đảm bảo immutable. UI admin hiện cảnh báo "Voucher đã có 12 đơn dùng, chỉ sửa được field non-critical." |
| Học viên đã enroll cố vào /confirm-purchase | Redirect loop | Page mount check enrollment → redirect /learn. |
| Free path tạo enrollment cho voucher giảm 100% | Quota bị tính nhưng không có "thanh toán" thật | Acceptable — quota là công cụ marketing cap, không phải accounting. |

## 9. Implementation Plan (slicing)

Chia thành các issues nhỏ track riêng:

1. **Slice A — DB layer**: migrations 064-068 + RPC tests (preview_purchase, create_order_with_fee_snapshot updated, cancel_order updated, expire_stale_orders updated, create_campaign, update_campaign, create_voucher, update_voucher).
2. **Slice B — Confirm purchase page**: `/confirm-purchase/:courseId` + CourseDetailPage integration + voucher input + breakdown + i18n.
3. **Slice C — Admin pages**: `/admin/campaigns` + `/admin/vouchers` + CourseMultiSelect + form modals + detail drawer.
4. **Slice D — Order admin extension**: AdminOrdersPage cột voucher_code + campaign_name + detail drawer extension.
5. **Slice E — E2E test**: full flow Admin tạo voucher → Learner áp dụng → Admin confirm order → enrollment active.

## 10. Acceptance Criteria

- [ ] Migrations 064-068 áp dụng sạch (no destructive change to existing orders).
- [ ] RPC `preview_purchase` đúng pro-rata formula, raise đúng errcode cho mọi case voucher invalid.
- [ ] RPC `create_order_with_fee_snapshot` atomic với voucher + campaign + free path.
- [ ] RPC `cancel_order` hoàn quota + xoá voucher_usages khi order có voucher.
- [ ] RPC `expire_stale_orders` hoàn quota + xoá voucher_usages cho mọi order expired có voucher.
- [ ] Exclusion constraint chặn campaign overlap.
- [ ] `/confirm-purchase/:courseId` hoạt động đầy đủ: preview, voucher apply, breakdown, submit.
- [ ] CourseDetailPage hiện strikethrough + campaign price khi có campaign match.
- [ ] `/admin/campaigns` CRUD đầy đủ với form + multi-select course picker.
- [ ] `/admin/vouchers` CRUD đầy đủ + drawer xem voucher_usages.
- [ ] `/admin/orders` hiện voucher_code + campaign_name.
- [ ] Vietnamese i18n đầy đủ, không hardcode.
- [ ] E2E pass: tạo voucher → áp dụng → tạo order → cancel → voucher quota hoàn lại.

## 11. Decisions (locked 2026-05-20)

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| **V-D1** | Voucher input UI ở đâu? | **Trang mới `/confirm-purchase/:courseId`** | Tách step "preview + apply voucher" khỏi `/checkout/:orderId` để voucher có thể apply TRƯỚC khi order được tạo. Course detail clean. |
| **V-D2** | Quota có hoàn khi order non-active? | **Có, hook vào `cancel_order` + `expire_stale_orders`** | Tránh leakage. Per_user_limit chính xác. Atomic UPDATE + DELETE. Sau merge feature/auto-payment, expire (status=expired) đã có nhờ migration 054. Refund_pending/refunded chỉ đạt qua cancel trước nên không cần hook riêng. |
| **V-D3** | Voucher schema cắt field nào cho MVP? | **Cắt `min_order_amount` + `applicable_user_segment`** | Admin dùng quota + applicable_courses + tiers thay thế. Schema gọn hơn. Phase 3 thêm lại được. |
| **V-D4** | Bao nhiêu campaign active cùng lúc? | **Tối đa 1** | Exclusion constraint tstzrange + btree_gist. Loại bỏ logic auto-pick best. Phù hợp Black Friday / Tết Sale pattern. |
| **V-D5** | Khi stacking làm final = 0? | **Cho phép → free path D-05** | Tái sử dụng RPC sẵn có. Voucher quota vẫn tính. Phù hợp promo VIP. |
| **V-D6** | Voucher code format? | **`^[A-Z0-9]{6,20}$`**, admin nhập tay | Đơn giản, đủ space cho meaningful codes. Bulk generation defer. |
| **V-D7** | Ai tạo voucher/campaign? | **Admin-only, platform-wide** | Phase 1 đủ cho marketing. Creator scope mở rộng Phase 3. |
| **V-D8** | UI applicable_courses picker? | **Radio "Toàn bộ / Chỉ một số" + multi-select có search** | Toggle dẫn dắt ý định. Search bắt buộc khi > 100 courses. |
| **V-D9** | Chi phí discount ai chịu? | **Pro-rata theo share** | Không bên nào âm. Math đơn giản. ADR-0007 trình bày rationale chi tiết. |
| **V-D10** | Snapshot vs live evaluation? | **Snapshot vào orders tại create time** | Edit voucher/campaign sau không ảnh hưởng order cũ. Pattern thống nhất với E-07 (fee snapshot). |
