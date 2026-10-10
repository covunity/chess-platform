-- ── Migration 105: Stale Live Session Safety (Auto-End) ────────────────────────
-- Implements automatic safety ending for abandoned LIVE sessions.
--
-- Product Rules:
-- A LIVE session transitions to ENDED when the first applicable ceiling is reached:
-- 1. Maximum live duration: started_at + 12 hours
-- OR
-- 2. Scheduled end grace ceiling: scheduled_end_at + 6 hours
--    (ONLY when scheduled_end_at > started_at)
--
-- Preserves:
-- - started_at timestamp
-- - scheduled_start_at / scheduled_end_at
-- - all existing lifecycle triggers and field mutability constraints
--
-- Concurrency:
-- - Uses FOR UPDATE SKIP LOCKED to prevent duplicate work or race conditions
--
-- Security:
-- - SECURITY DEFINER with fixed search_path = public, auth, pg_temp
-- - REVOKE from PUBLIC, anon, authenticated
-- - GRANT to postgres, service_role

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

-- Security & Permissions:
-- Strictly maintenance-only; prevent regular users from calling directly
REVOKE ALL ON FUNCTION public.auto_end_stale_live_sessions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_end_stale_live_sessions() FROM anon;
REVOKE ALL ON FUNCTION public.auto_end_stale_live_sessions() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.auto_end_stale_live_sessions() TO service_role;
GRANT EXECUTE ON FUNCTION public.auto_end_stale_live_sessions() TO postgres;

COMMENT ON FUNCTION public.auto_end_stale_live_sessions() IS
  'Safety maintenance worker: auto-ends stale LIVE sessions exceeding 12h live duration or scheduled_end_at + 6h grace ceiling.';

-- Schedule with pg_cron if extension is available
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto_end_stale_live_sessions') THEN
    PERFORM cron.unschedule('auto_end_stale_live_sessions');
  END IF;

  PERFORM cron.schedule(
    'auto_end_stale_live_sessions',
    '*/10 * * * *',
    $cron$ SELECT public.auto_end_stale_live_sessions(); $cron$
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron job scheduling skipped: %', SQLERRM;
END $$;
