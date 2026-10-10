-- ── Migration 111: Live Classroom Chat Persistence & Retention ───────────
-- TASK 8.1: Creates dedicated persistent entity for live classroom chat (public.live_chat_messages).
--
-- Architecture:
--   - Chat belongs to live_session, NOT lesson.
--   - Realtime delivery uses LiveKit DataChannels.
--   - Persisted chat stores logical messages in Supabase for session history.
--   - Scopes:
--       * MAIN: Global classroom chat. board_id MUST BE NULL.
--       * PRACTICE: Private practice board chat. board_id MUST BE NOT NULL.
--   - Server-side authorization & RLS:
--       * Session must exist, belong to course, and status NOT IN ('DRAFT', 'CANCELLED') for insert.
--       * Reading permitted for all non-DRAFT sessions (persists after session completes/cancels).
--       * Caller must be course creator (teacher), staff (assistant), enrolled student, or admin.
--       * sender_user_id is strictly derived from auth.uid().
--       * PRACTICE messages require board_id and are isolated to participants of that board.
--   - Append-only immutability:
--       * UPDATE and direct DELETE are blocked.
--       * ON DELETE CASCADE preserves cleanup when parent live_session is deleted.
--   - Idempotency: client_message_id ensures safe retries without duplicate rows.

-- 1. Create table public.live_chat_messages
CREATE TABLE IF NOT EXISTS public.live_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_session_id uuid NOT NULL REFERENCES public.live_sessions(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('MAIN', 'PRACTICE')),
  board_id text NULL,
  sender_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_display_name text NULL,
  client_message_id text NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Scope invariant:
  -- MAIN: board_id IS NULL
  -- PRACTICE: board_id IS NOT NULL and non-empty
  CONSTRAINT live_chat_messages_scope_board_chk CHECK (
    (scope = 'MAIN' AND board_id IS NULL) OR
    (scope = 'PRACTICE' AND board_id IS NOT NULL AND char_length(trim(board_id)) > 0)
  ),

  -- Content invariant: non-empty, non-whitespace, max 1000 characters
  CONSTRAINT live_chat_messages_content_chk CHECK (
    char_length(trim(message)) > 0 AND char_length(message) <= 1000
  )
);

