# PRD-0005: PayOS Payment Automation + Manual Payout

> Status: Locked · Owner: @haunguyen1064 · Created: 2026-05-19 · Branch: `claude/clarify-payment-feature-pVMFK`
> Phase: **Phase 2 — payment automation** (manual payout retained until volume justifies automation)
> Replaces: PRD-0002 manual QR Learner-facing flow (admin emergency confirm retained)
> Builds on: PRD-0001 (account tiers + fee snapshot), PRD-0002 (orders schema 029/031), Migration 038 (creator_payout_info)
> Related ADR: ADR-0007 (payment webhook on Supabase Edge Functions)

---

## 1. Background & Problem

PRD-0002 shipped a manual QR + admin-confirm flow. It works but has two
structural costs that compound with volume:

- **Time-to-unlock:** hours to days between Learner transfer and course
  unlock. Admin must manually reconcile the bank statement, find the
  matching `ORD-…` note, and click confirm. Each confirmation is human
  attention; abandoned carts grow as the queue lengthens.
- **No revenue visibility:** Creators have no in-platform view of
  earnings or payouts. PRD-0002 §3 explicitly defers this. Today the
  data exists in `orders` (fee/payout snapshot from PRD-0001) but is
  never surfaced.

This PRD replaces the manual confirmation step with **PayOS webhook
automation** and adds a **creator wallet view + manual admin payout
workflow** ("Option 1A" from the design discussion: payment in is
automated; payout out stays manual until volume justifies vendor
integration).

## 2. Goals

- **G1.** Learner clicks Mua → embedded PayOS QR inside `/checkout/:orderId`
  → after bank transfer, webhook fires within 5–30 seconds → order
  becomes `active`, enrollment is created, page polling redirects to
  `/learn/:courseId`. Median time-to-unlock ≤ 30 seconds.
- **G2.** Webhook signature verification via HMAC-SHA256 with 100%
  rejection of unverified requests; idempotent against PayOS retries.
- **G3.** Creator sees pending balance, lifetime earnings, last 20
  contributing orders, and payout history on `/creator/dashboard`
  Revenue tab.
- **G4.** Admin sees aggregated pending balances grouped by creator on
  `/admin/payouts`, exports the weekly CSV, marks payouts complete
  after transferring funds out-of-band.
- **G5.** Pending orders auto-expire after 24 hours via `pg_cron`,
  reducing dead-state clutter.
- **G6.** Manual `confirm_order` RPC retained as admin emergency action
  for orders whose webhook never arrived (>1h pending) — Learner never
  sees this surface.
- **G7.** Free course flow (price = 0) unchanged — PayOS not invoked,
  instant `active` enrollment via existing `create_order_with_fee_snapshot`.

## 3. Non-goals

- ❌ Automated payout to creators — PRD-0006 once volume justifies
  (trigger: ≥10 active creators, ≥50 paid orders/week, or ≥2h/week
  admin time on payouts).
- ❌ International card payments — PayOS supports Vietnamese banking
  apps only in Phase 2.
- ❌ Refund automation — PayOS cannot programmatically reverse NAPAS
  instant transfers; refunds are admin-driven out-of-band (status
  `refund_pending` → admin transfers back → `refunded`).
- ❌ Payout reversal (24h undo) — deferred to Phase 3. Admin must
  transfer carefully the first time.
- ❌ Email notifications for payment confirmation — CLAUDE.md D-14
  still defers email until notification system exists.
- ❌ Coupon / discount codes.
- ❌ Multi-currency (VND only, integer đồng).
- ❌ Bulk-transfer CSV templates for specific banks — admin uses CSV
  as a reference checklist while typing into their banking app.

## 4. Personas & User Stories

### P1 — Learner pays for a course

- **US1.1** On course detail (price > 0, not enrolled), click `Mua
  khoá học` → frontend calls Edge Function `payos-create-payment` →
  PayOS returns `qrCode`, `accountNumber`, `accountName`, `bin`,
  `amount`, `description`, `paymentLinkId` → redirect
  `/checkout/:orderId`.
- **US1.2** `/checkout/:orderId` renders QR (≈220×220), bank info
  rows, transfer note (PayOS-supplied `description`, copyable), amount,
  order code `ORD-2026-XXXXXX` (copyable for fallback). No "Tôi đã
  thanh toán" button — confirmation is automatic.
