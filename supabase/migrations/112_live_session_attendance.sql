-- ── Migration 112: Live Session Attendance Data Layer & Heartbeat Lifecycle ──
-- TASK 9.1: Implements server-authoritative attendance persistence and intervals.
--
-- Architecture:
--   - public.live_session_attendance: Summary header per (live_session_id, user_id).
--   - public.live_session_attendance_intervals: Raw connection intervals per connection_id.
--   - Server timestamps (now()) are authoritative; client timestamps/durations are ignored.
--   - Multi-tab and multi-device connection intervals are merged via multiranges.
--   - Attendance JOIN requires status = 'LIVE'.
--   - Session termination (end_live_session / auto_end_stale_live_sessions) clamps intervals
--     and materializes ABSENT rows for non-attending enrollees.
--   - RLS strictly gates student reads to their own record, while teacher, assistant, and
--     admin can read the full session attendance roster. Direct writes are blocked.

-- 1. Create table public.live_session_attendance
CREATE TABLE IF NOT EXISTS public.live_session_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_session_id uuid NOT NULL REFERENCES public.live_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('teacher', 'assistant', 'student')),
  first_joined_at timestamptz NULL,
  last_left_at timestamptz NULL,
  total_duration_seconds integer NOT NULL DEFAULT 0 CHECK (total_duration_seconds >= 0),
  attendance_status text NOT NULL DEFAULT 'ABSENT'
    CHECK (attendance_status IN ('PRESENT', 'PARTIAL', 'ABSENT')),
  is_late boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_session_attendance_session_user_key UNIQUE (live_session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_live_session_attendance_session
  ON public.live_session_attendance (live_session_id);

CREATE INDEX IF NOT EXISTS idx_live_session_attendance_user
  ON public.live_session_attendance (user_id);

CREATE INDEX IF NOT EXISTS idx_live_session_attendance_status
  ON public.live_session_attendance (live_session_id, attendance_status);

-- 2. Create table public.live_session_attendance_intervals
CREATE TABLE IF NOT EXISTS public.live_session_attendance_intervals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_session_id uuid NOT NULL REFERENCES public.live_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_session_attendance_intervals_timestamps_chk CHECK (
    last_seen_at >= joined_at AND (left_at IS NULL OR left_at >= joined_at)
  )
);

CREATE INDEX IF NOT EXISTS idx_attendance_intervals_session
  ON public.live_session_attendance_intervals (live_session_id);

CREATE INDEX IF NOT EXISTS idx_attendance_intervals_user
  ON public.live_session_attendance_intervals (user_id);

CREATE INDEX IF NOT EXISTS idx_attendance_intervals_lookup
  ON public.live_session_attendance_intervals (live_session_id, user_id, connection_id);

