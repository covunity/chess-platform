-- Migration 030 (PRD-0002 Slice 3): admin-only RPC to update the 4 bank
-- config keys seeded by migration 029. Lets admins edit bank info via the
-- /admin/settings UI without running raw SQL.
--
-- Mirrors the pattern from migration 023 (change_user_account_tier):
--   - SECURITY DEFINER + admin role guard (errcode 42501)
--   - Argument validation (errcode 22023) before any writes
--   - All four keys upserted in one transaction so the UI never observes
--     a partial bank config.

CREATE OR REPLACE FUNCTION public.update_bank_config(
  p_short_name      text,
  p_bin             text,
  p_account_number  text,
  p_account_name    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  -- Admin guard
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- Argument validation. Trim whitespace before checking emptiness so a
  -- form submission of "   " is rejected, not silently saved.
  IF p_short_name IS NULL OR length(btrim(p_short_name)) = 0 THEN
    RAISE EXCEPTION 'bank_short_name required' USING errcode = '22023';
  END IF;

  IF p_bin IS NULL OR p_bin !~ '^\d{6}$' THEN
    RAISE EXCEPTION 'bank_bin must be 6 digits' USING errcode = '22023';
  END IF;

  IF p_account_number IS NULL OR length(btrim(p_account_number)) = 0 THEN
    RAISE EXCEPTION 'bank_account_number required' USING errcode = '22023';
  END IF;

  IF p_account_name IS NULL OR length(btrim(p_account_name)) = 0 THEN
    RAISE EXCEPTION 'bank_account_name required' USING errcode = '22023';
  END IF;

  -- UPSERT all four keys. Migration 029 seeds rows for all of them, so
  -- this is normally an UPDATE, but ON CONFLICT keeps the function safe
  -- against an unexpectedly-empty config table.
  INSERT INTO public.config (key, value) VALUES
    ('bank_short_name',     btrim(p_short_name)),
    ('bank_bin',            p_bin),
    ('bank_account_number', btrim(p_account_number)),
    ('bank_account_name',   btrim(p_account_name))
  ON CONFLICT (key) DO UPDATE SET
    value      = EXCLUDED.value,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_bank_config(text, text, text, text) TO authenticated;
