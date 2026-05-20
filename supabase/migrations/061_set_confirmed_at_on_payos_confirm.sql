-- Fix #291 — confirm_order_via_payos doesn't set confirmed_at, breaks Revenue tab sort
--
-- ── What was wrong ────────────────────────────────────────────────────────
-- Migrations 055 / 056 / 060 each set `status='active', paid_at=now(),
-- payos_transaction_id=...` on the happy-path UPDATE (and again on the D9a
-- late-paid UPDATE) but never touched `confirmed_at` / `confirmed_by`. The
-- Creator Revenue tab (RevenuePanel.tsx) orders `RecentEarning` rows by
-- `confirmed_at DESC`, so every PayOS-paid order appeared with an empty
-- date sorted to the bottom of the table.
--
-- The `confirmed_at` column was introduced in migration 029 for the manual
-- admin-confirm flow (slice 4 / PRD-0002). PayOS auto-confirmation in mig
-- 055 simply forgot to write to it — paid_at and confirmed_at had been
-- treated as synonymous in the manual flow, but the auto-confirm path only
-- wrote paid_at.
--
-- ── What this migration changes ───────────────────────────────────────────
-- 1. CREATE OR REPLACE confirm_order_via_payos with `confirmed_at = now()`
--    added to the SET clause of BOTH the happy-path atomic UPDATE and the
--    D9a late-paid UPDATE. Every other line — including the replay-attack
--    guard pinned in #256's owner comment and the #290 D9b payload-shape
--    fix from mig 060 — is byte-identical to migration 060.
--
--    `confirmed_by` is left NULL on both branches. That is the documented
--    signal for "PayOS webhook auto-confirmed, no human admin involved":
--    the manual admin-confirm path (slice 4) sets `confirmed_by` to the
--    admin's `users.id`, so `confirmed_by IS NULL` cleanly distinguishes
--    auto from manual confirmation without seeding a synthetic bot user.
--
--    D9b (refund_pending) does NOT get `confirmed_at` — the order is not
--    active/confirmed, it is awaiting manual refund. Existing logic stays.
--
-- 2. Backfill: any existing PayOS-paid order with status='active' and
--    paid_at set but confirmed_at NULL gets confirmed_at := paid_at. This
--    repopulates the Revenue tab sort for historical rows. Manual-confirm
--    rows already have confirmed_at set, so they are unaffected.
--
-- Reference: Issue #291.

-- ── 1. Redefine confirm_order_via_payos with confirmed_at on both paths ──

