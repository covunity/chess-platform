-- Migration 026: Prevent duplicate orders for the same (user, course) pair (issue #98).
-- Adds a partial UNIQUE index so only one pending/active order can exist per pair,
-- and updates the RPC to short-circuit and return the existing order instead of
-- inserting a new one.

-- Partial unique index: one pending/active order per (course, user)
CREATE UNIQUE INDEX IF NOT EXISTS orders_one_active_per_user_course
  ON public.orders (course_id, user_id)
  WHERE status IN ('pending', 'active');

-- Updated RPC with idempotent short-circuit
CREATE OR REPLACE FUNCTION public.create_order_with_fee_snapshot(
  p_course_id uuid
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id           uuid;
  v_course            record;
  v_creator_tier_code text;
  v_fee_pct           numeric(5, 2);
  v_fee_amount        integer;
  v_payout_amount     integer;
  v_order_status      public.order_status;
  v_order_code        text;
  v_new_order         public.orders;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Idempotency: return existing pending/active order for this (user, course)
  SELECT * INTO v_new_order
  FROM public.orders
  WHERE course_id = p_course_id
    AND user_id   = v_user_id
    AND status IN ('pending', 'active')
  LIMIT 1;

  IF FOUND THEN
    RETURN v_new_order;
  END IF;

  -- Lock course row to prevent race conditions
  SELECT id, price, creator_id, status
  INTO v_course
  FROM public.courses
  WHERE id = p_course_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'course not found: %', p_course_id;
  END IF;

  -- Resolve creator's tier fee
  SELECT u.account_tier_id, at.platform_fee_pct
  INTO v_creator_tier_code, v_fee_pct
  FROM public.users u
  JOIN public.account_tiers at ON at.code = u.account_tier_id
  WHERE u.id = v_course.creator_id;

  IF v_fee_pct IS NULL THEN
    v_fee_pct           := 20;
    v_creator_tier_code := 'individual';
  END IF;

  -- Compute fee snapshot (E-08)
  IF v_course.price = 0 THEN
    v_fee_amount    := 0;
    v_payout_amount := 0;
    v_fee_pct       := 0;
    v_order_status  := 'active';
  ELSE
    v_fee_amount    := floor(v_course.price * v_fee_pct / 100)::integer;
    v_payout_amount := v_course.price - v_fee_amount;
    v_order_status  := 'pending';
  END IF;

  v_order_code := 'ORD-' || extract(year FROM now())::text || '-' ||
                  lpad(floor(random() * 1000000)::text, 6, '0');

  INSERT INTO public.orders (
    course_id,
    user_id,
    status,
    amount,
    code,
    platform_fee_pct,
    platform_fee_amount,
    creator_payout_amount,
    creator_payout,
    account_tier_code
  )
  VALUES (
    p_course_id,
    v_user_id,
    v_order_status,
    v_course.price,
    v_order_code,
    v_fee_pct,
    v_fee_amount,
    v_payout_amount,
    v_payout_amount,
    v_creator_tier_code
  )
  RETURNING * INTO v_new_order;

  -- Free course: auto-create enrollment in same transaction
  IF v_course.price = 0 THEN
    INSERT INTO public.enrollments (course_id, user_id, order_id)
    VALUES (p_course_id, v_user_id, v_new_order.id)
    ON CONFLICT (course_id, user_id) DO NOTHING;
  END IF;

  RETURN v_new_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_order_with_fee_snapshot(uuid) TO authenticated;
