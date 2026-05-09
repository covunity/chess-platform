-- Test suite: approve_account_application + reject_account_application RPCs
-- Run: psql -f scripts/test-application-approve.sql
-- Requires migrations 016 + 018 + 019 + 022 applied.
-- Simulates auth.uid() via set_config('request.jwt.claims', ...).

-- Helper: insert an application directly (bypasses RPC, for test setup)
-- Returns the app id.

-- ── Test 1: Approve learner→creator with tier business ─────────────────────
DO $$
DECLARE
  v_admin_id   uuid := gen_random_uuid();
  v_learner_id uuid := gen_random_uuid();
  v_app_id     uuid;
  v_user_after public.users;
BEGIN
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_admin_id, 'app_admin1@test.local', 'App Admin1', 'admin', 'individual');

  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_learner_id, 'app_learner1@test.local', 'App Learner1', 'learner', 'individual');

  -- Create pending application for business tier
  INSERT INTO public.account_applications
    (user_id, status, requested_tier_code, motivation, experience, metadata)
  VALUES
    (v_learner_id, 'pending', 'business', 'Want to build chess courses', 'experienced',
     '{"business_name":"Chess Corp","business_registration_no":"BC-001"}'::jsonb)
  RETURNING id INTO v_app_id;

  -- Approve as admin
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id)::text, true);
  PERFORM public.approve_account_application(v_app_id);

  SELECT * INTO v_user_after FROM public.users WHERE id = v_learner_id;

  ASSERT v_user_after.role = 'creator',
    'FAIL: learner should become creator, got role=' || v_user_after.role;
  ASSERT v_user_after.account_tier_id = 'business',
    'FAIL: tier should be business, got ' || v_user_after.account_tier_id;

  RAISE NOTICE 'PASS: learner→creator approved with business tier (role=%, tier=%)',
    v_user_after.role, v_user_after.account_tier_id;

  DELETE FROM public.account_applications WHERE id = v_app_id;
  DELETE FROM public.users WHERE id IN (v_admin_id, v_learner_id);
END;
$$;

-- ── Test 2: Approve creator tier upgrade (role unchanged, tier changes) ─────
DO $$
DECLARE
  v_admin_id   uuid := gen_random_uuid();
  v_creator_id uuid := gen_random_uuid();
  v_app_id     uuid;
  v_user_after public.users;
BEGIN
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_admin_id, 'app_admin2@test.local', 'App Admin2', 'admin', 'individual');

  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_creator_id, 'app_creator1@test.local', 'App Creator1', 'creator', 'individual');

  INSERT INTO public.account_applications
    (user_id, status, requested_tier_code, motivation, experience, metadata)
  VALUES
    (v_creator_id, 'pending', 'business', 'Upgrade to business', 'experienced',
     '{"business_name":"Chess Pro","business_registration_no":"BC-002"}'::jsonb)
  RETURNING id INTO v_app_id;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id)::text, true);
  PERFORM public.approve_account_application(v_app_id);

  SELECT * INTO v_user_after FROM public.users WHERE id = v_creator_id;

  ASSERT v_user_after.role = 'creator',
    'FAIL: creator role should not change, got ' || v_user_after.role;
  ASSERT v_user_after.account_tier_id = 'business',
    'FAIL: tier should be business, got ' || v_user_after.account_tier_id;

  RAISE NOTICE 'PASS: creator tier upgrade approved (role=creator unchanged, tier=business)';

  DELETE FROM public.account_applications WHERE id = v_app_id;
  DELETE FROM public.users WHERE id IN (v_admin_id, v_creator_id);
END;
$$;

-- ── Test 3: Approve causes downgrade violation → raise ─────────────────────
DO $$
DECLARE
  v_admin_id   uuid := gen_random_uuid();
  v_creator_id uuid := gen_random_uuid();
  v_course_id  uuid := gen_random_uuid();
  v_app_id     uuid;
  v_raised     boolean := false;
  i            int;
BEGIN
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_admin_id, 'app_admin3@test.local', 'App Admin3', 'admin', 'individual');

  -- Creator on business tier (max 30 chapters)
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_creator_id, 'app_creator2@test.local', 'App Creator2', 'creator', 'business');

  INSERT INTO public.courses (id, creator_id, title, status, price, level, language)
  VALUES (v_course_id, v_creator_id, 'Big Course', 'draft', 0, 'beginner', 'vi');

  -- 11 chapters — exceeds individual limit (10) but within business limit (30)
  FOR i IN 1..11 LOOP
    INSERT INTO public.chapters (course_id, title, order_idx)
    VALUES (v_course_id, 'Chapter ' || i, i);
  END LOOP;

  -- Application to downgrade to individual
  INSERT INTO public.account_applications
    (user_id, status, requested_tier_code, motivation, experience, metadata)
  VALUES
    (v_creator_id, 'pending', 'individual', 'Downgrade test', 'experienced', '{}'::jsonb)
  RETURNING id INTO v_app_id;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id)::text, true);

  BEGIN
    PERFORM public.approve_account_application(v_app_id);
    RAISE EXCEPTION 'FAIL: expected tier_downgrade_violates_chapter_limit';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%tier_downgrade_violates_chapter_limit%' THEN
        v_raised := true;
        RAISE NOTICE 'PASS: downgrade violation on approve raised (msg: %)', SQLERRM;
      ELSE
        RAISE EXCEPTION 'FAIL: unexpected exception: %', SQLERRM;
      END IF;
  END;

  ASSERT v_raised, 'FAIL: downgrade violation not raised on approve';

  -- Verify user tier unchanged and app still pending
  ASSERT (SELECT account_tier_id FROM public.users WHERE id = v_creator_id) = 'business',
    'FAIL: creator tier should remain business';
  ASSERT (SELECT status FROM public.account_applications WHERE id = v_app_id) = 'pending',
    'FAIL: application should remain pending after failed approve';

  RAISE NOTICE 'PASS: tier and app status unchanged after failed approve';

  DELETE FROM public.account_applications WHERE id = v_app_id;
  DELETE FROM public.chapters WHERE course_id = v_course_id;
  DELETE FROM public.courses WHERE id = v_course_id;
  DELETE FROM public.users WHERE id IN (v_admin_id, v_creator_id);
