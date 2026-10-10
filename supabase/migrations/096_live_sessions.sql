-- ── Migration 096: Live Sessions Layer ────────────────────────────────────────
-- Implements the scheduled Live Session layer on top of courses and lessons.
-- Course -> Chapters -> Lessons (Curriculum/Content)
--        -> Live Sessions (Actual scheduled occurrences of teaching)
--
-- Each scheduled session has its own LiveKit room identity, structured agenda,
-- learning objectives, preparation notes, and status lifecycle.
-- Legacy course-level live fields (courses.live_room_id) remain for backward compatibility.

-- 1. Create table public.live_sessions
CREATE TABLE IF NOT EXISTS public.live_sessions (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id            uuid        NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  lesson_id            uuid        NULL REFERENCES public.lessons(id) ON DELETE SET NULL,
  title                text        NOT NULL CHECK (char_length(trim(title)) > 0 AND char_length(title) <= 200),
  description          text        NULL,
  scheduled_start_at   timestamptz NOT NULL,
  scheduled_end_at     timestamptz NULL,
  timezone             text        NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  status               text        NOT NULL DEFAULT 'SCHEDULED'
                       CHECK (status IN ('DRAFT', 'SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED')),
  agenda               jsonb       NOT NULL DEFAULT '[]'::jsonb,
  learning_objectives  text[]      NOT NULL DEFAULT '{}',
  preparation_notes    text        NULL,
  max_participants     integer     NULL CHECK (max_participants IS NULL OR max_participants > 0),
  livekit_room_name    text        NOT NULL,
  started_at           timestamptz NULL,
  ended_at             timestamptz NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_sessions_schedule_chk CHECK (
    scheduled_end_at IS NULL OR scheduled_end_at > scheduled_start_at
  )
);

-- 2. Indexes for efficient lookup
CREATE INDEX IF NOT EXISTS idx_live_sessions_course_id
  ON public.live_sessions (course_id);

CREATE INDEX IF NOT EXISTS idx_live_sessions_scheduled_start
  ON public.live_sessions (scheduled_start_at);

CREATE INDEX IF NOT EXISTS idx_live_sessions_status
  ON public.live_sessions (status);

CREATE INDEX IF NOT EXISTS idx_live_sessions_lesson_id
  ON public.live_sessions (lesson_id)
  WHERE lesson_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_live_sessions_room_name
  ON public.live_sessions (livekit_room_name);

-- 3. Trigger for updated_at
CREATE TRIGGER live_sessions_updated_at
  BEFORE UPDATE ON public.live_sessions
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- 4. Enable Row Level Security
ALTER TABLE public.live_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: Creators can manage sessions of their own courses
CREATE POLICY "Creators can manage own course live_sessions"
  ON public.live_sessions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = course_id AND c.creator_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = course_id AND c.creator_id = auth.uid()
    )
  );

-- Policy: Admins can view and manage all live_sessions
CREATE POLICY "Admins can manage all live_sessions"
  ON public.live_sessions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- Policy: Enrolled learners can read non-draft sessions
CREATE POLICY "Enrolled learners can view live_sessions"
  ON public.live_sessions
  FOR SELECT
  USING (
    status != 'DRAFT'
    AND EXISTS (
      SELECT 1 FROM public.enrollments e
      WHERE e.course_id = live_sessions.course_id AND e.user_id = auth.uid()
    )
  );

-- Policy: Public / prospective students can read non-draft sessions of published courses
CREATE POLICY "Public can view live_sessions of published courses"
  ON public.live_sessions
  FOR SELECT
  USING (
    status != 'DRAFT'
    AND EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = live_sessions.course_id AND c.status = 'published'
    )
  );

