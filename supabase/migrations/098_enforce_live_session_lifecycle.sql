-- ── Migration 098: Enforce live_sessions Lifecycle Transitions ──────────────
-- Enforces server-side transition state machine and protects server-owned fields:
-- - status (only allowed transitions: DRAFT->SCHEDULED, SCHEDULED->LIVE, SCHEDULED->CANCELLED, LIVE->ENDED, DRAFT->CANCELLED)
-- - livekit_room_name (immutable after insert)
-- - started_at / ended_at (managed exclusively by server RPCs)
-- Direct client UPDATE attempts to forge 'LIVE', 'ENDED', or mutate server-owned fields are blocked.

-- 1. Trigger function: enforce_live_sessions_lifecycle
CREATE OR REPLACE FUNCTION public.enforce_live_sessions_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_server_transition boolean;
BEGIN
  v_is_server_transition := (COALESCE(current_setting('app.live_session_transition', true), 'false') = 'true');

  -- A. INSERT validations
  IF TG_OP = 'INSERT' THEN
    -- Status must start as DRAFT or SCHEDULED
    IF NEW.status NOT IN ('DRAFT', 'SCHEDULED') THEN
      RAISE EXCEPTION 'New session must start as DRAFT or SCHEDULED, got %', NEW.status
        USING errcode = '42501';
    END IF;

    -- Room name must be provided and not empty
    IF NEW.livekit_room_name IS NULL OR trim(NEW.livekit_room_name) = '' THEN
      RAISE EXCEPTION 'livekit_room_name is required and cannot be empty'
        USING errcode = '22023';
    END IF;

    -- started_at and ended_at cannot be set on creation
    NEW.started_at := NULL;
    NEW.ended_at := NULL;

    RETURN NEW;
  END IF;

  -- B. UPDATE validations
  IF TG_OP = 'UPDATE' THEN
    -- 1. Room name integrity: livekit_room_name is immutable after creation
    IF OLD.livekit_room_name IS NOT NULL AND NEW.livekit_room_name IS DISTINCT FROM OLD.livekit_room_name THEN
      RAISE EXCEPTION 'livekit_room_name cannot be modified'
        USING errcode = '42501';
    END IF;

    -- 2. started_at integrity: only server transition can set or modify started_at
    IF NEW.started_at IS DISTINCT FROM OLD.started_at AND NOT v_is_server_transition THEN
      RAISE EXCEPTION 'started_at is server-owned and cannot be modified directly'
        USING errcode = '42501';
    END IF;

    -- 3. ended_at integrity: only server transition can set or modify ended_at
    IF NEW.ended_at IS DISTINCT FROM OLD.ended_at AND NOT v_is_server_transition THEN
      RAISE EXCEPTION 'ended_at is server-owned and cannot be modified directly'
        USING errcode = '42501';
    END IF;

    -- 4. Status transition enforcement:
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      -- Check valid state machine transitions:
      IF OLD.status = 'DRAFT' AND NEW.status = 'SCHEDULED' THEN
        -- Allowed (creator scheduling draft session)
        NULL;
      ELSIF OLD.status = 'DRAFT' AND NEW.status = 'CANCELLED' THEN
        -- Allowed (cancelling draft)
        NULL;
      ELSIF OLD.status = 'SCHEDULED' AND NEW.status = 'LIVE' THEN
        IF NOT v_is_server_transition THEN
          RAISE EXCEPTION 'Direct transition to LIVE is forbidden. Use start_live_session().'
            USING errcode = '42501';
        END IF;
      ELSIF OLD.status = 'SCHEDULED' AND NEW.status = 'CANCELLED' THEN
        IF NOT v_is_server_transition THEN
          RAISE EXCEPTION 'Direct transition to CANCELLED is forbidden. Use cancel_live_session().'
            USING errcode = '42501';
        END IF;
      ELSIF OLD.status = 'LIVE' AND NEW.status = 'ENDED' THEN
        IF NOT v_is_server_transition THEN
          RAISE EXCEPTION 'Direct transition to ENDED is forbidden. Use end_live_session().'
            USING errcode = '42501';
        END IF;
      ELSE
        -- Any other transition is completely invalid
        RAISE EXCEPTION 'Invalid session status transition from % to %', OLD.status, NEW.status
          USING errcode = '22023';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger to public.live_sessions
DROP TRIGGER IF EXISTS trg_live_sessions_lifecycle ON public.live_sessions;
CREATE TRIGGER trg_live_sessions_lifecycle
  BEFORE INSERT OR UPDATE ON public.live_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_live_sessions_lifecycle();

-- 2. Upgraded start_live_session RPC: strictly SCHEDULED -> LIVE
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

  IF v_creator_id != v_caller AND v_user_role != 'admin' THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- Lifecycle checks
  IF v_current_status = 'LIVE' THEN
    RAISE EXCEPTION 'session_already_live' USING errcode = '22023';
  END IF;

  IF v_current_status != 'SCHEDULED' THEN
    RAISE EXCEPTION 'cannot_start_session_in_%_status', v_current_status USING errcode = '22023';
  END IF;

  -- Set server transition context for trigger
  PERFORM set_config('app.live_session_transition', 'true', true);

  UPDATE public.live_sessions
  SET status = 'LIVE',
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  PERFORM set_config('app.live_session_transition', 'false', true);

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session.id,
    'status', v_session.status,
    'livekit_room_name', v_session.livekit_room_name,
    'started_at', v_session.started_at
  );
END;
$$;

-- 3. Upgraded end_live_session RPC: strictly LIVE -> ENDED
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

  IF v_creator_id != v_caller AND v_user_role != 'admin' THEN
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

  PERFORM set_config('app.live_session_transition', 'false', true);

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session.id,
    'status', v_session.status,
    'ended_at', v_session.ended_at
  );
END;
$$;

-- 4. New cancel_live_session RPC: strictly SCHEDULED / DRAFT -> CANCELLED
CREATE OR REPLACE FUNCTION public.cancel_live_session(p_session_id uuid)
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

  IF v_creator_id != v_caller AND v_user_role != 'admin' THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- Lifecycle checks
  IF v_current_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'session_already_cancelled' USING errcode = '22023';
  END IF;

  IF v_current_status = 'LIVE' THEN
    RAISE EXCEPTION 'cannot_cancel_live_session' USING errcode = '22023';
  END IF;

  IF v_current_status = 'ENDED' THEN
    RAISE EXCEPTION 'cannot_cancel_ended_session' USING errcode = '22023';
  END IF;

  IF v_current_status NOT IN ('SCHEDULED', 'DRAFT') THEN
    RAISE EXCEPTION 'cannot_cancel_session_in_%_status', v_current_status USING errcode = '22023';
  END IF;

  -- Set server transition context for trigger
  PERFORM set_config('app.live_session_transition', 'true', true);

  UPDATE public.live_sessions
  SET status = 'CANCELLED',
      updated_at = now()
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  PERFORM set_config('app.live_session_transition', 'false', true);

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session.id,
    'status', v_session.status
  );
END;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION public.start_live_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_live_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_live_session(uuid) TO authenticated;
