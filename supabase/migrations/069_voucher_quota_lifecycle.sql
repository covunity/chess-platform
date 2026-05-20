-- Migration 069 — Slice 4 of PRD-0006: voucher quota lifecycle on
-- cancel + expire.
--
-- Closes the voucher quota lifecycle. When an order leaves pending/active
-- without producing revenue (`cancelled` or `expired`), the voucher quota
-- must be refunded AND the `voucher_usages` row deleted so:
--   * `vouchers.total_uses` stays accurate (slice 3a quota CHECK constraint
--     keeps holding water),
--   * `per_user_limit` accounting via `_resolve_voucher_for_purchase`
--     (migration 068) lets the same learner reuse the same code on a new
--     purchase, and
--   * `total_quota` capacity is freed for another learner.
--
-- Two paths to hook (no other status flip out of pending/active without
-- revenue exists in PRD-0005's enum):
--
--   1) `cancel_order` (pending|active → cancelled). Migrations 031 + 062
--      defined the current allowlist (`pending`, `active`). We replace the
--      function with CREATE OR REPLACE and add a voucher refund block in
--      the same transaction as the status flip + enrollment cleanup.
--   2) `expire_stale_orders` (pg_cron, pending → expired). Migration 054
--      shipped this as a single UPDATE returning a row count. We rewrite
--      it with a CTE that captures every `voucher_id` from the flipped
--      rows and refunds them in batch (one UPDATE per voucher row, plus
--      one DELETE per voucher_usages row). Return type is unchanged so
--      the pg_cron caller does not need to be rescheduled.
--
-- We DO NOT hook `mark_order_refunded` (migration 058). The PRD-0005 D9b
-- refund path is `cancelled → refund_pending → refunded`, so the voucher
-- quota was already refunded when the order first hit `cancelled`. By the
-- time `mark_order_refunded` runs, `voucher_usages` no longer holds a row
-- for that order and `vouchers.total_uses` already reflects the refund.
-- The guarded UPDATE (`AND total_uses > 0`) and the no-op DELETE make this
-- design idempotent: a hypothetical second refund hook would also be a
-- no-op. See test scenario 6 below.
--
-- ── Scenarios verified (mental trace through this migration's code +
-- ── slice 3b's preview/create voucher logic in migration 068) ──────────
--   1) cancel pending order with voucher
--      → status = cancelled, total_uses -= 1, voucher_usages row deleted,
--        learner can immediately retry the same code on a new order.
--   2) cancel active order with voucher (rare: admin reverses a confirm)
--      → identical voucher refund; enrollment row deleted (existing
--        behavior from migration 031, untouched here).
--   3) expire pending order with voucher (pg_cron tick)
--      → status = expired, total_uses -= 1, voucher_usages row deleted.
--   4) expire batch of 5 pending orders all using voucher V
--      → CTE aggregates the 5 voucher refunds by voucher_id (GROUP BY)
--        BEFORE the UPDATE so the join is 1:1 with `vouchers`. Postgres
--        `UPDATE … FROM` only updates each target row once (PG docs warn
--        about multi-match → "which row will be used is not readily
--        predictable"). Aggregating gives us a single (voucher_id, refund_n)
--        row per voucher, so total_uses drops by 5. DELETE removes
--        5 voucher_usages rows.
--   5) cancel/expire order WITHOUT a voucher (voucher_id IS NULL)
--      → IF guard short-circuits in cancel_order; in expire_stale_orders
--        the WHERE clause in refund_quota fails on `v.id = NULL`, the DELETE
--        finds no matching row → both no-ops, no error.
--   6) cancelled → refund_pending → refunded (D9b)
--      → cancel_order ran first: voucher_usages row gone, total_uses
--        already decremented. mark_order_refunded (migration 058) does not
--        touch vouchers at all, so quota is NOT double-refunded.
--   7) per_user_limit accuracy after cancel
--      → slice 3b's `_resolve_voucher_for_purchase` (migration 068) joins
--        voucher_usages to orders and filters
--        `o.status NOT IN ('cancelled', 'expired')`. After cancel, the
--        usage row is deleted entirely so the count drops to 0 — the
--        learner can reuse the code. (The status-filter join was the
--        belt; the DELETE here is the suspenders. Either alone would be
--        sufficient; together they make the invariant hold even if a
--        future migration changes one side.)
--
-- ── Race conditions ────────────────────────────────────────────────────
-- Two admins click "Cancel" on the same order: `cancel_order` issues
-- `SELECT ... FOR UPDATE` on the order row (carried over from migration
-- 031), so the second caller blocks until the first commits, then re-reads
-- and hits the `cancelled` status branch which raises
-- `order_already_cancelled`. The refund block never runs twice.
--
-- For `expire_stale_orders`, the outer UPDATE in the CTE serializes via
-- row locks acquired during the UPDATE — pg_cron only invokes the
-- function on one Postgres backend at a time, but even if it didn't, the
-- `status = 'pending'` predicate would naturally skip rows another
-- transaction had already flipped.
--
-- ── Idempotency ────────────────────────────────────────────────────────
-- Both functions use CREATE OR REPLACE FUNCTION, so re-running migration
-- 069 is safe. Re-cancelling a cancelled order is rejected by the existing
-- status allowlist before the new voucher block executes, and even if it
-- somehow ran, the DELETE would match no rows and the UPDATE would no-op
-- on `total_uses > 0` once the counter hit zero.
--
-- References: PRD-0006 §4 P4, §5.2, §11 V-D2; PRD-0005 §5.5.