END;
$$;

-- ── Test 4: Approve for admin user → raise cannot approve application ───────
DO $$
DECLARE
  v_admin_id  uuid := gen_random_uuid();
  v_admin2_id uuid := gen_random_uuid();
  v_app_id    uuid;
  v_raised    boolean := false;
BEGIN
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_admin_id, 'app_admin4@test.local', 'App Admin4', 'admin', 'individual');

  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_admin2_id, 'app_admin5@test.local', 'App Admin5', 'admin', 'individual');

  -- Create application for another admin (edge case)
  INSERT INTO public.account_applications
    (user_id, status, requested_tier_code, motivation, experience, metadata)
  VALUES
    (v_admin2_id, 'pending', 'business', 'Admin wants to upgrade', 'experienced',
     '{"business_name":"Admin Corp","business_registration_no":"AC-001"}'::jsonb)
  RETURNING id INTO v_app_id;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id)::text, true);

  BEGIN
    PERFORM public.approve_account_application(v_app_id);
    RAISE EXCEPTION 'FAIL: expected cannot approve application for admin user';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%cannot approve application for admin user%' THEN
        v_raised := true;
        RAISE NOTICE 'PASS: cannot approve admin user application (msg: %)', SQLERRM;
      ELSE
        RAISE EXCEPTION 'FAIL: unexpected exception: %', SQLERRM;
      END IF;
  END;

  ASSERT v_raised, 'FAIL: admin-target guard not raised on approve';

  DELETE FROM public.account_applications WHERE id = v_app_id;
  DELETE FROM public.users WHERE id IN (v_admin_id, v_admin2_id);
END;
$$;

-- ── Test 5: Reject with empty reason → raise rejection reason required ──────
DO $$
DECLARE
  v_admin_id  uuid := gen_random_uuid();
  v_learner_id uuid := gen_random_uuid();
  v_app_id    uuid;
  v_raised    boolean := false;
BEGIN
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_admin_id, 'app_admin6@test.local', 'App Admin6', 'admin', 'individual');

  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_learner_id, 'app_learner2@test.local', 'App Learner2', 'learner', 'individual');

  INSERT INTO public.account_applications
    (user_id, status, requested_tier_code, motivation, experience, metadata)
  VALUES
    (v_learner_id, 'pending', 'individual', 'Want to teach', 'experienced', '{}'::jsonb)
  RETURNING id INTO v_app_id;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id)::text, true);

  -- Test empty string reason
  BEGIN
    PERFORM public.reject_account_application(v_app_id, '');
    RAISE EXCEPTION 'FAIL: expected rejection reason required for empty string';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%rejection reason required%' THEN
        v_raised := true;
        RAISE NOTICE 'PASS: empty rejection reason rejected';
      ELSE
        RAISE EXCEPTION 'FAIL: unexpected exception: %', SQLERRM;
      END IF;
  END;

  ASSERT v_raised, 'FAIL: empty reason was not rejected';

  -- Test NULL reason
  v_raised := false;
  BEGIN
    PERFORM public.reject_account_application(v_app_id, NULL);
    RAISE EXCEPTION 'FAIL: expected rejection reason required for NULL';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%rejection reason required%' THEN
        v_raised := true;
        RAISE NOTICE 'PASS: NULL rejection reason rejected';
      ELSE
        RAISE EXCEPTION 'FAIL: unexpected exception: %', SQLERRM;
      END IF;
  END;

  ASSERT v_raised, 'FAIL: NULL reason was not rejected';

  -- Verify happy path: reject with valid reason succeeds
  PERFORM public.reject_account_application(v_app_id, 'Not enough experience');

  ASSERT (SELECT status FROM public.account_applications WHERE id = v_app_id) = 'rejected',
    'FAIL: application should be rejected after valid reject call';
  RAISE NOTICE 'PASS: valid rejection reason accepted, app status=rejected';

  DELETE FROM public.account_applications WHERE id = v_app_id;
  DELETE FROM public.users WHERE id IN (v_admin_id, v_learner_id);
END;
$$;
