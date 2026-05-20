-- Migration 068 — Slice 3b of PRD-0006: voucher snapshot on orders +
-- voucher-aware preview_purchase + atomic voucher redemption in
-- create_order_with_fee_snapshot.
--
-- Slice 2 (migration 067) stamped only the campaign side of the discount.
-- This migration adds the voucher columns to `orders`, then teaches both
-- RPCs to:
--   * accept a voucher code,
--   * normalise + validate it (6 distinct errcodes),
--   * compute the pro-rata stacking per ADR-0007,
--   * lock the voucher row FOR UPDATE in the create path so two concurrent
--     "last-quota" redemptions cannot both succeed, and
--   * record a voucher_usages row + bump vouchers.total_uses in the same
--     transaction as the order INSERT.
--
-- Voucher fields stay snapshotted onto the order (ADR-0002 E-07 pattern):
-- editing the voucher after the order exists does not retroactively change
-- the learner's price or the creator's payout.
--
-- Free path (D-05): final_price = 0 → order is INSERTed with status=active
-- and an enrollment row is created in the same txn. The voucher_usages row
-- is still written so the BizDev quota stays accurate even on 100% promos
-- (ADR-0007 §7 "Quota is a marketing cap, not accounting").

-- ── 1. Voucher snapshot columns on orders ───────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS voucher_id              uuid REFERENCES public.vouchers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voucher_code            text,
  ADD COLUMN IF NOT EXISTS voucher_discount_amount integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.orders.voucher_id IS
  'Voucher row that applied at order creation time. ON DELETE SET NULL so '
  'deleting a stale voucher does not corrupt historical orders.';
COMMENT ON COLUMN public.orders.voucher_code IS
  'Snapshot of the voucher code at order time. Survives voucher deletion so '
  'admin orders pages can still show "voucher used: WELCOME10" months later.';
COMMENT ON COLUMN public.orders.voucher_discount_amount IS
  'Amount (₫) the voucher reduced the order by. 0 when no voucher used. '
  'Applied AFTER the campaign discount per ADR-0007 stacking formula.';

