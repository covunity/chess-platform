-- Manual SQL test: chapter limit enforcement per account tier
-- Run against a local Supabase instance after applying migrations 018-020.
--
-- Expected results documented inline.

DO $$
DECLARE
  v_user_id       uuid := gen_random_uuid();
  v_course_id     uuid := gen_random_uuid();
  v_chapter_id    uuid;
  i               int;
  v_raised        boolean;
BEGIN
  -- Setup: insert a user with 'individual' tier (max 10 chapters)
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_user_id, 'test_chapter_limit@test.local', 'Test User', 'creator', 'individual');

  INSERT INTO public.courses (id, creator_id, title, status, price, level, language)
  VALUES (v_course_id, v_user_id, 'Test Course', 'draft', 0, 'beginner', 'vi');

  -- Insert 10 chapters (at limit for individual tier)
  FOR i IN 1..10 LOOP
    INSERT INTO public.chapters (id, course_id, title, position)
    VALUES (gen_random_uuid(), v_course_id, 'Chapter ' || i, i);
  END LOOP;

  -- Assert: 11th insert raises chapter_limit_exceeded
  v_raised := false;
  BEGIN
    INSERT INTO public.chapters (id, course_id, title, position)
    VALUES (gen_random_uuid(), v_course_id, 'Chapter 11', 11);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%chapter_limit_exceeded%' THEN
      v_raised := true;
    ELSE
      RAISE; -- re-raise unexpected errors
    END IF;
  END;

  ASSERT v_raised, 'Expected chapter_limit_exceeded for individual tier at 11th chapter';
  RAISE NOTICE 'PASS: individual tier (max 10) blocks 11th chapter';

  -- Cleanup
  DELETE FROM public.chapters WHERE course_id = v_course_id;
  DELETE FROM public.courses WHERE id = v_course_id;
  DELETE FROM public.users WHERE id = v_user_id;
END;
$$;


DO $$
DECLARE
  v_user_id   uuid := gen_random_uuid();
  v_course_id uuid := gen_random_uuid();
  i           int;
  v_raised    boolean;
BEGIN
  -- Setup: business tier (max 30 chapters)
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_user_id, 'test_business@test.local', 'Business User', 'creator', 'business');

  INSERT INTO public.courses (id, creator_id, title, status, price, level, language)
  VALUES (v_course_id, v_user_id, 'Business Course', 'draft', 0, 'beginner', 'vi');

  -- Insert exactly 30 chapters (at limit)
  FOR i IN 1..30 LOOP
    INSERT INTO public.chapters (id, course_id, title, position)
    VALUES (gen_random_uuid(), v_course_id, 'Chapter ' || i, i);
  END LOOP;

  -- 31st should be blocked
  v_raised := false;
  BEGIN
    INSERT INTO public.chapters (id, course_id, title, position)
    VALUES (gen_random_uuid(), v_course_id, 'Chapter 31', 31);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%chapter_limit_exceeded%' THEN
      v_raised := true;
    END IF;
  END;

  ASSERT v_raised, 'Expected chapter_limit_exceeded for business tier at 31st chapter';
  RAISE NOTICE 'PASS: business tier (max 30) blocks 31st chapter';

  DELETE FROM public.chapters WHERE course_id = v_course_id;
  DELETE FROM public.courses WHERE id = v_course_id;
  DELETE FROM public.users WHERE id = v_user_id;
END;
$$;


DO $$
DECLARE
  v_user_id   uuid := gen_random_uuid();
  v_course_id uuid := gen_random_uuid();
  i           int;
  v_raised    boolean;
BEGIN
  -- Setup: athlete tier (max 15 chapters)
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_user_id, 'test_athlete@test.local', 'Athlete User', 'creator', 'athlete');

  INSERT INTO public.courses (id, creator_id, title, status, price, level, language)
  VALUES (v_course_id, v_user_id, 'Athlete Course', 'draft', 0, 'beginner', 'vi');

  FOR i IN 1..15 LOOP
    INSERT INTO public.chapters (id, course_id, title, position)
    VALUES (gen_random_uuid(), v_course_id, 'Chapter ' || i, i);
  END LOOP;

  v_raised := false;
  BEGIN
    INSERT INTO public.chapters (id, course_id, title, position)
    VALUES (gen_random_uuid(), v_course_id, 'Chapter 16', 16);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%chapter_limit_exceeded%' THEN
      v_raised := true;
    END IF;
  END;

  ASSERT v_raised, 'Expected chapter_limit_exceeded for athlete tier at 16th chapter';
  RAISE NOTICE 'PASS: athlete tier (max 15) blocks 16th chapter';

  DELETE FROM public.chapters WHERE course_id = v_course_id;
  DELETE FROM public.courses WHERE id = v_course_id;
  DELETE FROM public.users WHERE id = v_user_id;
END;
$$;


DO $$
DECLARE
  v_user_id   uuid := gen_random_uuid();
  v_course_id uuid := gen_random_uuid();
  i           int;
  v_raised    boolean;
BEGIN
  -- Setup: training_center tier (max 50 chapters)
  INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (v_user_id, 'test_tc@test.local', 'TC User', 'creator', 'training_center');

  INSERT INTO public.courses (id, creator_id, title, status, price, level, language)
  VALUES (v_course_id, v_user_id, 'TC Course', 'draft', 0, 'beginner', 'vi');

  FOR i IN 1..50 LOOP
    INSERT INTO public.chapters (id, course_id, title, position)
    VALUES (gen_random_uuid(), v_course_id, 'Chapter ' || i, i);
  END LOOP;

  v_raised := false;
  BEGIN
    INSERT INTO public.chapters (id, course_id, title, position)
    VALUES (gen_random_uuid(), v_course_id, 'Chapter 51', 51);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%chapter_limit_exceeded%' THEN
      v_raised := true;
    END IF;
  END;

  ASSERT v_raised, 'Expected chapter_limit_exceeded for training_center tier at 51st chapter';
  RAISE NOTICE 'PASS: training_center tier (max 50) blocks 51st chapter';

  DELETE FROM public.chapters WHERE course_id = v_course_id;
  DELETE FROM public.courses WHERE id = v_course_id;
  DELETE FROM public.users WHERE id = v_user_id;
END;
$$;

-- ── Test 5 (migration 025): FOR UPDATE lock prevents concurrent race ───────────
-- The concurrent scenario cannot be reliably reproduced in a single-session DO block.
-- Verify instead that the trigger function body contains FOR UPDATE.
DO $$
DECLARE
  v_func_src text;
BEGIN
  SELECT prosrc INTO v_func_src
  FROM pg_proc
  WHERE proname = 'enforce_chapter_limit'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

  ASSERT v_func_src IS NOT NULL, 'enforce_chapter_limit function must exist';
  ASSERT v_func_src LIKE '%FOR UPDATE%',
    'enforce_chapter_limit must lock course row with FOR UPDATE to prevent race condition';
  RAISE NOTICE 'PASS: enforce_chapter_limit contains FOR UPDATE lock (migration 025)';
END;
$$;