-- Partial unique index ensuring at most one open interval per (session, user, connection_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_intervals_open_uniq
  ON public.live_session_attendance_intervals (live_session_id, user_id, connection_id)
  WHERE left_at IS NULL;

-- 3. Deletion & Immutability Trigger
CREATE OR REPLACE FUNCTION public.enforce_live_session_attendance_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Allow cascade delete from parent session or user
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'direct_delete_not_allowed' USING errcode = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_live_session_attendance_invariants ON public.live_session_attendance;
CREATE TRIGGER trg_enforce_live_session_attendance_invariants
  BEFORE DELETE ON public.live_session_attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_live_session_attendance_invariants();

DROP TRIGGER IF EXISTS trg_enforce_live_session_attendance_intervals_invariants ON public.live_session_attendance_intervals;
CREATE TRIGGER trg_enforce_live_session_attendance_intervals_invariants
  BEFORE DELETE ON public.live_session_attendance_intervals
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_live_session_attendance_invariants();

-- 4. Enable Row Level Security
ALTER TABLE public.live_session_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_session_attendance_intervals ENABLE ROW LEVEL SECURITY;

-- SELECT policies
DROP POLICY IF EXISTS "live_session_attendance_select" ON public.live_session_attendance;
CREATE POLICY "live_session_attendance_select"
  ON public.live_session_attendance
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_current_user_admin()
    OR EXISTS (
      SELECT 1 FROM public.live_sessions s
      JOIN public.courses c ON c.id = s.course_id
      WHERE s.id = live_session_attendance.live_session_id
        AND c.creator_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.live_session_staff st
      WHERE st.live_session_id = live_session_attendance.live_session_id
        AND st.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "live_session_attendance_intervals_select" ON public.live_session_attendance_intervals;
CREATE POLICY "live_session_attendance_intervals_select"
  ON public.live_session_attendance_intervals
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_current_user_admin()
    OR EXISTS (
      SELECT 1 FROM public.live_sessions s
      JOIN public.courses c ON c.id = s.course_id
      WHERE s.id = live_session_attendance_intervals.live_session_id
        AND c.creator_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.live_session_staff st
      WHERE st.live_session_id = live_session_attendance_intervals.live_session_id
        AND st.user_id = auth.uid()
    )
  );

-- No direct INSERT / UPDATE / DELETE policies granted to clients;
-- all writes are channeled authoritatively through SECURITY DEFINER RPCs.

GRANT SELECT ON public.live_session_attendance TO authenticated, anon;
GRANT SELECT ON public.live_session_attendance_intervals TO authenticated, anon;


-- 5. RPC: record_live_session_join
CREATE OR REPLACE FUNCTION public.record_live_session_join(
  p_session_id uuid,
  p_connection_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_session record;
  v_is_admin boolean := false;
  v_is_authorized boolean := false;
  v_user_role text := 'student';
  v_interval_id uuid;
  v_is_late boolean := false;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = '42501';
  END IF;

  IF p_connection_id IS NULL THEN
    RAISE EXCEPTION 'connection_id_required' USING errcode = '22023';
  END IF;

  -- Verify session and course link
  SELECT s.id, s.course_id, s.status, s.started_at, c.creator_id
  INTO v_session
  FROM public.live_sessions s
  JOIN public.courses c ON c.id = s.course_id
  WHERE s.id = p_session_id;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'session_not_found' USING errcode = '22023';
  END IF;

  -- Lifecycle check: join permitted strictly when session is LIVE
  IF v_session.status != 'LIVE' THEN
    RAISE EXCEPTION 'cannot_join_session_in_%_status', v_session.status USING errcode = '22023';
  END IF;

  v_is_admin := public.is_current_user_admin();

  -- Authoritative role resolution (Task 7 semantics)
  IF v_session.creator_id = v_caller THEN
    v_is_authorized := true;
    v_user_role := 'teacher';
  ELSIF EXISTS (
    SELECT 1 FROM public.live_session_staff
    WHERE live_session_id = p_session_id AND user_id = v_caller AND role = 'assistant'
  ) THEN
    v_is_authorized := true;
    v_user_role := 'assistant';
  ELSIF EXISTS (
    SELECT 1 FROM public.enrollments
    WHERE course_id = v_session.course_id AND user_id = v_caller
  ) THEN
    v_is_authorized := true;
    v_user_role := 'student';
  ELSIF v_is_admin THEN
    v_is_authorized := true;
    v_user_role := 'student';
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'not_authorized_for_session' USING errcode = '42501';
  END IF;

  -- Check existing open interval for this (session, user, connection_id)
  SELECT id INTO v_interval_id
  FROM public.live_session_attendance_intervals
  WHERE live_session_id = p_session_id
    AND user_id = v_caller
    AND connection_id = p_connection_id
    AND left_at IS NULL;

  IF v_interval_id IS NOT NULL THEN
    -- Idempotent duplicate join: refresh last_seen_at
    UPDATE public.live_session_attendance_intervals
    SET last_seen_at = GREATEST(now(), joined_at, last_seen_at)
    WHERE id = v_interval_id;
  ELSE
    -- Atomically insert new interval with race protection
    BEGIN
      INSERT INTO public.live_session_attendance_intervals (
        live_session_id,
        user_id,
        connection_id,
        joined_at,
        last_seen_at
      ) VALUES (
        p_session_id,
        v_caller,
        p_connection_id,
        now(),
        now()
      ) RETURNING id INTO v_interval_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_interval_id
      FROM public.live_session_attendance_intervals
      WHERE live_session_id = p_session_id
        AND user_id = v_caller
        AND connection_id = p_connection_id
        AND left_at IS NULL;

      IF v_interval_id IS NOT NULL THEN
        UPDATE public.live_session_attendance_intervals
        SET last_seen_at = GREATEST(now(), joined_at, last_seen_at)
        WHERE id = v_interval_id;
      END IF;
    END;
  END IF;

  -- Punctuality: late if first join is > 10m after started_at
  v_is_late := (v_session.started_at IS NOT NULL AND now() > v_session.started_at + interval '10 minutes');

  -- Upsert summary row in live_session_attendance
  INSERT INTO public.live_session_attendance (
    live_session_id,
    user_id,
    role,
    first_joined_at,
    attendance_status,
    is_late
  ) VALUES (
    p_session_id,
    v_caller,
    v_user_role,
    now(),
    'ABSENT',
    v_is_late
  )
  ON CONFLICT (live_session_id, user_id) DO UPDATE
  SET
    first_joined_at = COALESCE(live_session_attendance.first_joined_at, EXCLUDED.first_joined_at),
    role = EXCLUDED.role,
    is_late = CASE 
      WHEN live_session_attendance.first_joined_at IS NOT NULL THEN live_session_attendance.is_late
      ELSE EXCLUDED.is_late
    END,
    updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'interval_id', v_interval_id,
    'session_id', p_session_id,
    'user_id', v_caller,
    'connection_id', p_connection_id,
    'role', v_user_role,
    'is_late', v_is_late
  );
END;
$$;


-- 6. RPC: ping_live_session_attendance
CREATE OR REPLACE FUNCTION public.ping_live_session_attendance(
  p_interval_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_interval record;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = '42501';
  END IF;

  SELECT i.*, s.status AS session_status
  INTO v_interval
  FROM public.live_session_attendance_intervals i
  JOIN public.live_sessions s ON s.id = i.live_session_id
  WHERE i.id = p_interval_id;

  IF v_interval.id IS NULL THEN
    RAISE EXCEPTION 'interval_not_found' USING errcode = '22023';
  END IF;

  IF v_interval.user_id != v_caller THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- If interval is already closed, idempotent return
  IF v_interval.left_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'interval_closed');
  END IF;

  -- If session has ended or is cancelled, do not advance heartbeat
  IF v_interval.session_status != 'LIVE' THEN
    UPDATE public.live_session_attendance_intervals
    SET left_at = v_interval.last_seen_at
    WHERE id = p_interval_id;

    RETURN jsonb_build_object('success', false, 'reason', 'session_not_live');
  END IF;

  -- Advance authoritative last_seen_at using server now()
  UPDATE public.live_session_attendance_intervals
  SET last_seen_at = GREATEST(now(), joined_at, last_seen_at)
  WHERE id = p_interval_id;

  RETURN jsonb_build_object('success', true);
END;
$$;


-- 7. RPC: record_live_session_leave
CREATE OR REPLACE FUNCTION public.record_live_session_leave(
  p_interval_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_interval record;
  v_leave_time timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = '42501';
  END IF;

  SELECT i.*, s.status AS session_status, s.ended_at AS session_ended_at
  INTO v_interval
  FROM public.live_session_attendance_intervals i
  JOIN public.live_sessions s ON s.id = i.live_session_id
  WHERE i.id = p_interval_id;

  IF v_interval.id IS NULL THEN
    RAISE EXCEPTION 'interval_not_found' USING errcode = '22023';
  END IF;

  IF v_interval.user_id != v_caller THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- Idempotent leave
  IF v_interval.left_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_closed', true);
  END IF;

  -- If session ended, clamp leave time to session.ended_at
  IF v_interval.session_ended_at IS NOT NULL AND v_interval.session_ended_at < now() THEN
    v_leave_time := v_interval.session_ended_at;
  ELSE
    v_leave_time := now();
  END IF;

  UPDATE public.live_session_attendance_intervals
  SET left_at = v_leave_time,
      last_seen_at = GREATEST(last_seen_at, v_leave_time)
  WHERE id = p_interval_id;

  -- Record last_left_at on summary header (strictly monotonic: never moves backwards)
  UPDATE public.live_session_attendance
  SET last_left_at = CASE
        WHEN live_session_attendance.last_left_at IS NULL THEN v_leave_time
        ELSE GREATEST(live_session_attendance.last_left_at, v_leave_time)
      END,
      updated_at = now()
  WHERE live_session_id = v_interval.live_session_id
    AND user_id = v_caller;

  RETURN jsonb_build_object('success', true);
END;
$$;


-- 8. RPC: finalize_live_session_attendance
CREATE OR REPLACE FUNCTION public.finalize_live_session_attendance(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_session record;
  v_is_admin boolean := false;
  v_session_duration integer := 0;
  v_effective_session_end timestamptz;
BEGIN
  SELECT s.id, s.course_id, s.status, s.started_at, s.ended_at, c.creator_id
  INTO v_session
  FROM public.live_sessions s
  JOIN public.courses c ON c.id = s.course_id
  WHERE s.id = p_session_id;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'session_not_found' USING errcode = '22023';
  END IF;

  -- Finalization check:
  -- A. Session = LIVE: direct client invocation of finalize_live_session_attendance() must be rejected.
  -- B. Session = ENDED: authorized lifecycle/reporting caller may finalize/recompute.
  -- C. Session = DRAFT/SCHEDULED/CANCELLED: reject finalization.
  -- D. Internal lifecycle: end_live_session() and auto_end_stale_live_sessions() succeed.
  IF v_session.status = 'LIVE' THEN
    RAISE EXCEPTION 'cannot_finalize_session_while_LIVE' USING errcode = '22023';
  ELSIF v_session.status IN ('DRAFT', 'SCHEDULED', 'CANCELLED') THEN
    RAISE EXCEPTION 'cannot_finalize_session_in_%_status', v_session.status USING errcode = '22023';
  ELSIF v_session.status != 'ENDED' THEN
    RAISE EXCEPTION 'cannot_finalize_session_not_ended' USING errcode = '22023';
  END IF;

  -- Caller authorization:
  -- IF auth.uid() IS NOT NULL:
  --   Always enforce the real caller authorization policy.
  --   A custom GUC (e.g. app.live_session_transition) must never bypass creator/admin checks.
  IF v_caller IS NOT NULL THEN
    -- Authenticated client caller: strictly enforce real caller identity.
    v_is_admin := public.is_current_user_admin();

    IF (v_session.creator_id IS DISTINCT FROM v_caller) AND NOT COALESCE(v_is_admin, false) THEN
      RAISE EXCEPTION 'forbidden' USING errcode = '42501';
    END IF;
  ELSIF session_user IN ('postgres', 'supabase_admin') OR COALESCE(auth.role(), '') = 'service_role' THEN
    -- Trusted server maintenance execution identity (pg_cron / service_role / db superuser)
    NULL;
  ELSE
    RAISE EXCEPTION 'unauthenticated' USING errcode = '42501';
  END IF;

  v_effective_session_end := COALESCE(v_session.ended_at, now());

  -- 1. Clamp remaining open intervals if session is ENDED
  IF v_session.status = 'ENDED' THEN
    UPDATE public.live_session_attendance_intervals
    SET left_at = GREATEST(joined_at, LEAST(last_seen_at, v_effective_session_end))
    WHERE live_session_id = p_session_id
      AND left_at IS NULL;
  END IF;

  -- 2. Materialize ABSENT summary rows for enrolled students who never joined
  INSERT INTO public.live_session_attendance (
    live_session_id,
    user_id,
    role,
    first_joined_at,
    last_left_at,
    total_duration_seconds,
    attendance_status,
    is_late
  )
  SELECT 
    v_session.id,
    e.user_id,
    'student',
    NULL,
    NULL,
    0,
    'ABSENT',
    false
  FROM public.enrollments e
  WHERE e.course_id = v_session.course_id
    AND NOT EXISTS (
      SELECT 1 FROM public.live_session_attendance a
      WHERE a.live_session_id = v_session.id AND a.user_id = e.user_id
    )
  ON CONFLICT (live_session_id, user_id) DO NOTHING;

  -- 3. Materialize ABSENT summary rows for assigned assistants who never joined
  INSERT INTO public.live_session_attendance (
    live_session_id,
    user_id,
    role,
    first_joined_at,
    last_left_at,
    total_duration_seconds,
    attendance_status,
    is_late
  )
  SELECT 
    v_session.id,
    st.user_id,
    'assistant',
    NULL,
    NULL,
    0,
    'ABSENT',
    false
  FROM public.live_session_staff st
  WHERE st.live_session_id = v_session.id
    AND NOT EXISTS (
      SELECT 1 FROM public.live_session_attendance a
      WHERE a.live_session_id = v_session.id AND a.user_id = st.user_id
    )
  ON CONFLICT (live_session_id, user_id) DO NOTHING;

  -- 4. Calculate actual session duration
  IF v_session.started_at IS NOT NULL THEN
    v_session_duration := EXTRACT(EPOCH FROM (v_effective_session_end - v_session.started_at))::integer;
    IF v_session_duration < 0 THEN
      v_session_duration := 0;
    END IF;
  ELSE
    v_session_duration := 0;
  END IF;

  -- 5. Calculate multirange duration and assign PRESENT / PARTIAL / ABSENT status
  -- Overlapping intervals are natively merged via range_agg to prevent duplicate credit.
  WITH user_interval_summary AS (
    SELECT 
      i.user_id,
      MAX(COALESCE(i.left_at, i.last_seen_at)) AS latest_interval_end,
      range_agg(
        tstzrange(
          GREATEST(i.joined_at, COALESCE(v_session.started_at, i.joined_at)),
          LEAST(COALESCE(i.left_at, i.last_seen_at), v_effective_session_end),
          '[)'
        )
      ) FILTER (
        WHERE LEAST(COALESCE(i.left_at, i.last_seen_at), v_effective_session_end) >
              GREATEST(i.joined_at, COALESCE(v_session.started_at, i.joined_at))
      ) AS m
    FROM public.live_session_attendance_intervals i
    WHERE i.live_session_id = p_session_id
    GROUP BY i.user_id
  ),
  user_durations AS (
    SELECT 
      uis.user_id,
      uis.latest_interval_end,
      COALESCE((
        SELECT EXTRACT(EPOCH FROM sum(upper(r) - lower(r)))::integer
        FROM unnest(uis.m) AS r
      ), 0) AS dur_secs
    FROM user_interval_summary uis
  )
  UPDATE public.live_session_attendance a
  SET 
    total_duration_seconds = ud.dur_secs,
    attendance_status = CASE 
      WHEN v_session_duration > 0 AND (ud.dur_secs::numeric / v_session_duration::numeric) >= 0.70 THEN 'PRESENT'
      WHEN v_session_duration > 0 AND (ud.dur_secs::numeric / v_session_duration::numeric) >= 0.20 THEN 'PARTIAL'
      ELSE 'ABSENT'
    END,
    last_left_at = CASE
      WHEN a.last_left_at IS NULL THEN ud.latest_interval_end
      WHEN ud.latest_interval_end IS NULL THEN a.last_left_at
      ELSE GREATEST(a.last_left_at, ud.latest_interval_end)
    END,
    is_late = CASE
      WHEN a.first_joined_at IS NOT NULL AND v_session.started_at IS NOT NULL THEN
        (a.first_joined_at > v_session.started_at + interval '10 minutes')
      ELSE false
    END,
    updated_at = now()
  FROM user_durations ud
  WHERE a.live_session_id = p_session_id
    AND a.user_id = ud.user_id;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'session_duration_seconds', v_session_duration
  );
END;
$$;


-- 9. RPC: get_live_session_attendance
CREATE OR REPLACE FUNCTION public.get_live_session_attendance(
  p_session_id uuid
)
RETURNS TABLE (
  id uuid,
  live_session_id uuid,
  user_id uuid,
  role text,
  first_joined_at timestamptz,
  last_left_at timestamptz,
  total_duration_seconds integer,
  attendance_status text,
  is_late boolean,
  created_at timestamptz,
  updated_at timestamptz,
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
  v_is_admin boolean := false;
  v_is_creator boolean := false;
  v_is_assistant boolean := false;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = '42501';
  END IF;

  SELECT s.id, s.course_id, c.creator_id
  INTO v_session
  FROM public.live_sessions s
  JOIN public.courses c ON c.id = s.course_id
  WHERE s.id = p_session_id;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'session_not_found' USING errcode = '22023';
  END IF;

  v_is_admin := public.is_current_user_admin();
  v_is_creator := (v_session.creator_id = v_caller);

  SELECT EXISTS (
    SELECT 1 FROM public.live_session_staff st
    WHERE st.live_session_id = p_session_id AND st.user_id = v_caller AND st.role = 'assistant'
  ) INTO v_is_assistant;

  -- Teacher, Assistant, Admin see full roster
  IF v_is_creator OR v_is_assistant OR v_is_admin THEN
    RETURN QUERY
    SELECT 
      a.id,
      a.live_session_id,
      a.user_id,
      a.role,
      a.first_joined_at,
      a.last_left_at,
      a.total_duration_seconds,
      a.attendance_status,
      a.is_late,
      a.created_at,
      a.updated_at,
      COALESCE(u.name, 'User')::text AS user_name,
      COALESCE(u.email, '')::text AS user_email
    FROM public.live_session_attendance a
    LEFT JOIN public.users u ON u.id = a.user_id
    WHERE a.live_session_id = p_session_id
    ORDER BY a.created_at ASC;
  ELSE
    -- Student or other caller: must be enrolled to view own row
    IF NOT EXISTS (
      SELECT 1 FROM public.enrollments e
      WHERE e.course_id = v_session.course_id AND e.user_id = v_caller
    ) THEN
      RAISE EXCEPTION 'forbidden' USING errcode = '42501';
    END IF;

    RETURN QUERY
    SELECT 
      a.id,
      a.live_session_id,
      a.user_id,
      a.role,
      a.first_joined_at,
      a.last_left_at,
      a.total_duration_seconds,
      a.attendance_status,
      a.is_late,
      a.created_at,
      a.updated_at,
      COALESCE(u.name, 'User')::text AS user_name,
      COALESCE(u.email, '')::text AS user_email
    FROM public.live_session_attendance a
    LEFT JOIN public.users u ON u.id = a.user_id
    WHERE a.live_session_id = p_session_id
      AND a.user_id = v_caller;
  END IF;
END;
$$;


-- 10. Upgrade end_live_session RPC to trigger attendance finalization
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
  v_current_status text;
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = '42501';
  END IF;

  SELECT c.creator_id, s.status
  INTO v_creator_id, v_current_status
  FROM public.live_sessions s
  JOIN public.courses c ON c.id = s.course_id
  WHERE s.id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found' USING errcode = '22023';
  END IF;

  SELECT role INTO v_user_role FROM public.users WHERE id = v_caller;

  IF (v_creator_id IS DISTINCT FROM v_caller)
     AND (COALESCE(v_user_role, '') <> 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- Lifecycle checks
  IF v_current_status = 'ENDED' THEN
    RAISE EXCEPTION 'session_already_ended' USING errcode = '22023';
  END IF;

  IF v_current_status != 'LIVE' THEN
    RAISE EXCEPTION 'cannot_end_session_in_%_status', v_current_status USING errcode = '22023';
  END IF;

  -- Set server transition context for trigger
  PERFORM set_config('app.live_session_transition', 'true', true);

  UPDATE public.live_sessions
  SET status = 'ENDED',
      ended_at = COALESCE(ended_at, now()),
      updated_at = now()
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  -- Authoritatively finalize attendance for this session while transition context is active
  PERFORM public.finalize_live_session_attendance(p_session_id);

  PERFORM set_config('app.live_session_transition', 'false', true);

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session.id,
    'status', v_session.status,
    'ended_at', v_session.ended_at
  );
END;
$$;


-- 11. Upgrade auto_end_stale_live_sessions to trigger attendance finalization
CREATE OR REPLACE FUNCTION public.auto_end_stale_live_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_session_id uuid;
  v_count integer := 0;
BEGIN
  -- Set server transition context for lifecycle triggers
  PERFORM set_config('app.live_session_transition', 'true', true);

  FOR v_session_id IN
    SELECT id
    FROM public.live_sessions
    WHERE status = 'LIVE'
      AND started_at IS NOT NULL
      AND (
        now() >= started_at + interval '12 hours'
        OR (
          scheduled_end_at IS NOT NULL
          AND scheduled_end_at > started_at
          AND now() >= scheduled_end_at + interval '6 hours'
        )
      )
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.live_sessions
    SET status = 'ENDED',
        ended_at = now(),
        updated_at = now()
    WHERE id = v_session_id
      AND status = 'LIVE';

    IF FOUND THEN
      v_count := v_count + 1;
      -- Authoritatively finalize attendance for the auto-ended stale session
      PERFORM public.finalize_live_session_attendance(v_session_id);
    END IF;
  END LOOP;

  PERFORM set_config('app.live_session_transition', 'false', true);

  RETURN v_count;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('app.live_session_transition', 'false', true);
    RAISE;
  END;
$$;


-- 12. Execution Grants & Revokes
GRANT EXECUTE ON FUNCTION public.record_live_session_join(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ping_live_session_attendance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_live_session_leave(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_live_session_attendance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_live_session_attendance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.end_live_session(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.auto_end_stale_live_sessions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_end_stale_live_sessions() FROM anon;
REVOKE ALL ON FUNCTION public.auto_end_stale_live_sessions() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.auto_end_stale_live_sessions() TO service_role;
GRANT EXECUTE ON FUNCTION public.auto_end_stale_live_sessions() TO postgres;

