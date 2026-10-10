-- Migration 107: Enable Supabase Realtime for public.live_sessions table
-- Allows connected clients to receive real-time updates when a live session status transitions (e.g. LIVE -> ENDED / CANCELLED).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'live_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.live_sessions;
  END IF;
END $$;

ALTER TABLE public.live_sessions REPLICA IDENTITY FULL;

