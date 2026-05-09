-- Test suite: change_user_account_tier RPC
-- Run: psql -f scripts/test-admin-change-tier.sql
-- Requires migrations 018–023 applied.
-- Simulates auth.uid() via set_config('request.jwt.claims', ...).

-- ── Test 1: Happy path — admin changes creator tier ───────────────────────
DO $$
DECLARE
  v_admin_id   uuid := gen_random_uuid();
  v_creator_id uuid := gen_random_uuid();
  v_result     public.users;
BEGIN
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_admin_id, 'tier_admin@test.local', 'Tier Admin', 'admin', 'individual');

  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_creator_id, 'tier_creator@test.local', 'Tier Creator', 'creator', 'individual');

  -- Simulate admin caller
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id)::text, true);

  SELECT * INTO v_result
    FROM public.change_user_account_tier(v_creator_id, 'business');

  ASSERT v_result.account_tier_id = 'business',
    'FAIL: expected tier=business, got ' || v_result.account_tier_id;
  ASSERT v_result.id = v_creator_id,
    'FAIL: returned user id mismatch';

  RAISE NOTICE 'PASS: admin changes creator tier individual→business';

  DELETE FROM public.users WHERE id IN (v_admin_id, v_creator_id);
END;
$$;

-- ── Test 2: Downgrade violation — creator courses exceed new tier limit ────
DO $$
DECLARE
  v_admin_id   uuid := gen_random_uuid();
  v_creator_id uuid := gen_random_uuid();
  v_course_id  uuid := gen_random_uuid();
  i            int;
  v_raised     boolean := false;
BEGIN
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_admin_id, 'tier_admin2@test.local', 'Tier Admin2', 'admin', 'individual');

  -- Creator on business tier (max 30 chapters)
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_creator_id, 'tier_creator2@test.local', 'Tier Creator2', 'creator', 'business');

  INSERT INTO public.courses (id, creator_id, title, status, price, level, language)
  VALUES (v_course_id, v_creator_id, 'Heavy Course', 'draft', 0, 'beginner', 'vi');

  -- Insert 11 chapters — exceeds individual limit (10) but within business limit (30).
  -- Bypass chapter-limit trigger by using a chapter_id sequence-based hack:
  -- We insert directly since the trigger allows up to 30 for business tier.
  FOR i IN 1..11 LOOP
    INSERT INTO public.chapters (course_id, title, order_idx)
    VALUES (v_course_id, 'Chapter ' || i, i);
  END LOOP;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id)::text, true);

  BEGIN
    PERFORM public.change_user_account_tier(v_creator_id, 'individual');
    RAISE EXCEPTION 'FAIL: expected tier_downgrade_violates_chapter_limit';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%tier_downgrade_violates_chapter_limit%' THEN
        v_raised := true;
        RAISE NOTICE 'PASS: downgrade violation raised correctly (msg: %)', SQLERRM;
      ELSE
        RAISE EXCEPTION 'FAIL: unexpected exception: %', SQLERRM;
      END IF;
  END;

  ASSERT v_raised, 'FAIL: downgrade violation was not raised';

  -- Verify tier was NOT changed
  ASSERT (SELECT account_tier_id FROM public.users WHERE id = v_creator_id) = 'business',
    'FAIL: tier should remain business after failed downgrade';
  RAISE NOTICE 'PASS: tier unchanged after failed downgrade';

  DELETE FROM public.chapters WHERE course_id = v_course_id;
  DELETE FROM public.courses WHERE id = v_course_id;
  DELETE FROM public.users WHERE id IN (v_admin_id, v_creator_id);
END;
$$;

-- ── Test 3: Target is admin — raise cannot change tier for admin user ──────
DO $$
DECLARE
  v_admin_id        uuid := gen_random_uuid();
  v_target_admin_id uuid := gen_random_uuid();
  v_raised          boolean := false;
BEGIN
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_admin_id, 'tier_admin3@test.local', 'Tier Admin3', 'admin', 'individual');

  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_target_admin_id, 'tier_admin4@test.local', 'Target Admin', 'admin', 'individual');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id)::text, true);

  BEGIN
    PERFORM public.change_user_account_tier(v_target_admin_id, 'business');
    RAISE EXCEPTION 'FAIL: expected cannot change tier for admin user';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%cannot change tier for admin user%' THEN
        v_raised := true;
        RAISE NOTICE 'PASS: cannot change tier for admin user raised correctly';
      ELSE
        RAISE EXCEPTION 'FAIL: unexpected exception: %', SQLERRM;
      END IF;
  END;

  ASSERT v_raised, 'FAIL: admin-target guard was not raised';

  DELETE FROM public.users WHERE id IN (v_admin_id, v_target_admin_id);
END;
$$;

-- ── Test 4: Non-admin caller — raise forbidden ─────────────────────────────
DO $$
DECLARE
  v_creator_id uuid := gen_random_uuid();
  v_learner_id uuid := gen_random_uuid();
  v_raised     boolean := false;
BEGIN
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_creator_id, 'tier_creator3@test.local', 'Tier Creator3', 'creator', 'individual');

  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_learner_id, 'tier_learner@test.local', 'Tier Learner', 'learner', 'individual');

  -- Simulate non-admin caller (creator calling RPC)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_creator_id)::text, true);

  BEGIN
    PERFORM public.change_user_account_tier(v_learner_id, 'business');
    RAISE EXCEPTION 'FAIL: expected forbidden exception for non-admin caller';
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_raised := true;
      RAISE NOTICE 'PASS: non-admin caller forbidden (insufficient_privilege)';
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%forbidden%' THEN
        v_raised := true;
        RAISE NOTICE 'PASS: non-admin caller forbidden (msg: %)', SQLERRM;
      ELSE
        RAISE EXCEPTION 'FAIL: unexpected exception: %', SQLERRM;
      END IF;
  END;

  ASSERT v_raised, 'FAIL: forbidden was not raised for non-admin caller';

  DELETE FROM public.users WHERE id IN (v_creator_id, v_learner_id);
END;
$$;