-- 5. Server-controlled lifecycle RPC: start_live_session
CREATE OR REPLACE FUNCTION public.start_live_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_session public.live_sessions%ROWTYPE;
  v_creator_id uuid;
  v_user_role text;
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = '42501';
  END IF;

  SELECT c.creator_id
  INTO v_creator_id
  FROM public.live_sessions s
  JOIN public.courses c ON c.id = s.course_id
  WHERE s.id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found' USING errcode = '22023';
  END IF;

  SELECT role INTO v_user_role FROM public.users WHERE id = v_caller;

  IF v_creator_id != v_caller AND v_user_role != 'admin' THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  UPDATE public.live_sessions
  SET status = 'LIVE',
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session.id,
    'status', v_session.status,
    'livekit_room_name', v_session.livekit_room_name,
    'started_at', v_session.started_at
  );
END;
$$;

-- 6. Server-controlled lifecycle RPC: end_live_session
CREATE OR REPLACE FUNCTION public.end_live_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_session public.live_sessions%ROWTYPE;
  v_creator_id uuid;
  v_user_role text;
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = '42501';
  END IF;

  SELECT c.creator_id
  INTO v_creator_id
  FROM public.live_sessions s
  JOIN public.courses c ON c.id = s.course_id
  WHERE s.id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found' USING errcode = '22023';
  END IF;

  SELECT role INTO v_user_role FROM public.users WHERE id = v_caller;

  IF v_creator_id != v_caller AND v_user_role != 'admin' THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  UPDATE public.live_sessions
  SET status = 'ENDED',
      ended_at = now(),
      updated_at = now()
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session.id,
    'status', v_session.status,
    'ended_at', v_session.ended_at
  );
END;
$$;

-- 7. Upgraded check_live_classroom_access with session awareness & backward compatibility
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

  IF v_session IS NOT NULL THEN
    -- Room is a scheduled live session
    IF p_user_id IS NULL THEN
      RETURN jsonb_build_object(
        'is_course_room', true,
        'is_session', true,
        'allowed', false,
        'reason', 'unauthenticated',
        'session_id', v_session.session_id,
        'session_title', v_session.session_title,
        'course_id', v_session.course_id,
        'course_title', v_session.course_title,
        'price', v_session.price
      );
    END IF;

    -- Check if creator
    IF v_session.creator_id = p_user_id THEN
      RETURN jsonb_build_object(
        'is_course_room', true,
        'is_session', true,
        'allowed', true,
        'role', 'teacher',
        'is_creator', true,
        'session_id', v_session.session_id,
        'session_title', v_session.session_title,
        'livekit_room_name', v_session.livekit_room_name,
        'course_id', v_session.course_id,
        'course_title', v_session.course_title
      );
    END IF;

    -- Check if admin
    SELECT role INTO v_user_role FROM public.users WHERE id = p_user_id;
    IF v_user_role = 'admin' THEN
      RETURN jsonb_build_object(
        'is_course_room', true,
        'is_session', true,
        'allowed', true,
        'role', 'teacher',
        'is_admin', true,
        'session_id', v_session.session_id,
        'session_title', v_session.session_title,
        'livekit_room_name', v_session.livekit_room_name,
        'course_id', v_session.course_id,
        'course_title', v_session.course_title
      );
    END IF;

    -- Check if student enrolled
    SELECT EXISTS (
      SELECT 1 FROM public.enrollments
      WHERE course_id = v_session.course_id AND user_id = p_user_id
    ) INTO v_is_enrolled;

    IF v_is_enrolled THEN
      RETURN jsonb_build_object(
        'is_course_room', true,
        'is_session', true,
        'allowed', true,
        'role', 'student',
        'is_enrolled', true,
        'session_id', v_session.session_id,
        'session_title', v_session.session_title,
        'livekit_room_name', v_session.livekit_room_name,
        'course_id', v_session.course_id,
        'course_title', v_session.course_title
      );
    END IF;

    -- Not enrolled in course
    RETURN jsonb_build_object(
      'is_course_room', true,
      'is_session', true,
      'allowed', false,
      'reason', 'not_enrolled',
      'session_id', v_session.session_id,
      'session_title', v_session.session_title,
      'course_id', v_session.course_id,
      'course_title', v_session.course_title,
      'price', v_session.price
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
GRANT EXECUTE ON FUNCTION public.start_live_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_live_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_live_classroom_access(text, uuid) TO authenticated, anon;
