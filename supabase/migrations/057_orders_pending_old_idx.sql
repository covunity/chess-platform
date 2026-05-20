-- Slice 4 of PRD-0005 — partial index for stale-pending orders lookups
--
-- The admin "Cần can thiệp" tab (AdminOrdersPage) filters
--   status = 'pending' AND created_at < now() - interval '1 hour'
-- to surface orders where the PayOS webhook never arrived. The same predicate
-- shape is also used by the slice-2 `expire_stale_orders()` cron job (24h
-- threshold), so the partial index helps both workloads on the rare hot path
-- without bloating the all-orders index.
--
-- Idempotent — safe to re-run.

create index if not exists orders_pending_old_idx
  on public.orders (created_at)
  where status = 'pending';

comment on index public.orders_pending_old_idx is
  'Partial index supporting the admin "Cần can thiệp" tab and expire_stale_orders() cron. PRD-0005 §5.8.';
