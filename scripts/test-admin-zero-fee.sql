-- Manual SQL test: admin role pays zero platform fee
-- Run after migration 086 against a local Supabase instance.
-- Covers: resolver short-circuit, override is ignored for admin,
--         backfill applied, admin_list_creator_fees excludes admin,
--         admin_set_creator_fee_override rejects admin target.

-- ── Test 1: resolver returns 0 for admin role ─────────────────────────────
DO $$
DECLARE
  v_admin_id uuid := gen_random_uuid();
  v_fee      numeric;
BEGIN
  -- Admins are locked to 'individual' tier by trigger 019; use that.
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_admin_id, 'admin_zero_fee@test.local', 'Admin Seller', 'admin', 'individual');

  v_fee := public.resolve_platform_fee_pct(v_admin_id);
  ASSERT v_fee = 0, 'resolver must return 0 for admin role, got ' || v_fee::text;
  RAISE NOTICE 'PASS: resolver returns 0 for admin (fee=%)', v_fee;

  DELETE FROM public.users WHERE id = v_admin_id;
END;
$$;

-- ── Test 2: resolver still returns tier fee for creator role ──────────────
DO $$
DECLARE
  v_creator_id uuid := gen_random_uuid();
  v_fee        numeric;
BEGIN
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_creator_id, 'creator_individual@test.local', 'Reg Creator', 'creator', 'individual');

  v_fee := public.resolve_platform_fee_pct(v_creator_id);
  ASSERT v_fee = 20, 'individual creator fee must be 20, got ' || v_fee::text;
  RAISE NOTICE 'PASS: creator on individual tier still pays 20%% (fee=%)', v_fee;

  DELETE FROM public.users WHERE id = v_creator_id;
END;
$$;

-- ── Test 3: defensive cleanup nulled any stale admin override ─────────────
DO $$
BEGIN
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE role = 'admin' AND platform_fee_pct_override IS NOT NULL
  ), 'no admin user should retain a non-NULL platform_fee_pct_override';
  RAISE NOTICE 'PASS: no admin retains a stale fee override';
END;
$$;

-- ── Test 4: backfill — existing admin orders flipped to fee=0 ─────────────
DO $$
DECLARE
  v_admin_id   uuid := gen_random_uuid();
  v_buyer_id   uuid := gen_random_uuid();
  v_course_id  uuid := gen_random_uuid();
  v_order_id   uuid := gen_random_uuid();
  v_row        public.orders;
BEGIN
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_admin_id, 'admin_backfill@test.local', 'Admin BF', 'admin', 'individual'),
         (v_buyer_id, 'buyer_backfill@test.local', 'Buyer BF', 'learner', 'individual');

  INSERT INTO public.courses (id, creator_id, title, status, price, level, language)
  VALUES (v_course_id, v_admin_id, 'Admin Course', 'published', 100000, 'beginner', 'vi');

  -- Simulate a legacy order written before migration 086 (with 20% fee snapshot)
  INSERT INTO public.orders (id, course_id, user_id, status, amount, code,
                             platform_fee_pct, platform_fee_amount, creator_payout_amount,
                             creator_payout, account_tier_code)
  VALUES (v_order_id, v_course_id, v_buyer_id, 'active', 100000, 'ORD-2026-BF0001',
          20, 20000, 80000, 80000, 'individual');

  -- Manually re-run the backfill statement (idempotent)
  UPDATE public.orders o
     SET platform_fee_pct      = 0,
         platform_fee_amount   = 0,
         creator_payout_amount = o.amount,
         creator_payout        = o.amount
    FROM public.courses c
    JOIN public.users u ON u.id = c.creator_id
   WHERE o.course_id = c.id
     AND u.role = 'admin'
     AND (o.platform_fee_amount > 0 OR o.creator_payout_amount <> o.amount);

  SELECT * INTO v_row FROM public.orders WHERE id = v_order_id;
  ASSERT v_row.platform_fee_pct = 0,           'backfilled fee_pct must be 0';
  ASSERT v_row.platform_fee_amount = 0,        'backfilled fee_amount must be 0';
  ASSERT v_row.creator_payout_amount = 100000, 'backfilled payout must equal price';
  ASSERT v_row.creator_payout = 100000,        'backfilled legacy payout column must equal price';
  RAISE NOTICE 'PASS: admin order backfilled to fee=0, payout=%', v_row.creator_payout_amount;

  DELETE FROM public.orders  WHERE id = v_order_id;
  DELETE FROM public.courses WHERE id = v_course_id;
  DELETE FROM public.users   WHERE id IN (v_admin_id, v_buyer_id);
END;
$$;

-- ── Test 5: admin_list_creator_fees never lists admin users ───────────────
DO $$
DECLARE
  v_admin_id  uuid := gen_random_uuid();
  v_match     integer;
BEGIN
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_admin_id, 'admin_listing@test.local', 'Admin List', 'admin', 'individual');

  -- The RPC requires the caller to be admin; we test the WHERE clause by
  -- inspecting the function source rather than invoking it (no auth context here).
  SELECT count(*) INTO v_match
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'admin_list_creator_fees'
     AND pg_get_functiondef(p.oid) ILIKE '%u.role = ''creator''%';
  ASSERT v_match = 1, 'admin_list_creator_fees must keep the role=creator filter';
  RAISE NOTICE 'PASS: admin_list_creator_fees still filters role=creator';

  DELETE FROM public.users WHERE id = v_admin_id;
END;
$$;

-- ── Test 6a: today's analytics_snapshots was refreshed by migration 086 ──
-- After step 4 of the migration, today's snapshot rows must exist for the
-- canonical (time_range, category) pairs that AdminAnalyticsPage reads.
DO $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.analytics_snapshots
   WHERE snapshot_date = v_today
     AND category = 'financial';
  ASSERT v_count >= 1,
    'expected at least one financial snapshot row for today after migration 086, got ' || v_count::text;
  RAISE NOTICE 'PASS: today financial analytics snapshot exists (% rows)', v_count;
END;
$$;

-- ── Test 6: admin_set_creator_fee_override still rejects admin targets ────
DO $$
DECLARE
  v_match integer;
BEGIN
  SELECT count(*) INTO v_match
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'admin_set_creator_fee_override'
     AND pg_get_functiondef(p.oid) ILIKE '%target.role <> ''creator''%';
  ASSERT v_match = 1, 'admin_set_creator_fee_override must keep the creator-only guard';
  RAISE NOTICE 'PASS: admin_set_creator_fee_override still guards role=creator';
END;
$$;