-- ── 2. Voucher discount helper ──────────────────────────────────────────────
-- Mirrors ADR-0007 applyDiscount(intermediate, voucher). Pure: takes the
-- voucher row + the (post-campaign) price and returns the integer ₫ discount.
-- NULL voucher / non-positive price → 0.
CREATE OR REPLACE FUNCTION public._voucher_discount_amount(
  p_price   integer,
  p_voucher public.vouchers
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_raw integer;
BEGIN
  IF p_voucher.id IS NULL OR p_price <= 0 THEN
    RETURN 0;
  END IF;

  IF p_voucher.discount_type = 'percentage' THEN
    v_raw := floor(p_price::numeric * p_voucher.discount_value / 100)::integer;
    IF p_voucher.max_discount_amount IS NOT NULL THEN
      RETURN LEAST(v_raw, p_voucher.max_discount_amount);
    END IF;
    RETURN v_raw;
  END IF;

  -- fixed_amount
  RETURN LEAST(p_voucher.discount_value, p_price);
END;
$$;

REVOKE ALL ON FUNCTION public._voucher_discount_amount(integer, public.vouchers) FROM public;

-- ── 3. Voucher resolution helper ────────────────────────────────────────────
-- Resolves a voucher code → vouchers row, raising the appropriate errcode
-- when the code is invalid. Used by BOTH preview_purchase (read-only) and
-- create_order_with_fee_snapshot (after the FOR UPDATE lock).
--
-- `p_lock_row = true` is what the create RPC passes so the voucher row gets
-- locked atomically. Preview passes false — no lock needed for a read.
--
-- Errcodes (caller catches by message string; '22023' for all to keep them
-- distinct from PG's built-in classes):
--   voucher_not_found          — no row with that code
--   voucher_inactive           — is_active = false
--   voucher_expired            — now() outside [starts_at, ends_at]
--   voucher_course_not_eligible — applicable_courses set + course not listed
--   voucher_quota_exceeded     — total_uses >= total_quota
--   voucher_user_limit         — per-user usage count >= per_user_limit
CREATE OR REPLACE FUNCTION public._resolve_voucher_for_purchase(
  p_code      text,
  p_course_id uuid,
  p_user_id   uuid,
  p_lock_row  boolean
)
RETURNS public.vouchers
LANGUAGE plpgsql
AS $$
DECLARE
  v_voucher    public.vouchers;
  v_norm_code  text;
  v_user_uses  integer;
BEGIN
  v_norm_code := upper(btrim(p_code));

  -- Lookup. Branch on lock so the SELECT actually grabs a row lock when
  -- called from the create RPC. plpgsql does not allow a runtime FOR UPDATE
  -- toggle on a single SELECT, so we duplicate the query.
  IF p_lock_row THEN
    SELECT * INTO v_voucher
      FROM public.vouchers
     WHERE code = v_norm_code
     FOR UPDATE;
  ELSE
    SELECT * INTO v_voucher
      FROM public.vouchers
     WHERE code = v_norm_code;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'voucher_not_found' USING errcode = '22023';
  END IF;

  IF NOT v_voucher.is_active THEN
    RAISE EXCEPTION 'voucher_inactive' USING errcode = '22023';
  END IF;

  IF now() < v_voucher.starts_at OR now() > v_voucher.ends_at THEN
    RAISE EXCEPTION 'voucher_expired' USING errcode = '22023';
  END IF;

  IF v_voucher.applicable_courses IS NOT NULL
     AND NOT (v_voucher.applicable_courses ? p_course_id::text) THEN
    RAISE EXCEPTION 'voucher_course_not_eligible' USING errcode = '22023';
  END IF;

  IF v_voucher.total_quota IS NOT NULL
     AND v_voucher.total_uses >= v_voucher.total_quota THEN
    RAISE EXCEPTION 'voucher_quota_exceeded' USING errcode = '22023';
  END IF;

  -- Per-user limit: count usages by this user on this voucher whose order
  -- is still alive (not cancelled / not expired). Voucher_usages CASCADE on
  -- order delete, so this stays in sync without a separate refund hook.
  SELECT count(*) INTO v_user_uses
    FROM public.voucher_usages vu
    JOIN public.orders o ON o.id = vu.order_id
   WHERE vu.voucher_id = v_voucher.id
     AND vu.user_id    = p_user_id
     AND o.status NOT IN ('cancelled', 'expired');

  IF v_user_uses >= v_voucher.per_user_limit THEN
    RAISE EXCEPTION 'voucher_user_limit' USING errcode = '22023';
  END IF;

  RETURN v_voucher;
END;
$$;

REVOKE ALL ON FUNCTION public._resolve_voucher_for_purchase(text, uuid, uuid, boolean) FROM public;

-- ── 4. preview_purchase — voucher-aware ────────────────────────────────────
-- Replaces the slice-2 version. Returns the same jsonb shape but now
-- populates voucher_id / voucher_code / voucher_discount_amount when a code
-- is supplied. Errors propagate as exceptions — the client maps the message
-- string to an i18n key.
CREATE OR REPLACE FUNCTION public.preview_purchase(
  p_course_id    uuid,
  p_voucher_code text DEFAULT NULL
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
  v_voucher            public.vouchers;
  v_voucher_discount   integer := 0;
  v_voucher_id         uuid;
  v_voucher_code       text;
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

  -- Campaign leg.
  SELECT * INTO v_campaign
    FROM public.get_active_campaign_for_course(p_course_id);

  IF FOUND AND v_campaign.id IS NOT NULL THEN
    v_campaign_discount := public._campaign_discount_amount(v_course.price, v_campaign);
    v_campaign_id       := v_campaign.id;
    v_campaign_name     := v_campaign.name;
  END IF;

  v_intermediate := GREATEST(v_course.price - v_campaign_discount, 0);

  -- Voucher leg. NULL / empty → skip resolution entirely.
  IF p_voucher_code IS NOT NULL AND btrim(p_voucher_code) <> '' THEN
    v_voucher := public._resolve_voucher_for_purchase(
      p_voucher_code, p_course_id, v_user_id, false
    );
    v_voucher_discount := public._voucher_discount_amount(v_intermediate, v_voucher);
    v_voucher_id       := v_voucher.id;
    v_voucher_code     := v_voucher.code;
  END IF;

  v_final := GREATEST(v_intermediate - v_voucher_discount, 0);

  -- Fee on FINAL price (ADR-0007). Free path → both halves zero.
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
    'voucher_id',                v_voucher_id,
    'voucher_code',              v_voucher_code,
    'voucher_discount_amount',   v_voucher_discount,
    'final_price',               v_final,
    'platform_fee_pct',          v_fee_pct,
    'platform_fee_amount',       v_fee_amount,
    'creator_payout_amount',     v_payout
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_purchase(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.preview_purchase(uuid, text) TO authenticated;

-- ── 5. create_order_with_fee_snapshot — voucher-aware ──────────────────────
-- Atomic transaction:
--   1. Idempotency early-exit on existing pending/active order (same as
--      slice 2 — repeat clicks of Đặt mua land back on the same row, the
--      voucher is NOT redeemed twice).
--   2. Lock the course row.
--   3. Resolve campaign.
--   4. If voucher code present: lock voucher row FOR UPDATE + re-validate.
--      The lock + revalidation is what makes the race-condition acceptance
--      criterion hold: two concurrent "last-quota" callers serialize; the
--      second one re-reads total_uses after the first commits and raises
--      voucher_quota_exceeded.
--   5. Apply ADR-0007 stacking to compute final_price.
--   6. INSERT order with all 6 snapshot fields.
--   7. INSERT voucher_usages + UPDATE vouchers.total_uses++ (if voucher).
--   8. INSERT enrollment if final_price = 0 (free path D-05).
DROP FUNCTION IF EXISTS public.create_order_with_fee_snapshot(uuid, text);

CREATE OR REPLACE FUNCTION public.create_order_with_fee_snapshot(
  p_course_id    uuid,
  p_voucher_code text DEFAULT NULL
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
  v_intermediate       integer;
  v_voucher            public.vouchers;
  v_voucher_id         uuid;
  v_voucher_code       text;
  v_voucher_discount   integer := 0;
  v_final_price        integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Idempotency: existing pending/active order wins. No double-redeem.
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

  SELECT u.account_tier_id, at.platform_fee_pct
    INTO v_creator_tier_code, v_fee_pct
    FROM public.users u
    JOIN public.account_tiers at ON at.code = u.account_tier_id
   WHERE u.id = v_course.creator_id;

  IF v_fee_pct IS NULL THEN
    v_fee_pct           := 20;
    v_creator_tier_code := 'individual';
  END IF;

  -- Campaign leg.
  SELECT * INTO v_campaign
    FROM public.get_active_campaign_for_course(p_course_id);

  IF FOUND AND v_campaign.id IS NOT NULL THEN
    v_campaign_discount := public._campaign_discount_amount(v_course.price, v_campaign);
    v_campaign_id       := v_campaign.id;
  END IF;

  v_intermediate := GREATEST(v_course.price - v_campaign_discount, 0);

  -- Voucher leg with row lock + re-validation. Empty string treated as null.
  IF p_voucher_code IS NOT NULL AND btrim(p_voucher_code) <> '' THEN
    v_voucher := public._resolve_voucher_for_purchase(
      p_voucher_code, p_course_id, v_user_id, true
    );
    v_voucher_discount := public._voucher_discount_amount(v_intermediate, v_voucher);
    v_voucher_id       := v_voucher.id;
    v_voucher_code     := v_voucher.code;
  END IF;

  v_final_price := GREATEST(v_intermediate - v_voucher_discount, 0);

  -- ADR-0007: fee applies to FINAL price; never negative. Free path flips
  -- order to active so D-05 takes over.
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
    campaign_discount_amount,
    voucher_id,
    voucher_code,
    voucher_discount_amount
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
    v_campaign_discount,
    v_voucher_id,
    v_voucher_code,
    v_voucher_discount
  )
  RETURNING * INTO v_new_order;

  -- Record the redemption + bump quota. Only when the voucher actually
  -- contributed a discount > 0 (a 0₫ voucher discount on a free course is
  -- still a redemption per PRD-0006 §11 V-D5 — quota is a marketing cap,
  -- not an accounting amount). We gate on v_voucher_id, not v_voucher_discount.
  IF v_voucher_id IS NOT NULL THEN
    INSERT INTO public.voucher_usages (
      voucher_id, user_id, order_id, discount_amount
    )
    VALUES (
      v_voucher_id, v_user_id, v_new_order.id,
      GREATEST(v_voucher_discount, 1)  -- CHECK > 0; 1₫ floor on free path
    );
    UPDATE public.vouchers
       SET total_uses = total_uses + 1
     WHERE id = v_voucher_id;
  END IF;

  IF v_final_price = 0 THEN
    INSERT INTO public.enrollments (course_id, user_id, order_id)
    VALUES (p_course_id, v_user_id, v_new_order.id)
    ON CONFLICT (course_id, user_id) DO NOTHING;
  END IF;

  RETURN v_new_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_order_with_fee_snapshot(uuid, text) TO authenticated;
