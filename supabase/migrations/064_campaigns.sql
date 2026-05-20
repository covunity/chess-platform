-- Migration 064 — Slice 1 of PRD-0006: Campaign skeleton + auto-display.
--
-- Ships the `campaigns` table, its row-level security policies, and the
-- admin-only RPCs needed for the `/admin/campaigns` CRUD page plus the
-- helper used by CourseDetailPage to discover the current active campaign
-- for a given course.
--
-- Locks at most 1 active campaign per time window (PRD-0006 V-D4) using a
-- GIST exclusion constraint over the closed `tstzrange(starts_at, ends_at)`.
-- Two admins trying to create overlapping active campaigns will race; the
-- losing transaction surfaces a `campaign_overlap_with_existing` error.
--
-- `applicable_courses` is a `jsonb` array of course id strings. NULL means
-- the campaign applies to every course on the platform — admins use this for
-- platform-wide sales (Tết, Black Friday). When non-NULL, the matcher checks
-- whether the course id appears in the array via the `?` operator.
--
-- Voucher tables and order extensions land in later slices (065-068) per
-- PRD-0006 §9. This migration does not touch `orders`.

-- ── 1. Extension needed for the exclusion constraint ────────────────────────
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── 2. campaigns table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaigns (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  description          text CHECK (description IS NULL OR length(description) <= 500),
  discount_type        text NOT NULL CHECK (discount_type IN ('percentage','fixed_amount')),
  discount_value       integer NOT NULL CHECK (discount_value >= 0),
  max_discount_amount  integer CHECK (max_discount_amount IS NULL OR max_discount_amount > 0),
  applicable_courses   jsonb,
  starts_at            timestamptz NOT NULL,
  ends_at              timestamptz NOT NULL,
  is_active            boolean NOT NULL DEFAULT true,
  created_by           uuid NOT NULL REFERENCES public.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaigns_ends_after_starts CHECK (ends_at > starts_at),
  CONSTRAINT campaigns_pct_le_100 CHECK (
    discount_type = 'fixed_amount' OR discount_value <= 100
  )
);

COMMENT ON TABLE public.campaigns IS
  'Auto-applied promotional discounts. At most one active campaign per time window '
  '(enforced by campaigns_no_overlap exclusion constraint). NULL applicable_courses '
  'means the campaign covers every course on the platform.';

-- Exclusion: two active campaigns may not share any moment in time. The
-- range is closed on both ends so a campaign ending at T0 and another
-- starting at T0 still collides — admin must end the first one strictly
-- before the second one begins.
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_no_overlap
  EXCLUDE USING gist (tstzrange(starts_at, ends_at, '[]') WITH &&)
  WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS idx_campaigns_active_range
  ON public.campaigns (starts_at, ends_at)
  WHERE is_active = true;

-- ── 3. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- Public (anon + authenticated) SELECT is limited to campaigns that are
-- currently in their active window. Course detail page reads this for the
-- price banner; admins use the broader admin policy below.
DROP POLICY IF EXISTS campaigns_select_active ON public.campaigns;
CREATE POLICY campaigns_select_active ON public.campaigns
  FOR SELECT
  TO authenticated, anon
  USING (is_active = true AND now() BETWEEN starts_at AND ends_at);

