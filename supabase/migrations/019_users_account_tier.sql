-- Migration 019: Add account_tier_id to users + admin-lock trigger
-- See docs/adr/0002-enterprise-account-tiers.md (E-04, E-05)

-- Add tier column; existing rows default to 'individual' (E-04)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS account_tier_id text NOT NULL DEFAULT 'individual'
  REFERENCES public.account_tiers (code);

-- Trigger: admin accounts are always locked to individual tier (E-05)
CREATE OR REPLACE FUNCTION public.enforce_admin_individual_tier()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.role = 'admin' AND NEW.account_tier_id != 'individual' THEN
    RAISE EXCEPTION 'admin accounts must have account_tier_id = ''individual''';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_admin_individual_tier_trigger ON public.users;

CREATE TRIGGER enforce_admin_individual_tier_trigger
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_admin_individual_tier();
