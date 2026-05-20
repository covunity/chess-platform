# PRD-0002: Manual QR Payment + Admin Order Confirmation

> Status: Locked · Owner: @haunguyen1064 · Created: 2026-05-09 · Branch: `claude/phase-2-setup-eBlkQ`
> Related: Issue #17 (Slice 16), #13 (Slice 12 access control), #19 (Slice 18 history), #71 (dashboard paid follow-up), #51 (payout KPI)
> Phase: **Phase 2 (manual)** — automated payment gateway (PayOS/Stripe) deferred to a later PRD.
> Builds on: PRD-0001 (account tiers + fee snapshot), Migration 021

---

## 1. Background & Problem

Core loop của platform là **Create course → Admin review → Purchase → Learn**. Hiện chân **Purchase** vẫn là khoảng trống:

- Schema `orders` đã có (migration 008 + 021): tier fee snapshot, RPC `create_order_with_fee_snapshot`, free-course auto-enroll. Đây là phần khó nhất và đã xong.
- **Thiếu hoàn toàn UI checkout** — Learner click Purchase trên course detail không dẫn đi đâu.
- **Thiếu Admin order panel** — không có cách để admin xác nhận chuyển khoản.
- **Thiếu Awaiting screen** cho Learner sau khi bấm "Tôi đã chuyển".
- **Thiếu paywall** — Learner không enrol vẫn vào được lesson trả phí (issue #13).

Phase 2 này sẽ ship bản **manual payment**: hiện QR VietQR, Learner chuyển khoản ngoài app, bấm "Đã thanh toán", Admin xác minh trong dashboard và confirm tay. Không tích hợp cổng thanh toán tự động trong scope này.

Lý do chọn manual trước:
- Việt Nam: chuyển khoản ngân hàng + QR là kênh ưu tiên của khách hàng cá nhân, giảm friction so với Stripe.
- Volume Phase 2 dự kiến thấp (đo từ analytics) → admin verify thủ công là chấp nhận được.
- Tránh phụ thuộc cổng thanh toán (KYC, fee, webhook reliability) khi chưa validate revenue.
- Tự động hoá để sau (PRD riêng) khi có volume thực tế.

## 2. Goals

- **G1.** Learner mua course trả phí qua flow QR: order created → QR + bank info hiển thị → Learner chuyển khoản ngoài app → bấm "Đã thanh toán" → màn chờ admin xác minh.
- **G2.** Admin có panel `/admin/orders` để confirm hoặc cancel (kèm lý do) đơn pending.
- **G3.** Khi admin confirm, enrollment được tạo **trong cùng transaction** với việc đổi `order.status = active`, course unlock ngay sau next page load của Learner (đóng vòng với issue #13 paywall).
- **G4.** Free course (price = 0) giữ nguyên flow auto-active — không qua UI checkout.
- **G5.** Có Learner-side purchase history `/account/orders` (ship cùng để tránh "đơn pending biến mất").
- **G6.** Bank account info (số tài khoản, ngân hàng, tên thụ hưởng) cấu hình qua DB `config` table và **chỉnh sửa được trong Admin Settings UI** — đổi không cần deploy, không cần SQL.
- **G7.** Order code unique tuyệt đối (sequence-based, không random collision).

## 3. Non-goals (Phase 2 manual scope)

- ❌ Cổng thanh toán tự động (PayOS, Stripe, MoMo) — PRD riêng sau khi validate volume.
- ❌ Webhook xác minh chuyển khoản tự động.
- ❌ Refund flow (per CLAUDE.md D-18 — vẫn defer).
- ❌ Email "đơn được confirm" (D-14, ship sau khi notification system có).
- ❌ Multi-currency (chỉ VND, integer đồng, không decimal).
- ❌ Coupon / discount code.
- ❌ Bulk-confirm nhiều đơn.
- ❌ SLA tracking (mục tiêu confirm trong 6h chỉ là copy text, không enforce).
- ❌ Rate-limit số đơn pending mỗi user (admin tự xử lý nếu có abuse).

## 4. Personas & User Stories

### P1 — Learner mua course trả phí
- **US1.1**: Trên course detail (price > 0, chưa enroll), bấm `Mua khoá học` → app gọi RPC `create_order_with_fee_snapshot` → redirect `/checkout/:orderId`.
- **US1.2**: Tại `/checkout/:orderId` thấy QR VietQR (220×220), bank info, số tiền chính xác, **mã đơn ORD-YYYY-XXXXXX in mono đậm với nút copy**.
- **US1.3**: Quét QR bằng app ngân hàng, chuyển khoản với note = mã đơn → quay lại app bấm `Tôi đã thanh toán` → redirect `/checkout/:orderId/awaiting`.
- **US1.4**: Tại awaiting page thấy hourglass + "Admin sẽ xác minh trong ~6h". Có CTA "Về trang chủ" và "Xem trong lịch sử đơn".
- **US1.5**: Trong lúc đang pending, thử mở lesson trả phí → bị paywall (issue #13), banner cảnh báo "Đơn đang chờ admin xác minh".

### P2 — Learner đã có order pending (vào lại)
- **US2.1**: Quay lại course detail thấy banner `--warning-soft` "Đơn của bạn đang chờ admin xác minh", CTA xem chi tiết.
- **US2.2**: Vào `/account/orders` thấy đơn pending, có nút "Xem hướng dẫn thanh toán" → quay lại `/checkout/:orderId`.
- **US2.3**: Có thể tự huỷ đơn pending (status → `cancelled`, reason = "Người dùng huỷ"); cùng course có thể tạo đơn mới.

### P3a — Admin cấu hình bank info
- **US3a.1**: Vào `/admin/settings` → tab `Thanh toán` → form 4 fields (Bank short name, Bank BIN, Account number, Account name) prefilled từ `config` table.
- **US3a.2**: Sửa rồi bấm `Lưu` → RPC `update_bank_config` cập nhật `config` rows → toast success → checkout page kế tiếp render QR mới.
- **US3a.3**: Có preview block hiển thị QR mẫu (amount=10000, addInfo="PREVIEW") để admin kiểm tra trước khi save — đảm bảo VietQR build đúng.

### P3 — Admin confirm đơn pending
- **US3.1**: Vào `/admin/orders`, tab `Đơn chờ duyệt (12)` active mặc định. Bảng: code (mono), Learner (avatar+name+email), Course title, Amount, Fee → Payout (nhỏ ink-3 "96k → 384k"), Created (relative), Actions.
- **US3.2**: Click `Xác nhận` (1 click + toast confirm) → RPC `confirm_order(order_id)` → atomic: `status='active'`, `confirmed_at=now()`, INSERT `enrollments` (ON CONFLICT DO NOTHING).
- **US3.3**: Click kebab → `Huỷ đơn` mở dialog yêu cầu lý do (textarea required) → RPC `cancel_order(order_id, reason)` → `status='cancelled'`, `cancelled_at=now()`, `cancelled_reason=text`, `cancelled_by=admin_id`.
- **US3.4**: Tab `Tất cả đơn` xem toàn bộ history với filter status, tìm theo code, theo Learner email.
- **US3.5**: Sidebar admin có badge số đơn pending (giống pattern application).

### P4 — Learner xem lịch sử đơn
- **US4.1**: TopNav avatar dropdown → `Lịch sử đơn hàng` → `/account/orders`.
- **US4.2**: Bảng đầy đủ orders của user, filter pills All/Active/Pending/Cancelled, sort newest first, pagination 20/page.
- **US4.3**: Đơn cancelled có "Xem lý do" inline reveal hiển thị `cancelled_reason` của admin (hoặc "Người dùng huỷ").
- **US4.4**: Free order amount hiển thị "Miễn phí" (xanh `--success`), không hiện "0₫".

## 5. Functional Requirements

### 5.1 Schema additions (Migration 029)

```sql
-- 029_orders_confirm_cancel.sql
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS confirmed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by      uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at      timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by      uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_reason  text;

-- Sequence-based order code (replace random in RPC 021)
CREATE SEQUENCE IF NOT EXISTS public.orders_seq START 1;

-- Bank config (read by checkout page)
INSERT INTO public.config (key, value) VALUES
  ('bank_account_number', '...'),
  ('bank_account_name',   '...'),
  ('bank_bin',            '970422'),  -- VietQR BIN, e.g. MB Bank
  ('bank_short_name',     'MBBANK')
ON CONFLICT (key) DO NOTHING;
```

### 5.2 Sửa RPC `create_order_with_fee_snapshot` — order code unique

```sql
-- Replace random(): risk of collision ~0.001% per order, becomes 1% at 10k orders
v_order_code := 'ORD-' || extract(year FROM now())::text || '-' ||
                lpad(nextval('public.orders_seq')::text, 6, '0');
```

Đồng thời chặn duplicate pending order: nếu đã có `pending` order cho cùng `(user_id, course_id)`, RPC raise `duplicate_pending_order` (UI redirect về order pending hiện tại thay vì tạo mới — tránh user tạo nhiều đơn). Migration `026_order_duplicate_fix.sql` đã có một phần xử lý này; review lại.

### 5.3 RPC `confirm_order(p_order_id uuid)` — Admin only

- SECURITY DEFINER. Check caller `role = 'admin'`, raise nếu không.
- Lock order row FOR UPDATE.
- Reject nếu `status != 'pending'`.
- Update: `status='active'`, `confirmed_at=now()`, `confirmed_by=auth.uid()`.
- INSERT `enrollments(course_id, user_id, order_id)` ON CONFLICT (course_id, user_id) DO NOTHING (idempotent — Learner có thể đã có enrollment cũ).
- Cùng transaction. Return order row updated.

### 5.4 RPC `cancel_order(p_order_id uuid, p_reason text)`

- SECURITY DEFINER. Allow:
  - `role = 'admin'` (any pending/active order — hiếm khi cancel active, nhưng cho phép)
  - Owner cancel **own pending order** (`user_id = auth.uid()` AND `status = 'pending'`)
- `p_reason` required, length ≤ 500.
- Update: `status='cancelled'`, `cancelled_at=now()`, `cancelled_by=auth.uid()`, `cancelled_reason=p_reason`.
- Nếu order đã `active` (admin cancel sau khi confirm) → cũng remove enrollment row (cleanup): cảnh báo trong UI rằng Learner sẽ mất quyền truy cập. Edge case hiếm, có ghi log.

### 5.5 `/checkout/:orderId` page (Learner)

- Auth required. 404 nếu order không thuộc user hiện tại.
- Nếu `status = 'active'` → redirect `/learn/:courseId` (Learner đã được confirm, không cần xem lại QR).
- Nếu `status = 'cancelled'` → redirect `/account/orders` với toast hiện lý do.
- Nếu `status = 'pending'`:
  - **Order summary card** (left): course thumbnail, title, creator, total amount.
  - **QR + transfer card** (right):
    - Build VietQR URL: `https://img.vietqr.io/image/{bank_short_name}-{account_number}-compact.jpg?amount={amount}&addInfo={order_code}&accountName={url-encoded-name}` (theo doc VietQR).
    - Render `<img>` 220×220.
    - Bank details rows: Bank, Account name, Account number (mono, copy button), Amount.
    - Critical note block: "Nội dung chuyển khoản (bắt buộc):" + mã đơn mono + copy.
  - **Action footer**: ghost link "Huỷ đơn" (mở confirm dialog, gọi `cancel_order`), `btn-accent btn-lg` "Tôi đã thanh toán" → navigate `/checkout/:orderId/awaiting`.
- I18n keys: `checkout.title`, `checkout.qr.scanToPay`, `checkout.bank.accountName`, `checkout.note.required`, `checkout.action.iPaid`, `checkout.action.cancelOrder`...

### 5.6 `/checkout/:orderId/awaiting` page

- Auth required, same ownership check.
- Nếu order đã `active` → redirect `/learn/:courseId` (admin đã confirm trong lúc Learner ở trang này — happy path).
- Nếu `cancelled` → redirect `/account/orders`.
- UI: hourglass icon (warm yellow), heading "Đang chờ admin xác minh", body copy ~6h, order details card, CTA "Về trang chủ" + "Xem trong lịch sử".
- Polling: client refetch order status mỗi 30s khi tab focused → auto-redirect khi confirmed.

### 5.7 `/account/orders` page (Learner)

Đã được spec hoá kỹ trong issue #19. Thực hiện theo issue đó. Bổ sung:
- Cancel reason `null` → hiện default theo `cancelled_by`: nếu `cancelled_by = user_id` → "Bạn đã huỷ đơn này", else → "Admin đã huỷ" (kèm reason text).

### 5.8 `/admin/orders` page

- Tabs: `Đơn chờ duyệt (count)` | `Tất cả đơn`.
- Pending tab: bảng theo design issue #17 §Design.
- All-orders tab: thêm filter `status` dropdown, search input theo `code` hoặc Learner email.
- Pagination 20/page.
- Confirm action: 1-click với toast. Cancel action: kebab → dialog reason required.
- Sidebar badge: count đơn pending (cập nhật optimistic sau confirm/cancel).

### 5.9 `/admin/settings` — Bank config UI

Trang admin mới với layout sidebar + tabs nội dung. Phase 2 chỉ có 1 tab `Thanh toán`; thiết kế cho phép thêm tab khác (e.g. `Phí nền tảng`, `Gửi mail`) sau này.

- Auth guard: `role = 'admin'`.
- Tab `Thanh toán` → card chứa form:
  - `bank_short_name` (text, required, e.g. `MBBANK`) — dùng để build VietQR URL slug.
  - `bank_bin` (text 6-digit, required, validate qua regex `^\d{6}$`).
  - `bank_account_number` (text, required, max 20 chars).
  - `bank_account_name` (text, required, uppercase auto, max 100 chars).
- Validate client-side trước submit; RPC validate lại server-side.
- RPC `update_bank_config(p_short_name text, p_bin text, p_account_number text, p_account_name text)`:
  - SECURITY DEFINER, check `role = 'admin'`.
  - UPDATE 4 rows trong `config` table (key = `bank_short_name|bank_bin|bank_account_number|bank_account_name`) trong cùng transaction.
  - Insert nếu key chưa tồn tại (idempotent với migration seed).
- Sau save: toast success + reload preview QR.
- **Preview block**: dưới form hiện QR sample 180×180 với `amount=10000, addInfo='PREVIEW'`, build từ giá trị form đang nhập (live, không cần save). Admin verify QR scan ra đúng tài khoản trước khi save.
- I18n: `admin.settings.payment.bankShortName`, `bankBin`, `accountNumber`, `accountName`, `preview`, `save`, `saved`, `validation.binFormat`...

Đây là tab đơn giản nhất — tránh over-engineering tabs khác trong scope này.

### 5.10 Course detail integration (issue #11 hiện có)

- Khi Learner đã đăng nhập, click `Mua khoá học`:
  - Gọi RPC `create_order_with_fee_snapshot(course_id)`.
  - Nếu RPC raise `duplicate_pending_order` → fetch existing pending order, redirect `/checkout/:existing_id`.
  - Else redirect `/checkout/:new_id`.
- Nếu chưa đăng nhập → redirect `/login?redirect=/courses/:id` (giữ context để mua xong khi quay lại).
- Nếu user đã có pending order cho course này → CTA đổi thành `Tiếp tục thanh toán` (ink-3 secondary), banner warning hiện.
- Nếu user đã có active enrollment → CTA đổi thành `Vào học`.

### 5.11 Paywall + access guard (gộp issue #13)

Bao gồm trong PRD này vì là cặp đôi với purchase: không có paywall thì purchase vô nghĩa.

- Helper `canAccessLesson(user, lesson)` (server-side guard cho RPC fetch lesson):
  - True nếu: `lesson.free_preview = true`, OR active enrollment tồn tại, OR user là admin.
- `/learn/:courseId/:lessonId` route guard:
  - Free preview → ai cũng vào.
  - Paid + not enrolled + có pending order → redirect course detail với banner "đơn đang chờ".
  - Paid + not enrolled + no order → redirect course detail với paywall sheet.
  - Paid + enrolled → full access.
  - Admin → full access + badge "Admin preview · không enrolled" trên player.
- Admin preview mode: bookmark + progress writes silently no-op.

## 6. Non-functional Requirements

- **Atomicity**: confirm = 1 transaction, status update + enrollment insert phải atomic. Nếu enrollment FK fail, status update rollback.
- **Idempotency**: confirm_order trên đơn đã active → no-op (return order). Không double-insert enrollment (ON CONFLICT DO NOTHING).
- **Order code uniqueness**: unique index đã có trên `orders.code`. Sequence-based đảm bảo no collision (vs random hiện tại).
- **Race condition**: 2 admin click confirm cùng lúc → row lock, chỉ 1 thắng.
- **VietQR availability**: nếu `img.vietqr.io` down, fallback hiện text "Quét QR không khả dụng. Vui lòng chuyển khoản theo thông tin dưới đây" (info bank vẫn render). Không block flow.
- **Page load**: checkout page < 1.5s (chủ yếu là QR image — preload).
- **Admin panel scale**: Phase 2 dự kiến < 1000 đơn pending tại 1 thời điểm. Pagination 20/page, sort created_at DESC, index trên `(status, created_at)`.

## 7. Telemetry / Analytics (best-effort)

Không có tool analytics chính thức Phase 2. Log qua `console.info` + Supabase logs:
- `order.created` — courseId, amount, tier
- `order.payment_clicked` — orderId (Learner bấm "Tôi đã thanh toán")
- `order.confirmed` — orderId, time-to-confirm (ms từ created_at đến confirmed_at)
- `order.cancelled` — orderId, by (admin/user), reason length

Mục tiêu đo: median time-to-confirm, % đơn pending → cancelled, % đơn pending bị abandon (không bao giờ click "Tôi đã thanh toán").

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Admin xác nhận chậm → Learner bỏ cuộc | Mất doanh thu | Awaiting page có copy "~6h", polling 30s, future: notification email |
| Learner chuyển khoản sai nội dung (không có order code) | Admin không match được | UI nhấn mạnh required note, copy button, big mono. Admin check thủ công bằng amount + thời gian + course |
| Learner double-click "Mua" → 2 pending order | UI rối, admin lúng túng | RPC raise `duplicate_pending_order`, UI handle redirect về order cũ |
| Admin confirm nhầm đơn (chuyển khoản chưa về) | Cấp quyền truy cập miễn phí | Cho phép admin cancel sau khi đã confirm (cleanup enrollment) — edge case có log |
| Bank thay đổi số tài khoản | Cần deploy lại | Bank info trong `config` table, đổi qua admin settings (nice-to-have, hoặc SQL trực tiếp) |
| VietQR API down | Learner không quét được | Render text bank info song song với QR, fallback graceful |
| User huỷ đơn trong khi admin đang confirm | Race | RPC `confirm_order` check status `pending` trước khi update, nếu đã `cancelled` → raise + admin thấy toast "Đơn đã bị huỷ" |
| Sequence rollover khi reset DB dev | Order code trùng giữa các môi trường | Không quan trọng — code unique trong scope từng DB |

## 9. Implementation Plan (proposed slicing)

Đề xuất chia thành các issues nhỏ để track riêng, theo pattern PRD-0001:

1. **Migration 029 + RPC confirm_order/cancel_order + sequence order code** (DB layer, có SQL test)
2. **Bank config seed + VietQR URL builder helper** (`src/lib/vietqr.ts`)
3. **`/admin/settings` Payment tab + RPC `update_bank_config`** (admin chỉnh bank info)
4. **`/checkout/:orderId` page + course detail integration** (Learner-side checkout)
5. **`/checkout/:orderId/awaiting` page + polling 30s**
6. **`/admin/orders` page (Pending + All tabs) + sidebar badge**
7. **`/account/orders` page** (issue #19 spec, có thể giao agent riêng)
8. **Paywall sheet + access guard** (issue #13 spec, có thể tách hẳn vì lớn)
9. **E2E test**: Learner mua → cố vào lesson → bị paywall → admin confirm → Learner reload → có quyền truy cập.

## 10. Acceptance Criteria (rollup)

- [ ] Migration 029 áp dụng sạch trên DB chưa có order data.
- [ ] RPC `confirm_order` atomic, idempotent, RLS-safe.
- [ ] RPC `cancel_order` cho phép admin & owner-pending cancel với reason.
- [ ] RPC `update_bank_config` admin-only, cập nhật 4 keys trong `config` table.
- [ ] Order code 100% unique qua sequence.
- [ ] `/admin/settings` tab `Thanh toán` cho phép admin sửa bank info + preview QR live.
- [ ] `/checkout/:orderId` render QR + bank info + copy mã đơn từ `config` table.
- [ ] "Tôi đã thanh toán" → awaiting page, polling 30s status.
- [ ] `/admin/orders` confirm/cancel hoạt động, sidebar badge cập nhật.
- [ ] `/account/orders` hiện đầy đủ orders với filter + cancel reason reveal.
- [ ] Paywall sheet block Learner chưa enroll khỏi lesson trả phí.
- [ ] Free course không đi qua UI checkout — vẫn instant active enrollment.
- [ ] E2E test pass full flow.
- [ ] Vietnamese i18n đầy đủ, không hardcode string.
- [ ] Issues #17, #13, #19, #71, #51 đều có thể đóng sau khi PRD này ship.

## 11. Decisions (locked 2026-05-09)

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| **D1** | Bank info config quản lý ra sao? | **Admin settings UI ngay** (`/admin/settings` tab Thanh toán) | Admin không cần biết SQL; QR sai → người vận hành tự sửa được. Tab khác thêm sau. |
| **D2** | Đơn pending có TTL? | ~~**Không TTL Phase 2**~~ — **Lifted by PRD-0005 (2026-05-19): TTL 24h, cron 30 phút** | Manual-flow rationale ("admin tự quản lý") không còn hợp lệ khi PayOS auto-confirm; orphan pending = noise. |
| **D3** | Awaiting page polling hay realtime? | **Polling 30s** | 2 req/phút/Learner đang chờ — chấp nhận được volume Phase 2. Tránh phụ thuộc Realtime quota. |
| **D4** | Hiển thị queue indicator (số đơn pending trước)? | **Không** | Copy "~6h" đủ. Hiện count có thể gây lo lắng nếu queue dài. Defer hẳn. |
| **D5** | Admin confirm có gửi email cho Learner? | **Không (defer)** | Tuân thủ CLAUDE.md D-14 — email là low priority cho tới khi notification system có. |
