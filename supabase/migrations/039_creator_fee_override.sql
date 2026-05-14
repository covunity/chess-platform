-- Migration 039: per-creator platform fee override (#185)
-- Admin can set/clear `users.platform_fee_pct_override` for a specific creator
-- to bypass the tier-based `account_tiers.platform_fee_pct`. The override is
-- snapshotted at order creation (E-07) via the new resolver function below;
-- existing orders are NOT recalculated when the override changes.

-- ── 1. Column on users (NULL = no override → fallback to tier) ──────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS platform_fee_pct_override numeric(5, 2)
    CHECK (
      platform_fee_pct_override IS NULL
      OR (platform_fee_pct_override >= 0 AND platform_fee_pct_override <= 100)
    );

COMMENT ON COLUMN public.users.platform_fee_pct_override IS
  'Per-creator fee override (#185). When set, replaces account_tiers.platform_fee_pct '
  'for this user. NULL → fallback to tier fee. Snapshotted to orders.platform_fee_pct '
  'at create_order_with_fee_snapshot time; mutations do not affect past orders.';

-- Hide the override column from the authenticated role at the table level.
-- Authenticated users can still SELECT the other columns (existing client code
-- uses explicit column lists everywhere — verified). Admin reads via
-- SECURITY DEFINER RPC below; the typed `users` row exposed to the client does
-- not include this column.
REVOKE SELECT (platform_fee_pct_override) ON public.users FROM authenticated;
REVOKE UPDATE (platform_fee_pct_override) ON public.users FROM authenticated;

-- ── 2. Resolver: returns override if set, otherwise the tier fee ────────────
CREATE OR REPLACE FUNCTION public.resolve_platform_fee_pct(p_user_id uuid)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    u.platform_fee_pct_override,
    at.platform_fee_pct,
    20  -- legacy global default; matches the previous IF v_fee_pct IS NULL branch
  )
  FROM public.users u
  LEFT JOIN public.account_tiers at ON at.code = u.account_tier_id
  WHERE u.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.resolve_platform_fee_pct(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_platform_fee_pct(uuid) TO authenticated;

-- ── 3. create_order_with_fee_snapshot: use the resolver instead of tier JOIN ─
-- Body is identical to migration 029 except the fee resolution block.
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

  -- Resolve fee via override-aware function (#185).
  -- Also stamp the creator's current tier_code on the order for audit trail.
  v_fee_pct := public.resolve_platform_fee_pct(v_course.creator_id);

  SELECT u.account_tier_id INTO v_creator_tier_code
  FROM public.users u
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
    course_id, user_id, status, amount, code,
    platform_fee_pct, platform_fee_amount,
    creator_payout_amount, creator_payout, account_tier_code
  )
  VALUES (
    p_course_id, v_user_id, v_order_status, v_course.price, v_order_code,
    v_fee_pct, v_fee_amount, v_payout_amount, v_payout_amount, v_creator_tier_code
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

-- ── 4. Admin RPC: set the override for a specific creator ───────────────────
CREATE OR REPLACE FUNCTION public.admin_set_creator_fee_override(
  p_user_id uuid,
  p_pct     numeric
)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  target public.users;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF p_pct IS NULL OR p_pct < 0 OR p_pct > 100 THEN
    RAISE EXCEPTION 'override must be between 0 and 100' USING errcode = '22023';
  END IF;

  SELECT * INTO target FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found' USING errcode = 'P0002';
  END IF;
  IF target.role <> 'creator' THEN
    RAISE EXCEPTION 'target user is not a creator' USING errcode = '22023';
  END IF;

  UPDATE public.users
     SET platform_fee_pct_override = p_pct
   WHERE id = p_user_id
   RETURNING * INTO target;

  RETURN target;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_creator_fee_override(uuid, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_set_creator_fee_override(uuid, numeric) TO authenticated;

-- ── 5. Admin RPC: clear the override (set back to NULL) ─────────────────────
CREATE OR REPLACE FUNCTION public.admin_clear_creator_fee_override(p_user_id uuid)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  target public.users;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  UPDATE public.users
     SET platform_fee_pct_override = NULL
   WHERE id = p_user_id
   RETURNING * INTO target;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found' USING errcode = 'P0002';
  END IF;

  RETURN target;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_clear_creator_fee_override(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_clear_creator_fee_override(uuid) TO authenticated;

-- ── 6. Admin listing RPC: creators with their tier fee + override + effective ─
-- Avoids column-level REVOKE issues for the admin UI; SECURITY DEFINER returns
-- only when caller is admin. Supports search (name/email ILIKE) and an
-- "overrides only" filter; pagination is offset/limit because the table is
-- small (creator count, not order count).
CREATE OR REPLACE FUNCTION public.admin_list_creator_fees(
  p_search        text    DEFAULT NULL,
  p_overrides_only boolean DEFAULT FALSE,
  p_limit         integer DEFAULT 50,
  p_offset        integer DEFAULT 0
)
RETURNS TABLE (
  user_id                   uuid,
  name                      text,
  email                     text,
  account_tier_id           text,
  tier_name_vi              text,
  tier_fee_pct              numeric,
  platform_fee_pct_override numeric,
  effective_fee_pct         numeric,
  total_count               bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_search text := nullif(trim(coalesce(p_search, '')), '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT u.id,
           u.name,
           u.email,
           u.account_tier_id,
           at.name_vi              AS tier_name_vi,
           at.platform_fee_pct     AS tier_fee_pct,
           u.platform_fee_pct_override,
           COALESCE(u.platform_fee_pct_override, at.platform_fee_pct, 20) AS effective_fee_pct
      FROM public.users u
      LEFT JOIN public.account_tiers at ON at.code = u.account_tier_id
     WHERE u.role = 'creator'
       AND (v_search IS NULL
            OR u.email ILIKE '%' || v_search || '%'
            OR coalesce(u.name, '') ILIKE '%' || v_search || '%')
       AND (NOT p_overrides_only OR u.platform_fee_pct_override IS NOT NULL)
  ),
  counted AS (SELECT count(*) AS total_count FROM filtered)
  SELECT f.id,
         f.name,
         f.email,
         f.account_tier_id,
         f.tier_name_vi,
         f.tier_fee_pct,
         f.platform_fee_pct_override,
         f.effective_fee_pct,
         c.total_count
    FROM filtered f
    CROSS JOIN counted c
   ORDER BY f.email ASC
   LIMIT  greatest(p_limit, 1)
   OFFSET greatest(p_offset, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_creator_fees(text, boolean, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_creator_fees(text, boolean, integer, integer) TO authenticated;