-- 2. Indexes for efficient lookup & pagination
CREATE INDEX IF NOT EXISTS idx_live_chat_messages_session_created
  ON public.live_chat_messages (live_session_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_live_chat_messages_session_scope_created
  ON public.live_chat_messages (live_session_id, scope, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_live_chat_messages_practice_board
  ON public.live_chat_messages (live_session_id, board_id, created_at ASC, id ASC)
  WHERE scope = 'PRACTICE';

CREATE INDEX IF NOT EXISTS idx_live_chat_messages_sender
  ON public.live_chat_messages (sender_user_id);

-- Partial unique index for client message deduplication / idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_chat_messages_client_id_uniq
  ON public.live_chat_messages (live_session_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

-- 3. Immutability & Deletion Safeguards Trigger
CREATE OR REPLACE FUNCTION public.enforce_live_chat_messages_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Allow cascade delete from parent live_sessions or auth.users
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'direct_delete_not_allowed' USING errcode = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'cannot_modify_chat_messages' USING errcode = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_live_chat_messages_invariants ON public.live_chat_messages;
CREATE TRIGGER trg_enforce_live_chat_messages_invariants
  BEFORE UPDATE OR DELETE ON public.live_chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_live_chat_messages_invariants();

-- 4. Enable Row Level Security
ALTER TABLE public.live_chat_messages ENABLE ROW LEVEL SECURITY;

-- Policy: SELECT / Read Chat Messages
DROP POLICY IF EXISTS "Authorized users can read live_chat_messages" ON public.live_chat_messages;
CREATE POLICY "Authorized users can read live_chat_messages"
  ON public.live_chat_messages
  FOR SELECT
  USING (
    -- 1. Caller must be authorized session participant
    EXISTS (
      SELECT 1 FROM public.live_sessions s
      JOIN public.courses c ON c.id = s.course_id
      WHERE s.id = live_chat_messages.live_session_id
        AND s.status NOT IN ('DRAFT')
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
          OR public.is_current_user_admin()
        )
    )
    AND (
      -- 2a. MAIN chat is visible to all authorized session participants
      scope = 'MAIN'
      OR
      -- 2b. PRACTICE chat: Creator (teacher) and Admin can observe
      EXISTS (
        SELECT 1 FROM public.live_sessions s
        JOIN public.courses c ON c.id = s.course_id
        WHERE s.id = live_chat_messages.live_session_id
          AND (c.creator_id = auth.uid() OR public.is_current_user_admin())
      )
      OR
      -- 2c. PRACTICE chat: Sender can read own messages
      sender_user_id = auth.uid()
      OR
      -- 2d. PRACTICE chat: Assigned player for this board in live_games
      EXISTS (
        SELECT 1 FROM public.live_games g
        WHERE g.live_session_id = live_chat_messages.live_session_id
          AND g.board_id = live_chat_messages.board_id
          AND (g.white_user_id = auth.uid() OR g.black_user_id = auth.uid())
      )
    )
  );

-- Policy: INSERT / Post Chat Messages
DROP POLICY IF EXISTS "Authorized users can insert live_chat_messages" ON public.live_chat_messages;
CREATE POLICY "Authorized users can insert live_chat_messages"
  ON public.live_chat_messages
  FOR INSERT
  WITH CHECK (
    -- 1. Sender must be authenticated user
    sender_user_id = auth.uid()
    -- 2. Message length validation
    AND char_length(trim(message)) > 0
    AND char_length(message) <= 1000
    -- 3. Scope and board_id invariants
    AND (
      (scope = 'MAIN' AND board_id IS NULL) OR
      (scope = 'PRACTICE' AND board_id IS NOT NULL AND char_length(trim(board_id)) > 0)
    )
    -- 4. Session exists, not DRAFT, not CANCELLED, caller is authorized participant
    AND EXISTS (
      SELECT 1 FROM public.live_sessions s
      JOIN public.courses c ON c.id = s.course_id
      WHERE s.id = live_chat_messages.live_session_id
        AND s.status NOT IN ('DRAFT', 'CANCELLED')
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
          OR public.is_current_user_admin()
        )
    )
    -- 5. For PRACTICE scope: caller must be creator or assigned to this board
    AND (
      scope = 'MAIN'
      OR EXISTS (
        SELECT 1 FROM public.live_sessions s
        JOIN public.courses c ON c.id = s.course_id
        WHERE s.id = live_chat_messages.live_session_id
          AND c.creator_id = auth.uid()
      )
      OR (
        -- Not assigned to another board
        NOT EXISTS (
          SELECT 1 FROM public.live_games g
          WHERE g.live_session_id = live_chat_messages.live_session_id
            AND g.board_id != live_chat_messages.board_id
            AND (g.white_user_id = auth.uid() OR g.black_user_id = auth.uid())
        )
        AND (
          -- If live_games has assigned players for this board, caller must be one of them
          NOT EXISTS (
            SELECT 1 FROM public.live_games g
            WHERE g.live_session_id = live_chat_messages.live_session_id
              AND g.board_id = live_chat_messages.board_id
          )
          OR EXISTS (
            SELECT 1 FROM public.live_games g
            WHERE g.live_session_id = live_chat_messages.live_session_id
              AND g.board_id = live_chat_messages.board_id
              AND (g.white_user_id = auth.uid() OR g.black_user_id = auth.uid())
          )
        )
      )
    )
  );

-- Policy: Admins can manage live_chat_messages
DROP POLICY IF EXISTS "Admins can manage live_chat_messages" ON public.live_chat_messages;
CREATE POLICY "Admins can manage live_chat_messages"
  ON public.live_chat_messages
  FOR ALL
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());


