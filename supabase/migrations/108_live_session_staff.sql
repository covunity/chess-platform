-- ── Migration 108: Authoritative Assistant Role & live_session_staff ─────────
-- F-07: Implements session-scoped assistant authorization end-to-end.
--
-- 1. Table: public.live_session_staff
--    - Session-scoped assignment model (no public.users.role mutation)
--    - Strict role CHECK (role IN ('assistant'))
--    - Unique constraint on (live_session_id, user_id)
--    - Cascade delete on live_sessions and auth.users
--
-- 2. Invariants & Triggers:
--    - Prevent assigning course creator as assistant
--    - Block modifying staff on terminal sessions (ENDED or CANCELLED)
--
-- 3. RLS:
--    - Creator of course or platform admin can INSERT, UPDATE, DELETE
--    - Students, assistants, and unrelated creators cannot modify staff
--
-- 4. Authoritative check_live_classroom_access():
--    - Creator / Admin -> teacher
--    - live_session_staff -> assistant
--    - enrollments -> student
--    - Neither -> not_enrolled

CREATE TABLE IF NOT EXISTS public.live_session_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_session_id uuid NOT NULL REFERENCES public.live_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('assistant')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_session_staff_session_user_key UNIQUE (live_session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_live_session_staff_session_id ON public.live_session_staff(live_session_id);
CREATE INDEX IF NOT EXISTS idx_live_session_staff_user_id ON public.live_session_staff(user_id);

-- Enforce server-side invariants
CREATE OR REPLACE FUNCTION public.enforce_live_session_staff_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_session record;
BEGIN
  -- Fetch session and course info
  SELECT s.id, s.status, s.course_id, c.creator_id
  INTO v_session
  FROM public.live_sessions s
  JOIN public.courses c ON c.id = s.course_id
  WHERE s.id = NEW.live_session_id;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'live_session_not_found' USING errcode = 'P0002';
  END IF;

  -- Block modifying staff on terminal sessions (ENDED or CANCELLED)
  IF v_session.status IN ('ENDED', 'CANCELLED') THEN
    RAISE EXCEPTION 'cannot_modify_staff_on_terminal_session' USING errcode = '23514';
  END IF;

  -- Prevent assigning course creator as assistant
  IF NEW.user_id = v_session.creator_id THEN
    RAISE EXCEPTION 'creator_cannot_be_assistant' USING errcode = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_live_session_staff_invariants ON public.live_session_staff;
CREATE TRIGGER trg_enforce_live_session_staff_invariants
  BEFORE INSERT OR UPDATE ON public.live_session_staff
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_live_session_staff_invariants();

-- Enable RLS
ALTER TABLE public.live_session_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view live_session_staff" ON public.live_session_staff;
CREATE POLICY "Users can view live_session_staff"
  ON public.live_session_staff
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_current_user_admin()
    OR EXISTS (
      SELECT 1 FROM public.live_sessions s
      JOIN public.courses c ON c.id = s.course_id
      WHERE s.id = live_session_staff.live_session_id
        AND (
          c.creator_id = auth.uid()
          OR (c.status = 'published' AND s.status != 'DRAFT')
          OR EXISTS (
            SELECT 1 FROM public.enrollments e
            WHERE e.course_id = c.id AND e.user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS "Creator or admin can insert live_session_staff" ON public.live_session_staff;
CREATE POLICY "Creator or admin can insert live_session_staff"
  ON public.live_session_staff
  FOR INSERT
  WITH CHECK (
    public.is_current_user_admin()
    OR EXISTS (
      SELECT 1 FROM public.live_sessions s
      JOIN public.courses c ON c.id = s.course_id
      WHERE s.id = live_session_staff.live_session_id
        AND c.creator_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Creator or admin can update live_session_staff" ON public.live_session_staff;
CREATE POLICY "Creator or admin can update live_session_staff"
  ON public.live_session_staff
  FOR UPDATE
  USING (
    public.is_current_user_admin()
    OR EXISTS (
      SELECT 1 FROM public.live_sessions s
      JOIN public.courses c ON c.id = s.course_id
      WHERE s.id = live_session_staff.live_session_id
        AND c.creator_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_current_user_admin()
    OR EXISTS (
      SELECT 1 FROM public.live_sessions s
      JOIN public.courses c ON c.id = s.course_id
      WHERE s.id = live_session_staff.live_session_id
        AND c.creator_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Creator or admin can delete live_session_staff" ON public.live_session_staff;
CREATE POLICY "Creator or admin can delete live_session_staff"
  ON public.live_session_staff
  FOR DELETE
  USING (
    public.is_current_user_admin()
    OR EXISTS (
      SELECT 1 FROM public.live_sessions s
      JOIN public.courses c ON c.id = s.course_id
      WHERE s.id = live_session_staff.live_session_id
        AND c.creator_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_session_staff TO authenticated;
GRANT SELECT ON public.live_session_staff TO anon;

-- Update authoritative check_live_classroom_access RPC
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
  v_is_assistant boolean := false;
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
        -- Check if assigned assistant in live_session_staff
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
    -- Creators, admins, and assistants MUST NOT bypass status (must call start_live_session first).
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
      'is_creator', true,
      'course_id', v_course.id,
      'course_title', v_course.title
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
      'is_enrolled', true,
      'course_id', v_course.id,
      'course_title', v_course.title
    );
  END IF;

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

-- 5. RPC Helpers for Assistant Management

-- Get staff for a session
CREATE OR REPLACE FUNCTION public.get_live_session_staff(p_session_id uuid)
RETURNS TABLE (
  id uuid,
  live_session_id uuid,
  user_id uuid,
  role text,
  created_at timestamptz,
  user_name text,
  user_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_session record;
  v_is_admin boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = '42501';
  END IF;

  SELECT s.id, c.creator_id, s.status
  INTO v_session
  FROM public.live_sessions s
  JOIN public.courses c ON c.id = s.course_id
  WHERE s.id = p_session_id;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'session_not_found' USING errcode = 'P0002';
  END IF;

  v_is_admin := public.is_current_user_admin();

  -- Must be creator, admin, or assigned staff to view staff list
  IF NOT (v_is_admin OR v_session.creator_id = v_caller OR EXISTS (
    SELECT 1 FROM public.live_session_staff st WHERE st.live_session_id = p_session_id AND st.user_id = v_caller
  )) THEN
    RAISE EXCEPTION 'permission_denied' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT
    st.id,
    st.live_session_id,
    st.user_id,
    st.role,
    st.created_at,
    COALESCE(u.name, 'User')::text AS user_name,
    COALESCE(u.email, '')::text AS user_email
  FROM public.live_session_staff st
  LEFT JOIN public.users u ON u.id = st.user_id
  WHERE st.live_session_id = p_session_id
  ORDER BY st.created_at ASC;
END;
$$;

-- Add an assistant to a session
CREATE OR REPLACE FUNCTION public.add_live_session_assistant(
  p_session_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_session record;
  v_is_admin boolean;
  v_user record;
  v_staff_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = '42501';
  END IF;

  SELECT s.id, s.course_id, s.status, c.creator_id
  INTO v_session
  FROM public.live_sessions s
  JOIN public.courses c ON c.id = s.course_id
  WHERE s.id = p_session_id;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'session_not_found' USING errcode = 'P0002';
  END IF;

  v_is_admin := public.is_current_user_admin();

  -- Only course creator or admin can add assistant
  IF NOT (v_is_admin OR v_session.creator_id = v_caller) THEN
    RAISE EXCEPTION 'permission_denied' USING errcode = '42501';
  END IF;

  -- Lifecycle check: cannot modify staff on ended or cancelled sessions
  IF v_session.status IN ('ENDED', 'CANCELLED') THEN
    RAISE EXCEPTION 'cannot_modify_staff_on_terminal_session' USING errcode = '23514';
  END IF;

  -- Check user exists in auth.users
  SELECT id, email INTO v_user FROM auth.users WHERE id = p_user_id;
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'user_not_found' USING errcode = 'P0002';
  END IF;

  -- Cannot assign course creator as assistant
  IF p_user_id = v_session.creator_id THEN
    RAISE EXCEPTION 'creator_cannot_be_assistant' USING errcode = '23514';
  END IF;

  -- Insert (unique constraint will catch duplicates)
  INSERT INTO public.live_session_staff (live_session_id, user_id, role)
  VALUES (p_session_id, p_user_id, 'assistant')
  RETURNING id INTO v_staff_id;

  RETURN jsonb_build_object(
    'id', v_staff_id,
    'live_session_id', p_session_id,
    'user_id', p_user_id,
    'role', 'assistant'
  );
END;
$$;

-- Remove assistant from a session
CREATE OR REPLACE FUNCTION public.remove_live_session_assistant(
  p_session_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_session record;
  v_is_admin boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = '42501';
  END IF;

  SELECT s.id, s.course_id, s.status, c.creator_id
  INTO v_session
  FROM public.live_sessions s
  JOIN public.courses c ON c.id = s.course_id
  WHERE s.id = p_session_id;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'session_not_found' USING errcode = 'P0002';
  END IF;

  v_is_admin := public.is_current_user_admin();

  -- Only course creator or admin can remove assistant
  IF NOT (v_is_admin OR v_session.creator_id = v_caller) THEN
    RAISE EXCEPTION 'permission_denied' USING errcode = '42501';
  END IF;

  -- Lifecycle check
  IF v_session.status IN ('ENDED', 'CANCELLED') THEN
    RAISE EXCEPTION 'cannot_modify_staff_on_terminal_session' USING errcode = '23514';
  END IF;

  DELETE FROM public.live_session_staff
  WHERE live_session_id = p_session_id AND user_id = p_user_id;

  RETURN true;
END;
$$;

-- Lookup users by email/name/ID for assignment by creator
CREATE OR REPLACE FUNCTION public.lookup_user_for_assistant(p_query text)
RETURNS TABLE (
  id uuid,
  name text,
  email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_is_creator boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = '42501';
  END IF;

  v_is_admin := public.is_current_user_admin();
  SELECT EXISTS (SELECT 1 FROM public.courses WHERE creator_id = v_caller) INTO v_is_creator;

  -- Only course creators and admins can search users to assign
  IF NOT (v_is_admin OR v_is_creator) THEN
    RAISE EXCEPTION 'permission_denied' USING errcode = '42501';
  END IF;

  IF p_query IS NULL OR length(trim(p_query)) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT u.id, u.name, u.email
  FROM public.users u
  WHERE u.id <> v_caller
    AND (
      u.email ILIKE '%' || trim(p_query) || '%'
      OR u.name ILIKE '%' || trim(p_query) || '%'
      OR u.id::text = trim(p_query)
    )
  LIMIT 10;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_live_session_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_live_session_assistant(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_live_session_assistant(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_user_for_assistant(text) TO authenticated;
