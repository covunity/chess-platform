-- Slice 2 of PRD-0005 — 24h order expiry via pg_cron
--
-- Pending orders older than 24 hours auto-transition to `expired` status via
-- pg_cron running every 30 minutes. Lifts PRD-0002 D2 ("No TTL Phase 2") —
-- its manual-flow rationale no longer applies once PayOS auto-confirms.
--
-- No backfill: there are no production orders yet (PRD-0005 §10 D3).
--
-- Note: `orders.status` is a Postgres ENUM (public.order_status), not a CHECK
-- constraint, so we must ALTER TYPE … ADD VALUE rather than rewrite a CHECK.
-- ALTER TYPE … ADD VALUE must run in its own statement (and historically
-- outside a transaction prior to PG 12). Keep it isolated at the top of the
-- file before any code references the new value.

-- 1. Extend the enum.
alter type public.order_status add value if not exists 'expired';

-- 2. Add the expired_at timestamp column.
alter table public.orders
  add column if not exists expired_at timestamptz;

-- 3. The worker function. Returns the number of orders that were flipped.
--    Invoked by pg_cron (see below) every 30 minutes. Safe to call manually.
create or replace function public.expire_stale_orders()
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  update public.orders
     set status = 'expired',
         expired_at = now()
   where status = 'pending'
     and created_at < now() - interval '24 hours';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.expire_stale_orders() is
  'Marks pending orders older than 24h as expired. Invoked by pg_cron job '
  '`expire-stale-orders` every 30 minutes. PRD-0005 §5.5.';

-- 4. Ensure pg_cron is available (idempotent — no-op if already loaded).
create extension if not exists pg_cron;

-- 5. Schedule the job idempotently — cron.schedule() itself is not idempotent
--    (re-running would create a duplicate row in cron.job).
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'expire-stale-orders') then
    perform cron.schedule(
      'expire-stale-orders',
      '*/30 * * * *',
      $cron$ select public.expire_stale_orders(); $cron$
    );
  end if;
end $$;
