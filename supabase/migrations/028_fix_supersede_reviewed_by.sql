-- Fix: submit_account_application was setting reviewed_by = caller (the applicant)
-- when superseding a pending application. reviewed_by is semantically reserved for
-- admin reviewers. When a user supersedes their own application, reviewed_by = NULL.

CREATE OR REPLACE FUNCTION public.submit_account_application(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller         uuid   := auth.uid();
  tier_code      text   := payload ->> 'requested_tier_code';
  motivation_val text   := trim(coalesce(payload ->> 'motivation', ''));
  experience_val text   := coalesce(trim(coalesce(payload ->> 'experience', '')), '');
  sample_url_val text   := nullif(trim(coalesce(payload ->> 'sample_url', '')), '');
  meta           jsonb  := coalesce(payload -> 'metadata', '{}'::jsonb);
  new_id         uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;

  -- Validate tier
  IF NOT EXISTS (SELECT 1 FROM public.account_tiers WHERE code = tier_code) THEN
    RAISE EXCEPTION 'invalid tier code: %', tier_code USING errcode = '22023';
  END IF;

  -- Motivation required for all tiers
  IF length(motivation_val) = 0 THEN
    RAISE EXCEPTION 'motivation required' USING errcode = '22023';
  END IF;

  -- Tier-specific required fields (E-19)
  IF tier_code = 'business' THEN
    IF nullif(trim(coalesce(meta ->> 'business_name', '')), '') IS NULL THEN
      RAISE EXCEPTION 'business_name required for business tier' USING errcode = '22023';
    END IF;
    IF nullif(trim(coalesce(meta ->> 'business_registration_no', '')), '') IS NULL THEN
      RAISE EXCEPTION 'business_registration_no required for business tier' USING errcode = '22023';
    END IF;
  ELSIF tier_code = 'athlete' THEN
    IF nullif(trim(coalesce(meta ->> 'federation_or_team', '')), '') IS NULL THEN
      RAISE EXCEPTION 'federation_or_team required for athlete tier' USING errcode = '22023';
    END IF;
  ELSIF tier_code = 'training_center' THEN
    IF nullif(trim(coalesce(meta ->> 'center_address', '')), '') IS NULL THEN
      RAISE EXCEPTION 'center_address required for training_center tier' USING errcode = '22023';
    END IF;
    IF (meta ->> 'center_size') IS NULL
       OR NOT (meta ->> 'center_size' ~ '^\d+$')
       OR (meta ->> 'center_size')::int <= 0 THEN
      RAISE EXCEPTION 'center_size must be a positive integer for training_center tier'
        USING errcode = '22023';
    END IF;
  END IF;

  -- Supersede any existing pending application (E-14).
  -- reviewed_by stays NULL — the applicant is not an admin reviewer.
  UPDATE public.account_applications
     SET status      = 'superseded',
         reviewed_at = now(),
         reviewed_by = NULL
   WHERE user_id = caller AND status = 'pending';

  -- Insert new application
  INSERT INTO public.account_applications (
    user_id, status, requested_tier_code, motivation, experience, sample_url, metadata
  ) VALUES (
    caller, 'pending', tier_code, motivation_val, experience_val, sample_url_val, meta
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_account_application(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_account_application(jsonb) TO authenticated;