-- Admin: full read/write so they can manage inactive + future + past rows.
DROP POLICY IF EXISTS campaigns_admin_all ON public.campaigns;
CREATE POLICY campaigns_admin_all ON public.campaigns
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- ── 4. create_campaign RPC ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_campaign(
  p_name                 text,
  p_description          text,
  p_discount_type        text,
  p_discount_value       integer,
  p_max_discount_amount  integer,
  p_applicable_courses   jsonb,
  p_starts_at            timestamptz,
  p_ends_at              timestamptz
)
RETURNS public.campaigns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  v_row  public.campaigns;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF p_discount_type NOT IN ('percentage', 'fixed_amount') THEN
    RAISE EXCEPTION 'invalid discount_type: %', p_discount_type USING errcode = '22023';
  END IF;
  IF p_discount_value IS NULL OR p_discount_value < 0 THEN
    RAISE EXCEPTION 'discount_value must be >= 0' USING errcode = '22023';
  END IF;
  IF p_discount_type = 'percentage' AND p_discount_value > 100 THEN
    RAISE EXCEPTION 'percentage discount_value must be <= 100' USING errcode = '22023';
  END IF;
  IF p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'ends_at must be greater than starts_at' USING errcode = '22023';
  END IF;

  BEGIN
    INSERT INTO public.campaigns (
      name, description, discount_type, discount_value, max_discount_amount,
      applicable_courses, starts_at, ends_at, is_active, created_by
    ) VALUES (
      p_name, p_description, p_discount_type, p_discount_value, p_max_discount_amount,
      p_applicable_courses, p_starts_at, p_ends_at, true, caller
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN exclusion_violation THEN
    -- The GIST exclusion constraint surfaces sqlstate 23P01 when an active
    -- campaign already covers part of the new range. Re-raise with a stable
    -- string the client can match against for i18n error messages.
    RAISE EXCEPTION 'campaign_overlap_with_existing' USING errcode = '23P01';
  END;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_campaign(text, text, text, integer, integer, jsonb, timestamptz, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.create_campaign(text, text, text, integer, integer, jsonb, timestamptz, timestamptz) TO authenticated;

-- ── 5. update_campaign RPC ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_campaign(
  p_id                   uuid,
  p_name                 text,
  p_description          text,
  p_discount_type        text,
  p_discount_value       integer,
  p_max_discount_amount  integer,
  p_applicable_courses   jsonb,
  p_starts_at            timestamptz,
  p_ends_at              timestamptz
)
RETURNS public.campaigns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  v_row  public.campaigns;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF p_discount_type NOT IN ('percentage', 'fixed_amount') THEN
    RAISE EXCEPTION 'invalid discount_type: %', p_discount_type USING errcode = '22023';
  END IF;
  IF p_discount_value IS NULL OR p_discount_value < 0 THEN
    RAISE EXCEPTION 'discount_value must be >= 0' USING errcode = '22023';
  END IF;
  IF p_discount_type = 'percentage' AND p_discount_value > 100 THEN
    RAISE EXCEPTION 'percentage discount_value must be <= 100' USING errcode = '22023';
  END IF;
  IF p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'ends_at must be greater than starts_at' USING errcode = '22023';
  END IF;

  BEGIN
    UPDATE public.campaigns
       SET name                = p_name,
           description         = p_description,
           discount_type       = p_discount_type,
           discount_value      = p_discount_value,
           max_discount_amount = p_max_discount_amount,
           applicable_courses  = p_applicable_courses,
           starts_at           = p_starts_at,
           ends_at             = p_ends_at,
           updated_at          = now()
     WHERE id = p_id
     RETURNING * INTO v_row;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'campaign_overlap_with_existing' USING errcode = '23P01';
  END;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign not found: %', p_id USING errcode = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_campaign(uuid, text, text, text, integer, integer, jsonb, timestamptz, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.update_campaign(uuid, text, text, text, integer, integer, jsonb, timestamptz, timestamptz) TO authenticated;

-- ── 6. deactivate_campaign RPC ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deactivate_campaign(p_id uuid)
RETURNS public.campaigns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  v_row  public.campaigns;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  UPDATE public.campaigns
     SET is_active  = false,
         updated_at = now()
   WHERE id = p_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign not found: %', p_id USING errcode = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.deactivate_campaign(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.deactivate_campaign(uuid) TO authenticated;

-- ── 7. get_active_campaign_for_course helper ────────────────────────────────
-- Returns the single currently-active campaign that applies to the given
-- course. Because the exclusion constraint guarantees at most one active
-- campaign per moment in time, the result is at most one row. Match rule:
--   * applicable_courses IS NULL  → platform-wide, applies to every course.
--   * applicable_courses jsonb-?-> course_id::text → explicit whitelist.
-- Read-only, public — anon learners need this on the course detail page.
CREATE OR REPLACE FUNCTION public.get_active_campaign_for_course(p_course_id uuid)
RETURNS public.campaigns
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.*
    FROM public.campaigns c
   WHERE c.is_active = true
     AND now() BETWEEN c.starts_at AND c.ends_at
     AND (c.applicable_courses IS NULL
          OR c.applicable_courses ? p_course_id::text)
   ORDER BY c.starts_at DESC
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_active_campaign_for_course(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_active_campaign_for_course(uuid) TO authenticated, anon;