create or replace function public.confirm_order_via_payos(
  p_payos_order_code     bigint,
  p_payos_transaction_id text,
  p_payload              jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order        public.orders;
  v_existing     public.orders;
  v_rows_updated integer;
  v_warning      jsonb;
begin
  -- ── Happy path: atomic UPDATE (replay-attack defence) ──────────────────
  -- WHERE status='pending' AND payos_transaction_id IS NULL is the guard.
  -- If the row is anything else, 0 rows update and we diagnose below.
  -- DO NOT modify this block — it is the canonical defence pinned in #256.
  -- #291: also set confirmed_at = now() so Revenue tab sort works.
  update public.orders
  set status               = 'active',
      paid_at              = now(),
      confirmed_at         = now(),
      payos_transaction_id = p_payos_transaction_id,
      webhook_event_log    = webhook_event_log || ARRAY[p_payload]
  where id = (
    select id from public.orders
    where payos_order_code = p_payos_order_code
    for update
  )
    and status                = 'pending'
    and payos_transaction_id is null
  returning * into v_order;

  get diagnostics v_rows_updated = row_count;

  if v_rows_updated = 1 then
    insert into public.enrollments (course_id, user_id, order_id)
    values (v_order.course_id, v_order.user_id, v_order.id)
    on conflict (course_id, user_id) do nothing;
    return v_order;
  end if;

  -- ── 0 rows updated → diagnose current state and branch ────────────────
  select * into v_existing
  from public.orders
  where payos_order_code = p_payos_order_code;

  if not found then
    raise exception 'order not found for payos_order_code: %', p_payos_order_code
      using errcode = '22023';
  end if;

  -- Idempotent replay: same transaction_id already recorded.
  if v_existing.payos_transaction_id is not distinct from p_payos_transaction_id then
    update public.orders
       set webhook_event_log = webhook_event_log || ARRAY[p_payload]
     where id = v_existing.id
     returning * into v_existing;
    return v_existing;
  end if;

  -- D9a — late paid after expiry. PayOS settlement raced the 24h cron.
  -- #291: also set confirmed_at = now() so Revenue tab sort works for
  -- late-paid orders too.
  if v_existing.status = 'expired' then
    v_warning := jsonb_build_object(
      'warning',    'late_paid_after_expire',
      'expired_at', v_existing.expired_at
    );
    update public.orders
       set status               = 'active',
           paid_at              = now(),
           confirmed_at         = now(),
           payos_transaction_id = p_payos_transaction_id,
           webhook_event_log    = webhook_event_log || ARRAY[p_payload, v_warning]
     where id = v_existing.id
     returning * into v_order;
    insert into public.enrollments (course_id, user_id, order_id)
    values (v_order.course_id, v_order.user_id, v_order.id)
    on conflict (course_id, user_id) do nothing;
    return v_order;
  end if;

  -- D9b — cancelled-then-paid. Learner cancelled but their banking app
  -- still completed the transfer. Flip to refund_pending, snapshot payer
  -- bank info from the PayOS payload, do NOT enrol. Admin processes the
  -- refund manually (slice 5).
  --
  -- FIX #290: p_payload IS the PayOS `data` inner object already (the Edge
  -- Function passes body.data, not the outer envelope). Read counter-account
  -- fields directly — no `-> 'data'` hop.
  --
  -- #291 note: do NOT set confirmed_at here. The order is not active/
  -- confirmed — it is awaiting manual refund. Revenue tab does not show
  -- refund_pending rows.
  if v_existing.status = 'cancelled' then
    update public.orders
       set status               = 'refund_pending',
           payos_transaction_id = p_payos_transaction_id,
           refund_due_to        = jsonb_build_object(
             'payer_account', p_payload ->> 'counterAccountNumber',
             'payer_name',    p_payload ->> 'counterAccountName',
             'payer_bank',    p_payload ->> 'counterAccountBankName',
             'amount',        p_payload ->> 'amount',
             'paid_at',       to_jsonb(now())
           ),
           webhook_event_log    = webhook_event_log || ARRAY[p_payload]
     where id = v_existing.id
     returning * into v_order;
    return v_order;
  end if;

  -- Terminal / already-handled states: log and return current row.
  if v_existing.status in ('refund_pending', 'refunded') then
    update public.orders
       set webhook_event_log = webhook_event_log || ARRAY[p_payload]
     where id = v_existing.id
     returning * into v_existing;
    return v_existing;
  end if;

  -- Active + different txn_id is suspicious (double-pay from a different
  -- transaction). Raise so the Edge Function logs an admin-action alert.
  if v_existing.status = 'active' then
    raise exception
      'payos_transaction_id_conflict: order=% existing=% incoming=%',
      v_existing.id, v_existing.payos_transaction_id, p_payos_transaction_id
      using errcode = '23000';
  end if;

  -- Pending with a different txn_id — should not happen given the atomic
  -- UPDATE above, but guard defensively.
  raise exception 'unexpected_status_branch: status=%, txn=%',
                  v_existing.status, v_existing.payos_transaction_id
    using errcode = '22023';
end;
$$;

revoke all on function public.confirm_order_via_payos(bigint, text, jsonb) from public;
grant execute on function public.confirm_order_via_payos(bigint, text, jsonb) to service_role;

-- ── 2. Backfill historical PayOS-paid orders with missing confirmed_at ───
-- Any order that was confirmed via the PayOS webhook before this migration
-- has status='active' + paid_at set but confirmed_at IS NULL. The Revenue
-- tab sorts by confirmed_at DESC so those rows appeared with a blank date
-- at the bottom. Copy paid_at into confirmed_at as the best available
-- timestamp (they would have been set in the same UPDATE going forward).
--
-- Idempotent: re-running this migration is a no-op because the WHERE
-- filters out rows that already have confirmed_at populated.
--
-- confirmed_by stays NULL — see header comment.

update public.orders
   set confirmed_at = paid_at
 where status        = 'active'
   and confirmed_at is null
   and paid_at      is not null;
