-- Migration 065 — Slice 3a of PRD-0006: vouchers table + admin CRUD RPCs.
--
-- Ships the `vouchers` table, its row-level security policies, and the
-- admin-only RPCs needed for the `/admin/vouchers` CRUD page. Voucher codes
-- are SECRETS — discovery must go through the slice 3b `preview_purchase`
-- RPC. This migration deliberately ships NO public SELECT policy so anon and
-- learner roles cannot enumerate codes via `from('vouchers')`.
--
-- `total_quota` is nullable to model "unlimited" without burning a magic
-- sentinel value. The accompanying CHECK uses COALESCE so a NULL quota
-- vacuously satisfies the "total_uses ≤ total_quota" invariant.
--
-- `applicable_courses` mirrors the campaigns column shape — jsonb array of
-- course id strings, or NULL for "applies to every course". `campaign_id`
-- is an optional FK so admins can tie a voucher to a parent campaign for
-- reporting; slice 3b is what wires the voucher into orders + usages.

-- ── 1. vouchers table ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vouchers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{6,20}$'),
  discount_type        text NOT NULL CHECK (discount_type IN ('percentage','fixed_amount')),
  discount_value       integer NOT NULL CHECK (discount_value >= 0),
  max_discount_amount  integer CHECK (max_discount_amount IS NULL OR max_discount_amount > 0),
  applicable_courses   jsonb,
  total_quota          integer CHECK (total_quota IS NULL OR total_quota > 0),
  total_uses           integer NOT NULL DEFAULT 0 CHECK (total_uses >= 0),
  per_user_limit       integer NOT NULL DEFAULT 1 CHECK (per_user_limit >= 1),
  starts_at            timestamptz NOT NULL,
  ends_at              timestamptz NOT NULL,
  is_active            boolean NOT NULL DEFAULT true,
  campaign_id          uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  created_by           uuid NOT NULL REFERENCES public.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vouchers_ends_after_starts CHECK (ends_at > starts_at),
  CONSTRAINT vouchers_pct_le_100 CHECK (
    discount_type = 'fixed_amount' OR discount_value <= 100
  ),
  -- NULL quota always passes (unlimited); otherwise total_uses ≤ total_quota.
  CONSTRAINT vouchers_uses_le_quota CHECK (
    total_uses <= COALESCE(total_quota, total_uses + 1)
  )
);

COMMENT ON TABLE public.vouchers IS
  'Manual-code vouchers (PRD-0006). NO public SELECT — codes are secrets, '
  'learner discovery is gated through preview_purchase RPC in slice 3b.';

COMMENT ON COLUMN public.vouchers.total_quota IS
  'NULL = unlimited. When non-NULL, total_uses ≤ total_quota is enforced by CHECK.';

CREATE INDEX IF NOT EXISTS idx_vouchers_code_active
  ON public.vouchers (code)
  WHERE is_active = true;

-- ── 2. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;

