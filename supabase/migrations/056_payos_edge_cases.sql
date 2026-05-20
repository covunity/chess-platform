-- Slice 3 of PRD-0005 — PayOS webhook edge cases
--
-- Extends `confirm_order_via_payos` (slice 1b only handled `pending → active`)
-- to cover the three race conditions locked in PRD-0005 §10 D9a/b/c:
--
--   D9a — Late paid:      expired → active, log `late_paid_after_expire`
--   D9b — Cancelled+paid: cancelled → refund_pending, snapshot payer bank
--   D9c — Active+cancel:  PayOS CANCELLED event on active order — log only,
--                          do NOT auto-revoke enrollment (admin reviews).
--
-- Decision C1(a) from issue #257: D9c is handled by a new RPC
-- `log_payos_cancellation` (CANCELLED events do NOT call
-- confirm_order_via_payos). This keeps the atomic-UPDATE replay defence
-- on the PAID path narrow and unambiguous.
--
-- The atomic UPDATE pattern from migration 055 (status='pending' AND
-- payos_transaction_id IS NULL in the WHERE clause, with FOR UPDATE row
-- lock) is PRESERVED for the happy path. The 0-rows-updated case fans out
-- to a SELECT-then-branch diagnosis instead of raising
-- `unsupported_status_in_slice_1b`.
--
-- Reference: issue #256 owner comment pinning the atomic UPDATE pattern as
-- the canonical replay-attack defence (PayOS payloads have no nonce).

-- ── 1. Extend order_status enum ───────────────────────────────────────────
-- ALTER TYPE … ADD VALUE must run in its own statement (mirrors migration
-- 054's 'expired' addition). Two separate statements; idempotent via IF NOT
-- EXISTS so re-runs after partial failure are safe.

alter type public.order_status add value if not exists 'refund_pending';

alter type public.order_status add value if not exists 'refunded';

-- ── 2. Refund tracking columns on orders ──────────────────────────────────
-- `refund_due_to` snapshots PayOS counter-account info at the moment of
-- the D9b transition so admin has the payer bank details available later
-- without needing to re-query PayOS. JSONB shape (not a row of columns)
-- because the upstream payload is itself JSON and we want round-trip.
--
-- `refunded_at` / `refunded_by` / `refund_reference` are filled in by
-- `mark_order_refunded` (slice 5) — added here so the column shape is
-- complete for the refund_pending state.

alter table public.orders
  add column if not exists refund_due_to    jsonb,
  add column if not exists refunded_at      timestamptz,
  add column if not exists refunded_by      uuid references public.users(id),
  add column if not exists refund_reference text;

-- ── 3. confirm_order_via_payos — full branching ──────────────────────────
--
-- Signature unchanged from slice 1b (so CREATE OR REPLACE works without
-- DROP). Body now diagnoses each non-happy-path branch instead of raising
-- unsupported_status_in_slice_1b.

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
    -- Still append payload to log so retries are visible. (Replay defence
    -- already held: the txn_id matches, no state mutation needed.)
    update public.orders
       set webhook_event_log = webhook_event_log || ARRAY[p_payload]
     where id = v_existing.id
     returning * into v_existing;
    return v_existing;
  end if;

  -- D9a — late paid after expiry. PayOS settlement raced the 24h cron.
  -- Re-activate, append both the payload and a synthetic warning entry so
  -- admin tooling can surface a "late paid" badge from the log.
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
  if v_existing.status = 'cancelled' then
    update public.orders
       set status               = 'refund_pending',
           payos_transaction_id = p_payos_transaction_id,
           refund_due_to        = jsonb_build_object(
             'payer_account', p_payload -> 'data' ->> 'counterAccountNumber',
             'payer_name',    p_payload -> 'data' ->> 'counterAccountName',
             'payer_bank',    p_payload -> 'data' ->> 'counterAccountBankName',
             'amount',        p_payload -> 'data' ->> 'amount',
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
  -- The UNIQUE constraint on payos_transaction_id is the second-layer guard.
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

-- ── 4. log_payos_cancellation — D9c handler ──────────────────────────────
-- PayOS CANCELLED events on already-active orders (rare, ~chargeback) are
-- logged but do NOT revoke enrollment (Decision C1(a)). Admin investigates
-- and decides remedy out-of-band. The RPC is separate from
-- confirm_order_via_payos so the atomic-UPDATE replay defence on the PAID
-- path stays narrow.

create or replace function public.log_payos_cancellation(
  p_payos_order_code bigint,
  p_payload          jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  update public.orders
     set webhook_event_log = webhook_event_log || ARRAY[p_payload]
   where id = (
     select id from public.orders
     where payos_order_code = p_payos_order_code
     for update
   )
   returning * into v_order;

  if not found then
    raise exception 'order not found for payos_order_code: %', p_payos_order_code
      using errcode = '22023';
  end if;

  return v_order;
end;
$$;

revoke all on function public.log_payos_cancellation(bigint, jsonb) from public;
grant execute on function public.log_payos_cancellation(bigint, jsonb) to service_role;
