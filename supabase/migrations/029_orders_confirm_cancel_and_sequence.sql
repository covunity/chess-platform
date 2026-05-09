-- Migration 029 (PRD-0002 Slice 1): orders confirm/cancel columns +
-- sequence-based order code + config table + bank info seed.
--
-- Builds on migration 021 (fee snapshot columns) and 026 (duplicate-pending
-- partial unique index + idempotent RPC). The duplicate-pending guard already
-- lives in 026 — this migration keeps the silent return-existing behaviour
-- because that gives the cleanest client UX (caller always navigates to the
-- returned order id, no special error path needed).

-- ── 1. Confirm/cancel columns on orders ────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS confirmed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by      uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at      timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by      uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_reason  text;

-- ── 2. Sequence-based order code ───────────────────────────────────────────
-- Replaces the `floor(random() * 1000000)` approach in migration 026, which
-- has a non-trivial collision risk past a few thousand orders. Sequence is
-- monotonic and unique across the database lifetime.
CREATE SEQUENCE IF NOT EXISTS public.orders_seq START 1;

-- ── 3. Config table (key/value runtime config) ─────────────────────────────
-- Used by Slice 3's `update_bank_config` RPC and read by the checkout page +
-- admin settings preview. Designed simple on purpose: no JSON, no scoping,
-- just text→text pairs that an admin can edit.
CREATE TABLE IF NOT EXISTS public.config (
  key         text        PRIMARY KEY,
  value       text        NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS config_updated_at ON public.config;
CREATE TRIGGER config_updated_at
  BEFORE UPDATE ON public.config
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.config ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read config (checkout page needs bank info).
-- No INSERT/UPDATE/DELETE policies — admin writes go through the
-- SECURITY DEFINER `update_bank_config` RPC introduced in Slice 3.
DROP POLICY IF EXISTS "Authenticated can read config" ON public.config;
CREATE POLICY "Authenticated can read config"
  ON public.config FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ── 4. Seed bank config keys with placeholders ─────────────────────────────
-- Real values are set by the admin via /admin/settings (Slice 3). The
-- placeholders here let the checkout page render without 500s on a fresh DB.
INSERT INTO public.config (key, value, description) VALUES
  ('bank_short_name',     'MBBANK',       'VietQR short name (e.g. MBBANK, VCB, TCB)'),
  ('bank_bin',            '970422',       'VietQR BIN code — 6 digits'),
  ('bank_account_number', '0000000000',   'Bank account number — placeholder, update via /admin/settings'),
  ('bank_account_name',   'CHESS COURSE', 'Account holder name — placeholder, update via /admin/settings')
ON CONFLICT (key) DO NOTHING;

-- ── 5. RPC: switch order code to sequence ──────────────────────────────────
-- Body identical to migration 026 except for the `v_order_code` line.
CREATE OR REPLACE FUNCTION public.create_order_with_fee_snapshot(
  p_course_id uuid
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id           uuid;
  v_course            record;
  v_creator_tier_code text;
  v_fee_pct           numeric(5, 2);
  v_fee_amount        integer;
  v_payout_amount     integer;
  v_order_status      public.order_status;
  v_order_code        text;
  v_new_order         public.orders;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Idempotency: return existing pending/active order for this (user, course)
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

  IF v_course.price = 0 THEN
    v_fee_amount    := 0;
    v_payout_amount := 0;
    v_fee_pct       := 0;
    v_order_status  := 'active';
  ELSE
    v_fee_amount    := floor(v_course.price * v_fee_pct / 100)::integer;
    v_payout_amount := v_course.price - v_fee_amount;
    v_order_status  := 'pending';
  END IF;

  v_order_code := 'ORD-' || extract(year FROM now())::text || '-' ||
                  lpad(nextval('public.orders_seq')::text, 6, '0');

  INSERT INTO public.orders (
    course_id,
    user_id,
    status,
    amount,
    code,
    platform_fee_pct,
    platform_fee_amount,
    creator_payout_amount,
    creator_payout,
    account_tier_code
  )
  VALUES (
    p_course_id,
    v_user_id,
    v_order_status,
    v_course.price,
    v_order_code,
    v_fee_pct,
    v_fee_amount,
    v_payout_amount,
    v_payout_amount,
    v_creator_tier_code
  )
  RETURNING * INTO v_new_order;

  IF v_course.price = 0 THEN
    INSERT INTO public.enrollments (course_id, user_id, order_id)
    VALUES (p_course_id, v_user_id, v_new_order.id)
    ON CONFLICT (course_id, user_id) DO NOTHING;
  END IF;

  RETURN v_new_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_order_with_fee_snapshot(uuid) TO authenticated;
