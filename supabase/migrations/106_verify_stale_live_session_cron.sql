-- ── Migration 106: Enforce and Verify Stale Live Session Cron Safety ────────────
-- Guarantees that the pg_cron safety job for auto-ending stale live sessions
-- is strictly scheduled and active in production.
-- Unlike non-critical maintenance tasks, stale live session termination is a
-- required safety boundary; this migration fails loudly if pg_cron or job scheduling
-- fails, rather than silently swallowing errors.

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
DECLARE
  v_job_record record;
BEGIN
  -- 1. Idempotently unschedule any existing job with this name to avoid duplicates
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto_end_stale_live_sessions') THEN
    PERFORM cron.unschedule('auto_end_stale_live_sessions');
  END IF;

  -- 2. Schedule the safety cleanup job to run every 10 minutes
  PERFORM cron.schedule(
    'auto_end_stale_live_sessions',
    '*/10 * * * *',
    $cron$ SELECT public.auto_end_stale_live_sessions(); $cron$
  );

  -- 3. Strict verification assertion: must exist and be active
  SELECT jobid, schedule, command, active
  INTO v_job_record
  FROM cron.job
  WHERE jobname = 'auto_end_stale_live_sessions';

  IF v_job_record.jobid IS NULL THEN
    RAISE EXCEPTION 'CRITICAL: Failed to create pg_cron job auto_end_stale_live_sessions'
      USING errcode = '22023';
  END IF;

  IF v_job_record.active IS NOT TRUE THEN
    RAISE EXCEPTION 'CRITICAL: pg_cron job auto_end_stale_live_sessions is not active'
      USING errcode = '22023';
  END IF;

  IF v_job_record.schedule != '*/10 * * * *' THEN
    RAISE EXCEPTION 'CRITICAL: pg_cron job auto_end_stale_live_sessions has unexpected schedule: %', v_job_record.schedule
      USING errcode = '22023';
  END IF;

  IF v_job_record.command NOT LIKE '%public.auto_end_stale_live_sessions()%' THEN
    RAISE EXCEPTION 'CRITICAL: pg_cron job auto_end_stale_live_sessions has unexpected command: %', v_job_record.command
      USING errcode = '22023';
  END IF;
END $$;
