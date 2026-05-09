-- Manual SQL test: orders confirm/cancel columns + sequence + bank config seed
-- Run against a local Supabase instance after applying migrations 018-029.
--
-- Verifies invariants that Slice 1 of PRD-0002 introduces:
--   1. New columns exist on `orders` (confirm/cancel timestamps + reason)
--   2. Sequence `orders_seq` exists and produces monotonic values
--   3. Generated order codes follow `ORD-YYYY-NNNNNN` shape
--   4. `config` table exists with the 4 bank keys seeded
--   5. Existing partial unique index (from migration 026) still prevents duplicate pending

-- ── Test 1: New confirm/cancel columns exist ───────────────────────────────
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'confirmed_at'
  ), 'orders.confirmed_at must exist';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'confirmed_by'
  ), 'orders.confirmed_by must exist';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'cancelled_at'
  ), 'orders.cancelled_at must exist';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'cancelled_by'
  ), 'orders.cancelled_by must exist';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'cancelled_reason'
  ), 'orders.cancelled_reason must exist';

  RAISE NOTICE 'PASS: orders confirm/cancel columns exist';
END;
$$;

-- ── Test 2: orders_seq exists and is monotonic ─────────────────────────────
DO $$
DECLARE
  v_a bigint;
  v_b bigint;
  v_c bigint;
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_sequences
    WHERE schemaname = 'public' AND sequencename = 'orders_seq'
  ), 'sequence public.orders_seq must exist';

  v_a := nextval('public.orders_seq');
  v_b := nextval('public.orders_seq');
  v_c := nextval('public.orders_seq');

  ASSERT v_b = v_a + 1, format('sequence not monotonic: a=%s b=%s', v_a, v_b);
  ASSERT v_c = v_b + 1, format('sequence not monotonic: b=%s c=%s', v_b, v_c);

  RAISE NOTICE 'PASS: orders_seq monotonic (% -> % -> %)', v_a, v_b, v_c;
END;
$$;

-- ── Test 3: Order code shape from sequence ─────────────────────────────────
DO $$
DECLARE
  v_code text;
BEGIN
  v_code := 'ORD-' || extract(year FROM now())::text || '-' ||
            lpad(nextval('public.orders_seq')::text, 6, '0');

  ASSERT v_code ~ '^ORD-\d{4}-\d{6}$',
    format('order code shape mismatch: %s', v_code);

  RAISE NOTICE 'PASS: order code shape (%)', v_code;
END;
$$;

-- ── Test 4: config table exists with bank keys seeded ──────────────────────
DO $$
DECLARE
  v_bank_keys text[] := ARRAY[
    'bank_short_name', 'bank_bin', 'bank_account_number', 'bank_account_name'
  ];
  v_key text;
  v_value text;
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'config'
  ), 'public.config table must exist';

  FOREACH v_key IN ARRAY v_bank_keys LOOP
    SELECT value INTO v_value FROM public.config WHERE key = v_key;
    ASSERT v_value IS NOT NULL AND length(v_value) > 0,
      format('config key % must be seeded with non-empty value', v_key);
  END LOOP;

  RAISE NOTICE 'PASS: config table with 4 bank keys seeded';
END;
$$;

-- ── Test 5: config RLS — authenticated read allowed, no public write ───────
DO $$
DECLARE
  v_select_policies int;
  v_other_policies  int;
BEGIN
  SELECT count(*)::int INTO v_select_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'config' AND cmd = 'SELECT';

  ASSERT v_select_policies >= 1, 'config must have at least one SELECT policy';

  -- INSERT/UPDATE/DELETE go through SECURITY DEFINER RPCs only — no direct policies expected.
  SELECT count(*)::int INTO v_other_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'config' AND cmd <> 'SELECT';

  ASSERT v_other_policies = 0,
    format('config should not have direct INSERT/UPDATE/DELETE policies (found %s)', v_other_policies);

  RAISE NOTICE 'PASS: config RLS shape (read-only via policy, write via RPC)';
END;
$$;

-- ── Test 6: Existing partial unique index still prevents duplicate pending ─
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'orders'
      AND indexname  = 'orders_one_active_per_user_course'
  ), 'partial unique index orders_one_active_per_user_course must still exist';

  RAISE NOTICE 'PASS: duplicate-pending guard preserved from migration 026';
END;
$$;

-- ── Test 7: RPC create_order_with_fee_snapshot still SECURITY DEFINER ──────
DO $$
DECLARE
  v_security text;
BEGIN
  SELECT CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END
  INTO v_security
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_order_with_fee_snapshot';

  ASSERT v_security = 'DEFINER',
    format('create_order_with_fee_snapshot must be SECURITY DEFINER, got %s', v_security);

  RAISE NOTICE 'PASS: RPC remains SECURITY DEFINER';
END;
$$;

-- ── Test 8: Free-course path still auto-active + enrolment (smoke) ─────────
-- Schema invariant only — actual RPC call requires simulated auth.uid(),
-- which lives in the integration test suite. This block documents what
-- migration 029 must NOT break.
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'enrollments' AND c.contype = 'u'
  ), 'enrollments must keep its unique constraint for ON CONFLICT DO NOTHING in RPC';

  RAISE NOTICE 'PASS: free-course enrollment ON CONFLICT path intact';
END;
$$;
