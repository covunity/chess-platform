-- Migration 052: admin weekly payout workflow RPCs (#260, slice 7 of PRD-0005).
-- Closes the wallet loop opened in slice 6 (#254, migration 051).
--
-- Three RPCs, all SECURITY DEFINER, admin-only:
--   - list_creators_missing_payout_info() : creators owed money but lacking
--                                           creator_payout_info — dashboard
--                                           warning surface.
--   - create_weekly_payouts()             : idempotently mints one pending
--                                           payouts row per creator whose
--                                           pending_balance > 0.
--   - mark_payout_complete(uuid, text)    : finalises a payout — stamps
--                                           reference_note + flips contributing
--                                           orders.paid_out_in.
--
-- Idempotency: create_weekly_payouts dedupes on (creator_id, current ISO week,
-- reference_note IS NULL) so two CSV clicks in the same week do not create
-- duplicate payouts. mark_payout_complete refuses to re-mark an already-marked
-- row.

-- ── 1. list_creators_missing_payout_info ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_creators_missing_payout_info()
RETURNS TABLE (
  creator_id      uuid,
  name            text,
  email           text,
  pending_balance bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN QUERY
    SELECT u.id AS creator_id,
           u.name,
           u.email,
           COALESCE(SUM(o.creator_payout) FILTER (
             WHERE o.status = 'active' AND o.paid_out_in IS NULL
           ), 0)::bigint AS pending_balance
      FROM public.users u
      LEFT JOIN public.courses co ON co.creator_id = u.id
      LEFT JOIN public.orders o   ON o.course_id = co.id
     WHERE u.role = 'creator'
       AND NOT EXISTS (
         SELECT 1 FROM public.creator_payout_info pi WHERE pi.user_id = u.id
       )
     GROUP BY u.id, u.name, u.email
     HAVING COALESCE(SUM(o.creator_payout) FILTER (
              WHERE o.status = 'active' AND o.paid_out_in IS NULL
            ), 0) > 0
     ORDER BY pending_balance DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_creators_missing_payout_info() FROM public;
GRANT EXECUTE ON FUNCTION public.list_creators_missing_payout_info() TO authenticated;

-- ── 2. create_weekly_payouts ─────────────────────────────────────────────────
-- For each creator with pending_balance > 0 AND a creator_payout_info row:
--   • If a payouts row already exists this ISO week (Mon-Sun, UTC) for this
--     creator with reference_note IS NULL, return that row (idempotency).
--   • Otherwise, snapshot bank info + currently-pending order_ids + amount
--     (sum of creator_payout across the snapshotted orders) into a new row.
-- Returns the resulting set of pending payouts (new + pre-existing this week).
--
-- Note: we recompute amount as SUM(creator_payout) of the order_ids set rather
-- than reading creator_wallet.pending_balance. This guarantees amount and
-- order_ids agree, even if a paid_out_in flip races between the two reads.
CREATE OR REPLACE FUNCTION public.create_weekly_payouts()
RETURNS SETOF public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller        uuid := auth.uid();
  week_start    timestamptz;
  week_end      timestamptz;
  rec           record;
  existing_id   uuid;
  new_order_ids uuid[];
  new_amount    bigint;
  payout_row    public.payouts;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- ISO week window: Monday 00:00 UTC of the week containing now()
  week_start := date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  week_end   := week_start + interval '7 days';

  FOR rec IN
    SELECT u.id AS creator_id,
           pi.bank_code, pi.bank_name, pi.account_number, pi.account_holder
      FROM public.users u
      JOIN public.creator_payout_info pi ON pi.user_id = u.id
     WHERE u.role = 'creator'
       AND EXISTS (
         SELECT 1
           FROM public.courses c
           JOIN public.orders  o ON o.course_id = c.id
          WHERE c.creator_id = u.id
            AND o.status = 'active'
            AND o.paid_out_in IS NULL
       )
  LOOP
    -- Idempotency: re-use the current week's pending row if any.
    SELECT id INTO existing_id
      FROM public.payouts
     WHERE creator_id = rec.creator_id
       AND reference_note IS NULL
       AND transferred_at >= week_start
       AND transferred_at <  week_end
     LIMIT 1;

    IF existing_id IS NOT NULL THEN
      RETURN QUERY SELECT * FROM public.payouts WHERE id = existing_id;
      CONTINUE;
    END IF;

    -- Snapshot current pending orders for this creator.
    SELECT COALESCE(array_agg(o.id ORDER BY o.confirmed_at), ARRAY[]::uuid[]),
           COALESCE(SUM(o.creator_payout), 0)::bigint
      INTO new_order_ids, new_amount
      FROM public.orders o
      JOIN public.courses c ON c.id = o.course_id
     WHERE c.creator_id = rec.creator_id
       AND o.status = 'active'
       AND o.paid_out_in IS NULL;

    -- Defence-in-depth: skip if the snapshot is empty (race with another call).
    IF array_length(new_order_ids, 1) IS NULL OR new_amount <= 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.payouts (
      creator_id, admin_id, amount,
      bank_code, bank_name, account_number, account_holder,
      order_ids, reference_note
    ) VALUES (
      rec.creator_id, caller, new_amount,
      rec.bank_code, rec.bank_name, rec.account_number, rec.account_holder,
      new_order_ids, NULL
    )
    RETURNING * INTO payout_row;

    RETURN NEXT payout_row;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.create_weekly_payouts() FROM public;
GRANT EXECUTE ON FUNCTION public.create_weekly_payouts() TO authenticated;

-- ── 3. mark_payout_complete ──────────────────────────────────────────────────
-- Atomically:
--   • assert reference_note IS NULL (idempotent guard)
--   • set reference_note = p_reference_note
--   • UPDATE orders SET paid_out_in = p_payout_id WHERE id = ANY(order_ids)
--                                                   AND paid_out_in IS NULL
-- Returns the updated payout row.
CREATE OR REPLACE FUNCTION public.mark_payout_complete(
  p_payout_id      uuid,
  p_reference_note text
)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  row    public.payouts;
  ref    text := nullif(trim(coalesce(p_reference_note, '')), '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF ref IS NULL THEN
    RAISE EXCEPTION 'reference_note required' USING errcode = '22023';
  END IF;

  SELECT * INTO row FROM public.payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout not found' USING errcode = 'P0002';
  END IF;

  IF row.reference_note IS NOT NULL THEN
    RAISE EXCEPTION 'payout_already_marked_complete' USING errcode = '22023';
  END IF;

  -- Flip contributing orders. Skip any already paid out (defence vs. race).
  UPDATE public.orders
     SET paid_out_in = p_payout_id
   WHERE id = ANY(row.order_ids)
     AND paid_out_in IS NULL;

  UPDATE public.payouts
     SET reference_note = ref
   WHERE id = p_payout_id
   RETURNING * INTO row;

  RETURN row;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_payout_complete(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_payout_complete(uuid, text) TO authenticated;
