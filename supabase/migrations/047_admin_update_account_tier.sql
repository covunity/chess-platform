-- Migration 047: admin RPC to update an account_tier's platform fee + chapter cap.
--
-- The account_tiers table already lets admins UPDATE via RLS, but the client
-- only has a read-only API. This RPC gives the admin UI a single, validated
-- entry point (matches the pattern from 039_creator_fee_override.sql).

CREATE OR REPLACE FUNCTION public.admin_update_account_tier(
  p_code                    text,
  p_platform_fee_pct        numeric,
  p_max_chapters_per_course integer
)
RETURNS public.account_tiers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  target public.account_tiers;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF p_platform_fee_pct IS NULL OR p_platform_fee_pct < 0 OR p_platform_fee_pct > 100 THEN
    RAISE EXCEPTION 'platform_fee_pct must be between 0 and 100' USING errcode = '22023';
  END IF;

  IF p_max_chapters_per_course IS NULL OR p_max_chapters_per_course < 1 OR p_max_chapters_per_course > 1000 THEN
    RAISE EXCEPTION 'max_chapters_per_course must be between 1 and 1000' USING errcode = '22023';
  END IF;

  SELECT * INTO target FROM public.account_tiers WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tier not found: %', p_code USING errcode = 'P0002';
  END IF;

  UPDATE public.account_tiers
     SET platform_fee_pct        = p_platform_fee_pct,
         max_chapters_per_course = p_max_chapters_per_course
   WHERE code = p_code
   RETURNING * INTO target;

  RETURN target;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_account_tier(text, numeric, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_update_account_tier(text, numeric, integer) TO authenticated;
