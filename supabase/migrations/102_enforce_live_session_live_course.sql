-- ── Migration 102: Enforce live_sessions only for LIVE courses ─────────────────
-- Business Invariant:
-- live_sessions.course_id -> courses.course_type = 'live'
--
-- Two-sided enforcement:
-- 1. On public.live_sessions (BEFORE INSERT OR UPDATE OF course_id):
--    Verify that the referenced course has course_type = 'live'.
-- 2. On public.courses (BEFORE UPDATE OF course_type):
--    Disallow changing course_type from 'live' to anything else if the course
--    currently has any live_sessions.

-- Part 1: Function and Trigger on live_sessions
CREATE OR REPLACE FUNCTION public.enforce_live_session_course_type()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_course_type text;
BEGIN
  -- On UPDATE, only check if course_id actually changed
  IF TG_OP = 'UPDATE' AND NEW.course_id IS NOT DISTINCT FROM OLD.course_id THEN
    RETURN NEW;
  END IF;

  SELECT course_type
  INTO v_course_type
  FROM public.courses
  WHERE id = NEW.course_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'course_not_found: Course % does not exist', NEW.course_id
      USING errcode = '23503'; -- foreign_key_violation
  END IF;

  IF v_course_type IS DISTINCT FROM 'live' THEN
    RAISE EXCEPTION 'Live sessions are only allowed for live courses: Course % has course_type ''%'', expected ''live''',
      NEW.course_id, v_course_type
      USING errcode = '23514'; -- check_violation
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_live_session_course_type ON public.live_sessions;
CREATE TRIGGER trg_live_session_course_type
  BEFORE INSERT OR UPDATE OF course_id ON public.live_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_live_session_course_type();

-- Part 2: Function and Trigger on courses
CREATE OR REPLACE FUNCTION public.enforce_course_type_has_no_live_sessions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_session_count integer;
BEGIN
  -- Only validate if course_type changed from 'live' to something else (e.g. 'standard')
  IF OLD.course_type = 'live' AND NEW.course_type IS DISTINCT FROM 'live' THEN
    SELECT count(*)
    INTO v_session_count
    FROM public.live_sessions
    WHERE course_id = NEW.id;

    IF v_session_count > 0 THEN
      RAISE EXCEPTION 'Cannot change course_type to ''%'': Course % currently has % live session(s)',
        NEW.course_type, NEW.id, v_session_count
        USING errcode = '23514'; -- check_violation
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_course_type_live_sessions ON public.courses;
CREATE TRIGGER trg_course_type_live_sessions
  BEFORE UPDATE OF course_type ON public.courses
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_course_type_has_no_live_sessions();
