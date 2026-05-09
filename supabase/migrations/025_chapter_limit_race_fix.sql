-- Migration 025: Fix race condition in enforce_chapter_limit trigger (issue #99).
-- Lock the course row with FOR UPDATE before counting chapters so that two
-- concurrent INSERT chapter transactions serialize and only one can pass when
-- count = max - 1.

CREATE OR REPLACE FUNCTION public.enforce_chapter_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_creator_id       uuid;
  v_tier_id          text;
  v_max_chapters     int;
  v_current_count    int;
BEGIN
  -- Serialize concurrent chapter inserts for the same course by locking its row.
  PERFORM 1 FROM public.courses WHERE id = NEW.course_id FOR UPDATE;

  SELECT creator_id INTO v_creator_id
  FROM public.courses
  WHERE id = NEW.course_id;

  SELECT u.account_tier_id, at.max_chapters_per_course
  INTO v_tier_id, v_max_chapters
  FROM public.users u
  JOIN public.account_tiers at ON at.code = u.account_tier_id
  WHERE u.id = v_creator_id;

  SELECT count(*) INTO v_current_count
  FROM public.chapters
  WHERE course_id = NEW.course_id;

  IF v_current_count >= v_max_chapters THEN
    RAISE EXCEPTION 'chapter_limit_exceeded: tier=%, current=%, max=%',
      v_tier_id, v_current_count, v_max_chapters;
  END IF;

  RETURN NEW;
END;
$$;
