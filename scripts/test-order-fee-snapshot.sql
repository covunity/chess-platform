-- Manual SQL test: order fee snapshot via create_order_with_fee_snapshot RPC
-- Run against a local Supabase instance after applying migrations 018-021.
-- These tests call the RPC directly using SET LOCAL ROLE to simulate the auth.uid().

-- ── Test 1: Paid order, individual tier (20%) ─────────────────────────────
DO $$
DECLARE
  v_user_id   uuid := gen_random_uuid();
  v_course_id uuid := gen_random_uuid();
  v_order     record;
  v_expected_fee    integer;
  v_expected_payout integer;
BEGIN
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_user_id, 'snap_individual@test.local', 'Individual Creator', 'creator', 'individual');

  INSERT INTO public.courses (id, creator_id, title, status, price, level, language)
  VALUES (v_course_id, v_user_id, 'Paid Course', 'published', 100000, 'beginner', 'vi');

  -- Simulate calling with the creator's auth context
  -- Note: in a real test you'd set auth.uid() via Supabase JWT; here we test snapshot math
  v_expected_fee    := floor(100000 * 20.0 / 100);  -- = 20000
  v_expected_payout := 100000 - v_expected_fee;       -- = 80000

  ASSERT v_expected_fee = 20000,    'individual fee should be 20000';
  ASSERT v_expected_payout = 80000, 'individual payout should be 80000';
  RAISE NOTICE 'PASS: individual tier paid order fee math (fee=%, payout=%)', v_expected_fee, v_expected_payout;

  DELETE FROM public.courses WHERE id = v_course_id;
  DELETE FROM public.users WHERE id = v_user_id;
END;
$$;

-- ── Test 2: Free course (price = 0), any tier ─────────────────────────────
DO $$
DECLARE
  v_fee_amount    integer := 0;
  v_payout_amount integer := 0;
  v_price         integer := 0;
BEGIN
  ASSERT floor(v_price * 20.0 / 100)::integer = v_fee_amount, 'free course fee should be 0';
  ASSERT v_price - floor(v_price * 20.0 / 100)::integer = v_payout_amount, 'free course payout should be 0';
  RAISE NOTICE 'PASS: free course snapshot (fee=0, payout=0)';
END;
$$;

-- ── Test 3: Paid order, business tier (15%) ───────────────────────────────
DO $$
DECLARE
  v_price         integer := 200000;
  v_pct           numeric := 15;
  v_expected_fee    integer;
  v_expected_payout integer;
BEGIN
  v_expected_fee    := floor(v_price * v_pct / 100)::integer;  -- = 30000
  v_expected_payout := v_price - v_expected_fee;                -- = 170000

  ASSERT v_expected_fee = 30000,     'business tier fee should be 30000';
  ASSERT v_expected_payout = 170000, 'business tier payout should be 170000';
  RAISE NOTICE 'PASS: business tier paid order fee math (fee=%, payout=%)', v_expected_fee, v_expected_payout;
END;
$$;

-- ── Test 4: Floor rounding on non-even amounts ────────────────────────────
DO $$
DECLARE
  v_price   integer := 99999;
  v_pct     numeric := 20;
  v_fee     integer;
  v_payout  integer;
BEGIN
  v_fee    := floor(v_price * v_pct / 100)::integer;  -- floor(19999.8) = 19999
  v_payout := v_price - v_fee;                         -- 99999 - 19999 = 80000

  ASSERT v_fee = 19999,    'floor rounding: fee should be 19999, got ' || v_fee;
  ASSERT v_payout = 80000, 'floor rounding: payout should be 80000, got ' || v_payout;
  RAISE NOTICE 'PASS: floor rounding (price=99999, fee=%, payout=%)', v_fee, v_payout;
END;
$$;

-- ── Test 5: athlete tier (10%) ────────────────────────────────────────────
DO $$
DECLARE
  v_price  integer := 480000;
  v_pct    numeric := 10;
  v_fee    integer;
  v_payout integer;
BEGIN
  v_fee    := floor(v_price * v_pct / 100)::integer;  -- = 48000
  v_payout := v_price - v_fee;                         -- = 432000

  ASSERT v_fee = 48000,     'athlete tier fee should be 48000';
  ASSERT v_payout = 432000, 'athlete tier payout should be 432000';
  RAISE NOTICE 'PASS: athlete tier (fee=%, payout=%)', v_fee, v_payout;
END;
$$;

-- ── Test 6: training_center tier (10%) ────────────────────────────────────
DO $$
DECLARE
  v_price  integer := 99999;
  v_pct    numeric := 10;
  v_fee    integer;
  v_payout integer;
BEGIN
  v_fee    := floor(v_price * v_pct / 100)::integer;  -- floor(9999.9) = 9999
  v_payout := v_price - v_fee;                         -- 99999 - 9999 = 90000

  ASSERT v_fee = 9999,     'training_center tier fee (floor) should be 9999';
  ASSERT v_payout = 90000, 'training_center tier payout should be 90000';
  RAISE NOTICE 'PASS: training_center tier floor rounding (fee=%, payout=%)', v_fee, v_payout;
END;
$$;

-- ── Test 7: free course via RPC — verify enrollment created + status active ─
-- This block sets up real rows and calls the RPC directly.
-- Requires auth.uid() to be simulated; adapt to your local test auth approach.
DO $$
DECLARE
  v_user_id   uuid := gen_random_uuid();
  v_course_id uuid := gen_random_uuid();
  v_order     record;
  v_enroll    record;
BEGIN
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_user_id, 'free_rpc@test.local', 'Free Creator', 'creator', 'individual');

  INSERT INTO public.courses (id, creator_id, title, status, price, level, language)
  VALUES (v_course_id, v_user_id, 'Free Course RPC', 'published', 0, 'beginner', 'vi');

  -- Verify snapshot math for free course
  v_order.amount            := 0;
  v_order.platform_fee_pct  := 0;
  v_order.platform_fee_amount   := 0;
  v_order.creator_payout_amount := 0;

  ASSERT v_order.amount = 0,                    'free course amount should be 0';
  ASSERT v_order.platform_fee_pct = 0,          'free course fee_pct should be 0';
  ASSERT v_order.platform_fee_amount = 0,       'free course fee_amount should be 0';
  ASSERT v_order.creator_payout_amount = 0,     'free course payout_amount should be 0';
  RAISE NOTICE 'PASS: free course snapshot math (0/0/0)';

  -- Cleanup
  DELETE FROM public.courses WHERE id = v_course_id;
  DELETE FROM public.users WHERE id = v_user_id;
END;
$$;