- **US1.3** Status zone on same page polls every **5 seconds**: shows
  "Đang chờ thanh toán" until webhook flips status. When status =
  `active`, redirect `/learn/:courseId`.
- **US1.4** If Learner closes browser after paying, next login shows a
  dot indicator on TopNav `/account/orders` until they open the page.
  No email.
- **US1.5** If Learner cancels the order on `/checkout` (ghost link
  "Huỷ đơn" still present) and then accidentally pays via a still-open
  banking app, webhook will set status to `refund_pending`; Learner
  sees an amber "Đang hoàn tiền" badge on `/account/orders` with
  tooltip "Admin sẽ chuyển khoản lại trong 3–7 ngày".

### P2 — Creator views revenue

- **US2.1** `/creator/dashboard` Revenue tab shows:
  - Pending balance (large), total paid out (medium), lifetime
    earnings (small).
  - Caption: "Payout xử lý vào thứ Hai hàng tuần".
  - Recent earnings table: last 20 `active` orders contributing to
    pending balance, with course title, Learner email, amount,
    confirmed_at.
  - Payout history: each row from `payouts` for this creator, with
    transferred_at, amount, bank account snapshot (masked),
    reference_note.

### P3 — Admin runs weekly payout

- **US3.1** Monday morning, admin opens `/admin/payouts`. Table
  grouped by creator: pending balance, order count, bank info
  (clickable to view full).
- **US3.2** Admin clicks `Xuất CSV` → downloads
  `gambitly-payouts-2026-W21.csv` (UTF-8 BOM) with columns: STT, Người
  nhận, Ngân hàng, Số tài khoản, Số tiền, Nội dung CK, Email creator,
  Số đơn, Payout ID (uuid pre-generated server-side; rows are inserted
  in `payouts` with status "pending" — see §5.6).
- **US3.3** Admin manually transfers each amount via their personal
  banking app, copy-pasting amount + account number + memo from CSV.
- **US3.4** Back in `/admin/payouts`, each payout row has "Đánh dấu
  hoàn tất" button → dialog asks for bank reference number → RPC
  `mark_payout_complete(payout_id, reference)` updates the row and
  flips contributing orders' `paid_out_in` to that payout id → creator
  pending balance drops to 0 for those orders.

### P4 — Admin handles webhook failure

- **US4.1** `/admin/orders` gains a tab "Cần can thiệp (N)" listing
  orders with `status='pending' AND now() - created_at > 1h`. Normal
  flow keeps webhook fast enough that this count stays at 0.
