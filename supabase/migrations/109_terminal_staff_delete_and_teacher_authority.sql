-- ── Migration 109: Terminal Staff DELETE Invariant & Teacher Authority Hardening ──
--
-- 1. Extend live_session_staff server-side invariants to DELETE operations:
--    - Uses OLD.live_session_id for DELETE.
--    - Blocks direct DELETE of staff rows on ENDED and CANCELLED sessions.
--    - Preserves cascade deletion when parent live_session itself is deleted (pg_trigger_depth() > 1).
--    - Preserves existing INSERT/UPDATE invariants (session status check, creator cannot be assistant).
--
-- 2. Resolve admin teacher identity inconsistency:
--    - Course creator is the authoritative teacher for the session.
--    - Platform admin (non-creator) receives classroom role 'student' (with allowed: true, is_admin: true).
--    - Returns authoritative teacher_id and creator_id in check_live_classroom_access().
--    - Client token issuance, LiveClassroomView, teacherId, and DataChannel routing all consistently
--      use the course creator's identity as the sole authoritative teacher.

-- 1. Upgraded enforce_live_session_staff_invariants() supporting DELETE
CREATE OR REPLACE FUNCTION public.enforce_live_session_staff_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_session record;
  v_target_session_id uuid;
BEGIN
  -- Handle DELETE
  IF TG_OP = 'DELETE' THEN
    -- If this is an engine-level foreign key cascade deletion from parent session or course, allow it
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;

    v_target_session_id := OLD.live_session_id;
  ELSE
    v_target_session_id := NEW.live_session_id;
  END IF;

  -- Fetch session and course info
  SELECT s.id, s.status, s.course_id, c.creator_id
  INTO v_session
  FROM public.live_sessions s
  JOIN public.courses c ON c.id = s.course_id
  WHERE s.id = v_target_session_id;

  IF v_session.id IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      -- If parent session row is already deleted/absent, allow cascade delete
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'live_session_not_found' USING errcode = 'P0002';
  END IF;

  -- Invariant: Cannot modify (INSERT, UPDATE, or DELETE) staff for terminal sessions (ENDED or CANCELLED)
  IF v_session.status IN ('ENDED', 'CANCELLED') THEN
    RAISE EXCEPTION 'cannot_modify_staff_on_terminal_session' USING errcode = '23514';
  END IF;

  -- For INSERT or UPDATE: Prevent assigning course creator as assistant
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF NEW.user_id = v_session.creator_id THEN
      RAISE EXCEPTION 'creator_cannot_be_assistant' USING errcode = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RETURN OLD;
END;
$$;

-- Re-create trigger to include DELETE
DROP TRIGGER IF EXISTS trg_enforce_live_session_staff_invariants ON public.live_session_staff;
CREATE TRIGGER trg_enforce_live_session_staff_invariants
  BEFORE INSERT OR UPDATE OR DELETE ON public.live_session_staff
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_live_session_staff_invariants();


