-- Test suite: submit_account_application supersede logic
-- Run: psql -f scripts/test-application-supersede.sql
-- Requires migrations 016 + 022 applied (account_applications + submit RPC).
-- Simulates auth.uid() via set_config('request.jwt.claims', ...).

-- ── Test 1: First submission creates a pending application ─────────────────
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_app_id  uuid;
  v_count   int;
BEGIN
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_user_id, 'sup_user1@test.local', 'Supersede User1', 'learner', 'individual');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_id)::text, true);

  v_app_id := public.submit_account_application(
    jsonb_build_object(
      'requested_tier_code', 'individual',
      'motivation', 'I want to teach chess',
      'experience', '5 years playing',
      'metadata', '{}'::jsonb
    )
  );

  ASSERT v_app_id IS NOT NULL, 'FAIL: submit should return a non-null app id';

  SELECT count(*) INTO v_count
    FROM public.account_applications
   WHERE user_id = v_user_id AND status = 'pending';

  ASSERT v_count = 1, 'FAIL: expected 1 pending application, got ' || v_count;
  RAISE NOTICE 'PASS: first submission → 1 pending app (id=%)', v_app_id;

  DELETE FROM public.account_applications WHERE user_id = v_user_id;
  DELETE FROM public.users WHERE id = v_user_id;
END;
$$;

-- ── Test 2: Second submission supersedes the first ─────────────────────────
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_app_a   uuid;
  v_app_b   uuid;
  v_status_a text;
  v_status_b text;
  v_pending_count int;
BEGIN
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_user_id, 'sup_user2@test.local', 'Supersede User2', 'learner', 'individual');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_id)::text, true);

  -- Submit app A
  v_app_a := public.submit_account_application(
    jsonb_build_object(
      'requested_tier_code', 'individual',
      'motivation', 'First application',
      'experience', 'some experience',
      'metadata', '{}'::jsonb
    )
  );

  -- Submit app B — should supersede A
  v_app_b := public.submit_account_application(
    jsonb_build_object(
      'requested_tier_code', 'business',
      'motivation', 'Second application — updated plan',
      'experience', 'more experience',
      'metadata', jsonb_build_object('business_name', 'Chess Corp', 'business_registration_no', 'BC-001')
    )
  );

  SELECT status INTO v_status_a FROM public.account_applications WHERE id = v_app_a;
  SELECT status INTO v_status_b FROM public.account_applications WHERE id = v_app_b;

  ASSERT v_status_a = 'superseded',
    'FAIL: app A should be superseded, got ' || coalesce(v_status_a, 'NULL');
  ASSERT v_status_b = 'pending',
    'FAIL: app B should be pending, got ' || coalesce(v_status_b, 'NULL');

  -- Only one pending at a time
  SELECT count(*) INTO v_pending_count
    FROM public.account_applications
   WHERE user_id = v_user_id AND status = 'pending';

  ASSERT v_pending_count = 1,
    'FAIL: expected exactly 1 pending app, got ' || v_pending_count;

  RAISE NOTICE 'PASS: second submission → app A=superseded, app B=pending';

  DELETE FROM public.account_applications WHERE user_id = v_user_id;
  DELETE FROM public.users WHERE id = v_user_id;
END;
$$;

-- ── Test 3: Submit with no prior pending — new pending, prior apps untouched
DO $$
DECLARE
  v_user_id  uuid := gen_random_uuid();
  v_app_a    uuid;
  v_app_b    uuid;
  v_app_c    uuid;
  v_status_a text;
  v_status_b text;
  v_status_c text;
BEGIN
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_user_id, 'sup_user3@test.local', 'Supersede User3', 'learner', 'individual');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_id)::text, true);

  -- Submit A, then B (supersedes A), then C (supersedes B)
  v_app_a := public.submit_account_application(
    jsonb_build_object('requested_tier_code', 'individual',
                       'motivation', 'App A', 'experience', 'exp', 'metadata', '{}'::jsonb)
  );

  v_app_b := public.submit_account_application(
    jsonb_build_object('requested_tier_code', 'individual',
                       'motivation', 'App B', 'experience', 'exp', 'metadata', '{}'::jsonb)
  );
  -- At this point A=superseded, B=pending

  v_app_c := public.submit_account_application(
    jsonb_build_object('requested_tier_code', 'individual',
                       'motivation', 'App C', 'experience', 'exp', 'metadata', '{}'::jsonb)
  );
  -- At this point A=superseded (unchanged), B=superseded, C=pending

  SELECT status INTO v_status_a FROM public.account_applications WHERE id = v_app_a;
  SELECT status INTO v_status_b FROM public.account_applications WHERE id = v_app_b;
  SELECT status INTO v_status_c FROM public.account_applications WHERE id = v_app_c;

  ASSERT v_status_a = 'superseded',
    'FAIL: app A should still be superseded, got ' || coalesce(v_status_a, 'NULL');
  ASSERT v_status_b = 'superseded',
    'FAIL: app B should be superseded by C, got ' || coalesce(v_status_b, 'NULL');
  ASSERT v_status_c = 'pending',
    'FAIL: app C should be pending, got ' || coalesce(v_status_c, 'NULL');

  RAISE NOTICE 'PASS: third submission → A=superseded, B=superseded, C=pending';

  DELETE FROM public.account_applications WHERE user_id = v_user_id;
  DELETE FROM public.users WHERE id = v_user_id;
END;
$$;

-- ── Test 4: Invalid tier code → raise exception ────────────────────────────
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_raised  boolean := false;
BEGIN
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_user_id, 'sup_user4@test.local', 'Supersede User4', 'learner', 'individual');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_id)::text, true);

  BEGIN
    PERFORM public.submit_account_application(
      jsonb_build_object('requested_tier_code', 'nonexistent_tier',
                         'motivation', 'Test', 'experience', 'exp', 'metadata', '{}'::jsonb)
    );
    RAISE EXCEPTION 'FAIL: expected invalid tier code exception';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%invalid tier code%' THEN
        v_raised := true;
        RAISE NOTICE 'PASS: invalid tier code rejected (msg: %)', SQLERRM;
      ELSE
        RAISE EXCEPTION 'FAIL: unexpected exception: %', SQLERRM;
      END IF;
  END;

  ASSERT v_raised, 'FAIL: invalid tier code was not rejected';

  DELETE FROM public.users WHERE id = v_user_id;
END;
$$;

-- ── Test 5: Missing motivation → raise exception ───────────────────────────
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_raised  boolean := false;
BEGIN
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_user_id, 'sup_user5@test.local', 'Supersede User5', 'learner', 'individual');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_id)::text, true);

  BEGIN
    PERFORM public.submit_account_application(
      jsonb_build_object('requested_tier_code', 'individual',
                         'motivation', '',
                         'experience', 'exp',
                         'metadata', '{}'::jsonb)
    );
    RAISE EXCEPTION 'FAIL: expected motivation required exception';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%motivation required%' THEN
        v_raised := true;
        RAISE NOTICE 'PASS: empty motivation rejected';
      ELSE
        RAISE EXCEPTION 'FAIL: unexpected exception: %', SQLERRM;
      END IF;
  END;

  ASSERT v_raised, 'FAIL: empty motivation was not rejected';

  DELETE FROM public.users WHERE id = v_user_id;
END;
$$;
