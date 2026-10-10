-- ── Migration 110: Live Game Persistence Foundation ─────────────────────────
-- TASK 8: Creates dedicated persistent entity for live chess games (public.live_games).
--
-- Architecture:
--   - live_session -> practice board(s) -> game 1, game 2, ...
--   - Each played game gets a unique live_games.id (UUID).
--   - board_id identifies board context only ('main' or practice board ID).
--   - Final-only persistence (no move-by-move PostgreSQL rows).
--   - Authoritative submission checks:
--       * MAIN: course creator (teacher) or platform admin only.
--       * PRACTICE: course creator, platform admin, or assigned white/black players.
--       * Unrelated learners/assistants cannot submit games.
--   - Idempotent finalization: Client generates game UUID; duplicate submissions
--     return the existing finalized row; conflicting results are rejected.
--   - Terminal immutability: Finalized games (COMPLETED or ABORTED) cannot be modified.
--   - Direct DELETE is restricted; cascade delete on live_sessions is preserved.

-- 1. Create table public.live_games
CREATE TABLE IF NOT EXISTS public.live_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_session_id uuid NOT NULL REFERENCES public.live_sessions(id) ON DELETE CASCADE,
  board_id text NOT NULL,
  game_scope text NOT NULL CHECK (game_scope IN ('MAIN', 'PRACTICE')),
  white_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  black_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  starting_fen text NOT NULL DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  final_fen text NULL,
  pgn text NULL,
  result text NOT NULL DEFAULT '*' CHECK (result IN ('1-0', '0-1', '1/2-1/2', '*')),
  termination_reason text NULL,
  status text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'ABORTED')),
  move_count integer NOT NULL DEFAULT 0 CHECK (move_count >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  submitted_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_games_board_id_chk CHECK (char_length(trim(board_id)) > 0),
  CONSTRAINT live_games_scope_board_chk CHECK (
    (game_scope = 'MAIN' AND board_id = 'main') OR
    (game_scope = 'PRACTICE' AND board_id != 'main')
  ),
  CONSTRAINT live_games_ended_after_started_chk CHECK (
    ended_at IS NULL OR ended_at >= started_at
  )
);

-- 2. Indexes for efficient lookup
CREATE INDEX IF NOT EXISTS idx_live_games_session_id ON public.live_games (live_session_id);
CREATE INDEX IF NOT EXISTS idx_live_games_board_id ON public.live_games (board_id);
CREATE INDEX IF NOT EXISTS idx_live_games_started_at ON public.live_games (started_at);
CREATE INDEX IF NOT EXISTS idx_live_games_ended_at ON public.live_games (ended_at);
CREATE INDEX IF NOT EXISTS idx_live_games_game_scope ON public.live_games (game_scope);
CREATE INDEX IF NOT EXISTS idx_live_games_white_user ON public.live_games (white_user_id) WHERE white_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_live_games_black_user ON public.live_games (black_user_id) WHERE black_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_live_games_status ON public.live_games (status);

-- 3. Trigger for updated_at
CREATE TRIGGER live_games_updated_at
  BEFORE UPDATE ON public.live_games
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- 4. Server-side Invariants & Immutability Trigger
CREATE OR REPLACE FUNCTION public.enforce_live_games_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  -- Handle DELETE
  IF TG_OP = 'DELETE' THEN
    -- Allow engine-level cascade deletions (parent live_session or auth user deleted)
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;

    -- Block direct client deletions
    RAISE EXCEPTION 'direct_delete_not_allowed' USING errcode = '23514';
  END IF;

  -- Handle UPDATE
  IF TG_OP = 'UPDATE' THEN
    -- Finalized games (COMPLETED or ABORTED) are immutable
    IF OLD.status IN ('COMPLETED', 'ABORTED') THEN
      RAISE EXCEPTION 'cannot_modify_finalized_game' USING errcode = '23514';
    END IF;

    -- Starting FEN, session, board, and scope cannot be mutated after creation
    IF NEW.live_session_id != OLD.live_session_id OR
       NEW.board_id != OLD.board_id OR
       NEW.game_scope != OLD.game_scope OR
       NEW.starting_fen != OLD.starting_fen THEN
      RAISE EXCEPTION 'cannot_modify_immutable_game_properties' USING errcode = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_live_games_invariants ON public.live_games;
