-- Slice 1b of PRD-0005 — PayOS happy-path checkout
--
-- Adds PayOS-specific columns to `orders` and introduces
-- `confirm_order_via_payos` RPC for the webhook → active transition.
--
-- The RPC implements an atomic UPDATE pattern documented by the issue owner:
-- the WHERE clause is the security guard against PayOS replay attacks.
-- PayOS does NOT include timestamp/nonce in its signed payload, so a
-- captured webhook can be replayed indefinitely; the only thing stopping
-- that is the UNIQUE index on `payos_transaction_id` plus the atomic UPDATE
-- with `payos_transaction_id IS NULL` in the WHERE clause.
--
-- Out of scope for slice 1b (slice 3 / issue #257 covers):
--   - expired → re-activate branch (decision D9a)
--   - cancelled → refund_pending branch (decision D9b)
--   - active/refund_pending/refunded no-op branches
--   - ALTER TYPE order_status ADD VALUE 'refund_pending', 'refunded'
--
-- Slice 1b raises `unsupported_status_in_slice_1b` for anything other than
-- pending → active, and slice 3 replaces that exception with branch logic.
--
-- Legacy config keys (bank_short_name, bank_bin, bank_account_number,
-- bank_account_name) from migration 029 are unused after slice 1b — the
-- /admin/settings Thanh toán tab is removed in this slice. The rows are left
-- in place; PRD-0005 §10 D7 deprecates them via UI removal, not a schema
-- migration. If you grep for them, expect dead seed data.

-- ── 1. PayOS columns on orders ─────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payos_order_code     bigint,
  ADD COLUMN IF NOT EXISTS payos_payment_link_id text,
  ADD COLUMN IF NOT EXISTS payos_transaction_id text,
  ADD COLUMN IF NOT EXISTS paid_at              timestamptz,
  ADD COLUMN IF NOT EXISTS webhook_event_log    jsonb[] NOT NULL DEFAULT '{}';

-- UNIQUE constraints are the second-layer guard against duplicate webhooks
-- and replay attacks. Both are nullable; UNIQUE on nullable columns allows
-- multiple rows where the value is NULL (Postgres default), which is what
-- we want for pre-PayOS rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_payos_order_code_key'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_payos_order_code_key UNIQUE (payos_order_code);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_payos_transaction_id_key'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_payos_transaction_id_key UNIQUE (payos_transaction_id);
  END IF;
END $$;

-- ── 2. Replace create_order_with_fee_snapshot to populate payos_order_code ─
-- Capture the sequence value once and reuse it for both the human-readable
-- `code` string and the integer `payos_order_code`. PRD-0005 D4: PayOS API
-- requires bigint orderCode; we use the same sequence already established by
-- migration 029 to avoid double-consuming sequence values.
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
  v_seq_value         bigint;
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

  -- Single nextval() — used twice. PayOS orderCode is bigint; human-facing
  -- code is the same number, zero-padded and prefixed.
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
    account_tier_code
  )
  VALUES (
    p_course_id,
    v_user_id,
    v_order_status,
    v_course.price,
    v_order_code,
    v_seq_value,
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

-- ── 3. confirm_order_via_payos RPC ─────────────────────────────────────────
--
-- Called exclusively by the payos-webhook Edge Function (service role).
-- This RPC is the canonical replay-attack defence:
--
--   UPDATE orders ... WHERE id = (...) AND status = 'pending'
--                                       AND payos_transaction_id IS NULL;
--
-- If the same webhook is replayed:
--   - First call: row matches (status=pending, transaction_id NULL) → updates.
--   - Second call: status is now 'active' AND transaction_id is set → 0 rows.
--     We then SELECT to inspect why and branch.
--
-- The UNIQUE constraint on payos_transaction_id is the second-layer race
-- guard: two simultaneous webhook deliveries from PayOS get serialised by
-- the row lock, but if they somehow slipped past, the UNIQUE violation
-- (errcode 23505) prevents data corruption. The Edge Function treats that
-- errcode as "duplicate already handled" and returns 200.
CREATE OR REPLACE FUNCTION public.confirm_order_via_payos(
  p_payos_order_code     bigint,
  p_payos_transaction_id text,
  p_payload              jsonb
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order        public.orders;
  v_existing     public.orders;
  v_rows_updated integer;
BEGIN
  -- Atomic UPDATE: status flips to active ONLY if it was pending AND no
  -- prior transaction_id exists. This is the replay-attack defence.
  UPDATE public.orders
  SET status               = 'active',
      paid_at              = now(),
      payos_transaction_id = p_payos_transaction_id,
      webhook_event_log    = webhook_event_log || ARRAY[p_payload]
  WHERE id = (
    SELECT id FROM public.orders
    WHERE payos_order_code = p_payos_order_code
    FOR UPDATE
  )
    AND status                = 'pending'
    AND payos_transaction_id IS NULL
  RETURNING * INTO v_order;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 1 THEN
    -- Happy path: create enrollment in the same transaction. ON CONFLICT
    -- guards against a parallel free-course / admin-confirm having raced.
    INSERT INTO public.enrollments (course_id, user_id, order_id)
    VALUES (v_order.course_id, v_order.user_id, v_order.id)
    ON CONFLICT (course_id, user_id) DO NOTHING;
    RETURN v_order;
  END IF;

  -- 0 rows updated → diagnose. Look up the current row to decide the branch.
  SELECT * INTO v_existing
  FROM public.orders
  WHERE payos_order_code = p_payos_order_code;

  IF NOT FOUND THEN
    -- No order exists for this orderCode — should never happen for a valid
    -- PayOS webhook, but treat as unsupported so the Edge Function logs.
    RAISE EXCEPTION 'order not found for payos_order_code: %', p_payos_order_code
      USING errcode = '22023';
  END IF;

  -- Idempotent replay: same transaction_id already recorded. Return existing
  -- row — Edge Function returns 200 and PayOS retries drain harmlessly.
  IF v_existing.payos_transaction_id = p_payos_transaction_id THEN
    RETURN v_existing;
  END IF;

  -- Any other branch (expired / cancelled / active / refund_pending /
  -- refunded with a different transaction_id, or pending with a different
  -- transaction_id — meaning we already locked it in somehow) is out of
  -- scope for slice 1b. Slice 3 (issue #257) replaces this with the
  -- PRD §5.4 branch logic.
  RAISE EXCEPTION 'unsupported_status_in_slice_1b: status=%, txn=%',
                  v_existing.status, v_existing.payos_transaction_id
    USING errcode = '22023';
END;
$$;

-- Service-role only — Edge Function uses the service role key. Do NOT
-- grant to authenticated; learners must never call this directly.
REVOKE ALL ON FUNCTION public.confirm_order_via_payos(bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_order_via_payos(bigint, text, jsonb) TO service_role;
