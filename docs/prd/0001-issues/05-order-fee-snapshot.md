# Issue 05 — Order fee snapshot via RPC + fee preview UI

**Labels**: `needs-triage`, `enhancement`, `database`, `frontend`
**Type**: AFK

## Parent

PRD: `docs/prd/0001-enterprise-account-tiers.md` §5.7, US5.1, US6.1, US6.2

## What to build

Snapshot platform fee + creator payout vào `orders` lúc tạo đơn. Free course price=0 → snapshot 0/0/0 và auto-active enrollment. Floor về platform formula. Creator thấy fee preview ở trang tạo course.

End-to-end deliverable:
- Migration `021_orders_fee_snapshot.sql`:
  - Thêm cột vào `orders`: `platform_fee_pct numeric(5,2) NOT NULL DEFAULT 0`, `platform_fee_amount int NOT NULL DEFAULT 0`, `creator_payout_amount int NOT NULL DEFAULT 0`, `account_tier_code text REFERENCES account_tiers(code)`.
  - RPC `create_order_with_fee_snapshot(p_course_id uuid)`:
    - SECURITY DEFINER; lock course row.
    - Lookup `course.price`, `course.creator_id`, creator's `account_tier_id` → tier `platform_fee_pct`.
    - Nếu `price = 0`: snapshot pct/amount/payout = 0/0/0.
    - Nếu `price > 0`: `fee = floor(price * pct / 100)`, `payout = price - fee`.
    - Insert order. Free course → status `active` + insert enrollment ngay (cùng transaction).
    - Return order row.
- `src/lib/orderApi.ts`: chuyển từ insert trực tiếp sang gọi RPC. Xoá code path direct-insert.
- `src/pages/creator/NewCoursePage.tsx`: dưới ô price, hiện preview "Phí nền tảng: X% ({fee_amount}₫). Bạn nhận: {payout}₫" tính từ tier hiện tại của user.
- i18n: `creator.newCourse.feePreview.*`.
- Unit test `computeFeeFloor.test.ts` đã có ở 02b — verify cùng logic match RPC.
- SQL test `scripts/test-order-fee-snapshot.sql`: paid + free + tier khác nhau.

## Acceptance criteria

- [ ] Mọi order mới tạo qua RPC, có 4 cột snapshot điền đúng.
- [ ] `floor(price * pct / 100)` formula khớp với client preview.
- [ ] Free course (price=0): snapshot 0/0/0 + order status `active` + enrollment row tạo cùng transaction.
- [ ] Paid course: snapshot pct theo tier creator hiện tại.
- [ ] NewCoursePage preview cập nhật real-time khi nhập price.
- [ ] SQL test pass cho 4 tier × (price=0, price=100k, price=99999).

## Blocked by

- Issue 02a
