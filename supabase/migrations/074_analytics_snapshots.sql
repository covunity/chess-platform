-- Migration 074 — Slice 1 of PRD-0008 (issue #328): analytics_snapshots
-- foundation + Financial KPI computation.
--
-- This is the snapshot infrastructure for the admin Analytics dashboard at
-- `/admin/overview`. Per ADR-0009, the dashboard reads exclusively from a
-- single precomputed table — no live aggregate query on `orders` from the
-- client. The table is written by exactly one path: the SECURITY DEFINER
-- function below, invoked nightly by pg_cron and on-demand by the admin
-- "Làm mới" button.
--
-- ## What ships in slice 1
--
-- 1. The `analytics_snapshots` table itself (schema locked in CONTEXT.md
--    under "analytics_snapshots schema") with PK (snapshot_date, time_range,
--    category) and CHECK constraints on time_range + category.
-- 2. Admin-only RLS SELECT policy. No INSERT/UPDATE/DELETE policy — writes
--    only happen via the SECURITY DEFINER RPC, bypassing RLS by design.
-- 3. Three partial indexes on `orders` keyed by `confirmed_at` filtered to
--    `status='active'` — these are the access paths the four Financial KPIs
--    will use. The other analytics indexes listed in CONTEXT.md
--    (users.created_at, enrollments.enrolled_at, lesson_progress.*,
--     courses.*) land in slices 2 and 3 alongside their consumers.
-- 4. The `compute_analytics_snapshot(force_now boolean DEFAULT false)` RPC.
--    In slice 1 this only writes the `category='financial'` rows
--    (4 ranges → 4 rows per call). Content + users categories layer on top
--    in later slices, sharing the same RPC + cron job.
-- 5. A pg_cron job `compute_analytics_snapshot_daily` at 00:05 ICT.
-- 6. 90-day retention of `analytics_snapshots` rows.
--
-- ## Why this shape
--
-- Snapshot-only architecture (no live aggregates) — see ADR-0009.
-- Per-tier fee snapshots stored on orders — see E-07 in CLAUDE.md (we sum
-- `platform_fee_amount` and `creator_payout_amount` directly rather than
-- recomputing from amount × pct).
-- Refund signal — `orders.status IN ('refund_pending', 'refunded')` is what
-- the refund flow (PRD-0005, migrations 056-058) flips an order to. Both
-- statuses are excluded by the `status = 'active'` filter, satisfying
-- CONTEXT.md's "refunded orders excluded from all financial KPIs" rule.
-- Free orders (`amount = 0`, D-05) are `status='active'` from the moment
-- of creation, so they naturally count toward `order_count` and contribute
-- 0 to the three money sums.
--
-- Cron pattern follows ADR-0007's `expire_stale_orders` (migration 054):
-- pg_cron extension already loaded, `cron.schedule(name, cron_string, sql)`
-- with the `CRON_TZ=Asia/Ho_Chi_Minh 5 0 * * *` form so the job fires at
-- 00:05 local Vietnam time regardless of the postgres server clock.
--
-- Reference: ADR-0009 (snapshot architecture), PRD-0008 (functional spec),
-- CONTEXT.md (locked metric formulas + payload shape), issue #328.

BEGIN;

-- ── 1. analytics_snapshots table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.analytics_snapshots (
  snapshot_date date         NOT NULL,
  time_range    text         NOT NULL CHECK (time_range IN ('7d','mtd','last_month','all_time')),
  category      text         NOT NULL CHECK (category IN ('financial','content','users')),
  payload       jsonb        NOT NULL,
  computed_at   timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_date, time_range, category)
);

COMMENT ON TABLE public.analytics_snapshots IS
  'Precomputed analytics rollups for the admin /admin/overview dashboard. '
  'One row per (snapshot_date, time_range, category) tuple — 4 ranges × 3 '
  'categories = 12 rows/day. Written exclusively by compute_analytics_snapshot. '
  'Per ADR-0009, the dashboard reads from this table only — no live aggregates.';

-- ── 2. Row-Level Security ─────────────────────────────────────────────────
ALTER TABLE public.analytics_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS analytics_snapshots_admin_select ON public.analytics_snapshots;
CREATE POLICY analytics_snapshots_admin_select
  ON public.analytics_snapshots
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
       WHERE users.id = auth.uid()
         AND users.role = 'admin'
    )
  );
-- No INSERT/UPDATE/DELETE policy: writes only via SECURITY DEFINER RPC.

