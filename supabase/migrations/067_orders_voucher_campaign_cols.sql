-- Migration 067 — Slice 2 of PRD-0006: campaign snapshot on orders + preview_purchase RPC.
--
-- This is the PARTIAL form of the migration described in PRD-0006 §5.1.
-- Voucher-related columns (voucher_id, voucher_code, voucher_discount_amount)
-- land in slice 3b (issue #307) together with the `vouchers` + `voucher_usages`
-- tables. Slice 2 adds only the three campaign-related columns plus the
-- updated `create_order_with_fee_snapshot` and the new read-only
-- `preview_purchase` RPC. The function signatures already accept
-- `p_voucher_code text DEFAULT NULL` so callers can pass NULL today and slice
-- 3b can layer voucher resolution on top without another signature change.
--
-- Migration numbering: 064 = campaigns table (slice 1, in main). 065 + 066 are
-- reserved for slice 3a (vouchers + voucher_usages). It's intentional that
-- this migration jumps to 067 — the issue spec mandates that number so the
-- subsequent voucher migrations slot in cleanly.
--
-- Cost-split rationale: ADR-0007 (pro-rata).
-- Snapshot semantics: ADR-0002 E-07 (immutable per-order snapshot).
-- Free path: D-05 (final_price = 0 → auto-active enrollment in the same txn).

-- ── 1. Add the three campaign-snapshot columns to orders ────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS original_price            integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS campaign_id               uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS campaign_discount_amount  integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.orders.original_price IS
  'Course price at order creation time, before any discount. Snapshot per ADR-0002 E-07. '
  'Backfilled from courses.price for orders that pre-date PRD-0006.';
COMMENT ON COLUMN public.orders.campaign_id IS
  'Campaign that applied at order creation time (if any). ON DELETE SET NULL so '
  'deleting a stale campaign row does not corrupt historical orders.';
COMMENT ON COLUMN public.orders.campaign_discount_amount IS
  'Amount (₫) the campaign reduced the order by. 0 when no campaign matched. '
  'Pro-rata split between platform and creator per ADR-0007.';

-- Backfill original_price for legacy rows. For pre-PRD-0006 orders the
-- learner paid `amount`, which equals the listed `courses.price` (no
-- discount could be applied). Set original_price = courses.price for any
-- row still at the default 0. Idempotent — running this twice is a no-op.
UPDATE public.orders o
   SET original_price = c.price
  FROM public.courses c
 WHERE o.course_id = c.id
   AND o.original_price = 0;

-- ── 2. Helper: compute a campaign's discount amount for a given price ──────
-- Mirrors ADR-0007 applyDiscount(price, campaign). Pure: takes the campaign
-- row + price and returns the integer ₫ discount. NULL campaign → 0.
CREATE OR REPLACE FUNCTION public._campaign_discount_amount(
  p_price integer,
  p_campaign public.campaigns
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_raw integer;
BEGIN
  IF p_campaign.id IS NULL OR p_price <= 0 THEN
    RETURN 0;
  END IF;

  IF p_campaign.discount_type = 'percentage' THEN
    v_raw := floor(p_price::numeric * p_campaign.discount_value / 100)::integer;
    IF p_campaign.max_discount_amount IS NOT NULL THEN
      RETURN LEAST(v_raw, p_campaign.max_discount_amount);
    END IF;
    RETURN v_raw;
  END IF;

  -- fixed_amount
  RETURN LEAST(p_campaign.discount_value, p_price);
END;
$$;

REVOKE ALL ON FUNCTION public._campaign_discount_amount(integer, public.campaigns) FROM public;

-- ── 3. preview_purchase: read-only breakdown for /confirm-purchase ──────────
-- Returns jsonb shape used by the page. Voucher slots are present (per the
-- PRD §5.2 final shape) but always null/0 in slice 2 — slice 3b layers the
-- voucher lookup on top. SECURITY DEFINER so anon (not allowed) and learner
-- callers both go through the same path; the function explicitly requires
-- the caller to be authenticated.
CREATE OR REPLACE FUNCTION public.preview_purchase(
  p_course_id      uuid,
  p_voucher_code   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id            uuid;
  v_course             record;
  v_campaign           public.campaigns;
  v_campaign_discount  integer := 0;
  v_intermediate       integer;
  v_final              integer;
  v_fee_pct            numeric(5, 2);
  v_fee_amount         integer;
  v_payout             integer;
  v_campaign_id        uuid;
  v_campaign_name      text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;

  -- Course must exist and be published. Status guard is what makes this safe
  -- to call without checking ownership — anyone can preview a course they can
  -- already see in the catalog.
  SELECT id, price, creator_id, status
    INTO v_course
    FROM public.courses
   WHERE id = p_course_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'course_not_found' USING errcode = 'P0002';
  END IF;
  IF v_course.status <> 'published' THEN
    RAISE EXCEPTION 'course_not_published' USING errcode = '22023';
  END IF;

  -- Resolve the currently-active campaign matching this course, if any.
  SELECT * INTO v_campaign
    FROM public.get_active_campaign_for_course(p_course_id);

  IF FOUND AND v_campaign.id IS NOT NULL THEN
    v_campaign_discount := public._campaign_discount_amount(v_course.price, v_campaign);
    v_campaign_id       := v_campaign.id;
    v_campaign_name     := v_campaign.name;
  END IF;

  v_intermediate := GREATEST(v_course.price - v_campaign_discount, 0);

  -- Voucher slot — slice 3b. p_voucher_code is intentionally accepted to lock
  -- the signature; slice 2 leaves voucher fields at null/0.
  v_final := v_intermediate;

  -- Fee snapshot mirrors the create RPC. Fee applies to FINAL price per ADR-0007.
  SELECT at.platform_fee_pct
    INTO v_fee_pct
    FROM public.users u
    JOIN public.account_tiers at ON at.code = u.account_tier_id
   WHERE u.id = v_course.creator_id;

  IF v_fee_pct IS NULL THEN
    v_fee_pct := 20;
  END IF;

  IF v_final = 0 THEN
    v_fee_amount := 0;
    v_payout     := 0;
    v_fee_pct    := 0;
  ELSE
    v_payout     := floor(v_final::numeric * (100 - v_fee_pct) / 100)::integer;
    v_fee_amount := v_final - v_payout;
  END IF;

  RETURN jsonb_build_object(
    'original_price',            v_course.price,
    'campaign_id',               v_campaign_id,
    'campaign_name',             v_campaign_name,
    'campaign_discount_amount',  v_campaign_discount,
    'voucher_id',                NULL,
    'voucher_code',              NULL,
    'voucher_discount_amount',   0,
    'final_price',               v_final,
    'platform_fee_pct',          v_fee_pct,
    'platform_fee_amount',       v_fee_amount,
    'creator_payout_amount',     v_payout
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_purchase(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.preview_purchase(uuid, text) TO authenticated;

-- ── 4. create_order_with_fee_snapshot — campaign-aware version ─────────────
-- The previous version (migration 055) only stamped the listed course price
-- onto the order. This version resolves the current campaign at order
-- creation time, applies the pro-rata discount, and writes the snapshot into
-- the three new columns. Voucher param is accepted but not yet wired
-- (slice 3b). Old callers that pass only `p_course_id` keep working because
-- `p_voucher_code` has a NULL default.
--
-- Drop the old single-arg overload so Postgres does not have to resolve
-- between two signatures — there is exactly one create RPC after this.
DROP FUNCTION IF EXISTS public.create_order_with_fee_snapshot(uuid);

CREATE OR REPLACE FUNCTION public.create_order_with_fee_snapshot(
  p_course_id     uuid,
  p_voucher_code  text DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id            uuid;
  v_course             record;
  v_creator_tier_code  text;
  v_fee_pct            numeric(5, 2);
  v_fee_amount         integer;
  v_payout_amount      integer;
  v_order_status       public.order_status;
  v_seq_value          bigint;
  v_order_code         text;
  v_new_order          public.orders;
  v_campaign           public.campaigns;
  v_campaign_id        uuid;
  v_campaign_discount  integer := 0;
  v_final_price        integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Idempotency: return existing pending/active order for this (user, course).
  -- Slice 2 keeps the legacy contract — repeat clicks of "Đặt mua" land back
  -- on the same row. Slice 3b widens this to handle voucher re-application.
  SELECT * INTO v_new_order
    FROM public.orders
   WHERE course_id = p_course_id
     AND user_id   = v_user_id
     AND status IN ('pending', 'active')
   LIMIT 1;

  IF FOUND THEN
    RETURN v_new_order;
  END IF;

  SELECT id, price, creator_id, status
    INTO v_course
    FROM public.courses
   WHERE id = p_course_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'course not found: %', p_course_id;
  END IF;

  -- Creator's tier fee. Same fallback the old version used.
  SELECT u.account_tier_id, at.platform_fee_pct
    INTO v_creator_tier_code, v_fee_pct
    FROM public.users u
    JOIN public.account_tiers at ON at.code = u.account_tier_id
   WHERE u.id = v_course.creator_id;

  IF v_fee_pct IS NULL THEN
    v_fee_pct           := 20;
    v_creator_tier_code := 'individual';
  END IF;

  -- Campaign resolution. The helper RPC already enforces "at most one active
  -- campaign whose range covers now()" via the GIST exclusion constraint.
  SELECT * INTO v_campaign
    FROM public.get_active_campaign_for_course(p_course_id);

  IF FOUND AND v_campaign.id IS NOT NULL THEN
    v_campaign_discount := public._campaign_discount_amount(v_course.price, v_campaign);
    v_campaign_id       := v_campaign.id;
  END IF;

  v_final_price := GREATEST(v_course.price - v_campaign_discount, 0);

  -- Fee computed on the FINAL price (ADR-0007). Free path (final = 0) flips
  -- the order to active immediately and creates the enrollment below.
  IF v_final_price = 0 THEN
    v_fee_amount    := 0;
    v_payout_amount := 0;
    v_fee_pct       := 0;
    v_order_status  := 'active';
  ELSE
    v_payout_amount := floor(v_final_price::numeric * (100 - v_fee_pct) / 100)::integer;
    v_fee_amount    := v_final_price - v_payout_amount;
    v_order_status  := 'pending';
  END IF;

  -- Single nextval — used for both human-readable code and PayOS orderCode.
  v_seq_value  := nextval('public.orders_seq');
  v_order_code := 'ORD-' || extract(year FROM now())::text || '-' ||
                  lpad(v_seq_value::text, 6, '0');

  INSERT INTO public.orders (
    course_id,
    user_id,
    status,
    amount,
    code,
    payos_order_code,
    platform_fee_pct,
    platform_fee_amount,
    creator_payout_amount,
    creator_payout,
    account_tier_code,
    original_price,
    campaign_id,
    campaign_discount_amount
  )
  VALUES (
    p_course_id,
    v_user_id,
    v_order_status,
    v_final_price,
    v_order_code,
    v_seq_value,
    v_fee_pct,
    v_fee_amount,
    v_payout_amount,
    v_payout_amount,
    v_creator_tier_code,
    v_course.price,
    v_campaign_id,
    v_campaign_discount
  )
  RETURNING * INTO v_new_order;

  IF v_final_price = 0 THEN
    -- D-05 free path. Same INSERT pattern as the legacy migration; ON
    -- CONFLICT covers the rare case where a parallel admin-confirm raced.
    INSERT INTO public.enrollments (course_id, user_id, order_id)
    VALUES (p_course_id, v_user_id, v_new_order.id)
    ON CONFLICT (course_id, user_id) DO NOTHING;
  END IF;

  RETURN v_new_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_order_with_fee_snapshot(uuid, text) TO authenticated;
