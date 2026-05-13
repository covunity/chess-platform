-- Migration 038: creator_payout_info + payout RPCs (#184)
-- Adds bank-account collection to /become-creator (all tiers) + edit flow at
-- /creator/settings/payout. Snapshot lives in account_applications.metadata.payout_info
-- (immutable audit trail); source-of-truth for settlement lives in
-- public.creator_payout_info (upserted at approve time, editable by owner).

-- ── 1. creator_payout_info table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.creator_payout_info (
  user_id        uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  bank_code      text NOT NULL,
  bank_name      text NOT NULL,
  account_number text NOT NULL,
  account_holder text NOT NULL,
  bank_branch    text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Non-unique index for duplicate-detection lookup.
CREATE INDEX IF NOT EXISTS creator_payout_info_lookup_idx
  ON public.creator_payout_info (bank_code, account_number);

ALTER TABLE public.creator_payout_info ENABLE ROW LEVEL SECURITY;

-- Owner can read own row; admin can read all.
DROP POLICY IF EXISTS "Owners read own payout info" ON public.creator_payout_info;
CREATE POLICY "Owners read own payout info"
  ON public.creator_payout_info FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins read all payout info" ON public.creator_payout_info;
CREATE POLICY "Admins read all payout info"
  ON public.creator_payout_info FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

-- No direct INSERT / UPDATE / DELETE policies — all mutations go through
-- SECURITY DEFINER RPCs below.

-- ── 2. submit_account_application: now requires payout_info for ALL tiers ────
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
  payout         jsonb  := meta -> 'payout_info';
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

  -- payout_info required for ALL tiers (#184)
  IF payout IS NULL OR jsonb_typeof(payout) <> 'object' THEN
    RAISE EXCEPTION 'payout_info required' USING errcode = '22023';
  END IF;
  IF nullif(trim(coalesce(payout ->> 'bank_code', '')), '') IS NULL THEN
    RAISE EXCEPTION 'payout_info.bank_code required' USING errcode = '22023';
  END IF;
  IF nullif(trim(coalesce(payout ->> 'bank_name', '')), '') IS NULL THEN
    RAISE EXCEPTION 'payout_info.bank_name required' USING errcode = '22023';
  END IF;
  IF (payout ->> 'account_number') IS NULL
     OR NOT (payout ->> 'account_number' ~ '^[0-9]{6,19}$') THEN
    RAISE EXCEPTION 'payout_info.account_number must be 6-19 digits' USING errcode = '22023';
  END IF;
  IF nullif(trim(coalesce(payout ->> 'account_holder', '')), '') IS NULL THEN
    RAISE EXCEPTION 'payout_info.account_holder required' USING errcode = '22023';
  END IF;
  IF nullif(trim(coalesce(payout ->> 'bank_branch', '')), '') IS NULL THEN
    RAISE EXCEPTION 'payout_info.bank_branch required' USING errcode = '22023';
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

-- ── 3. approve_account_application: now upserts creator_payout_info ──────────
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
  payout     jsonb;
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

  -- Upsert payout_info snapshot → source-of-truth table (#184).
  -- Snapshot is guaranteed present by submit_account_application validation.
  payout := app.metadata -> 'payout_info';
  IF payout IS NOT NULL AND jsonb_typeof(payout) = 'object' THEN
    INSERT INTO public.creator_payout_info (
      user_id, bank_code, bank_name, account_number, account_holder, bank_branch, updated_at
    ) VALUES (
      target.id,
      payout ->> 'bank_code',
      payout ->> 'bank_name',
      payout ->> 'account_number',
      payout ->> 'account_holder',
      payout ->> 'bank_branch',
      now()
    )
    ON CONFLICT (user_id) DO UPDATE
      SET bank_code      = EXCLUDED.bank_code,
          bank_name      = EXCLUDED.bank_name,
          account_number = EXCLUDED.account_number,
          account_holder = EXCLUDED.account_holder,
          bank_branch    = EXCLUDED.bank_branch,
          updated_at     = now();
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

-- ── 4. RPC: update_creator_payout_info (owner only) ──────────────────────────
CREATE OR REPLACE FUNCTION public.update_creator_payout_info(payload jsonb)
RETURNS public.creator_payout_info
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  row    public.creator_payout_info;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'creator') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'payload required' USING errcode = '22023';
  END IF;
  IF nullif(trim(coalesce(payload ->> 'bank_code', '')), '') IS NULL THEN
    RAISE EXCEPTION 'bank_code required' USING errcode = '22023';
  END IF;
  IF nullif(trim(coalesce(payload ->> 'bank_name', '')), '') IS NULL THEN
    RAISE EXCEPTION 'bank_name required' USING errcode = '22023';
  END IF;
  IF (payload ->> 'account_number') IS NULL
     OR NOT (payload ->> 'account_number' ~ '^[0-9]{6,19}$') THEN
    RAISE EXCEPTION 'account_number must be 6-19 digits' USING errcode = '22023';
  END IF;
  IF nullif(trim(coalesce(payload ->> 'account_holder', '')), '') IS NULL THEN
    RAISE EXCEPTION 'account_holder required' USING errcode = '22023';
  END IF;
  IF nullif(trim(coalesce(payload ->> 'bank_branch', '')), '') IS NULL THEN
    RAISE EXCEPTION 'bank_branch required' USING errcode = '22023';
  END IF;

  INSERT INTO public.creator_payout_info (
    user_id, bank_code, bank_name, account_number, account_holder, bank_branch, updated_at
  ) VALUES (
    caller,
    payload ->> 'bank_code',
    payload ->> 'bank_name',
    payload ->> 'account_number',
    payload ->> 'account_holder',
    payload ->> 'bank_branch',
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET bank_code      = EXCLUDED.bank_code,
        bank_name      = EXCLUDED.bank_name,
        account_number = EXCLUDED.account_number,
        account_holder = EXCLUDED.account_holder,
        bank_branch    = EXCLUDED.bank_branch,
        updated_at     = now()
  RETURNING * INTO row;

  RETURN row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_creator_payout_info(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.update_creator_payout_info(jsonb) TO authenticated;

-- ── 5. RPC: find_duplicate_payout_owners (admin only) ────────────────────────
-- Returns users (excluding the given user_id) that already own a payout row
-- with the same (bank_code, account_number). Used by admin review UI to warn
-- on duplicate accounts. No UNIQUE constraint at the DB layer (#184 Q3).
CREATE OR REPLACE FUNCTION public.find_duplicate_payout_owners(
  p_bank_code text,
  p_account_number text,
  p_exclude_user_id uuid DEFAULT NULL
)
RETURNS TABLE (user_id uuid, name text, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN QUERY
    SELECT u.id, u.name, u.email
      FROM public.creator_payout_info pi
      JOIN public.users u ON u.id = pi.user_id
     WHERE pi.bank_code      = p_bank_code
       AND pi.account_number = p_account_number
       AND (p_exclude_user_id IS NULL OR pi.user_id <> p_exclude_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.find_duplicate_payout_owners(text, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.find_duplicate_payout_owners(text, text, uuid) TO authenticated;
