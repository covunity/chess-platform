-- Migration 070 — Fix voucher_usages writing 1₫ instead of 0₫ on free-path
-- stacking (issue #319).
--
-- ## Why
--
-- Migration 066 created `voucher_usages.discount_amount integer NOT NULL
-- CHECK (discount_amount > 0)` — a `> 0` constraint that disallows legitimate
-- 0₫ redemptions. Migration 068's `create_order_with_fee_snapshot` worked
-- around the constraint by inserting `GREATEST(v_voucher_discount, 1)` on the
-- free path (campaign already discounts the course to 0 → voucher's real
-- discount is also 0). That workaround silently inflates the audit row by 1₫
-- and corrupts marketing analytics ("voucher saved learners X₫" is wrong).
--
-- PRD-0006 §5.3 + §11 V-D5 require the snapshot to be both immutable and
-- accurate. Quota is a marketing cap (we still record the redemption on a
-- free-path order), but the *amount* on that row must be the real 0₫.
--
-- ## What this migration does
--
-- 1. Replace the `> 0` CHECK with `>= 0` so 0₫ is a valid value.
-- 2. Recreate `create_order_with_fee_snapshot` with the workaround removed —
--    the voucher_usages INSERT now writes `v_voucher_discount` directly.
-- 3. Backfill rows that are free-path artifacts: rows where
--    `voucher_usages.discount_amount = 1` AND the parent order had
--    `orders.voucher_discount_amount = 0` (i.e. the snapshot on the order
--    confirms this was a free-path redemption, so the audit row's 1₫ is the
--    floor-induced lie). Genuine 1₫ voucher discounts have
--    `orders.voucher_discount_amount = 1` — they are left untouched.
--
-- ## Scenario coverage
--
-- * Free-path stacking (campaign −100% → final=0, voucher applied): the
--   voucher_usages row now records `discount_amount = 0` and quota still
--   bumps by 1 (V-D5 unchanged).
-- * Paid-path (voucher applies real discount): unchanged — `v_voucher_discount`
--   is whatever `_voucher_discount_amount` returned, same as before.
-- * Idempotency: `DROP CONSTRAINT IF EXISTS`, `ADD CONSTRAINT`, `CREATE OR
--   REPLACE`, and the WHERE-scoped backfill all re-run safely.
--
-- See: issue #319, ADR-0007 (stacking), PRD-0006 §5.3 / §11 V-D5.

-- ── 1. Swap the CHECK constraint: > 0 → >= 0 ────────────────────────────────
-- PG auto-named the inline column CHECK from migration 066 as
-- `voucher_usages_discount_amount_check`. Drop-then-add (idempotent via
-- IF EXISTS) so a fresh DB also lands on the correct constraint.
ALTER TABLE public.voucher_usages
  DROP CONSTRAINT IF EXISTS voucher_usages_discount_amount_check;

ALTER TABLE public.voucher_usages
  ADD CONSTRAINT voucher_usages_discount_amount_check
  CHECK (discount_amount >= 0);

-- ── 2. Recreate create_order_with_fee_snapshot without the GREATEST workaround
-- Body is byte-identical to migration 068 except for line 450's INSERT,
-- where `GREATEST(v_voucher_discount, 1)` is replaced with `v_voucher_discount`.
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

  -- Record the redemption + bump quota. Gate stays on v_voucher_id (not on
  -- v_voucher_discount > 0) per PRD-0006 §11 V-D5: a 0₫ voucher discount on
  -- a free course is still a redemption — quota is a marketing cap, not an
  -- accounting amount. Migration 070 dropped the `> 0` CHECK on
  -- voucher_usages.discount_amount, so we can finally write the real value
  -- here instead of the 1₫ workaround from migration 068.
  IF v_voucher_id IS NOT NULL THEN
    INSERT INTO public.voucher_usages (
      voucher_id, user_id, order_id, discount_amount
    )
    VALUES (
      v_voucher_id, v_user_id, v_new_order.id,
      v_voucher_discount  -- issue #319: was GREATEST(v_voucher_discount, 1)
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

-- ── 3. Backfill: restore free-path artifacts from 1₫ → 0₫ ───────────────────
-- Free-path rows correspond to orders where `voucher_discount_amount = 0`
-- (the snapshot on the order itself). Real 1₫ voucher discounts would have
-- `orders.voucher_discount_amount = 1`, so this WHERE clause leaves those
-- alone. Safe to re-run: idempotent because the next pass finds 0 matching
-- rows after the first pass commits.
UPDATE public.voucher_usages
   SET discount_amount = 0
 WHERE discount_amount = 1
   AND order_id IN (
     SELECT id FROM public.orders WHERE voucher_discount_amount = 0
   );