-- Admin: full read/write. No other SELECT policy on purpose — anon and
-- learners get an empty set when they try to query the table directly.
DROP POLICY IF EXISTS vouchers_admin_all ON public.vouchers;
CREATE POLICY vouchers_admin_all ON public.vouchers
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- ── 3. _validate_applicable_courses helper ──────────────────────────────────
-- Confirms every id in a jsonb array exists in public.courses. NULL input
-- (= "applies to every course") is treated as valid.
CREATE OR REPLACE FUNCTION public._validate_applicable_courses(p_courses jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_provided integer;
  v_found    integer;
BEGIN
  IF p_courses IS NULL THEN
    RETURN;
  END IF;
  IF jsonb_typeof(p_courses) <> 'array' THEN
    RAISE EXCEPTION 'voucher_course_not_found' USING errcode = '22023';
  END IF;
  SELECT jsonb_array_length(p_courses) INTO v_provided;
  IF v_provided = 0 THEN
    RETURN;
  END IF;
  SELECT count(*) INTO v_found
    FROM public.courses
   WHERE id::text IN (SELECT jsonb_array_elements_text(p_courses));
  IF v_found < v_provided THEN
    RAISE EXCEPTION 'voucher_course_not_found' USING errcode = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._validate_applicable_courses(jsonb) FROM public;

-- ── 4. create_voucher RPC ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_voucher(
  p_code                 text,
  p_discount_type        text,
  p_discount_value       integer,
  p_max_discount_amount  integer,
  p_applicable_courses   jsonb,
  p_total_quota          integer,
  p_per_user_limit       integer,
  p_starts_at            timestamptz,
  p_ends_at              timestamptz,
  p_campaign_id          uuid
)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  v_row  public.vouchers;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- Surface a stable error string even before the CHECK constraint can fire;
  -- the client matches on the prefix for i18n messages.
  IF p_code IS NULL OR p_code !~ '^[A-Z0-9]{6,20}$' THEN
    RAISE EXCEPTION 'voucher_code_invalid_format' USING errcode = '22023';
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
  IF p_per_user_limit IS NULL OR p_per_user_limit < 1 THEN
    RAISE EXCEPTION 'per_user_limit must be >= 1' USING errcode = '22023';
  END IF;
  IF p_total_quota IS NOT NULL AND p_total_quota < 1 THEN
    RAISE EXCEPTION 'total_quota must be >= 1 or NULL for unlimited' USING errcode = '22023';
  END IF;
  IF p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'ends_at must be greater than starts_at' USING errcode = '22023';
  END IF;

  PERFORM public._validate_applicable_courses(p_applicable_courses);

  BEGIN
    INSERT INTO public.vouchers (
      code, discount_type, discount_value, max_discount_amount,
      applicable_courses, total_quota, per_user_limit,
      starts_at, ends_at, is_active, campaign_id, created_by
    ) VALUES (
      p_code, p_discount_type, p_discount_value, p_max_discount_amount,
      p_applicable_courses, p_total_quota, p_per_user_limit,
      p_starts_at, p_ends_at, true, p_campaign_id, caller
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'voucher_code_already_exists' USING errcode = '23505';
  END;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_voucher(text, text, integer, integer, jsonb, integer, integer, timestamptz, timestamptz, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.create_voucher(text, text, integer, integer, jsonb, integer, integer, timestamptz, timestamptz, uuid) TO authenticated;

-- ── 5. update_voucher RPC ──────────────────────────────────────────────────
-- Locks critical fields once any usage exists (total_uses > 0). The set of
-- locked fields is intentionally aggressive: anything that changes economics
-- for past redemptions is forbidden. is_active + ends_at (extend only) +
-- applicable_courses + campaign_id stay mutable so admins can tweak scope.
CREATE OR REPLACE FUNCTION public.update_voucher(
  p_id                   uuid,
  p_code                 text,
  p_discount_type        text,
  p_discount_value       integer,
  p_max_discount_amount  integer,
  p_applicable_courses   jsonb,
  p_total_quota          integer,
  p_per_user_limit       integer,
  p_starts_at            timestamptz,
  p_ends_at              timestamptz,
  p_campaign_id          uuid
)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  v_existing public.vouchers;
  v_row      public.vouchers;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT * INTO v_existing FROM public.vouchers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'voucher not found: %', p_id USING errcode = 'P0002';
  END IF;

  IF p_code IS NULL OR p_code !~ '^[A-Z0-9]{6,20}$' THEN
    RAISE EXCEPTION 'voucher_code_invalid_format' USING errcode = '22023';
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
  IF p_per_user_limit IS NULL OR p_per_user_limit < 1 THEN
    RAISE EXCEPTION 'per_user_limit must be >= 1' USING errcode = '22023';
  END IF;
  IF p_total_quota IS NOT NULL AND p_total_quota < 1 THEN
    RAISE EXCEPTION 'total_quota must be >= 1 or NULL for unlimited' USING errcode = '22023';
  END IF;
  IF p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'ends_at must be greater than starts_at' USING errcode = '22023';
  END IF;

  PERFORM public._validate_applicable_courses(p_applicable_courses);

  IF v_existing.total_uses > 0 THEN
    IF p_code IS DISTINCT FROM v_existing.code
       OR p_discount_type IS DISTINCT FROM v_existing.discount_type
       OR p_discount_value IS DISTINCT FROM v_existing.discount_value
       OR p_max_discount_amount IS DISTINCT FROM v_existing.max_discount_amount
       OR p_per_user_limit IS DISTINCT FROM v_existing.per_user_limit
       OR p_starts_at IS DISTINCT FROM v_existing.starts_at THEN
      RAISE EXCEPTION 'voucher_locked_after_use' USING errcode = '22023';
    END IF;
    -- Quota may only grow (or stay) once used; shrinking below current uses
    -- would break the CHECK constraint anyway, but flag it explicitly.
    IF p_total_quota IS NOT NULL
       AND (v_existing.total_quota IS NULL OR p_total_quota < v_existing.total_quota) THEN
      RAISE EXCEPTION 'voucher_locked_after_use' USING errcode = '22023';
    END IF;
    -- ends_at may only extend (or stay); shrinking earlier than original
    -- would yank rights the campaign already advertised.
    IF p_ends_at < v_existing.ends_at THEN
      RAISE EXCEPTION 'voucher_locked_after_use' USING errcode = '22023';
    END IF;
  END IF;

  BEGIN
    UPDATE public.vouchers
       SET code                 = p_code,
           discount_type        = p_discount_type,
           discount_value       = p_discount_value,
           max_discount_amount  = p_max_discount_amount,
           applicable_courses   = p_applicable_courses,
           total_quota          = p_total_quota,
           per_user_limit       = p_per_user_limit,
           starts_at            = p_starts_at,
           ends_at              = p_ends_at,
           campaign_id          = p_campaign_id,
           updated_at           = now()
     WHERE id = p_id
     RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'voucher_code_already_exists' USING errcode = '23505';
  END;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_voucher(uuid, text, text, integer, integer, jsonb, integer, integer, timestamptz, timestamptz, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.update_voucher(uuid, text, text, integer, integer, jsonb, integer, integer, timestamptz, timestamptz, uuid) TO authenticated;

-- ── 6. deactivate_voucher RPC ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deactivate_voucher(p_id uuid)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  v_row  public.vouchers;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  UPDATE public.vouchers
     SET is_active  = false,
         updated_at = now()
   WHERE id = p_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'voucher not found: %', p_id USING errcode = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.deactivate_voucher(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.deactivate_voucher(uuid) TO authenticated;

-- ── 7. delete_voucher RPC ──────────────────────────────────────────────────
-- Hard-delete only when no usage has been recorded. Once total_uses > 0 the
-- voucher row must stick around so historical `voucher_usages.voucher_id` FK
-- points somewhere useful — admins should deactivate instead.
CREATE OR REPLACE FUNCTION public.delete_voucher(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  v_uses integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT total_uses INTO v_uses FROM public.vouchers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'voucher not found: %', p_id USING errcode = 'P0002';
  END IF;
  IF v_uses > 0 THEN
    RAISE EXCEPTION 'voucher_in_use' USING errcode = '22023';
  END IF;

  DELETE FROM public.vouchers WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_voucher(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_voucher(uuid) TO authenticated;
