-- Migration 077 — Slice 4 of PRD-0008 (issue #331): Users section.
--
-- Two pieces ship in this migration:
--
-- 1. Two indexes for the users-section access paths:
--    • `users_created_at_idx` — backs the New-signups COUNT and the
--      conversion-rate denominator + the signup-trend buckets.
--    • `lesson_progress_viewed_at_idx` — backs the Active-users
--      `COUNT(DISTINCT user_id)` scan.
--    Both `IF NOT EXISTS` so a fresh `db push` runs cleanly even though
--    CONTEXT.md "Indexes added for analytics" lists them.
--
-- 2. CREATE OR REPLACE `compute_analytics_snapshot(boolean)` — preserves
--    the slice-3 Financial + Content body verbatim, then ADDS four
--    `category='users'` upserts (one per range). The users payload per
--    CONTEXT.md "payload shape (category='users')":
--      • kpis.new_signups     — COUNT(*) FROM users WHERE created_at IN range,
--                               NO role filter (a learner who later flips to
--                               creator must not disappear from past months —
--                               see CONTEXT.md "New signups").
--      • kpis.active_users    — COUNT(DISTINCT user_id) FROM lesson_progress
--                               WHERE viewed_at IN range. Sign-in / browsing
--                               do not count — only actual lesson interaction
--                               (CONTEXT.md "Active user").
--      • kpis.conversion_rate — value = numerator / denominator (0..1 ratio).
--                               denominator = COUNT(*) FROM users WHERE
--                                 role='learner' AND created_at IN range.
--                               numerator   = COUNT(DISTINCT learner_id) of
--                                 those learners who ALSO have at least one
--                                 orders row with status='active' AND
--                                 confirmed_at IN range. Free-course
--                                 activations (amount=0, status='active' per
--                                 D-05) count — the metric is behavioral
--                                 commitment, not revenue (CONTEXT.md
--                                 "Conversion rate"). Numerator + denominator
--                                 are ALSO stored on the payload so the UI
--                                 can render "N/M" alongside the percent.
--      • signup_trend         — same generate_series + LEFT JOIN bucketing
--                               as the financial revenue_trend (migration
--                               075). Daily buckets for 7d/mtd/last_month;
--                               monthly buckets for all_time.
--      • top_buyers           — TOP 10 by SUM(orders.amount) DESC,
--                               tie-break user_id ASC. Filters to
--                               status='active' AND confirmed_at IN range
--                               so refunded orders (migration 058 flips them
--                               to refund_pending/refunded) are excluded
--                               naturally. NO `amount > 0` filter — free
--                               claimers still appear, but with spend = 0
--                               they sort to the bottom and never displace
--                               paying customers (CONTEXT.md "Top buyers").
--
-- Per the project pattern (migrations 060/061/075/076) — we DO NOT edit
-- prior migrations. CREATE OR REPLACE on the RPC fully supersedes the
-- slice-3 body. Indexes use IF NOT EXISTS so a fresh `db push` runs cleanly.
--
-- Reference: PRD-0008 §4 P3 (US3.1–US3.3), §5.4, §5.5, §5.6, ADR-0009
-- (snapshot duplication rule), CONTEXT.md "User-engagement metrics" +
-- "Leaderboards" + "New signups" + "Indexes added for analytics", issue #331.

BEGIN;

-- ── 1. Indexes for the users-section queries ─────────────────────────────
CREATE INDEX IF NOT EXISTS users_created_at_idx
  ON public.users (created_at);

CREATE INDEX IF NOT EXISTS lesson_progress_viewed_at_idx
  ON public.lesson_progress (viewed_at);

-- ── 2. compute_analytics_snapshot RPC — extended with users writes ───────
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
  -- KPI accumulators (financial)
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
  -- KPI accumulators (content)
  v_new_courses        bigint;
  v_new_courses_prior  bigint;
  v_pub_courses        bigint;
  v_pub_courses_prior  bigint;
  v_enrollments        bigint;
  v_enrollments_prior  bigint;
  v_by_level           jsonb;
  v_by_language        jsonb;
  v_completion_top     jsonb;
  -- KPI accumulators (users)
  v_new_signups        bigint;
  v_new_signups_prior  bigint;
  v_active_users       bigint;
  v_active_users_prior bigint;
  v_conv_denom         bigint;
  v_conv_num           bigint;
  v_conv_rate          numeric;
  v_conv_denom_prior   bigint;
  v_conv_num_prior     bigint;
  v_conv_rate_prior    numeric;
  v_signup_trend       jsonb;
  v_top_buyers         jsonb;
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

  -- ════════════════════════════════════════════════════════════════════
  -- Financial — 7d
  -- ════════════════════════════════════════════════════════════════════
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

  -- ════════════════════════════════════════════════════════════════════
  -- Financial — mtd
  -- ════════════════════════════════════════════════════════════════════
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

  -- ════════════════════════════════════════════════════════════════════
  -- Financial — last_month
  -- ════════════════════════════════════════════════════════════════════
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

  -- ════════════════════════════════════════════════════════════════════
  -- Financial — all_time (no delta; monthly buckets)
  -- ════════════════════════════════════════════════════════════════════
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

  -- ════════════════════════════════════════════════════════════════════
  -- Content — completion_top (range-independent, computed ONCE)
  -- ════════════════════════════════════════════════════════════════════
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'course_id',        t.course_id,
             'title',            t.title,
             'completion_rate',  t.completion_rate,
             'enrollment_count', t.enrollment_count
           )
           ORDER BY t.completion_rate DESC, t.course_id ASC
         ), '[]'::jsonb)
    INTO v_completion_top
    FROM (
      WITH lesson_counts AS (
        SELECT co.id AS course_id,
               COUNT(l.id) AS total_lessons
          FROM public.courses co
          LEFT JOIN public.chapters ch ON ch.course_id = co.id
          LEFT JOIN public.lessons  l  ON l.chapter_id = ch.id
         WHERE co.status = 'published'
         GROUP BY co.id
      ),
      per_enrollee AS (
        SELECT e.course_id,
               e.user_id,
               COALESCE(SUM(CASE WHEN lp.completed THEN 1 ELSE 0 END), 0) AS completed_count
          FROM public.enrollments e
          LEFT JOIN public.lesson_progress lp
                 ON lp.course_id = e.course_id
                AND lp.user_id   = e.user_id
         GROUP BY e.course_id, e.user_id
      )
      SELECT c.id AS course_id,
             c.title,
             ROUND(
               AVG(
                 CASE WHEN lc.total_lessons > 0
                      THEN pe.completed_count::numeric / lc.total_lessons
                      ELSE 0 END
               )::numeric,
               4
             ) AS completion_rate,
             COUNT(pe.user_id) AS enrollment_count
        FROM public.courses c
        JOIN lesson_counts lc ON lc.course_id = c.id
        JOIN per_enrollee  pe ON pe.course_id = c.id
       WHERE c.status = 'published'
       GROUP BY c.id, c.title
       ORDER BY completion_rate DESC, c.id ASC
       LIMIT 10
    ) t;

  -- ════════════════════════════════════════════════════════════════════
  -- Content — 7d
  -- ════════════════════════════════════════════════════════════════════
  SELECT COUNT(*) INTO v_new_courses
    FROM public.courses
   WHERE created_at >= v_7d_start AND created_at < v_now;

  SELECT COUNT(*) INTO v_new_courses_prior
    FROM public.courses
   WHERE created_at >= v_7d_prior_start AND created_at < v_7d_start;

  SELECT COUNT(*) INTO v_pub_courses
    FROM public.courses
   WHERE published_at >= v_7d_start AND published_at < v_now;

  SELECT COUNT(*) INTO v_pub_courses_prior
    FROM public.courses
   WHERE published_at >= v_7d_prior_start AND published_at < v_7d_start;

  SELECT COUNT(*) INTO v_enrollments
    FROM public.enrollments
   WHERE enrolled_at >= v_7d_start AND enrolled_at < v_now;

  SELECT COUNT(*) INTO v_enrollments_prior
    FROM public.enrollments
   WHERE enrolled_at >= v_7d_prior_start AND enrolled_at < v_7d_start;

  v_kpis := jsonb_build_object(
    'new_courses',       jsonb_build_object('value', v_new_courses, 'delta_pct', public._analytics_delta_pct(v_new_courses, v_new_courses_prior)),
    'published_courses', jsonb_build_object('value', v_pub_courses, 'delta_pct', public._analytics_delta_pct(v_pub_courses, v_pub_courses_prior)),
    'total_enrollments', jsonb_build_object('value', v_enrollments, 'delta_pct', public._analytics_delta_pct(v_enrollments, v_enrollments_prior))
  );

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('level', level::text, 'count', cnt)
           ORDER BY level
         ), '[]'::jsonb)
    INTO v_by_level
    FROM (
      SELECT level, COUNT(*)::bigint AS cnt
        FROM public.courses
       WHERE created_at >= v_7d_start AND created_at < v_now
       GROUP BY level
    ) s;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('language', language, 'count', cnt)
           ORDER BY language
         ), '[]'::jsonb)
    INTO v_by_language
    FROM (
      SELECT language, COUNT(*)::bigint AS cnt
        FROM public.courses
       WHERE created_at >= v_7d_start AND created_at < v_now
       GROUP BY language
    ) s;

  INSERT INTO public.analytics_snapshots (snapshot_date, time_range, category, payload, computed_at)
  VALUES (
    v_today, '7d', 'content',
    jsonb_build_object(
      'kpis',            v_kpis,
      'by_level',        v_by_level,
      'by_language',     v_by_language,
      'completion_top',  v_completion_top
    ),
    now()
  )
  ON CONFLICT (snapshot_date, time_range, category) DO UPDATE
    SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;

  -- ════════════════════════════════════════════════════════════════════
  -- Content — mtd
  -- ════════════════════════════════════════════════════════════════════
  SELECT COUNT(*) INTO v_new_courses
    FROM public.courses
   WHERE created_at >= v_mtd_start AND created_at < v_now;

  SELECT COUNT(*) INTO v_new_courses_prior
    FROM public.courses
   WHERE created_at >= v_mtd_prior_start AND created_at < v_mtd_prior_end;

  SELECT COUNT(*) INTO v_pub_courses
    FROM public.courses
   WHERE published_at >= v_mtd_start AND published_at < v_now;

  SELECT COUNT(*) INTO v_pub_courses_prior
    FROM public.courses
   WHERE published_at >= v_mtd_prior_start AND published_at < v_mtd_prior_end;

  SELECT COUNT(*) INTO v_enrollments
    FROM public.enrollments
   WHERE enrolled_at >= v_mtd_start AND enrolled_at < v_now;

  SELECT COUNT(*) INTO v_enrollments_prior
    FROM public.enrollments
   WHERE enrolled_at >= v_mtd_prior_start AND enrolled_at < v_mtd_prior_end;

  v_kpis := jsonb_build_object(
    'new_courses',       jsonb_build_object('value', v_new_courses, 'delta_pct', public._analytics_delta_pct(v_new_courses, v_new_courses_prior)),
    'published_courses', jsonb_build_object('value', v_pub_courses, 'delta_pct', public._analytics_delta_pct(v_pub_courses, v_pub_courses_prior)),
    'total_enrollments', jsonb_build_object('value', v_enrollments, 'delta_pct', public._analytics_delta_pct(v_enrollments, v_enrollments_prior))
  );

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('level', level::text, 'count', cnt)
           ORDER BY level
         ), '[]'::jsonb)
    INTO v_by_level
    FROM (
      SELECT level, COUNT(*)::bigint AS cnt
        FROM public.courses
       WHERE created_at >= v_mtd_start AND created_at < v_now
       GROUP BY level
    ) s;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('language', language, 'count', cnt)
           ORDER BY language
         ), '[]'::jsonb)
    INTO v_by_language
    FROM (
      SELECT language, COUNT(*)::bigint AS cnt
        FROM public.courses
       WHERE created_at >= v_mtd_start AND created_at < v_now
       GROUP BY language
    ) s;

  INSERT INTO public.analytics_snapshots (snapshot_date, time_range, category, payload, computed_at)
  VALUES (
    v_today, 'mtd', 'content',
    jsonb_build_object(
      'kpis',            v_kpis,
      'by_level',        v_by_level,
      'by_language',     v_by_language,
      'completion_top',  v_completion_top
    ),
    now()
  )
  ON CONFLICT (snapshot_date, time_range, category) DO UPDATE
    SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;

  -- ════════════════════════════════════════════════════════════════════
  -- Content — last_month
  -- ════════════════════════════════════════════════════════════════════
  SELECT COUNT(*) INTO v_new_courses
    FROM public.courses
   WHERE created_at >= v_last_month_start AND created_at < v_last_month_end;

  SELECT COUNT(*) INTO v_new_courses_prior
    FROM public.courses
   WHERE created_at >= v_prev_prev_start AND created_at < v_prev_prev_end;

  SELECT COUNT(*) INTO v_pub_courses
    FROM public.courses
   WHERE published_at >= v_last_month_start AND published_at < v_last_month_end;

  SELECT COUNT(*) INTO v_pub_courses_prior
    FROM public.courses
   WHERE published_at >= v_prev_prev_start AND published_at < v_prev_prev_end;

  SELECT COUNT(*) INTO v_enrollments
    FROM public.enrollments
   WHERE enrolled_at >= v_last_month_start AND enrolled_at < v_last_month_end;

  SELECT COUNT(*) INTO v_enrollments_prior
    FROM public.enrollments
   WHERE enrolled_at >= v_prev_prev_start AND enrolled_at < v_prev_prev_end;

  v_kpis := jsonb_build_object(
    'new_courses',       jsonb_build_object('value', v_new_courses, 'delta_pct', public._analytics_delta_pct(v_new_courses, v_new_courses_prior)),
    'published_courses', jsonb_build_object('value', v_pub_courses, 'delta_pct', public._analytics_delta_pct(v_pub_courses, v_pub_courses_prior)),
    'total_enrollments', jsonb_build_object('value', v_enrollments, 'delta_pct', public._analytics_delta_pct(v_enrollments, v_enrollments_prior))
  );

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('level', level::text, 'count', cnt)
           ORDER BY level
         ), '[]'::jsonb)
    INTO v_by_level
    FROM (
      SELECT level, COUNT(*)::bigint AS cnt
        FROM public.courses
       WHERE created_at >= v_last_month_start AND created_at < v_last_month_end
       GROUP BY level
    ) s;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('language', language, 'count', cnt)
           ORDER BY language
         ), '[]'::jsonb)
    INTO v_by_language
    FROM (
      SELECT language, COUNT(*)::bigint AS cnt
        FROM public.courses
       WHERE created_at >= v_last_month_start AND created_at < v_last_month_end
       GROUP BY language
    ) s;

  INSERT INTO public.analytics_snapshots (snapshot_date, time_range, category, payload, computed_at)
  VALUES (
    v_today, 'last_month', 'content',
    jsonb_build_object(
      'kpis',            v_kpis,
      'by_level',        v_by_level,
      'by_language',     v_by_language,
      'completion_top',  v_completion_top
    ),
    now()
  )
  ON CONFLICT (snapshot_date, time_range, category) DO UPDATE
    SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;

  -- ════════════════════════════════════════════════════════════════════
  -- Content — all_time (no delta)
  -- ════════════════════════════════════════════════════════════════════
  SELECT COUNT(*) INTO v_new_courses
    FROM public.courses;

  SELECT COUNT(*) INTO v_pub_courses
    FROM public.courses
   WHERE published_at IS NOT NULL;

  SELECT COUNT(*) INTO v_enrollments
    FROM public.enrollments;

  v_kpis := jsonb_build_object(
    'new_courses',       jsonb_build_object('value', v_new_courses, 'delta_pct', NULL),
    'published_courses', jsonb_build_object('value', v_pub_courses, 'delta_pct', NULL),
    'total_enrollments', jsonb_build_object('value', v_enrollments, 'delta_pct', NULL)
  );

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('level', level::text, 'count', cnt)
           ORDER BY level
         ), '[]'::jsonb)
    INTO v_by_level
    FROM (
      SELECT level, COUNT(*)::bigint AS cnt
        FROM public.courses
       GROUP BY level
    ) s;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('language', language, 'count', cnt)
           ORDER BY language
         ), '[]'::jsonb)
    INTO v_by_language
    FROM (
      SELECT language, COUNT(*)::bigint AS cnt
        FROM public.courses
       GROUP BY language
    ) s;

  INSERT INTO public.analytics_snapshots (snapshot_date, time_range, category, payload, computed_at)
  VALUES (
    v_today, 'all_time', 'content',
    jsonb_build_object(
      'kpis',            v_kpis,
      'by_level',        v_by_level,
      'by_language',     v_by_language,
      'completion_top',  v_completion_top
    ),
    now()
  )
  ON CONFLICT (snapshot_date, time_range, category) DO UPDATE
    SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;

  -- ════════════════════════════════════════════════════════════════════
  -- Users — 7d
  -- ════════════════════════════════════════════════════════════════════
  -- new_signups: COUNT(*) — NO role filter (CONTEXT.md "New signups").
  SELECT COUNT(*) INTO v_new_signups
    FROM public.users
   WHERE created_at >= v_7d_start AND created_at < v_now;

  SELECT COUNT(*) INTO v_new_signups_prior
    FROM public.users
   WHERE created_at >= v_7d_prior_start AND created_at < v_7d_start;

  -- active_users: COUNT(DISTINCT user_id) FROM lesson_progress viewed_at IN range.
  SELECT COUNT(DISTINCT user_id) INTO v_active_users
    FROM public.lesson_progress
   WHERE viewed_at >= v_7d_start AND viewed_at < v_now;

  SELECT COUNT(DISTINCT user_id) INTO v_active_users_prior
    FROM public.lesson_progress
   WHERE viewed_at >= v_7d_prior_start AND viewed_at < v_7d_start;

  -- conversion: denominator = learners signed up in range.
  SELECT COUNT(*) INTO v_conv_denom
    FROM public.users
   WHERE role = 'learner'
     AND created_at >= v_7d_start AND created_at < v_now;

  -- numerator: those learners who placed any status='active' order
  -- (free claims included — NO amount filter, per CONTEXT.md "Conversion rate").
  SELECT COUNT(DISTINCT u.id) INTO v_conv_num
    FROM public.users u
   WHERE u.role = 'learner'
     AND u.created_at >= v_7d_start AND u.created_at < v_now
     AND EXISTS (
       SELECT 1 FROM public.orders o
        WHERE o.user_id = u.id
          AND o.status = 'active'
          AND o.confirmed_at >= v_7d_start
          AND o.confirmed_at <  v_now
     );

  v_conv_rate := CASE WHEN v_conv_denom > 0
                      THEN ROUND(v_conv_num::numeric / v_conv_denom::numeric, 4)
                      ELSE 0
                 END;

  -- prior-period conversion (same formula, prior window).
  SELECT COUNT(*) INTO v_conv_denom_prior
    FROM public.users
   WHERE role = 'learner'
     AND created_at >= v_7d_prior_start AND created_at < v_7d_start;

  SELECT COUNT(DISTINCT u.id) INTO v_conv_num_prior
    FROM public.users u
   WHERE u.role = 'learner'
     AND u.created_at >= v_7d_prior_start AND u.created_at < v_7d_start
     AND EXISTS (
       SELECT 1 FROM public.orders o
        WHERE o.user_id = u.id
          AND o.status = 'active'
          AND o.confirmed_at >= v_7d_prior_start
          AND o.confirmed_at <  v_7d_start
     );

  v_conv_rate_prior := CASE WHEN v_conv_denom_prior > 0
                            THEN ROUND(v_conv_num_prior::numeric / v_conv_denom_prior::numeric, 4)
                            ELSE NULL
                       END;

  v_kpis := jsonb_build_object(
    'new_signups',     jsonb_build_object('value', v_new_signups,  'delta_pct', public._analytics_delta_pct(v_new_signups,  v_new_signups_prior)),
    'active_users',    jsonb_build_object('value', v_active_users, 'delta_pct', public._analytics_delta_pct(v_active_users, v_active_users_prior)),
    'conversion_rate', jsonb_build_object(
      'value',         v_conv_rate,
      'numerator',     v_conv_num,
      'denominator',   v_conv_denom,
      'delta_pct',     CASE
                         WHEN v_conv_rate_prior IS NULL THEN NULL
                         WHEN v_conv_rate_prior = 0 AND v_conv_rate = 0 THEN 0
                         WHEN v_conv_rate_prior = 0 THEN NULL
                         ELSE round(((v_conv_rate - v_conv_rate_prior) / v_conv_rate_prior) * 100, 1)
                       END
    )
  );

  -- signup_trend: daily buckets, generate_series + LEFT JOIN (mirrors revenue_trend).
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('bucket', to_char(d.day, 'YYYY-MM-DD'), 'value', COALESCE(s.value, 0))
           ORDER BY d.day
         ), '[]'::jsonb)
    INTO v_signup_trend
    FROM generate_series(
           date_trunc('day', v_7d_start AT TIME ZONE 'Asia/Ho_Chi_Minh'),
           date_trunc('day', v_now      AT TIME ZONE 'Asia/Ho_Chi_Minh'),
           interval '1 day'
         ) AS d(day)
    LEFT JOIN (
      SELECT date_trunc('day', created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS day,
             COUNT(*)::bigint AS value
        FROM public.users
       WHERE created_at >= v_7d_start
         AND created_at <  v_now
       GROUP BY 1
    ) s ON s.day = d.day;

  -- top_buyers: SUM(amount) DESC, tie-break user_id ASC, LIMIT 10.
  -- status='active' is the canonical refund exclusion (migration 058).
  -- NO amount > 0 filter: free claimers may appear with spend=0, but they
  -- sort to the bottom and never displace paying customers (CONTEXT.md
  -- "Leaderboards" → "Top buyers").
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'user_id',     t.user_id,
             'name',        t.display_name,
             'spend',       t.spend,
             'order_count', t.order_count
           )
           ORDER BY t.spend DESC, t.user_id ASC
         ), '[]'::jsonb)
    INTO v_top_buyers
    FROM (
      SELECT o.user_id,
             COALESCE(u.name, u.email) AS display_name,
             SUM(o.amount)::bigint     AS spend,
             COUNT(*)::bigint          AS order_count
        FROM public.orders o
        JOIN public.users  u ON u.id = o.user_id
       WHERE o.status = 'active'
         AND o.confirmed_at >= v_7d_start
         AND o.confirmed_at <  v_now
       GROUP BY o.user_id, u.name, u.email
       ORDER BY spend DESC, o.user_id ASC
       LIMIT 10
    ) t;

  INSERT INTO public.analytics_snapshots (snapshot_date, time_range, category, payload, computed_at)
  VALUES (
    v_today, '7d', 'users',
    jsonb_build_object(
      'kpis',          v_kpis,
      'signup_trend',  v_signup_trend,
      'top_buyers',    v_top_buyers
    ),
    now()
  )
  ON CONFLICT (snapshot_date, time_range, category) DO UPDATE
    SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;

  -- ════════════════════════════════════════════════════════════════════
  -- Users — mtd
  -- ════════════════════════════════════════════════════════════════════
  SELECT COUNT(*) INTO v_new_signups
    FROM public.users
   WHERE created_at >= v_mtd_start AND created_at < v_now;

  SELECT COUNT(*) INTO v_new_signups_prior
    FROM public.users
   WHERE created_at >= v_mtd_prior_start AND created_at < v_mtd_prior_end;

  SELECT COUNT(DISTINCT user_id) INTO v_active_users
    FROM public.lesson_progress
   WHERE viewed_at >= v_mtd_start AND viewed_at < v_now;

  SELECT COUNT(DISTINCT user_id) INTO v_active_users_prior
    FROM public.lesson_progress
   WHERE viewed_at >= v_mtd_prior_start AND viewed_at < v_mtd_prior_end;

  SELECT COUNT(*) INTO v_conv_denom
    FROM public.users
   WHERE role = 'learner'
     AND created_at >= v_mtd_start AND created_at < v_now;

  SELECT COUNT(DISTINCT u.id) INTO v_conv_num
    FROM public.users u
   WHERE u.role = 'learner'
     AND u.created_at >= v_mtd_start AND u.created_at < v_now
     AND EXISTS (
       SELECT 1 FROM public.orders o
        WHERE o.user_id = u.id
          AND o.status = 'active'
          AND o.confirmed_at >= v_mtd_start
          AND o.confirmed_at <  v_now
     );

  v_conv_rate := CASE WHEN v_conv_denom > 0
                      THEN ROUND(v_conv_num::numeric / v_conv_denom::numeric, 4)
                      ELSE 0
                 END;

  SELECT COUNT(*) INTO v_conv_denom_prior
    FROM public.users
   WHERE role = 'learner'
     AND created_at >= v_mtd_prior_start AND created_at < v_mtd_prior_end;

  SELECT COUNT(DISTINCT u.id) INTO v_conv_num_prior
    FROM public.users u
   WHERE u.role = 'learner'
     AND u.created_at >= v_mtd_prior_start AND u.created_at < v_mtd_prior_end
     AND EXISTS (
       SELECT 1 FROM public.orders o
        WHERE o.user_id = u.id
          AND o.status = 'active'
          AND o.confirmed_at >= v_mtd_prior_start
          AND o.confirmed_at <  v_mtd_prior_end
     );

  v_conv_rate_prior := CASE WHEN v_conv_denom_prior > 0
                            THEN ROUND(v_conv_num_prior::numeric / v_conv_denom_prior::numeric, 4)
                            ELSE NULL
                       END;

  v_kpis := jsonb_build_object(
    'new_signups',     jsonb_build_object('value', v_new_signups,  'delta_pct', public._analytics_delta_pct(v_new_signups,  v_new_signups_prior)),
    'active_users',    jsonb_build_object('value', v_active_users, 'delta_pct', public._analytics_delta_pct(v_active_users, v_active_users_prior)),
    'conversion_rate', jsonb_build_object(
      'value',         v_conv_rate,
      'numerator',     v_conv_num,
      'denominator',   v_conv_denom,
      'delta_pct',     CASE
                         WHEN v_conv_rate_prior IS NULL THEN NULL
                         WHEN v_conv_rate_prior = 0 AND v_conv_rate = 0 THEN 0
                         WHEN v_conv_rate_prior = 0 THEN NULL
                         ELSE round(((v_conv_rate - v_conv_rate_prior) / v_conv_rate_prior) * 100, 1)
                       END
    )
  );

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('bucket', to_char(d.day, 'YYYY-MM-DD'), 'value', COALESCE(s.value, 0))
           ORDER BY d.day
         ), '[]'::jsonb)
    INTO v_signup_trend
    FROM generate_series(
           date_trunc('day', v_mtd_start AT TIME ZONE 'Asia/Ho_Chi_Minh'),
           date_trunc('day', v_now       AT TIME ZONE 'Asia/Ho_Chi_Minh'),
           interval '1 day'
         ) AS d(day)
    LEFT JOIN (
      SELECT date_trunc('day', created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS day,
             COUNT(*)::bigint AS value
        FROM public.users
       WHERE created_at >= v_mtd_start
         AND created_at <  v_now
       GROUP BY 1
    ) s ON s.day = d.day;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'user_id',     t.user_id,
             'name',        t.display_name,
             'spend',       t.spend,
             'order_count', t.order_count
           )
           ORDER BY t.spend DESC, t.user_id ASC
         ), '[]'::jsonb)
    INTO v_top_buyers
    FROM (
      SELECT o.user_id,
             COALESCE(u.name, u.email) AS display_name,
             SUM(o.amount)::bigint     AS spend,
             COUNT(*)::bigint          AS order_count
        FROM public.orders o
        JOIN public.users  u ON u.id = o.user_id
       WHERE o.status = 'active'
         AND o.confirmed_at >= v_mtd_start
         AND o.confirmed_at <  v_now
       GROUP BY o.user_id, u.name, u.email
       ORDER BY spend DESC, o.user_id ASC
       LIMIT 10
    ) t;

  INSERT INTO public.analytics_snapshots (snapshot_date, time_range, category, payload, computed_at)
  VALUES (
    v_today, 'mtd', 'users',
    jsonb_build_object(
      'kpis',          v_kpis,
      'signup_trend',  v_signup_trend,
      'top_buyers',    v_top_buyers
    ),
    now()
  )
  ON CONFLICT (snapshot_date, time_range, category) DO UPDATE
    SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;

  -- ════════════════════════════════════════════════════════════════════
  -- Users — last_month
  -- ════════════════════════════════════════════════════════════════════
  SELECT COUNT(*) INTO v_new_signups
    FROM public.users
   WHERE created_at >= v_last_month_start AND created_at < v_last_month_end;

  SELECT COUNT(*) INTO v_new_signups_prior
    FROM public.users
   WHERE created_at >= v_prev_prev_start AND created_at < v_prev_prev_end;

  SELECT COUNT(DISTINCT user_id) INTO v_active_users
    FROM public.lesson_progress
   WHERE viewed_at >= v_last_month_start AND viewed_at < v_last_month_end;

  SELECT COUNT(DISTINCT user_id) INTO v_active_users_prior
    FROM public.lesson_progress
   WHERE viewed_at >= v_prev_prev_start AND viewed_at < v_prev_prev_end;

  SELECT COUNT(*) INTO v_conv_denom
    FROM public.users
   WHERE role = 'learner'
     AND created_at >= v_last_month_start AND created_at < v_last_month_end;

  SELECT COUNT(DISTINCT u.id) INTO v_conv_num
    FROM public.users u
   WHERE u.role = 'learner'
     AND u.created_at >= v_last_month_start AND u.created_at < v_last_month_end
     AND EXISTS (
       SELECT 1 FROM public.orders o
        WHERE o.user_id = u.id
          AND o.status = 'active'
          AND o.confirmed_at >= v_last_month_start
          AND o.confirmed_at <  v_last_month_end
     );

  v_conv_rate := CASE WHEN v_conv_denom > 0
                      THEN ROUND(v_conv_num::numeric / v_conv_denom::numeric, 4)
                      ELSE 0
                 END;

  SELECT COUNT(*) INTO v_conv_denom_prior
    FROM public.users
   WHERE role = 'learner'
     AND created_at >= v_prev_prev_start AND created_at < v_prev_prev_end;

  SELECT COUNT(DISTINCT u.id) INTO v_conv_num_prior
    FROM public.users u
   WHERE u.role = 'learner'
     AND u.created_at >= v_prev_prev_start AND u.created_at < v_prev_prev_end
     AND EXISTS (
       SELECT 1 FROM public.orders o
        WHERE o.user_id = u.id
          AND o.status = 'active'
          AND o.confirmed_at >= v_prev_prev_start
          AND o.confirmed_at <  v_prev_prev_end
     );

  v_conv_rate_prior := CASE WHEN v_conv_denom_prior > 0
                            THEN ROUND(v_conv_num_prior::numeric / v_conv_denom_prior::numeric, 4)
                            ELSE NULL
                       END;

  v_kpis := jsonb_build_object(
    'new_signups',     jsonb_build_object('value', v_new_signups,  'delta_pct', public._analytics_delta_pct(v_new_signups,  v_new_signups_prior)),
    'active_users',    jsonb_build_object('value', v_active_users, 'delta_pct', public._analytics_delta_pct(v_active_users, v_active_users_prior)),
    'conversion_rate', jsonb_build_object(
      'value',         v_conv_rate,
      'numerator',     v_conv_num,
      'denominator',   v_conv_denom,
      'delta_pct',     CASE
                         WHEN v_conv_rate_prior IS NULL THEN NULL
                         WHEN v_conv_rate_prior = 0 AND v_conv_rate = 0 THEN 0
                         WHEN v_conv_rate_prior = 0 THEN NULL
                         ELSE round(((v_conv_rate - v_conv_rate_prior) / v_conv_rate_prior) * 100, 1)
                       END
    )
  );

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('bucket', to_char(d.day, 'YYYY-MM-DD'), 'value', COALESCE(s.value, 0))
           ORDER BY d.day
         ), '[]'::jsonb)
    INTO v_signup_trend
    FROM generate_series(
           date_trunc('day', v_last_month_start AT TIME ZONE 'Asia/Ho_Chi_Minh'),
           date_trunc('day', (v_last_month_end - interval '1 day') AT TIME ZONE 'Asia/Ho_Chi_Minh'),
           interval '1 day'
         ) AS d(day)
    LEFT JOIN (
      SELECT date_trunc('day', created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS day,
             COUNT(*)::bigint AS value
        FROM public.users
       WHERE created_at >= v_last_month_start
         AND created_at <  v_last_month_end
       GROUP BY 1
    ) s ON s.day = d.day;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'user_id',     t.user_id,
             'name',        t.display_name,
             'spend',       t.spend,
             'order_count', t.order_count
           )
           ORDER BY t.spend DESC, t.user_id ASC
         ), '[]'::jsonb)
    INTO v_top_buyers
    FROM (
      SELECT o.user_id,
             COALESCE(u.name, u.email) AS display_name,
             SUM(o.amount)::bigint     AS spend,
             COUNT(*)::bigint          AS order_count
        FROM public.orders o
        JOIN public.users  u ON u.id = o.user_id
       WHERE o.status = 'active'
         AND o.confirmed_at >= v_last_month_start
         AND o.confirmed_at <  v_last_month_end
       GROUP BY o.user_id, u.name, u.email
       ORDER BY spend DESC, o.user_id ASC
       LIMIT 10
    ) t;

  INSERT INTO public.analytics_snapshots (snapshot_date, time_range, category, payload, computed_at)
  VALUES (
    v_today, 'last_month', 'users',
    jsonb_build_object(
      'kpis',          v_kpis,
      'signup_trend',  v_signup_trend,
      'top_buyers',    v_top_buyers
    ),
    now()
  )
  ON CONFLICT (snapshot_date, time_range, category) DO UPDATE
    SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;

  -- ════════════════════════════════════════════════════════════════════
  -- Users — all_time (no delta; monthly trend buckets)
  -- ════════════════════════════════════════════════════════════════════
  SELECT COUNT(*) INTO v_new_signups
    FROM public.users;

  SELECT COUNT(DISTINCT user_id) INTO v_active_users
    FROM public.lesson_progress;

  SELECT COUNT(*) INTO v_conv_denom
    FROM public.users
   WHERE role = 'learner';

  SELECT COUNT(DISTINCT u.id) INTO v_conv_num
    FROM public.users u
   WHERE u.role = 'learner'
     AND EXISTS (
       SELECT 1 FROM public.orders o
        WHERE o.user_id = u.id
          AND o.status = 'active'
     );

  v_conv_rate := CASE WHEN v_conv_denom > 0
                      THEN ROUND(v_conv_num::numeric / v_conv_denom::numeric, 4)
                      ELSE 0
                 END;

  v_kpis := jsonb_build_object(
    'new_signups',     jsonb_build_object('value', v_new_signups,  'delta_pct', NULL),
    'active_users',    jsonb_build_object('value', v_active_users, 'delta_pct', NULL),
    'conversion_rate', jsonb_build_object(
      'value',         v_conv_rate,
      'numerator',     v_conv_num,
      'denominator',   v_conv_denom,
      'delta_pct',     NULL
    )
  );

  -- all_time signup trend: monthly buckets (mirrors all_time revenue_trend).
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('bucket', to_char(d.day, 'YYYY-MM'), 'value', COALESCE(s.value, 0))
           ORDER BY d.day
         ), '[]'::jsonb)
    INTO v_signup_trend
    FROM (
      SELECT day::date AS day
        FROM generate_series(
          (SELECT date_trunc('month', MIN(created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')
             FROM public.users),
          date_trunc('month', v_now AT TIME ZONE 'Asia/Ho_Chi_Minh'),
          interval '1 month'
        ) AS day
    ) d
    LEFT JOIN (
      SELECT date_trunc('month', created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
             COUNT(*)::bigint AS value
        FROM public.users
       GROUP BY 1
    ) s ON s.day = d.day;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'user_id',     t.user_id,
             'name',        t.display_name,
             'spend',       t.spend,
             'order_count', t.order_count
           )
           ORDER BY t.spend DESC, t.user_id ASC
         ), '[]'::jsonb)
    INTO v_top_buyers
    FROM (
      SELECT o.user_id,
             COALESCE(u.name, u.email) AS display_name,
             SUM(o.amount)::bigint     AS spend,
             COUNT(*)::bigint          AS order_count
        FROM public.orders o
        JOIN public.users  u ON u.id = o.user_id
       WHERE o.status = 'active'
       GROUP BY o.user_id, u.name, u.email
       ORDER BY spend DESC, o.user_id ASC
       LIMIT 10
    ) t;

  INSERT INTO public.analytics_snapshots (snapshot_date, time_range, category, payload, computed_at)
  VALUES (
    v_today, 'all_time', 'users',
    jsonb_build_object(
      'kpis',          v_kpis,
      'signup_trend',  v_signup_trend,
      'top_buyers',    v_top_buyers
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
  'Writes / upserts the daily analytics_snapshots rows. Slice 4 (migration '
  '077) extends the Financial + Content body with the four category=''users'' '
  'range rows (KPIs: new_signups / active_users / conversion_rate; '
  'signup_trend — daily buckets for 7d/mtd/last_month, monthly for all_time; '
  'top_buyers — top 10 by SUM(orders.amount) DESC tie-break user_id ASC, '
  'status=''active'' refund-exclusion). Idempotent via PK upsert. '
  'SECURITY DEFINER so both pg_cron (null auth.uid) and admin callers can write.';

COMMIT;
