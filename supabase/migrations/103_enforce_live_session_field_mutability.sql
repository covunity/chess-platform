-- ── Migration 103: Enforce Lifecycle-Aware Live Session Field Mutability ────────
-- Business Rules:
-- 1. DRAFT:
--    - Normal editable metadata fields remain editable.
--    - course_id may be changed if target course is live and lesson integrity is valid.
-- 2. SCHEDULED:
--    - Normal session metadata remains editable (title, description, schedule, agenda, lesson_id, max_participants, etc.).
--    - course_id MUST NOT be changed once session is SCHEDULED.
-- 3. LIVE:
--    - course_id MUST NOT be changed.
--    - lesson_id MUST NOT be changed.
--    - scheduled_start_at MUST NOT be changed.
--    - scheduled_end_at MUST NOT be changed.
--    - max_participants, title, description, agenda, objectives, notes, timezone remain editable.
-- 4. ENDED:
--    - Session is strictly read-only for normal editable metadata:
--      course_id, lesson_id, title, description, scheduled_start_at, scheduled_end_at,
--      timezone, agenda, learning_objectives, preparation_notes, max_participants.
-- 5. CANCELLED:
--    - Same read-only policy as ENDED.
--
-- Existing server-owned protections (status, livekit_room_name, started_at, ended_at)
-- remain enforced by trg_live_sessions_lifecycle (Migration 098).

CREATE OR REPLACE FUNCTION public.enforce_live_session_field_mutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- 1. ENDED or CANCELLED sessions are strictly read-only for normal editable fields
  IF OLD.status IN ('ENDED', 'CANCELLED') THEN
    IF NEW.course_id IS DISTINCT FROM OLD.course_id
       OR NEW.lesson_id IS DISTINCT FROM OLD.lesson_id
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.scheduled_start_at IS DISTINCT FROM OLD.scheduled_start_at
       OR NEW.scheduled_end_at IS DISTINCT FROM OLD.scheduled_end_at
       OR NEW.timezone IS DISTINCT FROM OLD.timezone
       OR NEW.agenda IS DISTINCT FROM OLD.agenda
       OR NEW.learning_objectives IS DISTINCT FROM OLD.learning_objectives
       OR NEW.preparation_notes IS DISTINCT FROM OLD.preparation_notes
       OR NEW.max_participants IS DISTINCT FROM OLD.max_participants
    THEN
      RAISE EXCEPTION 'Cannot modify session in % status. Session is read-only.', OLD.status
        USING errcode = '42501'; -- insufficient_privilege / forbidden
    END IF;
  END IF;

  -- 2. LIVE sessions:
  -- Frozen: course_id, lesson_id, scheduled_start_at, scheduled_end_at
  -- Mutable: title, description, agenda, learning_objectives, preparation_notes, timezone, max_participants
  IF OLD.status = 'LIVE' THEN
    IF NEW.course_id IS DISTINCT FROM OLD.course_id THEN
      RAISE EXCEPTION 'Cannot change course_id while session is in LIVE status'
        USING errcode = '42501';
    END IF;

    IF NEW.lesson_id IS DISTINCT FROM OLD.lesson_id THEN
      RAISE EXCEPTION 'Cannot change lesson_id while session is in LIVE status'
        USING errcode = '42501';
    END IF;

    IF NEW.scheduled_start_at IS DISTINCT FROM OLD.scheduled_start_at THEN
      RAISE EXCEPTION 'Cannot change scheduled_start_at while session is in LIVE status'
        USING errcode = '42501';
    END IF;

    IF NEW.scheduled_end_at IS DISTINCT FROM OLD.scheduled_end_at THEN
      RAISE EXCEPTION 'Cannot change scheduled_end_at while session is in LIVE status'
        USING errcode = '42501';
    END IF;
  END IF;

  -- 3. SCHEDULED sessions:
  -- Frozen: course_id
  -- Mutable: title, description, agenda, learning_objectives, preparation_notes, timezone, max_participants, lesson_id, scheduled_start_at, scheduled_end_at
  IF OLD.status = 'SCHEDULED' THEN
    IF NEW.course_id IS DISTINCT FROM OLD.course_id THEN
      RAISE EXCEPTION 'Cannot change course_id once session is SCHEDULED'
        USING errcode = '42501';
    END IF;
  END IF;

  -- 4. DRAFT sessions:
  -- All editable fields and course_id remain editable (subject to course/lesson integrity triggers).

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_live_session_field_mutability ON public.live_sessions;
CREATE TRIGGER trg_live_session_field_mutability
  BEFORE UPDATE ON public.live_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_live_session_field_mutability();
