-- Renames creator_applications → account_applications and adds tier metadata.
-- Adds requested_tier_code + metadata columns, 'superseded' status value,
-- and new RPCs (submit / approve / reject) that supersede the old ones.

-- ── 1. Rename table (idempotent guard) ───────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'creator_applications'
  ) THEN
    ALTER TABLE public.creator_applications RENAME TO account_applications;
  END IF;
END
$$;

-- Rename auto-generated indexes for clarity
ALTER INDEX IF EXISTS creator_applications_one_pending_per_user
  RENAME TO account_applications_one_pending_per_user;
ALTER INDEX IF EXISTS creator_applications_status_idx
  RENAME TO account_applications_status_idx;

-- ── 2. Extend status constraint to include 'superseded' ──────────────────────
-- PG auto-renames constraints on table rename; drop both names defensively.
ALTER TABLE public.account_applications
  DROP CONSTRAINT IF EXISTS creator_applications_status_check,
  DROP CONSTRAINT IF EXISTS account_applications_status_check;

DO $$
BEGIN
  ALTER TABLE public.account_applications
    ADD CONSTRAINT account_applications_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'superseded'));
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

-- ── 3. New columns ───────────────────────────────────────────────────────────
ALTER TABLE public.account_applications
  ADD COLUMN IF NOT EXISTS requested_tier_code text NOT NULL DEFAULT 'individual'
    REFERENCES public.account_tiers(code),
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── 4. Drop old RPCs (reference table by old name; must recreate) ────────────
DROP FUNCTION IF EXISTS public.approve_creator_application(uuid);
DROP FUNCTION IF EXISTS public.reject_creator_application(uuid, text);

-- ── 5. RPC: submit_account_application ───────────────────────────────────────
-- Supersedes any existing pending application for the caller, then inserts
-- a new one. Validates tier-specific required fields server-side (E-19).
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

  -- Supersede any existing pending application (E-14)
  UPDATE public.account_applications
     SET status      = 'superseded',
         reviewed_at = now(),
         reviewed_by = caller
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

-- ── 6. RPC: approve_account_application ──────────────────────────────────────
-- Handles learner→creator and creator→creator (tier-only) transitions.
-- Raises tier_downgrade_violates_chapter_limit if new tier's chapter limit
-- would be exceeded by the user's existing courses (E-11).
CREATE OR REPLACE FUNCTION public.approve_account_application(app_id uuid)
RETURNS public.account_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app        public.account_applications;
  caller     uuid := auth.uid();
  target     public.users;
  new_tier   public.account_tiers;
  viol_count int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT * INTO app FROM public.account_applications
   WHERE id = app_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'application not found' USING errcode = 'P0002';
  END IF;

  IF app.status <> 'pending' THEN
    RAISE EXCEPTION 'application already reviewed' USING errcode = '22023';
  END IF;

  SELECT * INTO target FROM public.users WHERE id = app.user_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found' USING errcode = 'P0002';
  END IF;

  IF target.role = 'admin' THEN
    RAISE EXCEPTION 'cannot approve application for admin user' USING errcode = '22023';
  END IF;

  SELECT * INTO new_tier FROM public.account_tiers WHERE code = app.requested_tier_code;

  -- Downgrade violation check: any course with more chapters than the new limit
  SELECT COUNT(*) INTO viol_count
    FROM public.courses c
   WHERE c.creator_id = target.id
     AND (
       SELECT COUNT(*) FROM public.chapters ch WHERE ch.course_id = c.id
     ) > new_tier.max_chapters_per_course;

  IF viol_count > 0 THEN
    RAISE EXCEPTION 'tier_downgrade_violates_chapter_limit'
      USING errcode = '22023',
            detail  = format('%s course(s) exceed the new tier chapter limit of %s',
                             viol_count, new_tier.max_chapters_per_course);
  END IF;

  -- Learner → creator + tier; creator → tier only (E-20)
  IF target.role = 'learner' THEN
    UPDATE public.users
       SET role            = 'creator',
           account_tier_id = app.requested_tier_code
     WHERE id = target.id;
  ELSE
    UPDATE public.users
       SET account_tier_id = app.requested_tier_code
     WHERE id = target.id;
  END IF;

  UPDATE public.account_applications
     SET status      = 'approved',
         reviewed_at = now(),
         reviewed_by = caller
   WHERE id = app_id
   RETURNING * INTO app;

  RETURN app;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_account_application(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.approve_account_application(uuid) TO authenticated;

-- ── 7. RPC: reject_account_application ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reject_account_application(app_id uuid, reason text)
RETURNS public.account_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app    public.account_applications;
  caller uuid := auth.uid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF reason IS NULL OR length(btrim(reason)) = 0 THEN
    RAISE EXCEPTION 'rejection reason required' USING errcode = '22023';
  END IF;

  SELECT * INTO app FROM public.account_applications
   WHERE id = app_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'application not found' USING errcode = 'P0002';
  END IF;

  IF app.status <> 'pending' THEN
    RAISE EXCEPTION 'application already reviewed' USING errcode = '22023';
  END IF;

  UPDATE public.account_applications
     SET status           = 'rejected',
         reviewed_at      = now(),
         reviewed_by      = caller,
         rejection_reason = reason
   WHERE id = app_id
   RETURNING * INTO app;

  RETURN app;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_account_application(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.reject_account_application(uuid, text) TO authenticated;
