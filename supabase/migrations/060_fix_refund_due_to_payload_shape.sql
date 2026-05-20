-- Fix #290 — refund_due_to JSONB always NULL on D9b branch
--
-- ── What was wrong ────────────────────────────────────────────────────────
-- Migration 056's `confirm_order_via_payos` built the D9b refund snapshot
-- via `p_payload -> 'data' ->> 'counterAccountNumber'` and friends. But the
-- `payos-webhook` Edge Function passes `body.data` (the inner object) as
-- `p_payload` — not the outer envelope. So the extra `-> 'data'` hop always
-- resolved to NULL, and every refund_pending row landed with
-- {payer_account: null, payer_name: null, payer_bank: null, amount: null}.
--
-- The Admin "Cần refund" queue rendered '—' for payer name / account / bank,
-- making the manual refund operation impossible to execute.
--
-- ── What this migration changes ───────────────────────────────────────────
-- 1. CREATE OR REPLACE confirm_order_via_payos with the D9b jsonb_build_object
--    reading PayOS counter-account fields directly off p_payload (no `-> 'data'`
--    hop). Every other line — including the atomic UPDATE replay-attack guard
--    pinned in #256's owner comment — is byte-identical to migration 056.
--
-- 2. Best-effort backfill of existing `refund_pending` rows whose payer fields
--    are NULL. `webhook_event_log` is a jsonb[] of payloads as passed to the
--    RPC (i.e. already the inner data object — see mig 056 line 144 and the
--    Edge Function line 277), so the last entry should carry the
--    counter-account fields that the buggy snapshot dropped.
--
-- Choice of fix location: SQL-side rather than changing the Edge Function's
-- p_payload contract — `log_payos_cancellation` also receives `body.data`,
-- so flipping the convention in only one call site would create inconsistency
-- and force a Deno test rewrite. The SQL change is narrower.
--
-- Reference: PRD-0005 §10 D9b. Issue #290.

-- ── 1. Redefine confirm_order_via_payos with fixed D9b snapshot ──────────

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
  update public.orders
  set status               = 'active',
      paid_at              = now(),
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
  if v_existing.status = 'expired' then
    v_warning := jsonb_build_object(
      'warning',    'late_paid_after_expire',
      'expired_at', v_existing.expired_at
    );
    update public.orders
       set status               = 'active',
           paid_at              = now(),
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

-- ── 2. Best-effort backfill of existing refund_pending rows ──────────────
-- Any rows that hit D9b under the buggy snapshot have refund_due_to with
-- every field NULL. The original PayOS payload is preserved at the tail of
-- webhook_event_log (mig 056 line 155: `webhook_event_log || ARRAY[p_payload]`
-- always appends the inner data object, since the Edge Function passes
-- body.data as p_payload). Re-derive the snapshot from there.
--
-- `paid_at` here is approximate (now() at backfill time) — the historical
-- transaction time is lost from the snapshot, but the field is informational
-- only; admin uses the bank info to execute the refund.
--
-- Idempotent: re-running this migration on a database where the backfill
-- already succeeded is a no-op because the WHERE filters out rows with a
-- non-null payer_account.

update public.orders
   set refund_due_to = jsonb_build_object(
         'payer_account', webhook_event_log[array_length(webhook_event_log, 1)] ->> 'counterAccountNumber',
         'payer_name',    webhook_event_log[array_length(webhook_event_log, 1)] ->> 'counterAccountName',
         'payer_bank',    webhook_event_log[array_length(webhook_event_log, 1)] ->> 'counterAccountBankName',
         'amount',        webhook_event_log[array_length(webhook_event_log, 1)] ->> 'amount',
         'paid_at',       to_jsonb(coalesce(paid_at, now()))
       )
 where status = 'refund_pending'
   and (refund_due_to is null or refund_due_to ->> 'payer_account' is null)
   and webhook_event_log is not null
   and array_length(webhook_event_log, 1) >= 1
   and webhook_event_log[array_length(webhook_event_log, 1)] ->> 'counterAccountNumber' is not null;