-- ── 3. Partial indexes on orders for Financial KPIs ──────────────────────
-- Each query the Financial section runs filters to `status='active'` and
-- buckets by `confirmed_at`. Partial indexes keep the index small (pending/
-- cancelled/expired/refunded rows are excluded entirely) and let the planner
-- pick a covering scan for SUM(amount), SUM(platform_fee_amount),
-- SUM(creator_payout_amount), COUNT(*) — i.e. the four KPI formulas in
-- CONTEXT.md.
CREATE INDEX IF NOT EXISTS orders_active_confirmed_at_idx
  ON public.orders (confirmed_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS orders_user_confirmed_idx
  ON public.orders (user_id, confirmed_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS orders_course_confirmed_idx
  ON public.orders (course_id, confirmed_at)
  WHERE status = 'active';

-- ── 4. compute_analytics_snapshot RPC ─────────────────────────────────────
-- Writes / upserts the four Financial rows for today. Same RPC will be
-- extended to also write content + users rows in slices 2 and 3.
--
-- Range semantics (Asia/Ho_Chi_Minh boundaries, per CONTEXT.md):
--   7d         → [now() - 7d, now()];       prior = [now() - 14d, now() - 7d]
--   mtd        → [first-of-month-ICT, now]; prior = same span in previous ICT month
--   last_month → full previous ICT month;   prior = the ICT month before that
--   all_time   → epoch → now();             prior = NULL (no delta)
--
-- Free orders (`amount = 0`, D-05) auto-confirm at creation per ADR-0007 and
-- carry status='active'. They count toward COUNT(*) but contribute 0 to the
-- three SUM()s.
--
-- Refunded orders (`status` in 'refund_pending' / 'refunded') are excluded
-- entirely by the `status = 'active'` filter — see CONTEXT.md
-- "Financial metrics" note.
--
-- The pg_cron invoker has auth.uid() = NULL, so we only enforce the admin
-- gate when there IS a calling user (the manual refresh button case).
CREATE OR REPLACE FUNCTION public.compute_analytics_snapshot(
  force_now boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_today        date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_now          timestamptz := now();
  -- range bounds
  v_7d_start          timestamptz;
  v_7d_prior_start    timestamptz;
  v_mtd_start         timestamptz;
  v_mtd_prior_start   timestamptz;
  v_mtd_prior_end     timestamptz;
  v_last_month_start  timestamptz;
  v_last_month_end    timestamptz;
  v_prev_prev_start   timestamptz;
  v_prev_prev_end     timestamptz;
  -- KPI accumulators
  v_rev            bigint;
  v_orders         bigint;
  v_fee            bigint;
  v_payout         bigint;
  v_rev_prior      bigint;
  v_orders_prior   bigint;
  v_fee_prior      bigint;
  v_payout_prior   bigint;
  v_kpis           jsonb;
BEGIN
  -- Admin gate. pg_cron's null auth.uid() is allowed (system context).
  IF v_caller IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.users
        WHERE id = v_caller
          AND role = 'admin'
     ) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- force_now is currently informational — every invocation recomputes the
  -- snapshot for v_today because the upsert is idempotent. The flag is kept
  -- in the signature so a future "skip recompute if already fresh" guard
  -- has a place to land without changing callers.
  PERFORM force_now;

  -- ── Compute ICT-local range bounds ────────────────────────────────────
  v_7d_start         := v_now - interval '7 days';
  v_7d_prior_start   := v_now - interval '14 days';

  -- "First of current ICT month" — date_trunc the ICT-local now.
  v_mtd_start        := date_trunc('month', v_now AT TIME ZONE 'Asia/Ho_Chi_Minh')
                          AT TIME ZONE 'Asia/Ho_Chi_Minh';
  -- "Same span in previous ICT month" = start at previous month boundary,
  -- end at previous-month + elapsed-this-month.
  v_mtd_prior_start  := (date_trunc('month', v_now AT TIME ZONE 'Asia/Ho_Chi_Minh')
                          - interval '1 month')
                          AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_mtd_prior_end    := v_mtd_prior_start + (v_now - v_mtd_start);

  v_last_month_start := v_mtd_prior_start;
  v_last_month_end   := v_mtd_start;

  v_prev_prev_start  := (date_trunc('month', v_now AT TIME ZONE 'Asia/Ho_Chi_Minh')
                          - interval '2 months')
                          AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_prev_prev_end    := v_last_month_start;

  -- ────────────────────────────────────────────────────────────────────
  -- Financial KPIs — 7d
  -- ────────────────────────────────────────────────────────────────────
  SELECT
    COALESCE(SUM(amount), 0),
    COUNT(*),
    COALESCE(SUM(platform_fee_amount), 0),
    COALESCE(SUM(creator_payout_amount), 0)
  INTO v_rev, v_orders, v_fee, v_payout
  FROM public.orders
  WHERE status = 'active'
    AND confirmed_at >= v_7d_start
    AND confirmed_at <  v_now;

  SELECT
    COALESCE(SUM(amount), 0),
    COUNT(*),
    COALESCE(SUM(platform_fee_amount), 0),
    COALESCE(SUM(creator_payout_amount), 0)
  INTO v_rev_prior, v_orders_prior, v_fee_prior, v_payout_prior
  FROM public.orders
  WHERE status = 'active'
    AND confirmed_at >= v_7d_prior_start
    AND confirmed_at <  v_7d_start;

  v_kpis := jsonb_build_object(
    'revenue',        jsonb_build_object('value', v_rev,    'delta_pct', public._analytics_delta_pct(v_rev,    v_rev_prior)),
    'order_count',    jsonb_build_object('value', v_orders, 'delta_pct', public._analytics_delta_pct(v_orders, v_orders_prior)),
    'platform_fee',   jsonb_build_object('value', v_fee,    'delta_pct', public._analytics_delta_pct(v_fee,    v_fee_prior)),
    'creator_payout', jsonb_build_object('value', v_payout, 'delta_pct', public._analytics_delta_pct(v_payout, v_payout_prior))
  );

  INSERT INTO public.analytics_snapshots (snapshot_date, time_range, category, payload, computed_at)
  VALUES (v_today, '7d', 'financial', jsonb_build_object('kpis', v_kpis), now())
  ON CONFLICT (snapshot_date, time_range, category) DO UPDATE
    SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;

  -- ────────────────────────────────────────────────────────────────────
  -- Financial KPIs — mtd
  -- ────────────────────────────────────────────────────────────────────
  SELECT
    COALESCE(SUM(amount), 0),
    COUNT(*),
    COALESCE(SUM(platform_fee_amount), 0),
    COALESCE(SUM(creator_payout_amount), 0)
  INTO v_rev, v_orders, v_fee, v_payout
  FROM public.orders
  WHERE status = 'active'
    AND confirmed_at >= v_mtd_start
    AND confirmed_at <  v_now;

  SELECT
    COALESCE(SUM(amount), 0),
    COUNT(*),
    COALESCE(SUM(platform_fee_amount), 0),
    COALESCE(SUM(creator_payout_amount), 0)
  INTO v_rev_prior, v_orders_prior, v_fee_prior, v_payout_prior
  FROM public.orders
  WHERE status = 'active'
    AND confirmed_at >= v_mtd_prior_start
    AND confirmed_at <  v_mtd_prior_end;

  v_kpis := jsonb_build_object(
    'revenue',        jsonb_build_object('value', v_rev,    'delta_pct', public._analytics_delta_pct(v_rev,    v_rev_prior)),
    'order_count',    jsonb_build_object('value', v_orders, 'delta_pct', public._analytics_delta_pct(v_orders, v_orders_prior)),
    'platform_fee',   jsonb_build_object('value', v_fee,    'delta_pct', public._analytics_delta_pct(v_fee,    v_fee_prior)),
    'creator_payout', jsonb_build_object('value', v_payout, 'delta_pct', public._analytics_delta_pct(v_payout, v_payout_prior))
  );

  INSERT INTO public.analytics_snapshots (snapshot_date, time_range, category, payload, computed_at)
  VALUES (v_today, 'mtd', 'financial', jsonb_build_object('kpis', v_kpis), now())
  ON CONFLICT (snapshot_date, time_range, category) DO UPDATE
    SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;

  -- ────────────────────────────────────────────────────────────────────
  -- Financial KPIs — last_month
  -- ────────────────────────────────────────────────────────────────────
  SELECT
    COALESCE(SUM(amount), 0),
    COUNT(*),
    COALESCE(SUM(platform_fee_amount), 0),
    COALESCE(SUM(creator_payout_amount), 0)
  INTO v_rev, v_orders, v_fee, v_payout
  FROM public.orders
  WHERE status = 'active'
    AND confirmed_at >= v_last_month_start
    AND confirmed_at <  v_last_month_end;

  SELECT
    COALESCE(SUM(amount), 0),
    COUNT(*),
    COALESCE(SUM(platform_fee_amount), 0),
    COALESCE(SUM(creator_payout_amount), 0)
  INTO v_rev_prior, v_orders_prior, v_fee_prior, v_payout_prior
  FROM public.orders
  WHERE status = 'active'
    AND confirmed_at >= v_prev_prev_start
    AND confirmed_at <  v_prev_prev_end;

  v_kpis := jsonb_build_object(
    'revenue',        jsonb_build_object('value', v_rev,    'delta_pct', public._analytics_delta_pct(v_rev,    v_rev_prior)),
    'order_count',    jsonb_build_object('value', v_orders, 'delta_pct', public._analytics_delta_pct(v_orders, v_orders_prior)),
    'platform_fee',   jsonb_build_object('value', v_fee,    'delta_pct', public._analytics_delta_pct(v_fee,    v_fee_prior)),
    'creator_payout', jsonb_build_object('value', v_payout, 'delta_pct', public._analytics_delta_pct(v_payout, v_payout_prior))
  );

  INSERT INTO public.analytics_snapshots (snapshot_date, time_range, category, payload, computed_at)
  VALUES (v_today, 'last_month', 'financial', jsonb_build_object('kpis', v_kpis), now())
  ON CONFLICT (snapshot_date, time_range, category) DO UPDATE
    SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;

  -- ────────────────────────────────────────────────────────────────────
  -- Financial KPIs — all_time (no delta)
  -- ────────────────────────────────────────────────────────────────────
  SELECT
    COALESCE(SUM(amount), 0),
    COUNT(*),
    COALESCE(SUM(platform_fee_amount), 0),
    COALESCE(SUM(creator_payout_amount), 0)
  INTO v_rev, v_orders, v_fee, v_payout
  FROM public.orders
  WHERE status = 'active';

  v_kpis := jsonb_build_object(
    'revenue',        jsonb_build_object('value', v_rev,    'delta_pct', NULL),
    'order_count',    jsonb_build_object('value', v_orders, 'delta_pct', NULL),
    'platform_fee',   jsonb_build_object('value', v_fee,    'delta_pct', NULL),
    'creator_payout', jsonb_build_object('value', v_payout, 'delta_pct', NULL)
  );

  INSERT INTO public.analytics_snapshots (snapshot_date, time_range, category, payload, computed_at)
  VALUES (v_today, 'all_time', 'financial', jsonb_build_object('kpis', v_kpis), now())
  ON CONFLICT (snapshot_date, time_range, category) DO UPDATE
    SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;

  -- ── 90-day retention ────────────────────────────────────────────────
  DELETE FROM public.analytics_snapshots
   WHERE snapshot_date < (now() - interval '90 days')::date;
END;
$$;

COMMENT ON FUNCTION public.compute_analytics_snapshot(boolean) IS
  'Writes / upserts the daily analytics_snapshots rows. Slice 1 writes the '
  'four Financial range rows; later slices extend the same body for content '
  'and users categories. Invoked by pg_cron at 00:05 ICT and by the admin '
  '"Làm mới" button. Idempotent via PK upsert. SECURITY DEFINER so both '
  'pg_cron (null auth.uid) and admin callers can write.';

REVOKE ALL ON FUNCTION public.compute_analytics_snapshot(boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.compute_analytics_snapshot(boolean) TO authenticated;

-- ── 5. Delta percent helper ──────────────────────────────────────────────
-- Keeps the delta computation in one place so all 12 KPI cells (4 ranges
-- × 4 KPIs in slice 1, 12 KPIs once content/users land) use the same
-- formula. Special cases:
--   prior = 0 AND current = 0  → 0 (flat, not infinite)
--   prior = 0 AND current > 0  → NULL (no meaningful percent; UI renders "—")
-- Otherwise: floor-rounded to 1 decimal place.
CREATE OR REPLACE FUNCTION public._analytics_delta_pct(
  p_current bigint,
  p_prior   bigint
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_prior IS NULL THEN RETURN NULL; END IF;
  IF p_prior = 0 AND p_current = 0 THEN RETURN 0; END IF;
  IF p_prior = 0 THEN RETURN NULL; END IF;
  RETURN round(((p_current::numeric - p_prior::numeric) / p_prior::numeric) * 100, 1);
END;
$$;

REVOKE ALL ON FUNCTION public._analytics_delta_pct(bigint, bigint) FROM public;

-- ── 6. pg_cron daily schedule ────────────────────────────────────────────
-- Runs at 00:05 ICT every day. Supabase ships an older pg_cron that
-- does not accept the `CRON_TZ=...` per-job prefix (added in pg_cron
-- 1.5), so we schedule in UTC instead: ICT is UTC+7, so 00:05 ICT
-- equals 17:05 UTC of the previous calendar day → cron expression
-- `5 17 * * *`.
--
-- The snapshot_date stamped on each row is computed inside the
-- function as `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`, so the
-- ICT calendar day is preserved regardless of when (in UTC) the cron
-- actually fires. Same for all `date_trunc(..., now() AT TIME ZONE
-- 'Asia/Ho_Chi_Minh')` ranges below — they remain anchored to ICT.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'compute_analytics_snapshot_daily') THEN
    PERFORM cron.unschedule('compute_analytics_snapshot_daily');
  END IF;

  PERFORM cron.schedule(
    'compute_analytics_snapshot_daily',
    '5 17 * * *',
    $cron$ SELECT public.compute_analytics_snapshot(false); $cron$
  );
END $$;

COMMIT;