-- 2. Upgraded check_live_classroom_access() with Explicit Teacher Authority Model
CREATE OR REPLACE FUNCTION public.check_live_classroom_access(
  p_room_id text,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_session record;
  v_course record;
  v_is_enrolled boolean := false;
  v_is_assistant boolean := false;
  v_is_admin boolean := false;
  v_is_authorized boolean := false;
  v_assigned_role text := 'student';
  v_user_role text;
BEGIN
  -- A. First check if room is a session-based room
  SELECT
    s.id AS session_id,
    s.title AS session_title,
    s.status AS session_status,
    s.scheduled_start_at,
    s.scheduled_end_at,
    s.livekit_room_name,
    s.course_id,
    c.creator_id,
    c.title AS course_title,
    c.price
  INTO v_session
  FROM public.live_sessions s
  JOIN public.courses c ON c.id = s.course_id
  WHERE (s.livekit_room_name = p_room_id OR s.id::text = p_room_id)
  LIMIT 1;

  IF v_session.session_id IS NOT NULL THEN
    -- 1. Unauthenticated check
    IF p_user_id IS NULL THEN
      RETURN jsonb_build_object(
        'is_course_room', true,
        'is_session', true,
        'allowed', false,
        'reason', 'unauthenticated',
        'session_id', v_session.session_id,
        'session_title', v_session.session_title,
        'session_status', v_session.session_status,
        'course_id', v_session.course_id,
        'course_title', v_session.course_title,
        'price', v_session.price
      );
    END IF;

    -- 2. Verify authorization to the course/session
    -- A. Check if course creator -> Authoritative Teacher
    IF v_session.creator_id = p_user_id THEN
      v_is_authorized := true;
      v_assigned_role := 'teacher';
    ELSE
      -- B. Check if explicitly assigned assistant in live_session_staff -> Assistant
      SELECT EXISTS (
        SELECT 1 FROM public.live_session_staff
        WHERE live_session_id = v_session.session_id
          AND user_id = p_user_id
          AND role = 'assistant'
      ) INTO v_is_assistant;

      IF v_is_assistant THEN
        v_is_authorized := true;
        v_assigned_role := 'assistant';
      ELSE
        -- C. Check if platform admin or enrolled learner
        SELECT role INTO v_user_role FROM public.users WHERE id = p_user_id;
        v_is_admin := (v_user_role = 'admin');

        SELECT EXISTS (
          SELECT 1 FROM public.enrollments
          WHERE course_id = v_session.course_id AND user_id = p_user_id
        ) INTO v_is_enrolled;

        -- Platform admin or enrolled learner is allowed entry as 'student' (observer/participant)
        IF v_is_enrolled OR v_is_admin THEN
          v_is_authorized := true;
          v_assigned_role := 'student';
        END IF;
      END IF;
    END IF;

    -- 3. If not authorized, deny with not_enrolled
    IF NOT v_is_authorized THEN
      RETURN jsonb_build_object(
        'is_course_room', true,
        'is_session', true,
        'allowed', false,
        'reason', 'not_enrolled',
        'session_id', v_session.session_id,
        'session_title', v_session.session_title,
        'session_status', v_session.session_status,
        'course_id', v_session.course_id,
        'course_title', v_session.course_title,
        'price', v_session.price
      );
    END IF;

    -- 4. User is authorized -> ENFORCE SESSION STATUS
    IF v_session.session_status <> 'LIVE' THEN
      RETURN jsonb_build_object(
        'is_course_room', true,
        'is_session', true,
        'allowed', false,
        'reason', 'session_not_live',
        'session_id', v_session.session_id,
        'session_title', v_session.session_title,
        'session_status', v_session.session_status,
        'scheduled_start_at', v_session.scheduled_start_at,
        'scheduled_end_at', v_session.scheduled_end_at,
        'livekit_room_name', v_session.livekit_room_name,
        'course_id', v_session.course_id,
        'course_title', v_session.course_title,
        'teacher_id', v_session.creator_id,
        'creator_id', v_session.creator_id,
        'role', v_assigned_role
      );
    END IF;

    -- 5. Authorized and status is LIVE -> ALLOW
    RETURN jsonb_build_object(
      'is_course_room', true,
      'is_session', true,
      'allowed', true,
      'role', v_assigned_role,
      'teacher_id', v_session.creator_id,
      'creator_id', v_session.creator_id,
      'is_creator', (v_session.creator_id = p_user_id),
      'is_admin', (v_user_role = 'admin'),
      'is_assistant', v_is_assistant,
      'is_enrolled', v_is_enrolled,
      'session_id', v_session.session_id,
      'session_title', v_session.session_title,
      'session_status', v_session.session_status,
      'livekit_room_name', v_session.livekit_room_name,
      'course_id', v_session.course_id,
      'course_title', v_session.course_title
    );
  END IF;

  -- B. Fallback: Check legacy course room (by courses.live_room_id or courses.id)
  SELECT c.id, c.creator_id, c.title, c.price, c.course_type, c.live_status, c.live_schedule, c.status
  INTO v_course
  FROM public.courses c
  WHERE (c.live_room_id = p_room_id OR c.id::text = p_room_id)
  LIMIT 1;

  -- If not a course room at all, allow generic access (e.g. demo room)
  IF v_course IS NULL THEN
    RETURN jsonb_build_object(
      'is_course_room', false,
      'is_session', false,
      'allowed', true,
      'role', 'student',
      'livekit_room_name', p_room_id
    );
  END IF;

  -- Legacy course room authentication check
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'is_course_room', true,
      'is_session', false,
      'allowed', false,
      'reason', 'unauthenticated',
      'course_id', v_course.id,
      'course_title', v_course.title,
      'price', v_course.price
    );
  END IF;

  -- Creator
  IF v_course.creator_id = p_user_id THEN
    RETURN jsonb_build_object(
      'is_course_room', true,
      'is_session', false,
      'allowed', true,
      'role', 'teacher',
      'teacher_id', v_course.creator_id,
      'creator_id', v_course.creator_id,
      'is_creator', true,
      'course_id', v_course.id,
      'course_title', v_course.title
    );
  END IF;

  -- Admin (non-creator accesses legacy room as student with is_admin=true)
  SELECT role INTO v_user_role FROM public.users WHERE id = p_user_id;
  IF v_user_role = 'admin' THEN
    RETURN jsonb_build_object(
      'is_course_room', true,
      'is_session', false,
      'allowed', true,
      'role', 'student',
      'teacher_id', v_course.creator_id,
      'creator_id', v_course.creator_id,
      'is_admin', true,
      'course_id', v_course.id,
      'course_title', v_course.title
    );
  END IF;

  -- Student enrolled
  SELECT EXISTS (
    SELECT 1 FROM public.enrollments
    WHERE course_id = v_course.id AND user_id = p_user_id
  ) INTO v_is_enrolled;

  IF v_is_enrolled THEN
    RETURN jsonb_build_object(
      'is_course_room', true,
      'is_session', false,
      'allowed', true,
      'role', 'student',
      'teacher_id', v_course.creator_id,
      'creator_id', v_course.creator_id,
      'is_enrolled', true,
      'course_id', v_course.id,
      'course_title', v_course.title
    );
  END IF;

  -- Course published / free
  IF v_course.price = 0 AND v_course.status = 'published' THEN
    RETURN jsonb_build_object(
      'is_course_room', true,
      'is_session', false,
      'allowed', true,
      'role', 'student',
      'teacher_id', v_course.creator_id,
      'creator_id', v_course.creator_id,
      'is_enrolled', false,
      'course_id', v_course.id,
      'course_title', v_course.title
    );
  END IF;

  -- Denied
  RETURN jsonb_build_object(
    'is_course_room', true,
    'is_session', false,
    'allowed', false,
    'reason', 'not_enrolled',
    'course_id', v_course.id,
    'course_title', v_course.title,
    'price', v_course.price
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_live_classroom_access(text, uuid) TO authenticated, anon;