CREATE TRIGGER trg_enforce_live_games_invariants
  BEFORE UPDATE OR DELETE ON public.live_games
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_live_games_invariants();

-- 5. Enable Row Level Security
ALTER TABLE public.live_games ENABLE ROW LEVEL SECURITY;

-- Policy: Authorized session participants can view live_games
DROP POLICY IF EXISTS "Authorized users can view live_games" ON public.live_games;
CREATE POLICY "Authorized users can view live_games"
  ON public.live_games
  FOR SELECT
  USING (
    public.is_current_user_admin()
    OR EXISTS (
      SELECT 1 FROM public.live_sessions s
      JOIN public.courses c ON c.id = s.course_id
      WHERE s.id = live_games.live_session_id
        AND (
          c.creator_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.live_session_staff st
            WHERE st.live_session_id = s.id AND st.user_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.enrollments e
            WHERE e.course_id = c.id AND e.user_id = auth.uid()
          )
        )
    )
  );

-- Policy: Admin management
DROP POLICY IF EXISTS "Admins can manage live_games" ON public.live_games;
CREATE POLICY "Admins can manage live_games"
  ON public.live_games
  FOR ALL
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());


-- 6. RPC: record_live_game_start
-- Optional client helper to record game start when moves begin
CREATE OR REPLACE FUNCTION public.record_live_game_start(
  p_game_id uuid,
  p_session_id uuid,
  p_board_id text,
  p_game_scope text,
  p_white_user_id uuid DEFAULT NULL,
  p_black_user_id uuid DEFAULT NULL,
  p_starting_fen text DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  p_started_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_session record;
  v_is_admin boolean := false;
  v_existing record;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = '28000';
  END IF;

  -- Validate inputs
  IF p_game_scope NOT IN ('MAIN', 'PRACTICE') THEN
    RAISE EXCEPTION 'invalid_game_scope' USING errcode = '23514';
  END IF;

  IF p_game_scope = 'MAIN' AND p_board_id != 'main' THEN
    RAISE EXCEPTION 'invalid_board_id_for_main' USING errcode = '23514';
  END IF;

  IF p_game_scope = 'PRACTICE' AND (p_board_id IS NULL OR trim(p_board_id) = '' OR p_board_id = 'main') THEN
    RAISE EXCEPTION 'invalid_board_id_for_practice' USING errcode = '23514';
  END IF;

  -- Validate session
  SELECT s.id, s.status, s.course_id, s.ended_at, s.updated_at, c.creator_id
  INTO v_session
  FROM public.live_sessions s
  JOIN public.courses c ON c.id = s.course_id
  WHERE s.id = p_session_id;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'live_session_not_found' USING errcode = 'P0002';
  END IF;

  -- Persistence window check (LIVE or ENDED within 2 hours)
  IF v_session.status = 'ENDED' THEN
    IF COALESCE(v_session.ended_at, v_session.updated_at) < now() - interval '2 hours' THEN
      RAISE EXCEPTION 'session_persistence_window_expired' USING errcode = '23514';
    END IF;
  ELSIF v_session.status != 'LIVE' THEN
    RAISE EXCEPTION 'session_not_active' USING errcode = '23514';
  END IF;

  -- Player participant validation
  IF p_white_user_id IS NOT NULL THEN
    IF p_white_user_id != v_session.creator_id
       AND NOT EXISTS (SELECT 1 FROM public.enrollments WHERE course_id = v_session.course_id AND user_id = p_white_user_id)
       AND NOT EXISTS (SELECT 1 FROM public.live_session_staff WHERE live_session_id = v_session.id AND user_id = p_white_user_id) THEN
      RAISE EXCEPTION 'invalid_white_player' USING errcode = '23514';
    END IF;
  END IF;

  IF p_black_user_id IS NOT NULL THEN
    IF p_black_user_id != v_session.creator_id
       AND NOT EXISTS (SELECT 1 FROM public.enrollments WHERE course_id = v_session.course_id AND user_id = p_black_user_id)
       AND NOT EXISTS (SELECT 1 FROM public.live_session_staff WHERE live_session_id = v_session.id AND user_id = p_black_user_id) THEN
      RAISE EXCEPTION 'invalid_black_player' USING errcode = '23514';
    END IF;
  END IF;

  -- Authoritative submission check
  SELECT (role = 'admin') INTO v_is_admin FROM public.users WHERE id = v_caller_id;

  IF p_game_scope = 'MAIN' THEN
    IF v_caller_id != v_session.creator_id AND NOT COALESCE(v_is_admin, false) THEN
      RAISE EXCEPTION 'unauthorized_main_game_submission' USING errcode = '42501';
    END IF;
  ELSE
    IF v_caller_id != v_session.creator_id
       AND NOT COALESCE(v_is_admin, false)
       AND (p_white_user_id IS NULL OR v_caller_id != p_white_user_id)
       AND (p_black_user_id IS NULL OR v_caller_id != p_black_user_id) THEN
      RAISE EXCEPTION 'unauthorized_practice_game_submission' USING errcode = '42501';
    END IF;
  END IF;

  -- Idempotency check: if game already recorded, return it
  SELECT * INTO v_existing FROM public.live_games WHERE id = p_game_id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.live_session_id != p_session_id THEN
      RAISE EXCEPTION 'game_session_mismatch' USING errcode = '23514';
    END IF;
    RETURN to_jsonb(v_existing);
  END IF;

  -- Insert new IN_PROGRESS game
  INSERT INTO public.live_games (
    id,
    live_session_id,
    board_id,
    game_scope,
    white_user_id,
    black_user_id,
    starting_fen,
    status,
    started_at,
    submitted_by
  ) VALUES (
    p_game_id,
    p_session_id,
    p_board_id,
    p_game_scope,
    p_white_user_id,
    p_black_user_id,
    COALESCE(p_starting_fen, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'),
    'IN_PROGRESS',
    COALESCE(p_started_at, now()),
    v_caller_id
  )
  RETURNING * INTO v_existing;

  RETURN to_jsonb(v_existing);
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_existing FROM public.live_games WHERE id = p_game_id;
    RETURN to_jsonb(v_existing);
END;
$$;


-- 7. RPC: finalize_live_game
-- Idempotent final game persistence (insert-if-not-exists or transition to COMPLETED/ABORTED)
CREATE OR REPLACE FUNCTION public.finalize_live_game(
  p_game_id uuid,
  p_session_id uuid,
  p_board_id text,
  p_game_scope text,
  p_white_user_id uuid DEFAULT NULL,
  p_black_user_id uuid DEFAULT NULL,
  p_starting_fen text DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  p_final_fen text DEFAULT NULL,
  p_pgn text DEFAULT NULL,
  p_result text DEFAULT '*',
  p_termination_reason text DEFAULT NULL,
  p_status text DEFAULT 'COMPLETED',
  p_move_count integer DEFAULT 0,
  p_started_at timestamptz DEFAULT now(),
  p_ended_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_session record;
  v_is_admin boolean := false;
  v_existing record;
  v_effective_ended_at timestamptz;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = '28000';
  END IF;

  -- Validate inputs
  IF p_game_scope NOT IN ('MAIN', 'PRACTICE') THEN
    RAISE EXCEPTION 'invalid_game_scope' USING errcode = '23514';
  END IF;

  IF p_game_scope = 'MAIN' AND p_board_id != 'main' THEN
    RAISE EXCEPTION 'invalid_board_id_for_main' USING errcode = '23514';
  END IF;

  IF p_game_scope = 'PRACTICE' AND (p_board_id IS NULL OR trim(p_board_id) = '' OR p_board_id = 'main') THEN
    RAISE EXCEPTION 'invalid_board_id_for_practice' USING errcode = '23514';
  END IF;

  IF p_result NOT IN ('1-0', '0-1', '1/2-1/2', '*') THEN
    RAISE EXCEPTION 'invalid_game_result' USING errcode = '23514';
  END IF;

  IF p_status NOT IN ('COMPLETED', 'ABORTED') THEN
    RAISE EXCEPTION 'invalid_game_status' USING errcode = '23514';
  END IF;

  IF p_move_count < 0 THEN
    RAISE EXCEPTION 'invalid_move_count' USING errcode = '23514';
  END IF;

  v_effective_ended_at := COALESCE(p_ended_at, now());

  IF p_started_at IS NOT NULL AND v_effective_ended_at < p_started_at THEN
    RAISE EXCEPTION 'invalid_timestamps: ended_at before started_at' USING errcode = '23514';
  END IF;

  IF p_started_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'invalid_timestamps: started_at in the future' USING errcode = '23514';
  END IF;

  -- Validate session
  SELECT s.id, s.status, s.course_id, s.ended_at, s.updated_at, c.creator_id
  INTO v_session
  FROM public.live_sessions s
  JOIN public.courses c ON c.id = s.course_id
  WHERE s.id = p_session_id;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'live_session_not_found' USING errcode = 'P0002';
  END IF;

  -- Persistence window check (LIVE or ENDED within 2 hours)
  IF v_session.status = 'ENDED' THEN
    IF COALESCE(v_session.ended_at, v_session.updated_at) < now() - interval '2 hours' THEN
      RAISE EXCEPTION 'session_persistence_window_expired' USING errcode = '23514';
    END IF;
  ELSIF v_session.status != 'LIVE' THEN
    RAISE EXCEPTION 'session_not_active' USING errcode = '23514';
  END IF;

  -- Player participant validation
  IF p_white_user_id IS NOT NULL THEN
    IF p_white_user_id != v_session.creator_id
       AND NOT EXISTS (SELECT 1 FROM public.enrollments WHERE course_id = v_session.course_id AND user_id = p_white_user_id)
       AND NOT EXISTS (SELECT 1 FROM public.live_session_staff WHERE live_session_id = v_session.id AND user_id = p_white_user_id) THEN
      RAISE EXCEPTION 'invalid_white_player' USING errcode = '23514';
    END IF;
  END IF;

  IF p_black_user_id IS NOT NULL THEN
    IF p_black_user_id != v_session.creator_id
       AND NOT EXISTS (SELECT 1 FROM public.enrollments WHERE course_id = v_session.course_id AND user_id = p_black_user_id)
       AND NOT EXISTS (SELECT 1 FROM public.live_session_staff WHERE live_session_id = v_session.id AND user_id = p_black_user_id) THEN
      RAISE EXCEPTION 'invalid_black_player' USING errcode = '23514';
    END IF;
  END IF;

  -- Authoritative submission check
  SELECT (role = 'admin') INTO v_is_admin FROM public.users WHERE id = v_caller_id;

  IF p_game_scope = 'MAIN' THEN
    IF v_caller_id != v_session.creator_id AND NOT COALESCE(v_is_admin, false) THEN
      RAISE EXCEPTION 'unauthorized_main_game_submission' USING errcode = '42501';
    END IF;
  ELSE
    IF v_caller_id != v_session.creator_id
       AND NOT COALESCE(v_is_admin, false)
       AND (p_white_user_id IS NULL OR v_caller_id != p_white_user_id)
       AND (p_black_user_id IS NULL OR v_caller_id != p_black_user_id) THEN
      RAISE EXCEPTION 'unauthorized_practice_game_submission' USING errcode = '42501';
    END IF;
  END IF;

  -- Check existing row
  SELECT * INTO v_existing FROM public.live_games WHERE id = p_game_id;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.live_session_id != p_session_id THEN
      RAISE EXCEPTION 'game_session_mismatch' USING errcode = '23514';
    END IF;

    -- If already finalized: check for idempotent match or conflict
    IF v_existing.status IN ('COMPLETED', 'ABORTED') THEN
      IF v_existing.result = p_result
         AND v_existing.board_id = p_board_id
         AND (v_existing.final_fen IS NOT DISTINCT FROM p_final_fen) THEN
        -- Idempotent retry / duplicate submission
        RETURN to_jsonb(v_existing);
      ELSE
        RAISE EXCEPTION 'conflicting_final_game_state' USING errcode = '23514';
      END IF;
    END IF;

    -- If IN_PROGRESS: update to final state
    UPDATE public.live_games
    SET
      final_fen = p_final_fen,
      pgn = p_pgn,
      result = p_result,
      termination_reason = p_termination_reason,
      status = p_status,
      move_count = p_move_count,
      ended_at = v_effective_ended_at,
      submitted_by = v_caller_id,
      updated_at = now()
    WHERE id = p_game_id
    RETURNING * INTO v_existing;

    RETURN to_jsonb(v_existing);
  END IF;

  -- Row does not exist: single-step final persistence (insert directly as finalized)
  INSERT INTO public.live_games (
    id,
    live_session_id,
    board_id,
    game_scope,
    white_user_id,
    black_user_id,
    starting_fen,
    final_fen,
    pgn,
    result,
    termination_reason,
    status,
    move_count,
    started_at,
    ended_at,
    submitted_by
  ) VALUES (
    p_game_id,
    p_session_id,
    p_board_id,
    p_game_scope,
    p_white_user_id,
    p_black_user_id,
    COALESCE(p_starting_fen, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'),
    p_final_fen,
    p_pgn,
    p_result,
    p_termination_reason,
    p_status,
    p_move_count,
    COALESCE(p_started_at, now()),
    v_effective_ended_at,
    v_caller_id
  )
  RETURNING * INTO v_existing;

  RETURN to_jsonb(v_existing);
EXCEPTION
  WHEN unique_violation THEN
    -- In case of concurrent insert race, check idempotency on the inserted row
    SELECT * INTO v_existing FROM public.live_games WHERE id = p_game_id;
    IF v_existing.result = p_result
       AND v_existing.board_id = p_board_id
       AND (v_existing.final_fen IS NOT DISTINCT FROM p_final_fen) THEN
      RETURN to_jsonb(v_existing);
    ELSE
      RAISE EXCEPTION 'conflicting_final_game_state' USING errcode = '23514';
    END IF;
END;
$$;


-- 8. RPC: get_live_session_games
CREATE OR REPLACE FUNCTION public.get_live_session_games(p_session_id uuid)
RETURNS SETOF public.live_games
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_session record;
  v_is_authorized boolean := false;
BEGIN
  -- Verify caller has access to the session
  SELECT s.id, s.course_id, c.creator_id
  INTO v_session
  FROM public.live_sessions s
  JOIN public.courses c ON c.id = s.course_id
  WHERE s.id = p_session_id;

  IF v_session.id IS NULL THEN
    RETURN;
  END IF;

  IF v_caller_id IS NOT NULL THEN
    IF v_caller_id = v_session.creator_id OR public.is_current_user_admin() THEN
      v_is_authorized := true;
    ELSIF EXISTS (SELECT 1 FROM public.live_session_staff WHERE live_session_id = p_session_id AND user_id = v_caller_id) THEN
      v_is_authorized := true;
    ELSIF EXISTS (SELECT 1 FROM public.enrollments WHERE course_id = v_session.course_id AND user_id = v_caller_id) THEN
      v_is_authorized := true;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'not_authorized_for_session_games' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT * FROM public.live_games
  WHERE live_session_id = p_session_id
  ORDER BY started_at ASC;
END;
$$;


-- 9. Grants
GRANT ALL ON TABLE public.live_games TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_live_game_start TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_live_game TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_live_session_games TO authenticated, service_role;
