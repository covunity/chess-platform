-- Fix #292 — cancel_order accepts refund_pending orders → loses refund snapshot
--
-- ── What was wrong ────────────────────────────────────────────────────────
-- Migration 031 introduced cancel_order with a single denylist check
-- (`IF v_order.status = 'cancelled' THEN RAISE`). Every other status —
-- including the in-flight `refund_pending` state added by migration 056
-- (PRD-0005 D9b) and the terminal `refunded` state from migration 058 —
-- silently passed through. An admin clicking "Huỷ đơn" from the kebab menu
-- on a `refund_pending` row (AdminOrdersPage.tsx:817-828) would flip the
-- order to `cancelled`, **destroying the `refund_due_to` JSONB snapshot
-- while the learner's money was already in the platform's bank account**.
-- The refund obligation became orphaned: no queue row, no audit trail, no
-- way to know the platform still owed someone a transfer back.
--
-- New `expired` status (migration 054) had the same problem: cancelling an
-- already-expired order is meaningless but was silently allowed, masking
-- the real lifecycle.
--
-- ── What this migration changes ───────────────────────────────────────────
-- CREATE OR REPLACE cancel_order with an explicit *allowlist* of cancellable
-- statuses (`pending`, `active`) and a CASE block that raises a distinct
-- errcode-22023 exception for every rejected status so the UI / API layer
-- can map each one to a specific Vietnamese toast:
--
--   cancelled      → order_already_cancelled
--   expired        → cannot_cancel_expired_order
--   refund_pending → cannot_cancel_refund_pending_order
--   refunded       → cannot_cancel_refunded_order
--   (any future)   → cannot_cancel_order_with_status_<X>
--
-- Every other line of the function body (authorisation, reason validation,
-- row lock, UPDATE clause, enrolment revocation) is byte-identical to
-- migration 031. Signature, return type, and GRANT are unchanged.
--
-- The UI side (AdminOrdersPage.tsx) hides the kebab "Huỷ đơn" trigger for
-- any row outside the allowlist so admins never see the broken affordance,
-- but the RPC guard is the system of record — defence in depth.

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

  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text) TO authenticated;
