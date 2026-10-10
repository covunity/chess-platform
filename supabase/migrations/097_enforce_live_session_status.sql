-- ── Migration 097: Enforce live_sessions.status before issuing LiveKit token ───
-- Fixes P0 security issue where users could join live_sessions that are
-- in DRAFT, SCHEDULED, ENDED, or CANCELLED status.
--
-- Rule:
-- For live_sessions:
--   DRAFT     -> DENY (reason = 'session_not_live')
--   SCHEDULED -> DENY (reason = 'session_not_live')
--   ENDED     -> DENY (reason = 'session_not_live')
--   CANCELLED -> DENY (reason = 'session_not_live')
--   LIVE      -> ALLOW
--
-- Creators and admins MUST NOT bypass status (they must call start_live_session first).
-- Legacy course rooms (courses.live_room_id) remain backward compatible.

CREATE OR REPLACE FUNCTION public.check_live_classroom_access(
  p_room_id text,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_session record;
  v_course record;
  v_user_role text;
  v_is_authorized boolean := false;
  v_assigned_role text := 'student';
  v_is_enrolled boolean := false;
BEGIN
  -- A. First check if p_room_id matches a live_session (by id or livekit_room_name)
  SELECT
    s.id AS session_id,
    s.title AS session_title,
    s.status AS session_status,
    s.scheduled_start_at,
    s.scheduled_end_at,
    s.livekit_room_name,
    c.id AS course_id,
    c.creator_id,
    c.title AS course_title,
    c.price,
    c.course_type,
    c.status AS course_status
  INTO v_session
  FROM public.live_sessions s
  JOIN public.courses c ON c.id = s.course_id
  WHERE (s.id::text = p_room_id OR s.livekit_room_name = p_room_id)
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
    -- Check if creator
    IF v_session.creator_id = p_user_id THEN
      v_is_authorized := true;
      v_assigned_role := 'teacher';
    ELSE
      -- Check if platform admin
      SELECT role INTO v_user_role FROM public.users WHERE id = p_user_id;
      IF v_user_role = 'admin' THEN
        v_is_authorized := true;
        v_assigned_role := 'teacher';
      ELSE
        -- Check if student is enrolled
        SELECT EXISTS (
          SELECT 1 FROM public.enrollments
          WHERE course_id = v_session.course_id AND user_id = p_user_id
        ) INTO v_is_enrolled;

        IF v_is_enrolled THEN
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
    -- Only status = 'LIVE' is allowed to join the live room.
    -- DRAFT, SCHEDULED, ENDED, and CANCELLED must be denied.
    -- Creators and admins MUST NOT bypass status (must call start_live_session first).
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
        'role', v_assigned_role
      );
    END IF;

    -- 5. Authorized and status is LIVE -> ALLOW
    RETURN jsonb_build_object(
      'is_course_room', true,
      'is_session', true,
      'allowed', true,
      'role', v_assigned_role,
      'is_creator', (v_session.creator_id = p_user_id),
      'is_admin', (v_user_role = 'admin'),
      'is_enrolled', v_is_enrolled,
      'session_id', v_session.session_id,
      'session_title', v_session.session_title,
      'session_status', 'LIVE',
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
  IF v_course.id IS NULL THEN
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
      'is_creator', true,
      'course_id', v_course.id,
      'course_title', v_course.title,
      'livekit_room_name', p_room_id
    );
  END IF;

  -- Admin
  SELECT role INTO v_user_role FROM public.users WHERE id = p_user_id;
  IF v_user_role = 'admin' THEN
    RETURN jsonb_build_object(
      'is_course_room', true,
      'is_session', false,
      'allowed', true,
      'role', 'teacher',
      'is_admin', true,
      'course_id', v_course.id,
      'course_title', v_course.title,
      'livekit_room_name', p_room_id
    );
  END IF;

  -- Enrolled student
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
      'is_enrolled', true,
      'course_id', v_course.id,
      'course_title', v_course.title,
      'livekit_room_name', p_room_id
    );
  END IF;

  -- Not enrolled
  RETURN jsonb_build_object(
    'is_course_room', true,
    'is_session', false,
    'allowed', false,
    'reason', 'not_enrolled',
    'course_id', v_course.id,
    'course_title', v_course.title,
    'price', v_course.price,
    'live_schedule', v_course.live_schedule
  );
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.check_live_classroom_access(text, uuid) TO authenticated, anon;
