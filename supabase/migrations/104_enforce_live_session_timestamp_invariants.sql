-- ── Migration 104: Enforce Live Session Timestamp Invariants ───────────────────
-- Formalizes lifecycle timestamp invariants at table constraint level:
-- 1. LIVE must have started_at:
--    status != 'LIVE' OR started_at IS NOT NULL
-- 2. ENDED must have both timestamps and valid ordering:
--    status != 'ENDED' OR (started_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at >= started_at)
-- 3. DRAFT / SCHEDULED / CANCELLED must not have lifecycle timestamps:
--    status NOT IN ('DRAFT', 'SCHEDULED', 'CANCELLED') OR (started_at IS NULL AND ended_at IS NULL)
-- 4. Global timestamp ordering:
--    ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at

DO $$
BEGIN
  -- 1. LIVE must have started_at
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'live_sessions_live_started_at_chk'
  ) THEN
    ALTER TABLE public.live_sessions
      ADD CONSTRAINT live_sessions_live_started_at_chk
      CHECK (status != 'LIVE' OR started_at IS NOT NULL);
  END IF;

  -- 2. ENDED must have both started_at and ended_at, and ended_at >= started_at
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'live_sessions_ended_timestamps_chk'
  ) THEN
    ALTER TABLE public.live_sessions
      ADD CONSTRAINT live_sessions_ended_timestamps_chk
      CHECK (
        status != 'ENDED'
        OR (
          started_at IS NOT NULL
          AND ended_at IS NOT NULL
          AND ended_at >= started_at
        )
      );
  END IF;

  -- 3. DRAFT / SCHEDULED / CANCELLED must not have started_at or ended_at
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'live_sessions_pre_live_timestamps_chk'
  ) THEN
    ALTER TABLE public.live_sessions
      ADD CONSTRAINT live_sessions_pre_live_timestamps_chk
      CHECK (
        status NOT IN ('DRAFT', 'SCHEDULED', 'CANCELLED')
        OR (
          started_at IS NULL
          AND ended_at IS NULL
        )
      );
  END IF;

  -- 4. Global timestamp ordering
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'live_sessions_timestamp_ordering_chk'
  ) THEN
    ALTER TABLE public.live_sessions
      ADD CONSTRAINT live_sessions_timestamp_ordering_chk
      CHECK (
        ended_at IS NULL
        OR started_at IS NULL
        OR ended_at >= started_at
      );
  END IF;
END $$;
