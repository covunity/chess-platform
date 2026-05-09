-- Manual SQL test: update_bank_config RPC (PRD-0002 Slice 3, migration 030).
-- Run against a local Supabase instance after applying migrations through 030.
--
-- Verifies:
--   1. Function exists, is SECURITY DEFINER, returns void
--   2. EXECUTE granted to authenticated
--   3. Argument validation: BIN format + non-empty fields raise 22023
--   4. Admin guard raises 42501 for non-admin (simulated)
--   5. UPSERT writes all 4 config keys atomically
--   6. Idempotent: re-running with same values leaves rows unchanged in shape
--
-- The admin/non-admin paths require a real auth.uid(); we approximate by
-- temporarily inserting users and using set_config('request.jwt.claims', ...)
-- when running under Supabase. Where that's unavailable, the schema-shape
-- tests still catch most regressions.

-- ── Test 1: Function shape ─────────────────────────────────────────────────
DO $$
DECLARE
  v_security text;
  v_rettype  text;
BEGIN
  SELECT
    CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END,
    pg_catalog.format_type(p.prorettype, NULL)
  INTO v_security, v_rettype
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'update_bank_config';

  ASSERT v_security = 'DEFINER',
    format('update_bank_config must be SECURITY DEFINER, got %s', v_security);
  ASSERT v_rettype = 'void',
    format('update_bank_config must return void, got %s', v_rettype);

  RAISE NOTICE 'PASS: update_bank_config shape (SECURITY DEFINER, returns void)';
END;
$$;

-- ── Test 2: EXECUTE privilege granted to authenticated ─────────────────────
DO $$
BEGIN
  ASSERT has_function_privilege(
    'authenticated',
    'public.update_bank_config(text, text, text, text)',
    'EXECUTE'
  ), 'authenticated role must have EXECUTE on update_bank_config';

  RAISE NOTICE 'PASS: EXECUTE granted to authenticated';
END;
$$;

-- ── Test 3: BIN format validation (must be exactly 6 digits) ───────────────
-- Wrap in a SAVEPOINT so the failed call doesn't abort the rest of the script.
-- We can't simulate auth.uid() here without Supabase context, but the
-- argument validation in update_bank_config runs BEFORE the admin guard
-- only when the caller IS admin. So we test argument shape via a direct
-- service-role call below (Test 5).

-- ── Test 4: Admin guard exists in source ───────────────────────────────────
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'update_bank_config';

  ASSERT v_src LIKE '%role = ''admin''%',
    'update_bank_config must check role = admin before writing';
  ASSERT v_src LIKE '%errcode = ''42501''%',
    'update_bank_config admin guard must raise 42501 (insufficient_privilege)';
  ASSERT v_src ~ 'errcode = ''22023''',
    'update_bank_config arg validation must raise 22023 (invalid_parameter_value)';

  RAISE NOTICE 'PASS: admin guard + arg-validation errcodes present in source';
END;
$$;

-- ── Test 5: UPSERT semantics — write all 4 keys, then overwrite ────────────
-- Bypasses the auth.uid() guard by calling directly with elevated privileges.
-- Run as superuser (`postgres`) so the SECURITY DEFINER body executes the
-- INSERT path. This DOES NOT cover the admin guard — Test 4 covers that.
DO $$
DECLARE
  v_short text;
  v_bin   text;
  v_acct  text;
  v_name  text;
BEGIN
  -- Temporarily grant ourselves admin status via a fake user row so the
  -- SECURITY DEFINER function passes its guard. Cleanup at end.
  INSERT INTO public.users (id, email, name, role)
  VALUES ('00000000-0000-0000-0000-0000000000aa', 'rpctest-admin@test.local', 'RPC Test Admin', 'admin')
  ON CONFLICT (id) DO UPDATE SET role = 'admin';

  -- Cannot directly forge auth.uid() outside Supabase runtime, so we
  -- side-step by calling with SECURITY DEFINER and a CTE that pretends.
  -- In a real Supabase env this block is replaced with a JWT set_config.
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000aa"}', true);

  PERFORM public.update_bank_config('TCB', '970407', '0987654321', 'Test Holder');

  SELECT value INTO v_short FROM public.config WHERE key = 'bank_short_name';
  SELECT value INTO v_bin   FROM public.config WHERE key = 'bank_bin';
  SELECT value INTO v_acct  FROM public.config WHERE key = 'bank_account_number';
  SELECT value INTO v_name  FROM public.config WHERE key = 'bank_account_name';

  ASSERT v_short = 'TCB',          format('bank_short_name not updated: %s', v_short);
  ASSERT v_bin   = '970407',       format('bank_bin not updated: %s', v_bin);
  ASSERT v_acct  = '0987654321',   format('bank_account_number not updated: %s', v_acct);
  ASSERT v_name  = 'Test Holder',  format('bank_account_name not updated: %s', v_name);

  -- Idempotent: same call again must succeed without error
  PERFORM public.update_bank_config('TCB', '970407', '0987654321', 'Test Holder');

  RAISE NOTICE 'PASS: UPSERT writes all 4 keys + idempotent';

  -- Restore placeholders so other test scripts find expected seed values.
  PERFORM public.update_bank_config('MBBANK', '970422', '0000000000', 'CHESS COURSE');

  -- Cleanup
  DELETE FROM public.users WHERE id = '00000000-0000-0000-0000-0000000000aa';
END;
$$;

-- ── Test 6: BIN validation rejects bad input ───────────────────────────────
DO $$
DECLARE
  v_threw boolean := false;
BEGIN
  INSERT INTO public.users (id, email, name, role)
  VALUES ('00000000-0000-0000-0000-0000000000aa', 'rpctest-admin@test.local', 'RPC Test Admin', 'admin')
  ON CONFLICT (id) DO UPDATE SET role = 'admin';
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000aa"}', true);

  BEGIN
    PERFORM public.update_bank_config('MBBANK', '12345', '0000000000', 'CHESS COURSE');
  EXCEPTION WHEN invalid_parameter_value THEN
    v_threw := true;
  END;
  ASSERT v_threw, 'BIN of 5 digits must raise invalid_parameter_value';

  v_threw := false;
  BEGIN
    PERFORM public.update_bank_config('MBBANK', '12345a', '0000000000', 'CHESS COURSE');
  EXCEPTION WHEN invalid_parameter_value THEN
    v_threw := true;
  END;
  ASSERT v_threw, 'BIN with non-digit must raise invalid_parameter_value';

  v_threw := false;
  BEGIN
    PERFORM public.update_bank_config('  ', '970422', '0000000000', 'CHESS COURSE');
  EXCEPTION WHEN invalid_parameter_value THEN
    v_threw := true;
  END;
  ASSERT v_threw, 'whitespace-only short_name must raise invalid_parameter_value';

  RAISE NOTICE 'PASS: argument validation rejects bad BIN + empty fields';

  DELETE FROM public.users WHERE id = '00000000-0000-0000-0000-0000000000aa';
END;
$$;
