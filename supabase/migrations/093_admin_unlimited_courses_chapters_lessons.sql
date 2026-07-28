-- Migration 093: Admin role has unlimited capacity (courses, chapters, lessons).
-- Users with role = 'admin' are not restricted by account_tier caps or quota limits.

-- ── 1. resolve_max_lessons_per_course: admin role returns 999999 (unlimited) ─
CREATE OR REPLACE FUNCTION public.resolve_max_lessons_per_course(p_user_id uuid)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT CASE
    WHEN u.role = 'admin' THEN 999999
    ELSE COALESCE(
      u.max_lessons_per_course_override,
      at.max_lessons_per_course,
      30
    )
  END
  FROM public.users u
  LEFT JOIN public.account_tiers at ON at.code = u.account_tier_id
  WHERE u.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.resolve_max_lessons_per_course(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_max_lessons_per_course(uuid) TO authenticated;

-- ── 2. enforce_chapter_limit: short-circuit for role = 'admin' ───────────────
CREATE OR REPLACE FUNCTION public.enforce_chapter_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator_id       uuid;
  v_creator_role     text;
  v_tier_id          text;
  v_max_chapters     int;
  v_current_count    int;
BEGIN
  -- Serialize concurrent chapter inserts for the same course by locking its row.
  PERFORM 1 FROM public.courses WHERE id = NEW.course_id FOR UPDATE;

  SELECT u.id, u.role, u.account_tier_id, at.max_chapters_per_course
  INTO v_creator_id, v_creator_role, v_tier_id, v_max_chapters
  FROM public.courses c
  JOIN public.users u ON u.id = c.creator_id
  LEFT JOIN public.account_tiers at ON at.code = u.account_tier_id
  WHERE c.id = NEW.course_id;

  -- Admin role has unlimited chapter capacity
  IF v_creator_role = 'admin' THEN
    RETURN NEW;
  END IF;

  v_max_chapters := COALESCE(v_max_chapters, 10);

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

-- ── 3. enforce_lesson_limit: short-circuit for role = 'admin' ────────────────
CREATE OR REPLACE FUNCTION public.enforce_lesson_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_id     uuid;
  v_creator_id    uuid;
  v_creator_role  text;
  v_max_lessons   int;
  v_current_count int;
BEGIN
  SELECT ch.course_id INTO v_course_id
  FROM public.chapters ch
  WHERE ch.id = NEW.chapter_id;

  IF v_course_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM public.courses WHERE id = v_course_id FOR UPDATE;

  SELECT u.id, u.role INTO v_creator_id, v_creator_role
  FROM public.courses c
  JOIN public.users u ON u.id = c.creator_id
  WHERE c.id = v_course_id;

  IF v_creator_role = 'admin' THEN
    RETURN NEW;
  END IF;

  v_max_lessons := public.resolve_max_lessons_per_course(v_creator_id);

  SELECT count(*) INTO v_current_count
  FROM public.lessons l
  JOIN public.chapters ch ON ch.id = l.chapter_id
  WHERE ch.course_id = v_course_id;

  IF v_current_count >= v_max_lessons THEN
    RAISE EXCEPTION 'lesson_limit_exceeded: current=%, max=%',
      v_current_count, v_max_lessons
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