-- ── 1. cancel_order — add voucher refund block ─────────────────────────
-- Function body is byte-identical to migration 062 EXCEPT for the new
-- block at the end. Signature, return type, GRANT, and security model
-- are unchanged. Authorization guard, reason validation, FOR UPDATE row
-- lock, status allowlist, UPDATE clause, and enrollment cleanup are
-- preserved verbatim.
CREATE OR REPLACE FUNCTION public.cancel_order(
  p_order_id uuid,
  p_reason   text
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller     uuid := auth.uid();
  is_admin   boolean;
  v_order    public.orders;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;

  -- Reason validation up front so unauthorised callers can't probe order ids
  -- by varying the reason length.
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason required' USING errcode = '22023';
  END IF;
  IF length(p_reason) > 500 THEN
    RAISE EXCEPTION 'reason too long (max 500 chars)' USING errcode = '22023';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin')
  INTO is_admin;

  -- Lock the order row to serialise concurrent confirm/cancel clicks.
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found: %', p_order_id USING errcode = '22023';
  END IF;

  -- Authorisation: admin can cancel any non-cancelled order;
  -- owner can cancel only their own pending order.
  IF NOT is_admin THEN
    IF v_order.user_id <> caller THEN
      RAISE EXCEPTION 'forbidden' USING errcode = '42501';
    END IF;
    IF v_order.status <> 'pending' THEN
      RAISE EXCEPTION 'forbidden' USING errcode = '42501';
    END IF;
  END IF;

  -- PRD-0005 status flow: only pending/active can be cancelled.
  -- expired/refund_pending/refunded/cancelled are terminal or in-flight states
  -- that must not be flipped to cancelled. Use distinct errcodes so UI can
  -- map to specific user-facing messages.
  IF v_order.status NOT IN ('pending', 'active') THEN
    CASE v_order.status
      WHEN 'cancelled' THEN
        RAISE EXCEPTION 'order_already_cancelled' USING errcode = '22023';
      WHEN 'expired' THEN
        RAISE EXCEPTION 'cannot_cancel_expired_order' USING errcode = '22023';
      WHEN 'refund_pending' THEN
        RAISE EXCEPTION 'cannot_cancel_refund_pending_order' USING errcode = '22023';
      WHEN 'refunded' THEN
        RAISE EXCEPTION 'cannot_cancel_refunded_order' USING errcode = '22023';
      ELSE
        RAISE EXCEPTION 'cannot_cancel_order_with_status_%', v_order.status USING errcode = '22023';
    END CASE;
  END IF;

  UPDATE public.orders
  SET status            = 'cancelled',
      cancelled_at      = now(),
      cancelled_by      = caller,
      cancelled_reason  = p_reason
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- If the order had been confirmed, revoke access by deleting the matching
  -- enrolment row. Match on order_id when present so we don't accidentally
  -- delete an unrelated enrolment for the same (course, user) pair created
  -- by some other path.
  IF v_order.confirmed_at IS NOT NULL THEN
    DELETE FROM public.enrollments
    WHERE order_id = v_order.id;
  END IF;

  -- ── NEW in migration 069: refund voucher quota ────────────────────────
  -- Atomic with the status flip: if the order carried a voucher snapshot,
  -- decrement total_uses (guarded against underflow) and remove the audit
  -- row so per_user_limit accounting in _resolve_voucher_for_purchase
  -- frees the slot for re-redemption. The IF guard makes the block a
  -- no-op for orders without a voucher (most orders).
  IF v_order.voucher_id IS NOT NULL THEN
    UPDATE public.vouchers
       SET total_uses = total_uses - 1
     WHERE id = v_order.voucher_id
       AND total_uses > 0;

    DELETE FROM public.voucher_usages
     WHERE order_id = p_order_id;
  END IF;

  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text) TO authenticated;


