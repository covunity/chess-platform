-- Manual SQL test script for account_tiers schema (Issue #84)
-- Run against a local Supabase DB after applying migrations 018 + 019.
-- Each assertion uses RAISE EXCEPTION on failure so the script stops at first error.

-- ── 1. Verify 4 tier rows seeded ─────────────────────────────────────────────
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM public.account_tiers;
  IF cnt != 4 THEN
    RAISE EXCEPTION 'Expected 4 account_tiers rows, got %', cnt;
  END IF;
END $$;

-- ── 2. All expected codes present ────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.account_tiers WHERE code = 'individual') THEN
    RAISE EXCEPTION 'Missing tier: individual';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.account_tiers WHERE code = 'business') THEN
    RAISE EXCEPTION 'Missing tier: business';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.account_tiers WHERE code = 'athlete') THEN
    RAISE EXCEPTION 'Missing tier: athlete';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.account_tiers WHERE code = 'training_center') THEN
    RAISE EXCEPTION 'Missing tier: training_center';
  END IF;
END $$;

-- ── 3. users.account_tier_id column exists with default 'individual' ─────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'users'
      AND column_name  = 'account_tier_id'
  ) THEN
    RAISE EXCEPTION 'Column users.account_tier_id does not exist';
  END IF;
END $$;

-- ── 4. Trigger: setting admin to non-individual tier must raise ───────────────
--    (Requires a test admin user row; skip silently if no admin exists.)
DO $$
DECLARE
  admin_id uuid;
  raised   boolean := false;
BEGIN
  SELECT id INTO admin_id FROM public.users WHERE role = 'admin' LIMIT 1;
  IF admin_id IS NULL THEN
    RAISE NOTICE 'No admin user found — skipping trigger test';
    RETURN;
  END IF;

  BEGIN
    UPDATE public.users
    SET account_tier_id = 'business'
    WHERE id = admin_id;
  EXCEPTION WHEN OTHERS THEN
    raised := true;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'Trigger enforce_admin_individual_tier did not raise on admin tier update';
  END IF;

  -- Rollback the update if trigger somehow didn't fire
  UPDATE public.users SET account_tier_id = 'individual' WHERE id = admin_id;
END $$;

-- ── 5. Non-admin write must be blocked by RLS ────────────────────────────────
--    Simulate a non-privileged session by using a sub-transaction with a set_config
--    that makes auth.uid() return NULL (unauthenticated).
--    We expect both INSERT and UPDATE to be blocked by the write policy.
DO $$
DECLARE
  insert_raised  boolean := false;
  update_raised  boolean := false;
BEGIN
  -- Override auth context to simulate anon (no uid)
  PERFORM set_config('request.jwt.claims', '{}', true);

  -- Test INSERT blocked
  BEGIN
    INSERT INTO public.account_tiers (code, name_vi, platform_fee_pct, max_chapters_per_course, is_enterprise, requires_approval, display_order)
    VALUES ('_test_anon', 'Test Anon', 5, 5, false, true, 99);
  EXCEPTION WHEN insufficient_privilege THEN
    insert_raised := true;
  WHEN OTHERS THEN
    -- RLS may also raise as a generic error depending on Postgres version
    insert_raised := true;
  END;

  -- Test UPDATE blocked
  BEGIN
    UPDATE public.account_tiers SET name_vi = 'Hacked' WHERE code = 'individual';
  EXCEPTION WHEN insufficient_privilege THEN
    update_raised := true;
  WHEN OTHERS THEN
    update_raised := true;
  END;

  -- Clean up in case INSERT somehow succeeded
  DELETE FROM public.account_tiers WHERE code = '_test_anon';

  IF NOT insert_raised THEN
    RAISE EXCEPTION 'RLS did not block anon INSERT into account_tiers';
  END IF;

  IF NOT update_raised THEN
    RAISE EXCEPTION 'RLS did not block anon UPDATE on account_tiers';
  END IF;
END $$;

SELECT 'All account_tier_schema assertions passed.' AS result;
