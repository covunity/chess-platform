-- Manual SQL test: confirm_order + cancel_order (PRD-0002 Slice 4, migration 031).
-- Run against a local Supabase instance after applying migrations through 031.
--
-- We exercise auth.uid() via set_config('request.jwt.claims', ...) which
-- Supabase honours when the function is invoked under the postgres role.
-- All seed rows are written with deterministic UUIDs so the cleanup at the
-- bottom is unambiguous.

-- ── Fixtures ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  admin_id   uuid := '00000000-0000-0000-0000-0000000000a1';
  owner_id   uuid := '00000000-0000-0000-0000-0000000000a2';
  third_id   uuid := '00000000-0000-0000-0000-0000000000a3';
  creator_id uuid := '00000000-0000-0000-0000-0000000000a4';
  course_id  uuid := '00000000-0000-0000-0000-0000000000c1';
BEGIN
  INSERT INTO public.users (id, email, name, role) VALUES
    (admin_id,   'oc-admin@test.local',   'OC Admin',   'admin'),
    (owner_id,   'oc-owner@test.local',   'OC Owner',   'learner'),
    (third_id,   'oc-third@test.local',   'OC Third',   'learner'),
    (creator_id, 'oc-creator@test.local', 'OC Creator', 'creator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO public.courses (id, creator_id, title, description, price, status)
  VALUES (course_id, creator_id, 'Confirm/Cancel Test Course', 'fixture', 480000, 'published')
  ON CONFLICT (id) DO UPDATE SET status = 'published', price = 480000;

  RAISE NOTICE 'fixtures ready';
END;
$$;

-- ── Test 1: Confirm pending → active + enrollment created ──────────────────
DO $$
DECLARE
  admin_id  uuid := '00000000-0000-0000-0000-0000000000a1';
  owner_id  uuid := '00000000-0000-0000-0000-0000000000a2';
  course_id uuid := '00000000-0000-0000-0000-0000000000c1';
  v_order   public.orders;
  v_count   int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id)::text, true);
  v_order := public.create_order_with_fee_snapshot(course_id);
  ASSERT v_order.status = 'pending', format('expected pending, got %s', v_order.status);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_id)::text, true);
  v_order := public.confirm_order(v_order.id);

  ASSERT v_order.status = 'active', format('expected active, got %s', v_order.status);
  ASSERT v_order.confirmed_at IS NOT NULL, 'confirmed_at must be set';
  ASSERT v_order.confirmed_by = admin_id, format('confirmed_by mismatch: %s', v_order.confirmed_by);

  SELECT count(*) INTO v_count
  FROM public.enrollments
  WHERE course_id = v_order.course_id AND user_id = v_order.user_id;
  ASSERT v_count = 1, format('expected 1 enrollment, got %s', v_count);

  RAISE NOTICE 'PASS: confirm pending → active + enrollment';
END;
$$;

-- ── Test 2: Confirm already-active is idempotent ───────────────────────────
DO $$
DECLARE
  admin_id  uuid := '00000000-0000-0000-0000-0000000000a1';
  owner_id  uuid := '00000000-0000-0000-0000-0000000000a2';
  course_id uuid := '00000000-0000-0000-0000-0000000000c1';
  v_order   public.orders;
  v_first   timestamptz;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id)::text, true);
  SELECT * INTO v_order FROM public.orders
  WHERE course_id = course_id AND user_id = owner_id AND status = 'active' LIMIT 1;
  v_first := v_order.confirmed_at;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_id)::text, true);
  v_order := public.confirm_order(v_order.id);

  ASSERT v_order.status = 'active', 'still active';
  ASSERT v_order.confirmed_at = v_first, 'confirmed_at must NOT be overwritten on idempotent confirm';

  RAISE NOTICE 'PASS: confirm already-active is idempotent';
END;
$$;