-- ── 2. expire_stale_orders — CTE batch refund ──────────────────────────
-- Rewrites migration 054's function. The original was a plain UPDATE +
-- `get diagnostics row_count`. We move to a CTE so we can:
--   (a) capture the voucher_id of every flipped row in a single pass,
--   (b) decrement vouchers.total_uses in batch (one decrement per
--       flipped order — same per-order semantics as cancel_order),
--   (c) delete the corresponding voucher_usages rows in batch,
--   (d) still return the integer count to satisfy pg_cron's caller.
--
-- Subtle point: Postgres `UPDATE … FROM source` warns that if a target
-- row joins to multiple source rows, "only one of the join rows will be
-- used to update the target row, but which one will be used is not
-- readily predictable". This is the trap that bites a naive
-- `UPDATE vouchers v ... FROM expired e WHERE v.id = e.voucher_id`
-- implementation: 5 expired orders sharing the same voucher would
-- decrement total_uses by 1 instead of 5. We avoid the trap by
-- aggregating refunds per voucher_id in a `refund_counts` CTE first,
-- producing exactly one row per voucher → the FROM-join becomes 1:1
-- with `vouchers` and the SET expression applies the full decrement.
--
-- Return type stays `integer`. No GRANT change — function was called
-- only by pg_cron under the postgres role; SECURITY DEFINER is not
-- applied since pg_cron runs as superuser.
CREATE OR REPLACE FUNCTION public.expire_stale_orders()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.orders
       SET status     = 'expired',
           expired_at = now()
     WHERE status = 'pending'
       AND created_at < now() - interval '24 hours'
    RETURNING id, voucher_id
  ),
  refund_counts AS (
    -- Aggregate refunds per voucher BEFORE the UPDATE so the join is 1:1.
    -- voucher_id IS NULL rows are filtered out: no voucher → nothing to
    -- refund.
    SELECT voucher_id, count(*)::integer AS refund_n
      FROM expired
     WHERE voucher_id IS NOT NULL
     GROUP BY voucher_id
  ),
  refund_quota AS (
    UPDATE public.vouchers v
       SET total_uses = GREATEST(v.total_uses - rc.refund_n, 0)
      FROM refund_counts rc
     WHERE v.id = rc.voucher_id
    RETURNING v.id
  ),
  refund_usages AS (
    DELETE FROM public.voucher_usages u
     USING expired e
     WHERE u.order_id = e.id
    RETURNING u.id
  )
  SELECT count(*)::integer INTO v_count FROM expired;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.expire_stale_orders() IS
  'Marks pending orders older than 24h as expired AND refunds any voucher '
  'quota they were holding. Invoked by pg_cron job `expire-stale-orders` '
  'every 30 minutes. PRD-0005 §5.5 + PRD-0006 §11 V-D2.';
