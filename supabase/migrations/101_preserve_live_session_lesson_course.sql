-- ── Migration 101: Preserve live_sessions lesson/course invariant on moves ──
-- Business Invariant:
-- live_sessions.lesson_id IS NULL OR lesson's current chapter.course_id = live_sessions.course_id
--
-- Migration 100 ensures that live_sessions cannot be inserted or updated with a cross-course lesson.
-- Migration 101 prevents breaking the invariant via inverse operations:
-- 1. Moving a lesson (UPDATE lessons.chapter_id) to a chapter in another course while referenced by a live_session.
-- 2. Moving a chapter (UPDATE chapters.course_id) to another course while containing a lesson referenced by a live_session.

CREATE OR REPLACE FUNCTION public.enforce_lesson_chapter_live_session_course()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_course_id uuid;
  v_conflicting_session_id uuid;
  v_conflicting_course_id uuid;
BEGIN
  -- Only validate if chapter_id changed
  IF NEW.chapter_id IS NOT DISTINCT FROM OLD.chapter_id THEN
    RETURN NEW;
  END IF;

  -- Lookup course_id of the target chapter
  SELECT course_id
  INTO v_new_course_id
  FROM public.chapters
  WHERE id = NEW.chapter_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'chapter_not_found: Chapter % does not exist', NEW.chapter_id
      USING errcode = '23503'; -- foreign_key_violation
  END IF;

  -- Reject if this lesson is referenced by any live session belonging to a different course
  SELECT id, course_id
  INTO v_conflicting_session_id, v_conflicting_course_id
  FROM public.live_sessions
  WHERE lesson_id = NEW.id
    AND course_id IS DISTINCT FROM v_new_course_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Cannot move lesson %: referenced by live session % of course %, but target chapter % belongs to course %',
      NEW.id, v_conflicting_session_id, v_conflicting_course_id, NEW.chapter_id, v_new_course_id
      USING errcode = '23514'; -- check_violation
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lesson_chapter_live_session_course ON public.lessons;
CREATE TRIGGER trg_lesson_chapter_live_session_course
  BEFORE UPDATE OF chapter_id ON public.lessons
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_lesson_chapter_live_session_course();


CREATE OR REPLACE FUNCTION public.enforce_chapter_course_live_session()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_conflicting_session_id uuid;
  v_conflicting_lesson_id uuid;
  v_conflicting_course_id uuid;
BEGIN
  -- Only validate if course_id changed
  IF NEW.course_id IS NOT DISTINCT FROM OLD.course_id THEN
    RETURN NEW;
  END IF;

  -- Reject if any lesson in this chapter is referenced by a live session belonging to a different course
  SELECT ls.id, ls.lesson_id, ls.course_id
  INTO v_conflicting_session_id, v_conflicting_lesson_id, v_conflicting_course_id
  FROM public.live_sessions ls
  JOIN public.lessons l ON l.id = ls.lesson_id
  WHERE l.chapter_id = NEW.id
    AND ls.course_id IS DISTINCT FROM NEW.course_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Cannot move chapter % to course %: lesson % is referenced by live session % belonging to course %',
      NEW.id, NEW.course_id, v_conflicting_lesson_id, v_conflicting_session_id, v_conflicting_course_id
      USING errcode = '23514'; -- check_violation
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chapter_course_live_session ON public.chapters;
CREATE TRIGGER trg_chapter_course_live_session
  BEFORE UPDATE OF course_id ON public.chapters
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_chapter_course_live_session();
