-- ── Migration 100: Enforce live_sessions.lesson_id Course Integrity ─────────
-- Business Invariant:
-- If live_sessions.lesson_id IS NOT NULL, the referenced lesson MUST belong
-- to the same course as live_sessions.course_id (via lessons.chapter_id -> chapters.course_id).
--
-- Schema relationship:
--   lessons (id, chapter_id) -> chapters (id, course_id) -> courses (id)
--   live_sessions (id, course_id, lesson_id)
--
-- This trigger validates on both INSERT and UPDATE operations:
-- 1. INSERT: lesson_id must belong to course_id (if not NULL)
-- 2. UPDATE lesson_id: new lesson_id must belong to current course_id (if not NULL)
-- 3. UPDATE course_id: existing or new lesson_id must belong to new course_id (if not NULL)
-- 4. NULL semantics: setting lesson_id to NULL is always allowed.

CREATE OR REPLACE FUNCTION public.enforce_live_session_lesson_course()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_lesson_course_id uuid;
BEGIN
  -- If lesson_id is NULL, optional relation is valid
  IF NEW.lesson_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Lookup the course_id that owns this lesson through its chapter
  SELECT ch.course_id
  INTO v_lesson_course_id
  FROM public.lessons l
  JOIN public.chapters ch ON ch.id = l.chapter_id
  WHERE l.id = NEW.lesson_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lesson_not_found: Lesson % does not exist', NEW.lesson_id
      USING errcode = '23503'; -- foreign_key_violation
  END IF;

  IF v_lesson_course_id IS DISTINCT FROM NEW.course_id THEN
    RAISE EXCEPTION 'Cross-course lesson link is forbidden: Lesson % belongs to course %, not session course %',
      NEW.lesson_id, v_lesson_course_id, NEW.course_id
      USING errcode = '23514'; -- check_violation
  END IF;

  RETURN NEW;
END;
$$;

-- Coexist with existing lifecycle trigger (trg_live_sessions_lifecycle)
-- and delete protection trigger (trg_protect_live_session_delete)
DROP TRIGGER IF EXISTS trg_live_session_lesson_course ON public.live_sessions;
CREATE TRIGGER trg_live_session_lesson_course
  BEFORE INSERT OR UPDATE ON public.live_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_live_session_lesson_course();