-- ── Test 3: Confirm by non-admin raises 42501 ──────────────────────────────
DO $$
DECLARE
  owner_id  uuid := '00000000-0000-0000-0000-0000000000a2';
  course_id uuid := '00000000-0000-0000-0000-0000000000c1';
  v_order   public.orders;
  v_threw   boolean := false;
BEGIN
  SELECT * INTO v_order FROM public.orders
  WHERE course_id = course_id AND user_id = owner_id LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id)::text, true);
  BEGIN
    PERFORM public.confirm_order(v_order.id);
  EXCEPTION WHEN insufficient_privilege THEN
    v_threw := true;
  END;
  ASSERT v_threw, 'non-admin confirm must raise insufficient_privilege';

  RAISE NOTICE 'PASS: confirm by non-admin raises 42501';
END;
$$;

-- ── Test 4: Cancel pending by owner → cancelled with reason ────────────────
DO $$
DECLARE
  admin_id  uuid := '00000000-0000-0000-0000-0000000000a1';
  owner_id  uuid := '00000000-0000-0000-0000-0000000000a2';
  third_id  uuid := '00000000-0000-0000-0000-0000000000a3';
  creator_id uuid := '00000000-0000-0000-0000-0000000000a4';
  v_other_course uuid := '00000000-0000-0000-0000-0000000000c2';
  v_order   public.orders;
BEGIN
  -- Need a fresh pending order. Use a second course since the first one
  -- has an active enrollment from Test 1 and create_order_with_fee_snapshot
  -- is idempotent for (user, course).
  INSERT INTO public.courses (id, creator_id, title, description, price, status)
  VALUES (v_other_course, creator_id, 'C/C Test 2', 'fixture', 240000, 'published')
  ON CONFLICT (id) DO UPDATE SET status = 'published';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id)::text, true);
  v_order := public.create_order_with_fee_snapshot(v_other_course);

  v_order := public.cancel_order(v_order.id, 'changed my mind');
  ASSERT v_order.status = 'cancelled', 'must be cancelled';
  ASSERT v_order.cancelled_reason = 'changed my mind', 'reason saved';
  ASSERT v_order.cancelled_by = owner_id, format('cancelled_by mismatch: %s', v_order.cancelled_by);

  RAISE NOTICE 'PASS: owner cancels own pending';
END;
$$;

-- ── Test 5: Cancel pending by another (non-admin) user → forbidden ─────────
DO $$
DECLARE
  admin_id   uuid := '00000000-0000-0000-0000-0000000000a1';
  owner_id   uuid := '00000000-0000-0000-0000-0000000000a2';
  third_id   uuid := '00000000-0000-0000-0000-0000000000a3';
  creator_id uuid := '00000000-0000-0000-0000-0000000000a4';
  v_course   uuid := '00000000-0000-0000-0000-0000000000c3';
  v_order    public.orders;
  v_threw    boolean := false;
BEGIN
  INSERT INTO public.courses (id, creator_id, title, description, price, status)
  VALUES (v_course, creator_id, 'C/C Test 3', 'fixture', 100000, 'published')
  ON CONFLICT (id) DO UPDATE SET status = 'published';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id)::text, true);
  v_order := public.create_order_with_fee_snapshot(v_course);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', third_id)::text, true);
  BEGIN
    PERFORM public.cancel_order(v_order.id, 'not my order');
  EXCEPTION WHEN insufficient_privilege THEN
    v_threw := true;
  END;
  ASSERT v_threw, 'non-owner non-admin cancel must raise insufficient_privilege';

  RAISE NOTICE 'PASS: non-owner non-admin cannot cancel pending';
END;
$$;

-- ── Test 6: Cancel active by admin → enrollment deleted ────────────────────
DO $$
DECLARE
  admin_id  uuid := '00000000-0000-0000-0000-0000000000a1';
  owner_id  uuid := '00000000-0000-0000-0000-0000000000a2';
  course_id uuid := '00000000-0000-0000-0000-0000000000c1';
  v_order   public.orders;
  v_count   int;