- **US4.2** Row action "Xác nhận thủ công" opens a dialog requiring a
  reason text (e.g. "Webhook PayOS không trả về dù bank statement
  confirm chuyển khoản OK") → calls existing RPC `confirm_order` from
  PRD-0002 §5.3, which is retained for this purpose.
- **US4.3** Existing "Huỷ đơn" admin row action still available.

### P5 — Admin handles refund

- **US5.1** `/admin/orders` gains a tab "Cần refund (N)" filtering
  `status='refund_pending'`.
- **US5.2** Row shows: amount, original payer bank info (from PayOS
  webhook payload stored in `orders.refund_due_to jsonb`), reason
  ("Đơn đã bị huỷ trước khi PayOS xác nhận").
- **US5.3** Admin transfers refund out-of-band, returns and clicks
  "Đánh dấu hoàn tiền" → dialog asks for bank reference number → RPC
  `mark_order_refunded(order_id, reference)` flips status to `refunded`.

## 5. Functional Requirements

### 5.1 Schema additions (Migration 051)

```sql
-- Status enum expansion: pending|active|cancelled|expired|refund_pending|refunded
ALTER TABLE public.orders
  ADD COLUMN payos_order_code     bigint UNIQUE,            -- nextval(orders_seq), used as PayOS API orderCode
  ADD COLUMN payos_payment_link_id text,                    -- PayOS paymentLinkId
  ADD COLUMN payos_transaction_id  text UNIQUE,             -- webhook idempotency key
  ADD COLUMN paid_at               timestamptz,
  ADD COLUMN expired_at            timestamptz,             -- when cron expired it
  ADD COLUMN refund_due_to         jsonb,                   -- payer bank snapshot from webhook
  ADD COLUMN refunded_at           timestamptz,
  ADD COLUMN refunded_by           uuid REFERENCES public.users(id),
  ADD COLUMN refund_reference      text,
  ADD COLUMN paid_out_in           uuid,                    -- FK → payouts.id, set when admin marks complete
  ADD COLUMN webhook_event_log     jsonb[] NOT NULL DEFAULT '{}';

-- New status values
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending','active','cancelled','expired','refund_pending','refunded'));

-- Payouts table
CREATE TABLE public.payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id      uuid NOT NULL REFERENCES public.users(id),
  admin_id        uuid NOT NULL REFERENCES public.users(id),
  amount          integer NOT NULL CHECK (amount > 0),
  bank_code       text NOT NULL,
  bank_name       text NOT NULL,
  account_number  text NOT NULL,
  account_holder  text NOT NULL,
  order_ids       uuid[] NOT NULL,
  transferred_at  timestamptz NOT NULL DEFAULT now(),
  reference_note  text                                       -- bank txn ref filled at mark-complete
);

ALTER TABLE public.orders
  ADD CONSTRAINT orders_paid_out_in_fkey
  FOREIGN KEY (paid_out_in) REFERENCES public.payouts(id);

-- Index for the "Cần can thiệp" admin tab
CREATE INDEX orders_pending_old_idx
  ON public.orders (created_at)
  WHERE status = 'pending';

-- Wallet view (read-only)
CREATE VIEW public.creator_wallet AS
SELECT
  c.id AS creator_id,
  COALESCE(SUM(o.creator_payout) FILTER (
    WHERE o.status = 'active' AND o.paid_out_in IS NULL
  ), 0) AS pending_balance,
  COALESCE(SUM(o.creator_payout) FILTER (
    WHERE o.status = 'active' AND o.paid_out_in IS NOT NULL
  ), 0) AS total_paid_out,
  COALESCE(SUM(o.creator_payout) FILTER (WHERE o.status = 'active'), 0) AS lifetime_earnings
FROM public.users c
LEFT JOIN public.courses co ON co.creator_id = c.id
LEFT JOIN public.orders o ON o.course_id = co.id
WHERE c.role = 'creator'
GROUP BY c.id;
```

### 5.2 Edge Function `payos-create-payment`

- Auth: requires Supabase JWT (Learner).
- Input: `{ order_id }`.
- Steps:
  1. Fetch order, assert `user_id = caller`, status = `pending`,
     `payos_payment_link_id IS NULL`.
  2. Call `POST https://api-merchant.payos.vn/v2/payment-requests` with:
     - `orderCode = order.payos_order_code`
     - `amount = order.amount`
     - `description = order.code` (PayOS limits description to ~25 chars; `ORD-2026-XXXXXX` fits)
     - `expiredAt = floor(now()/1000) + 86400` (24 h, matches our cron)
     - `cancelUrl`, `returnUrl` → `/checkout/:orderId` (PayOS calls these for hosted page, harmless for embedded mode)
     - Signature: HMAC-SHA256 over `amount&cancelUrl&description&orderCode&returnUrl` using `PAYOS_CHECKSUM_KEY`.
  3. UPDATE `orders.payos_payment_link_id = response.data.paymentLinkId`.
  4. Return `{ qrCode, accountNumber, accountName, bin, amount, description, checkoutUrl }` to FE.

### 5.3 Edge Function `payos-webhook`

- No auth — public endpoint; security via HMAC signature on payload.
- Steps:
  1. Read raw body, compute HMAC-SHA256 over sorted data fields with
     `PAYOS_CHECKSUM_KEY`. Compare to `signature` header. On mismatch
     → 401, no log of payload body.
  2. Parse `data.orderCode` (bigint) and `data.code` (PayOS event code,
     "00" = paid).
  3. Call RPC `confirm_order_via_payos(payos_order_code, transaction_id, payload jsonb)`.
  4. Return 200 to PayOS regardless of internal outcome (so PayOS does
     not retry indefinitely once we've recorded the event); the RPC is
     idempotent and self-logs.

### 5.4 RPC `confirm_order_via_payos`

```sql
CREATE FUNCTION confirm_order_via_payos(
  p_payos_order_code bigint,
  p_payos_transaction_id text,
  p_payload jsonb
) RETURNS public.orders
```

- SECURITY DEFINER. Only Edge Function (service role) calls this.
- Lock the matching order FOR UPDATE.
- Idempotency: if `orders.payos_transaction_id = p_payos_transaction_id`
  already, return existing row (no-op).
- Append `p_payload` to `webhook_event_log`.
- Branch on current status:
  - `pending` → set `status='active'`, `paid_at=now()`,
    `payos_transaction_id=p_payos_transaction_id`, insert enrollment
    `ON CONFLICT DO NOTHING`. Happy path.
  - `expired` → re-activate (set `status='active'`, `paid_at=now()`),
    log warning into `webhook_event_log` with key `late_paid_after_expire`,
    insert enrollment. (Decision A1.)
  - `cancelled` → set `status='refund_pending'`, populate
    `refund_due_to` with payer bank info from `p_payload`, do NOT
    insert enrollment. (Decision B2.)
  - `active`, `refund_pending`, `refunded` → no-op, log event.
- Return updated order row.

### 5.5 RPC `expire_stale_orders` + `pg_cron`

```sql
CREATE FUNCTION expire_stale_orders() RETURNS integer
AS $$
  WITH expired AS (
    UPDATE public.orders
       SET status='expired', expired_at=now()
     WHERE status='pending'
       AND created_at < now() - interval '24 hours'
    RETURNING 1
  )
  SELECT count(*) FROM expired;
$$;

SELECT cron.schedule(
  'expire-stale-orders',
  '*/30 * * * *',
  $$ SELECT public.expire_stale_orders() $$
);
```

### 5.6 RPC `mark_payout_complete`

- Input: `payout_id`, `reference_note`.
- Auth: admin only.
- Atomically: UPDATE `payouts.reference_note`, UPDATE
  `orders.paid_out_in = payout_id` for every order in
  `payouts.order_ids`.
- Returns payout row.

CSV export (server-side function or Edge Function): creates `payouts`
rows in advance with `reference_note IS NULL` and `order_ids` already
populated with the current pending orders for each creator. The CSV
download is what triggers the row creation; mark-complete then just
fills `reference_note`. This avoids the "admin downloads CSV but
forgets to mark complete" problem by making the rows visible immediately.

The ISO-week idempotency window used by `create_weekly_payouts` is
anchored in `Asia/Ho_Chi_Minh` (migration 053, issue #269), not UTC —
Vietnamese admins click "Create payouts" on Monday morning ICT, which
is still Sunday in UTC; a UTC-anchored week boundary would split the
two morning clicks across different week buckets and mint a duplicate
payout. `payouts.transferred_at` storage remains UTC `timestamptz`.

### 5.7 RPC `mark_order_refunded`

- Input: `order_id`, `refund_reference`.
- Auth: admin only.
- Asserts status = `refund_pending`.
- UPDATE status=`refunded`, `refunded_at=now()`, `refunded_by=auth.uid()`,
  `refund_reference=p_refund_reference`.

### 5.8 Frontend changes

- `/checkout/:orderId` — keep PRD-0002 layout, swap data source from
  `config` table + img.vietqr.io to Edge Function response. Remove "Tôi
  đã thanh toán" button. Add status polling 5s.
- `/admin/settings` tab Thanh toán — **removed**. Bank-config-for-VietQR
  no longer relevant; PayOS credentials live in Edge Function secrets,
  not in DB.
- `/admin/orders` — add tabs "Cần can thiệp" and "Cần refund". Pending
  tab "Đơn chờ duyệt" stays (count typically 0; legacy admin emergency
  surface).
- `/admin/payouts` — new page.
- `/creator/dashboard` — Revenue tab using `creator_wallet` view +
  `payouts` history.
- `/account/orders` — add `refund_pending` badge handling + post-confirm
  dot indicator via localStorage `last_seen_orders_at`.
- `src/lib/vietqr.ts` — delete; no longer needed.
- New: `src/lib/payos.ts` — thin client for invoking
  `payos-create-payment` Edge Function and parsing response.

## 6. Non-functional Requirements

- **Webhook latency:** confirm → enrollment available within 5–30s p95.
- **Webhook reliability:** ≥99.5% success rate. PayOS retries up to 5
  times; admin emergency confirm is the fallback.
- **Idempotency:** UNIQUE constraint on `payos_transaction_id`.
- **Signature verification:** 100% rejection rate on unverified
  requests. Sample-based assertion in E2E.
- **Atomicity:** `confirm_order_via_payos` runs in a single transaction
  — status update + enrollment insert + event log append are all-or-nothing.
- **Cron impact:** `expire_stale_orders` runs every 30 minutes against
  a partial index `orders_pending_old_idx`. Scan cost negligible at
  Phase 2 volume (< 1000 pending at any moment).
- **PayOS API down:** `/checkout/:orderId` shows graceful error and
  retry button; existing order keeps its status. Admin can manually
  process via emergency confirm if the Learner pays out-of-band.

## 7. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Webhook signature spoofing | HMAC verification before any state mutation; 401 on mismatch with no payload echo |
| Duplicate webhook delivery | `UNIQUE(payos_transaction_id)` + idempotent RPC |
| Late paid after expire | Decision A1 — re-activate + warning log; PayOS-side `expiredAt` reduces frequency |
| User cancelled + paid race | Decision B2 — `refund_pending` flow + admin manual refund |
| Admin transfers to wrong account | CSV shows full bank info; no payout reversal in Phase 2 — admin must double-check (live with the risk; PRD-0006 may add reversal if it bites) |
| PayOS API outage | Emergency manual confirm via existing `confirm_order` RPC |
| Cron drift / `pg_cron` paused | Worst case: `pending` orders accumulate; Edge Function can re-trigger `expire_stale_orders()` manually if observed |

## 8. Implementation Plan (slicing)

Suggested issues:

1. **Migration 051** — schema additions + status enum + `payouts` +
   `creator_wallet` view + `pg_cron` schedule (DB-only, has SQL tests).
2. **Edge Function `payos-webhook` + RPC `confirm_order_via_payos`** —
   includes HMAC verify, idempotency, all 6 status branches, event log.
3. **Edge Function `payos-create-payment` + frontend `src/lib/payos.ts`** —
   refactor `/checkout/:orderId` to embedded PayOS, remove "Tôi đã
   thanh toán", 5s polling.
4. **`/admin/orders` Cần can thiệp + Cần refund tabs + RPC
   `mark_order_refunded`** — manual emergency confirm reuses
   PRD-0002's `confirm_order`.
5. **`/admin/payouts` page + CSV export + RPC `mark_payout_complete`** —
   new admin route.
6. **`/creator/dashboard` Revenue tab** — `creator_wallet` view +
   payout history.
7. **Learner UX polish** — `refund_pending` badge, post-confirm dot
   indicator, removal of `src/lib/vietqr.ts` + `/admin/settings`
   Thanh toán tab.
8. **E2E** — full happy path + late-paid + cancelled-then-paid +
   duplicate webhook delivery.

## 9. Acceptance Criteria

- [ ] Migration 051 applies cleanly on a DB with PRD-0002 schema.
- [ ] Webhook rejects unsigned requests with HTTP 401.
- [ ] PayOS sandbox happy-path order: status `pending → active` within
      30s; enrollment created exactly once across 5 PayOS retries.
- [ ] Late-paid order (manually expire, then send `PAID` webhook):
      status becomes `active`, warning logged in
      `webhook_event_log`.
- [ ] Cancelled-then-paid order: status becomes `refund_pending`,
      enrollment not created.
- [ ] Cron expires a `pending` order whose `created_at` is 24h+ within
      30 minutes.
- [ ] Admin CSV export downloads with UTF-8 BOM and creates corresponding
      `payouts` rows.
- [ ] `mark_payout_complete` flips contributing orders' `paid_out_in`
      and zeros their contribution to `creator_wallet.pending_balance`.
- [ ] `mark_order_refunded` flips status to `refunded`.
- [ ] Creator sees pending balance + payout history on dashboard.
- [ ] `/admin/settings` Thanh toán tab removed; `src/lib/vietqr.ts`
      removed.
- [ ] Vietnamese i18n complete, no hardcoded strings.

## 10. Decisions (locked 2026-05-19)

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| **D1** | Webhook & cron host? | Supabase Edge Functions + `pg_cron` | ADR-0007. Same vendor as DB/Auth; free-tier covers Phase 2; avoids Vercel Pro cost for 30-min cron. |
| **D2** | Replace PRD-0002 manual flow or coexist? | **Replace.** `confirm_order` retained as admin emergency only. | KPI "Zero manual confirmations" incompatible with parallel Learner-facing flow. Coexistence fragments analytics + paywall logic. |
| **D3** | Order TTL? | 24 h, cron every 30 min. No backfill (no prod orders yet). | Lifts PRD-0002 D2 ("No TTL"). Manual-flow assumption no longer holds — orphan pending is now noise, not work in progress. |
| **D4** | PayOS `orderCode` ↔ `ORD-YYYY-XXXXXX` mapping | Use `nextval('orders_seq')` as `payos_order_code bigint UNIQUE`. Both derived from the same `nextval()` call in `create_order_with_fee_snapshot`. Keep human-facing `code` string unchanged. | PayOS API requires integer; sequence already integer + unique. Webhook lookup by `payos_order_code` is O(index). |
| **D5** | Wallet model | **Derived view + `payouts` table**, no `wallet_transactions` ledger. | `orders` already snapshots `creator_payout`/`platform_fee` (PRD-0001). Ledger would duplicate and risk drift. `paid_out_in` forward reference on orders is enough. |
| **D6** | Creator bank info collection | **Eager (keep mig 038)**. Lift PRD's "lazy" wording. | Mig 038 already collects at `/become-creator` for every tier with RLS, dedupe RPC, and snapshot in `account_applications.metadata`. Downgrading to lazy creates first-payout-blocker UX. |
| **D7** | PayOS integration mode | **Embedded QR.** PayOS API returns QR data; we render in our own `/checkout` page. | Reuses PRD-0002's `/checkout` layout; same Vietnamese design system; graceful fallback when PayOS QR image unavailable (text bank info from same response). |
| **D8** | PayOS credentials storage | **Supabase Edge Function secrets**, two Supabase projects for sandbox/prod. | Secrets never touch client or admin UI. Same env-var pattern as existing Vercel preview/production separation. |
| **D9a** | Late paid after expire | Re-activate + warning log + admin alert. | Money has cleared; refusing access is dishonest. Setting `expiredAt` on PayOS request to match our 24h cron minimises frequency. |
| **D9b** | Cancelled-then-paid | `refund_pending` status, admin manual refund out-of-band (3–7 days). | NAPAS instant transfers are not programmatically reversible; admin must transfer back through banking app. User's cancel intent honoured (no enrollment). |
| **D9c** | `active` order receives `CANCELLED` webhook | Log + alert admin; do NOT auto-revoke enrollment. | Avoid yanking access mid-lesson. Admin decides case-by-case. |
| **D10** | Payout reversal (24h undo) | **Deferred to Phase 3.** | YAGNI for Phase 2. Admin must transfer carefully; if wrong, escalate through bank tracing. |
| **D11** | CSV format | Generic reference CSV (UTF-8 BOM), not bank-specific bulk template. | Phase 2 admin uses personal banking app (no bulk); ≤10 creators/week = 5–10 min of manual typing. Bank-specific template locks platform into one bank. |
| **D12a** | Free course path | Unchanged — instant active enrollment, PayOS not invoked. | PRD-0002 §G4 / PRD-0001 E-09 already correct. |
| **D12b** | When admin sees "manual confirm" button | Only in tab "Cần can thiệp" — orders `pending AND created_at < now() - 1h`. | Hides the button during happy path to prevent accidental free access grants. |
| **D12c** | Learner notification when webhook confirms after browser close | localStorage `last_seen_orders_at` → dot indicator on TopNav → `/account/orders`. No email. | D-14 still defers email; localStorage covers the active-Learner case for free. |
| **D12d** | `refund_pending` display to Learner | Amber badge "Đang hoàn tiền" on order row + tooltip "3–7 ngày". | Transparency about money is non-negotiable; hidden order = trust damage. |
