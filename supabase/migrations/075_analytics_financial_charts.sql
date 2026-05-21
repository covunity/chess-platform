-- Migration 075 — Slice 2 of PRD-0008 (issue #329): extend the Financial
-- snapshot payload with `revenue_trend`, `top_courses`, `top_creators`.
--
-- Builds on migration 074 which created `analytics_snapshots` + the first
-- version of `compute_analytics_snapshot(boolean)` that wrote only the four
-- KPI cells per range. This migration CREATE OR REPLACEs the RPC with a
-- body that ALSO writes:
--
--   • revenue_trend  — one point per day for 7d/mtd/last_month, one per
--                      calendar month for all_time. Bucket key is the
--                      ISO date string (`YYYY-MM-DD` / `YYYY-MM`).
--   • top_courses    — top 10 courses by SUM(orders.amount) in range,
--                      tie-break by course_id ASC.
--   • top_creators   — top 10 creators by SUM(orders.creator_payout_amount)
--                      in range. Joins orders → courses → users to read
--                      `creator_id` + `name`. Tie-break by creator_id ASC.
--
-- Note: we follow the migrations 060/061 pattern of fixing a previous RPC
-- by replacing it — DO NOT edit migration 074.
--
-- Reference: PRD-0008 §4 US1.3 + US1.4, §5.5, §5.6, CONTEXT.md "Leaderboards"
-- and "Financial metrics", issue #329.

BEGIN;

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
  v_trend          jsonb;
  v_top_courses    jsonb;
  v_top_creators   jsonb;
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

  PERFORM force_now;

  -- ── Compute ICT-local range bounds ────────────────────────────────────
  v_7d_start         := v_now - interval '7 days';
  v_7d_prior_start   := v_now - interval '14 days';

  v_mtd_start        := date_trunc('month', v_now AT TIME ZONE 'Asia/Ho_Chi_Minh')
                          AT TIME ZONE 'Asia/Ho_Chi_Minh';
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
  -- Financial — 7d
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

  -- Revenue trend — one point per ICT-local day across the 7d window.
  -- LEFT JOIN against generate_series so empty days render as 0.
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('bucket', to_char(d.day, 'YYYY-MM-DD'), 'value', COALESCE(o.value, 0))
           ORDER BY d.day
         ), '[]'::jsonb)
    INTO v_trend
    FROM generate_series(
           date_trunc('day', v_7d_start AT TIME ZONE 'Asia/Ho_Chi_Minh'),
           date_trunc('day', v_now      AT TIME ZONE 'Asia/Ho_Chi_Minh'),
           interval '1 day'
         ) AS d(day)
    LEFT JOIN (
      SELECT date_trunc('day', confirmed_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS day,
             SUM(amount)::bigint AS value
        FROM public.orders
       WHERE status = 'active'
         AND confirmed_at >= v_7d_start
         AND confirmed_at <  v_now
       GROUP BY 1
    ) o ON o.day = d.day;

  -- Top 10 courses by revenue (SUM(amount)). Tie-break by course_id ASC.
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('course_id', t.course_id, 'title', t.title, 'revenue', t.revenue)
           ORDER BY t.revenue DESC, t.course_id ASC
         ), '[]'::jsonb)
    INTO v_top_courses
    FROM (
      SELECT o.course_id,
             c.title,
             SUM(o.amount)::bigint AS revenue
        FROM public.orders o
        JOIN public.courses c ON c.id = o.course_id
       WHERE o.status = 'active'
         AND o.confirmed_at >= v_7d_start
         AND o.confirmed_at <  v_now
       GROUP BY o.course_id, c.title
       ORDER BY revenue DESC, o.course_id ASC
       LIMIT 10
    ) t;

  -- Top 10 creators by SUM(creator_payout_amount). Join orders → courses → users.
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('creator_id', t.creator_id, 'name', t.name, 'revenue', t.payout)
           ORDER BY t.payout DESC, t.creator_id ASC
         ), '[]'::jsonb)
    INTO v_top_creators
    FROM (
      SELECT c.creator_id,
             u.name,
             SUM(o.creator_payout_amount)::bigint AS payout
        FROM public.orders o
        JOIN public.courses c ON c.id = o.course_id
        JOIN public.users   u ON u.id = c.creator_id
       WHERE o.status = 'active'
         AND o.confirmed_at >= v_7d_start
         AND o.confirmed_at <  v_now
       GROUP BY c.creator_id, u.name
       ORDER BY payout DESC, c.creator_id ASC
       LIMIT 10
    ) t;

  INSERT INTO public.analytics_snapshots (snapshot_date, time_range, category, payload, computed_at)
  VALUES (
    v_today, '7d', 'financial',
    jsonb_build_object(
      'kpis',           v_kpis,
      'revenue_trend',  v_trend,
      'top_courses',    v_top_courses,
      'top_creators',   v_top_creators
    ),
    now()
  )
  ON CONFLICT (snapshot_date, time_range, category) DO UPDATE
    SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;

  -- ────────────────────────────────────────────────────────────────────
  -- Financial — mtd
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

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('bucket', to_char(d.day, 'YYYY-MM-DD'), 'value', COALESCE(o.value, 0))
           ORDER BY d.day
         ), '[]'::jsonb)
    INTO v_trend
    FROM generate_series(
           date_trunc('day', v_mtd_start AT TIME ZONE 'Asia/Ho_Chi_Minh'),
           date_trunc('day', v_now       AT TIME ZONE 'Asia/Ho_Chi_Minh'),
           interval '1 day'
         ) AS d(day)
    LEFT JOIN (
      SELECT date_trunc('day', confirmed_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS day,
             SUM(amount)::bigint AS value
        FROM public.orders
       WHERE status = 'active'
         AND confirmed_at >= v_mtd_start
         AND confirmed_at <  v_now
       GROUP BY 1
    ) o ON o.day = d.day;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('course_id', t.course_id, 'title', t.title, 'revenue', t.revenue)
           ORDER BY t.revenue DESC, t.course_id ASC
         ), '[]'::jsonb)
    INTO v_top_courses
    FROM (
      SELECT o.course_id,
             c.title,
             SUM(o.amount)::bigint AS revenue
        FROM public.orders o
        JOIN public.courses c ON c.id = o.course_id
       WHERE o.status = 'active'
         AND o.confirmed_at >= v_mtd_start
         AND o.confirmed_at <  v_now
       GROUP BY o.course_id, c.title
       ORDER BY revenue DESC, o.course_id ASC
       LIMIT 10
    ) t;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('creator_id', t.creator_id, 'name', t.name, 'revenue', t.payout)
           ORDER BY t.payout DESC, t.creator_id ASC
         ), '[]'::jsonb)
    INTO v_top_creators
    FROM (
      SELECT c.creator_id,
             u.name,
             SUM(o.creator_payout_amount)::bigint AS payout
        FROM public.orders o
        JOIN public.courses c ON c.id = o.course_id
        JOIN public.users   u ON u.id = c.creator_id
       WHERE o.status = 'active'
         AND o.confirmed_at >= v_mtd_start
         AND o.confirmed_at <  v_now
       GROUP BY c.creator_id, u.name
       ORDER BY payout DESC, c.creator_id ASC
       LIMIT 10
    ) t;

  INSERT INTO public.analytics_snapshots (snapshot_date, time_range, category, payload, computed_at)
  VALUES (
    v_today, 'mtd', 'financial',
    jsonb_build_object(
      'kpis',           v_kpis,
      'revenue_trend',  v_trend,
      'top_courses',    v_top_courses,
      'top_creators',   v_top_creators
    ),
    now()
  )
  ON CONFLICT (snapshot_date, time_range, category) DO UPDATE
    SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;

  -- ────────────────────────────────────────────────────────────────────
  -- Financial — last_month
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

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('bucket', to_char(d.day, 'YYYY-MM-DD'), 'value', COALESCE(o.value, 0))
           ORDER BY d.day
         ), '[]'::jsonb)
    INTO v_trend
    FROM generate_series(
           date_trunc('day', v_last_month_start AT TIME ZONE 'Asia/Ho_Chi_Minh'),
           date_trunc('day', (v_last_month_end - interval '1 day') AT TIME ZONE 'Asia/Ho_Chi_Minh'),
           interval '1 day'
         ) AS d(day)
    LEFT JOIN (
      SELECT date_trunc('day', confirmed_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS day,
             SUM(amount)::bigint AS value
        FROM public.orders
       WHERE status = 'active'
         AND confirmed_at >= v_last_month_start
         AND confirmed_at <  v_last_month_end
       GROUP BY 1
    ) o ON o.day = d.day;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('course_id', t.course_id, 'title', t.title, 'revenue', t.revenue)
           ORDER BY t.revenue DESC, t.course_id ASC
         ), '[]'::jsonb)
    INTO v_top_courses
    FROM (
      SELECT o.course_id,
             c.title,
             SUM(o.amount)::bigint AS revenue
        FROM public.orders o
        JOIN public.courses c ON c.id = o.course_id
       WHERE o.status = 'active'
         AND o.confirmed_at >= v_last_month_start
         AND o.confirmed_at <  v_last_month_end
       GROUP BY o.course_id, c.title
       ORDER BY revenue DESC, o.course_id ASC
       LIMIT 10
    ) t;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('creator_id', t.creator_id, 'name', t.name, 'revenue', t.payout)
           ORDER BY t.payout DESC, t.creator_id ASC
         ), '[]'::jsonb)
    INTO v_top_creators
    FROM (
      SELECT c.creator_id,
             u.name,
             SUM(o.creator_payout_amount)::bigint AS payout
        FROM public.orders o
        JOIN public.courses c ON c.id = o.course_id
        JOIN public.users   u ON u.id = c.creator_id
       WHERE o.status = 'active'
         AND o.confirmed_at >= v_last_month_start
         AND o.confirmed_at <  v_last_month_end
       GROUP BY c.creator_id, u.name
       ORDER BY payout DESC, c.creator_id ASC
       LIMIT 10
    ) t;

  INSERT INTO public.analytics_snapshots (snapshot_date, time_range, category, payload, computed_at)
  VALUES (
    v_today, 'last_month', 'financial',
    jsonb_build_object(
      'kpis',           v_kpis,
      'revenue_trend',  v_trend,
      'top_courses',    v_top_courses,
      'top_creators',   v_top_creators
    ),
    now()
  )
  ON CONFLICT (snapshot_date, time_range, category) DO UPDATE
    SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;

  -- ────────────────────────────────────────────────────────────────────
  -- Financial — all_time (no delta; monthly buckets)
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

  -- All-time uses one point per ICT-local calendar month.
  -- Range = earliest confirmed_at month → current ICT month. If there
  -- are no orders at all, return [] (the COALESCE on jsonb_agg handles it).
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('bucket', to_char(d.day, 'YYYY-MM'), 'value', COALESCE(o.value, 0))
           ORDER BY d.day
         ), '[]'::jsonb)
    INTO v_trend
    FROM (
      SELECT day::date AS day
        FROM generate_series(
          (SELECT date_trunc('month', MIN(confirmed_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')
             FROM public.orders
            WHERE status = 'active'),
          date_trunc('month', v_now AT TIME ZONE 'Asia/Ho_Chi_Minh'),
          interval '1 month'
        ) AS day
    ) d
    LEFT JOIN (
      SELECT date_trunc('month', confirmed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
             SUM(amount)::bigint AS value
        FROM public.orders
       WHERE status = 'active'
       GROUP BY 1
    ) o ON o.day = d.day;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('course_id', t.course_id, 'title', t.title, 'revenue', t.revenue)
           ORDER BY t.revenue DESC, t.course_id ASC
         ), '[]'::jsonb)
    INTO v_top_courses
    FROM (
      SELECT o.course_id,
             c.title,
             SUM(o.amount)::bigint AS revenue
        FROM public.orders o
        JOIN public.courses c ON c.id = o.course_id
       WHERE o.status = 'active'
       GROUP BY o.course_id, c.title
       ORDER BY revenue DESC, o.course_id ASC
       LIMIT 10
    ) t;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('creator_id', t.creator_id, 'name', t.name, 'revenue', t.payout)
           ORDER BY t.payout DESC, t.creator_id ASC
         ), '[]'::jsonb)
    INTO v_top_creators
    FROM (
      SELECT c.creator_id,
             u.name,
             SUM(o.creator_payout_amount)::bigint AS payout
        FROM public.orders o
        JOIN public.courses c ON c.id = o.course_id
        JOIN public.users   u ON u.id = c.creator_id
       WHERE o.status = 'active'
       GROUP BY c.creator_id, u.name
       ORDER BY payout DESC, c.creator_id ASC
       LIMIT 10
    ) t;

  INSERT INTO public.analytics_snapshots (snapshot_date, time_range, category, payload, computed_at)
  VALUES (
    v_today, 'all_time', 'financial',
    jsonb_build_object(
      'kpis',           v_kpis,
      'revenue_trend',  v_trend,
      'top_courses',    v_top_courses,
      'top_creators',   v_top_creators
    ),
    now()
  )
  ON CONFLICT (snapshot_date, time_range, category) DO UPDATE
    SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;

  -- ── 90-day retention ────────────────────────────────────────────────
  DELETE FROM public.analytics_snapshots
   WHERE snapshot_date < (now() - interval '90 days')::date;
END;
$$;

COMMENT ON FUNCTION public.compute_analytics_snapshot(boolean) IS
  'Writes / upserts the daily analytics_snapshots rows. Slice 2 extends the '
  'four Financial rows to include revenue_trend (daily for 7d/mtd/last_month, '
  'monthly for all_time), top_courses (top 10 by revenue), and top_creators '
  '(top 10 by creator_payout_amount). Invoked by pg_cron at 00:05 ICT and by '
  'the admin "Làm mới" button. Idempotent via PK upsert. SECURITY DEFINER so '
  'both pg_cron (null auth.uid) and admin callers can write.';

COMMIT;
