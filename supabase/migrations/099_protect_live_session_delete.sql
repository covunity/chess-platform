-- ── Migration 099: Protect live_sessions DELETE Policy ───────────────────────
-- Business rule: Only DRAFT sessions can be deleted.
-- SCHEDULED, LIVE, ENDED, and CANCELLED sessions must not be deleted.
-- Direct SQL / PostgREST DELETE attempts on non-DRAFT sessions are blocked with a clear exception.

CREATE OR REPLACE FUNCTION public.protect_live_session_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Business Rule: Only DRAFT live sessions can be deleted.
  -- SCHEDULED, LIVE, ENDED, and CANCELLED sessions must not be deleted.
  IF OLD.status IS DISTINCT FROM 'DRAFT' THEN
    -- Allow cascading deletion if parent course is deleted (pg_trigger_depth() > 1),
    -- but block all direct DELETE operations on live_sessions (pg_trigger_depth() <= 1).
    IF pg_trigger_depth() <= 1 THEN
      RAISE EXCEPTION 'Cannot delete session in % status. Only DRAFT sessions can be deleted. Use cancel_live_session() for SCHEDULED sessions.', OLD.status
        USING errcode = '42501';
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

-- Coexist with existing triggers (trg_live_sessions_lifecycle on INSERT/UPDATE)
DROP TRIGGER IF EXISTS trg_protect_live_session_delete ON public.live_sessions;
CREATE TRIGGER trg_protect_live_session_delete
  BEFORE DELETE ON public.live_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_live_session_delete();
