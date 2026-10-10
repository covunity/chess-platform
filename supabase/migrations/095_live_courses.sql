-- ── Migration 095: Live Courses (Online Interactive Courses) ────────────────
-- Adds course_type ('standard' | 'live') to courses table, along with live classroom metadata.
-- Creator & Admin can create live courses with a designated room and schedule.
-- Learners must enroll/register in order to access the live classroom.

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS course_type text NOT NULL DEFAULT 'standard' CHECK (course_type IN ('standard', 'live')),
  ADD COLUMN IF NOT EXISTS live_room_id text,
  ADD COLUMN IF NOT EXISTS live_schedule text,
  ADD COLUMN IF NOT EXISTS live_status text NOT NULL DEFAULT 'scheduled' CHECK (live_status IN ('scheduled', 'live', 'ended'));

-- Create index on live_room_id for quick lookups
CREATE INDEX IF NOT EXISTS idx_courses_live_room_id ON public.courses (live_room_id) WHERE live_room_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_courses_course_type ON public.courses (course_type);

-- Function to validate live classroom access and return role
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
  v_course record;
  v_user_role text;
  v_is_enrolled boolean := false;
BEGIN
  -- 1. Try to find the course linked to this room (by live_room_id or by course id)
  SELECT c.id, c.creator_id, c.title, c.price, c.course_type, c.live_status, c.live_schedule, c.status
  INTO v_course
  FROM public.courses c
  WHERE (c.live_room_id = p_room_id OR c.id::text = p_room_id)
  LIMIT 1;

  -- If not a course-specific room, allow standard access (e.g. demo room)
  IF v_course IS NULL THEN
    RETURN jsonb_build_object(
      'is_course_room', false,
      'allowed', true,
      'role', 'student'
    );
  END IF;

  -- If room is for a course, user must be authenticated
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'is_course_room', true,
      'allowed', false,
      'reason', 'unauthenticated',
      'course_id', v_course.id,
      'course_title', v_course.title,
      'price', v_course.price
    );
  END IF;

  -- 2. Check if user is the course creator
  IF v_course.creator_id = p_user_id THEN
    RETURN jsonb_build_object(
      'is_course_room', true,
      'allowed', true,
      'role', 'teacher',
      'is_creator', true,
      'course_id', v_course.id,
      'course_title', v_course.title
    );
  END IF;

  -- 3. Check if user is platform admin
  SELECT role INTO v_user_role FROM public.users WHERE id = p_user_id;
  IF v_user_role = 'admin' THEN
    RETURN jsonb_build_object(
      'is_course_room', true,
      'allowed', true,
      'role', 'teacher',
      'is_admin', true,
      'course_id', v_course.id,
      'course_title', v_course.title
    );
  END IF;

  -- 4. Check if student has enrolled
  SELECT EXISTS (
    SELECT 1 FROM public.enrollments
    WHERE course_id = v_course.id AND user_id = p_user_id
  ) INTO v_is_enrolled;

  IF v_is_enrolled THEN
    RETURN jsonb_build_object(
      'is_course_room', true,
      'allowed', true,
      'role', 'student',
      'is_enrolled', true,
      'course_id', v_course.id,
      'course_title', v_course.title
    );
  END IF;

  -- Not enrolled
  RETURN jsonb_build_object(
    'is_course_room', true,
    'allowed', false,
    'reason', 'not_enrolled',
    'course_id', v_course.id,
    'course_title', v_course.title,
    'price', v_course.price,
    'live_schedule', v_course.live_schedule
  );
END;
$$;

-- Grant execution to public / authenticated users
GRANT EXECUTE ON FUNCTION public.check_live_classroom_access(text, uuid) TO authenticated, anon;
