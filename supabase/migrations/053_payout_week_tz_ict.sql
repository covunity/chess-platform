-- Migration 053: switch create_weekly_payouts() ISO-week boundary to ICT (#269).
--
-- Supersedes migration 052's UTC week boundary. Vietnamese admins operate in
-- ICT (UTC+7); a Monday 06:30 ICT click lands at 23:30 Sunday UTC, which
-- date_trunc('week', now() AT TIME ZONE 'UTC') buckets into the PREVIOUS ISO
-- week. The first click of the new business week would therefore find no
-- "this-week" row and mint one; a second click later that morning (now past
-- midnight UTC) would mint a second duplicate payout for the same creator.
--
-- Fix: anchor the week window in Asia/Ho_Chi_Minh so Mon 00:00 ICT (= Sun
-- 17:00 UTC) is the boundary. Two clicks the same Vietnamese business week
-- now collapse onto the same idempotency window regardless of UTC midnight.
--
-- Scope: re-issues create_weekly_payouts() only. payouts.transferred_at
-- storage is unchanged (still timestamptz, still UTC). No data migration —
-- existing rows are untouched. list_creators_missing_payout_info and
-- mark_payout_complete are not affected and not re-issued here.

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

  -- ISO week window: Monday 00:00 Asia/Ho_Chi_Minh of the week containing now().
  -- Stored as timestamptz (UTC under the hood) so the >=/< comparison against
  -- payouts.transferred_at (also timestamptz) is timezone-correct.
  week_start := date_trunc('week', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh';
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