BEGIN
  SELECT * INTO v_order FROM public.orders
  WHERE course_id = course_id AND user_id = owner_id AND status = 'active' LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_id)::text, true);
  v_order := public.cancel_order(v_order.id, 'manual refund');

  ASSERT v_order.status = 'cancelled', 'must be cancelled';

  SELECT count(*) INTO v_count
  FROM public.enrollments
  WHERE order_id = v_order.id;
  ASSERT v_count = 0, format('enrollment for cancelled active order must be deleted, got %s', v_count);

  RAISE NOTICE 'PASS: cancel active by admin deletes enrollment';
END;
$$;

-- ── Test 7: Cancel without reason → 22023 ──────────────────────────────────
DO $$
DECLARE
  admin_id   uuid := '00000000-0000-0000-0000-0000000000a1';
  owner_id   uuid := '00000000-0000-0000-0000-0000000000a2';
  creator_id uuid := '00000000-0000-0000-0000-0000000000a4';
  v_course   uuid := '00000000-0000-0000-0000-0000000000c4';
  v_order    public.orders;
  v_threw    boolean := false;
BEGIN
  INSERT INTO public.courses (id, creator_id, title, description, price, status)
  VALUES (v_course, creator_id, 'C/C Test 4', 'fixture', 50000, 'published')
  ON CONFLICT (id) DO UPDATE SET status = 'published';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id)::text, true);
  v_order := public.create_order_with_fee_snapshot(v_course);

  BEGIN
    PERFORM public.cancel_order(v_order.id, '');
  EXCEPTION WHEN invalid_parameter_value THEN
    v_threw := true;
  END;
  ASSERT v_threw, 'empty reason must raise invalid_parameter_value';

  v_threw := false;
  BEGIN
    PERFORM public.cancel_order(v_order.id, repeat('x', 501));
  EXCEPTION WHEN invalid_parameter_value THEN
    v_threw := true;
  END;
  ASSERT v_threw, 'reason > 500 chars must raise invalid_parameter_value';

  RAISE NOTICE 'PASS: empty/over-long reason rejected';
END;
$$;

-- ── Test 8: Cancel already-cancelled → 22023 ───────────────────────────────
DO $$
DECLARE
  admin_id  uuid := '00000000-0000-0000-0000-0000000000a1';
  owner_id  uuid := '00000000-0000-0000-0000-0000000000a2';
  course_id uuid := '00000000-0000-0000-0000-0000000000c1';
  v_order   public.orders;
  v_threw   boolean := false;
BEGIN
  SELECT * INTO v_order FROM public.orders
  WHERE course_id = course_id AND user_id = owner_id AND status = 'cancelled' LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_id)::text, true);
  BEGIN
    PERFORM public.cancel_order(v_order.id, 'duplicate cancel');
  EXCEPTION WHEN invalid_parameter_value THEN
    v_threw := true;
  END;
  ASSERT v_threw, 'cancelling already-cancelled order must raise invalid_parameter_value';

  RAISE NOTICE 'PASS: already-cancelled order rejected';
END;
$$;

-- ── Cleanup ────────────────────────────────────────────────────────────────
DELETE FROM public.enrollments
 WHERE user_id IN (
   '00000000-0000-0000-0000-0000000000a2',
   '00000000-0000-0000-0000-0000000000a3'
 );
DELETE FROM public.orders
 WHERE user_id IN (
   '00000000-0000-0000-0000-0000000000a2',
   '00000000-0000-0000-0000-0000000000a3'
 );
DELETE FROM public.courses WHERE id IN (
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000c2',
  '00000000-0000-0000-0000-0000000000c3',
  '00000000-0000-0000-0000-0000000000c4'
);
DELETE FROM public.users WHERE id IN (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a2',
  '00000000-0000-0000-0000-0000000000a3',
  '00000000-0000-0000-0000-0000000000a4'
);
