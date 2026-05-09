-- Migration 031 (PRD-0002 Slice 4): atomic order state-transition RPCs.
--
-- Builds on migration 029, which added the confirmed_at/by + cancelled_at/by/reason
-- columns. Both RPCs are SECURITY DEFINER so the table-level RLS policies on
-- `orders` and `enrollments` (migration 008) don't need a "creator can do
-- this" branch — authorisation lives entirely inside the function body.
--
-- Status semantics live in the order_status enum: pending | active | cancelled.

-- ── confirm_order(p_order_id) ──────────────────────────────────────────────
-- Admin marks a pending order as paid → flips to active and creates the
-- enrollment in the same transaction so the learner unlocks immediately.
-- Idempotent on already-active rows (Admin clicks Confirm twice → no error).
CREATE OR REPLACE FUNCTION public.confirm_order(
  p_order_id uuid
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller     uuid := auth.uid();
  v_order    public.orders;
BEGIN
  -- Admin guard
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- Lock the order row to serialise concurrent confirm/cancel clicks.
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found: %', p_order_id USING errcode = '22023';
  END IF;

  IF v_order.status = 'active' THEN
    -- Idempotent return — no-op so admin double-clicks are safe.
    RETURN v_order;
  END IF;

  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'order_already_cancelled' USING errcode = '22023';
  END IF;

  -- pending → active
  UPDATE public.orders
  SET status        = 'active',
      confirmed_at  = now(),
      confirmed_by  = caller
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- Create enrollment in the same transaction. ON CONFLICT covers the rare
  -- case where a free-course path (RPC create_order_with_fee_snapshot)
  -- already inserted the row.
  INSERT INTO public.enrollments (course_id, user_id, order_id)
  VALUES (v_order.course_id, v_order.user_id, v_order.id)
  ON CONFLICT (course_id, user_id) DO NOTHING;

  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_order(uuid) TO authenticated;


-- ── cancel_order(p_order_id, p_reason) ─────────────────────────────────────
-- Admin: can cancel any pending or active order (e.g. wrong transfer, refund).
-- Owner: can cancel only their own pending order (e.g. abandoned checkout).
-- Cancelling an already-active order also removes the enrolment so the
-- learner loses access immediately.
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

  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'order_already_cancelled' USING errcode = '22023';
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