-- 5. RPC: send_live_chat_message
-- Authoritative server procedure for posting a live chat message
CREATE OR REPLACE FUNCTION public.send_live_chat_message(
  p_session_id uuid,
  p_scope text,
  p_message text,
  p_board_id text DEFAULT NULL,
  p_client_message_id text DEFAULT NULL,
  p_sender_display_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_sender_id uuid := auth.uid();
  v_session record;
  v_is_authorized boolean := false;
  v_is_admin boolean := false;
  v_existing record;
  v_inserted record;
  v_trimmed_msg text;
BEGIN
  IF v_sender_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = '28000';
  END IF;

  v_trimmed_msg := trim(p_message);
  IF v_trimmed_msg = '' OR char_length(p_message) > 1000 THEN
    RAISE EXCEPTION 'invalid_message_length' USING errcode = '23514';
  END IF;

  IF p_scope NOT IN ('MAIN', 'PRACTICE') THEN
    RAISE EXCEPTION 'invalid_chat_scope' USING errcode = '23514';
  END IF;

  IF p_scope = 'MAIN' AND p_board_id IS NOT NULL THEN
    RAISE EXCEPTION 'main_message_cannot_have_board_id' USING errcode = '23514';
  END IF;

  IF p_scope = 'PRACTICE' AND (p_board_id IS NULL OR trim(p_board_id) = '') THEN
    RAISE EXCEPTION 'practice_message_requires_board_id' USING errcode = '23514';
  END IF;

  -- Verify session exists
  SELECT s.id, s.course_id, s.status, c.creator_id
  INTO v_session
  FROM public.live_sessions s
  JOIN public.courses c ON c.id = s.course_id
  WHERE s.id = p_session_id;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'session_not_found' USING errcode = 'P0002';
  END IF;

  -- Block insert on DRAFT or CANCELLED sessions
  IF v_session.status IN ('DRAFT', 'CANCELLED') THEN
    RAISE EXCEPTION 'session_not_accepting_chat' USING errcode = '23514';
  END IF;

  -- Check admin
  v_is_admin := public.is_current_user_admin();

  -- Verify user authorization to the session
  IF v_session.creator_id = v_sender_id OR v_is_admin THEN
    v_is_authorized := true;
  ELSE
    -- Assistant check
    IF EXISTS (
      SELECT 1 FROM public.live_session_staff st
      WHERE st.live_session_id = p_session_id AND st.user_id = v_sender_id
    ) THEN
      v_is_authorized := true;
    ELSE
      -- Enrolled learner check
      IF EXISTS (
        SELECT 1 FROM public.enrollments e
        WHERE e.course_id = v_session.course_id AND e.user_id = v_sender_id
      ) THEN
        v_is_authorized := true;
      END IF;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'unauthorized_session_participant' USING errcode = '42501';
  END IF;

  -- For PRACTICE: verify board authorization (only course creator is teacher)
  IF p_scope = 'PRACTICE' AND v_session.creator_id != v_sender_id THEN
    -- If caller is assigned to a different board, reject
    IF EXISTS (
      SELECT 1 FROM public.live_games g
      WHERE g.live_session_id = p_session_id
        AND g.board_id != p_board_id
        AND (g.white_user_id = v_sender_id OR g.black_user_id = v_sender_id)
    ) THEN
      RAISE EXCEPTION 'unauthorized_practice_board_participant' USING errcode = '42501';
    END IF;

    -- If games exist for this board and caller is not a player, reject
    IF EXISTS (
      SELECT 1 FROM public.live_games g
      WHERE g.live_session_id = p_session_id AND g.board_id = p_board_id
    ) AND NOT EXISTS (
      SELECT 1 FROM public.live_games g
      WHERE g.live_session_id = p_session_id AND g.board_id = p_board_id
        AND (g.white_user_id = v_sender_id OR g.black_user_id = v_sender_id)
    ) THEN
      RAISE EXCEPTION 'unauthorized_practice_board_participant' USING errcode = '42501';
    END IF;
  END IF;

  -- Idempotency check on client_message_id
  IF p_client_message_id IS NOT NULL AND trim(p_client_message_id) != '' THEN
    SELECT * INTO v_existing
    FROM public.live_chat_messages
    WHERE live_session_id = p_session_id AND client_message_id = p_client_message_id;

    IF v_existing.id IS NOT NULL THEN
      RETURN to_jsonb(v_existing);
    END IF;
  END IF;

  -- Insert message
  INSERT INTO public.live_chat_messages (
    live_session_id,
    scope,
    board_id,
    sender_user_id,
    sender_display_name,
    client_message_id,
    message
  ) VALUES (
    p_session_id,
    p_scope,
    CASE WHEN p_scope = 'PRACTICE' THEN p_board_id ELSE NULL END,
    v_sender_id,
    p_sender_display_name,
    p_client_message_id,
    p_message
  )
  RETURNING * INTO v_inserted;

  RETURN to_jsonb(v_inserted);
EXCEPTION
  WHEN unique_violation THEN
    IF p_client_message_id IS NOT NULL THEN
      SELECT * INTO v_existing
      FROM public.live_chat_messages
      WHERE live_session_id = p_session_id AND client_message_id = p_client_message_id;
      IF v_existing.id IS NOT NULL THEN
        RETURN to_jsonb(v_existing);
      END IF;
    END IF;
    RAISE;
END;
$$;


-- 6. RPC: get_live_chat_messages
-- Deterministic history retrieval with cursor pagination and scope isolation
-- Returns recent messages ordered chronologically (created_at ASC, id ASC)
CREATE OR REPLACE FUNCTION public.get_live_chat_messages(
  p_session_id uuid,
  p_scope text DEFAULT 'MAIN',
  p_board_id text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  live_session_id uuid,
  scope text,
  board_id text,
  sender_user_id uuid,
  sender_display_name text,
  client_message_id text,
  message text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_session record;
  v_is_authorized boolean := false;
  v_is_admin boolean := false;
  v_limit integer;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING errcode = '28000';
  END IF;

  IF p_scope NOT IN ('MAIN', 'PRACTICE') THEN
    RAISE EXCEPTION 'invalid_chat_scope' USING errcode = '23514';
  END IF;

  IF p_scope = 'PRACTICE' AND (p_board_id IS NULL OR trim(p_board_id) = '') THEN
    RAISE EXCEPTION 'practice_query_requires_board_id' USING errcode = '23514';
  END IF;

  -- Verify session exists
  SELECT s.id, s.course_id, s.status, c.creator_id
  INTO v_session
  FROM public.live_sessions s
  JOIN public.courses c ON c.id = s.course_id
  WHERE s.id = p_session_id;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'session_not_found' USING errcode = 'P0002';
  END IF;

  -- Block viewing on DRAFT sessions
  IF v_session.status = 'DRAFT' THEN
    RAISE EXCEPTION 'session_not_found' USING errcode = 'P0002';
  END IF;

  v_is_admin := public.is_current_user_admin();

  -- Verify caller authorization to the session
  IF v_session.creator_id = v_caller_id OR v_is_admin THEN
    v_is_authorized := true;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.live_session_staff st
      WHERE st.live_session_id = p_session_id AND st.user_id = v_caller_id
    ) THEN
      v_is_authorized := true;
    ELSE
      IF EXISTS (
        SELECT 1 FROM public.enrollments e
        WHERE e.course_id = v_session.course_id AND e.user_id = v_caller_id
      ) THEN
        v_is_authorized := true;
      END IF;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'unauthorized_session_participant' USING errcode = '42501';
  END IF;

  -- For PRACTICE: verify board privacy
  IF p_scope = 'PRACTICE' AND NOT v_is_admin AND v_session.creator_id != v_caller_id THEN
    -- If caller is assigned to another board, reject
    IF EXISTS (
      SELECT 1 FROM public.live_games g
      WHERE g.live_session_id = p_session_id
        AND g.board_id != p_board_id
        AND (g.white_user_id = v_caller_id OR g.black_user_id = v_caller_id)
    ) THEN
      RAISE EXCEPTION 'unauthorized_practice_board_participant' USING errcode = '42501';
    END IF;

    -- If this board has games and caller is not a player or previous sender, reject
    IF EXISTS (
      SELECT 1 FROM public.live_games g
      WHERE g.live_session_id = p_session_id AND g.board_id = p_board_id
    ) AND NOT EXISTS (
      SELECT 1 FROM public.live_games g
      WHERE g.live_session_id = p_session_id AND g.board_id = p_board_id
        AND (g.white_user_id = v_caller_id OR g.black_user_id = v_caller_id)
    ) AND NOT EXISTS (
      SELECT 1 FROM public.live_chat_messages m
      WHERE m.live_session_id = p_session_id AND m.scope = 'PRACTICE'
        AND m.board_id = p_board_id AND m.sender_user_id = v_caller_id
    ) THEN
      RAISE EXCEPTION 'unauthorized_practice_board_participant' USING errcode = '42501';
    END IF;
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);

  RETURN QUERY
  SELECT
    sub.id,
    sub.live_session_id,
    sub.scope,
    sub.board_id,
    sub.sender_user_id,
    sub.sender_display_name,
    sub.client_message_id,
    sub.message,
    sub.created_at
  FROM (
    SELECT
      m.id,
      m.live_session_id,
      m.scope,
      m.board_id,
      m.sender_user_id,
      m.sender_display_name,
      m.client_message_id,
      m.message,
      m.created_at
    FROM public.live_chat_messages m
    WHERE m.live_session_id = p_session_id
      AND m.scope = p_scope
      AND (
        (p_scope = 'MAIN' AND m.board_id IS NULL)
        OR
        (p_scope = 'PRACTICE' AND m.board_id = p_board_id)
      )
      AND (
        p_scope = 'MAIN'
        OR v_is_admin
        OR v_session.creator_id = v_caller_id
        OR m.sender_user_id = v_caller_id
        OR EXISTS (
          SELECT 1 FROM public.live_games g
          WHERE g.live_session_id = p_session_id
            AND g.board_id = p_board_id
            AND (g.white_user_id = v_caller_id OR g.black_user_id = v_caller_id)
        )
      )
      AND (
        p_before_created_at IS NULL
        OR (
          p_before_id IS NOT NULL AND (m.created_at, m.id) < (p_before_created_at, p_before_id)
          OR p_before_id IS NULL AND m.created_at < p_before_created_at
        )
      )
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT v_limit
  ) sub
  ORDER BY sub.created_at ASC, sub.id ASC;
END;
$$;

-- 7. Permissions
GRANT SELECT, INSERT ON public.live_chat_messages TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_live_chat_message TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_live_chat_messages TO authenticated;
