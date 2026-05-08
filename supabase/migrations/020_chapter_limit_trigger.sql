-- Migration 020: Enforce max_chapters_per_course per account tier
-- See docs/adr/0002-enterprise-account-tiers.md (E-06, E-11)
-- BEFORE INSERT backstop on chapters table.

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
  -- Resolve the course's creator
  SELECT creator_id INTO v_creator_id
  FROM public.courses
  WHERE id = NEW.course_id;

  -- Resolve the creator's tier limit
  SELECT u.account_tier_id, at.max_chapters_per_course
  INTO v_tier_id, v_max_chapters
  FROM public.users u
  JOIN public.account_tiers at ON at.code = u.account_tier_id
  WHERE u.id = v_creator_id;

  -- Count existing chapters for this course
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

DROP TRIGGER IF EXISTS enforce_chapter_limit_trigger ON public.chapters;

CREATE TRIGGER enforce_chapter_limit_trigger
  BEFORE INSERT ON public.chapters
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_chapter_limit();
