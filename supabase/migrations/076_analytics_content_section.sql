-- Migration 076 — Slice 3 of PRD-0008 (issue #330): Content section.
--
-- Two pieces ship in this migration:
--
-- 1. `courses.published_at timestamptz` + a BEFORE UPDATE trigger that
--    stamps the FIRST draft→published transition only. Re-publishing a
--    course that was withdrawn back to draft does NOT reset
--    `published_at` — the metric represents "first reached the catalog",
--    not "currently live". Acceptance test A14 in PRD-0008.
--    Existing `status='published'` rows are backfilled with `created_at`
--    so historical data is sane.
--
-- 2. CREATE OR REPLACE `compute_analytics_snapshot(boolean)` — preserves
--    the slice-2 Financial body verbatim, then ADDS four
--    `category='content'` upserts (one per range). The content payload
--    per CONTEXT.md "payload shape (category='content')":
--      • kpis.new_courses       — COUNT(*) FROM courses     WHERE created_at  IN range
--      • kpis.published_courses — COUNT(*) FROM courses     WHERE published_at IN range
--      • kpis.total_enrollments — COUNT(*) FROM enrollments WHERE enrolled_at IN range
--      • by_level     — courses GROUP BY level     filtered to created_at IN range
--      • by_language  — courses GROUP BY language  filtered to created_at IN range
--      • completion_top — top 10 published courses by average lesson-completion
--                         rate. RANGE-INDEPENDENT — the same array is duplicated
--                         across all four range rows per ADR-0009. No minimum
--                         enrollment threshold (CONTEXT.md "Completion-rate
--                         bar chart" decision: early-stage admins want to see
--                         the real picture even when a course has 1 enrollee).
--
-- Per the project pattern (migrations 060/061/075) — we DO NOT edit prior
-- migrations. CREATE OR REPLACE on the RPC fully supersedes the slice-2
-- body. Indexes use IF NOT EXISTS so a fresh `db push` runs cleanly.
--
-- Reference: PRD-0008 §4 P2 (US2.1–US2.3), §5.4, §5.5, ADR-0009 (snapshot
-- duplication rule), CONTEXT.md "Content metrics" + "Completion-rate bar
-- chart" + "Indexes added for analytics", issue #330.

BEGIN;

-- ── 1. courses.published_at column ──────────────────────────────────────
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

COMMENT ON COLUMN public.courses.published_at IS
  'Timestamp of the FIRST time this course transitioned draft → published. '
  'Set by the enforce_course_first_published_at BEFORE UPDATE trigger. '
  'Subsequent withdraw / republish cycles do NOT reset it — the column '
  'tracks "first reached the catalog", not "currently live". For currently '
  'live courses, query status=''published'' directly.';

-- ── 2. enforce_course_first_published_at trigger ────────────────────────
-- Stamps `now()` the first time a course transitions to 'published'. The
-- `NEW.published_at IS NULL` guard makes the function idempotent across
-- subsequent withdraw → republish cycles — a course's `published_at` is
-- written exactly once over its lifetime.
CREATE OR REPLACE FUNCTION public.enforce_course_first_published_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status != 'published'
     AND NEW.status = 'published'
     AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_course_first_published_at ON public.courses;
CREATE TRIGGER enforce_course_first_published_at
  BEFORE UPDATE ON public.courses
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_course_first_published_at();

-- ── 3. Backfill existing published rows ──────────────────────────────────
-- For courses that were already 'published' before this migration, stamp
-- `published_at = created_at` so analytics queries don't undercount the
-- catalog. Future transitions go through the trigger.
UPDATE public.courses
   SET published_at = created_at
 WHERE status = 'published'
   AND published_at IS NULL;

-- ── 4. Indexes for the content-section queries ───────────────────────────
-- Per CONTEXT.md "Indexes added for analytics". `courses_published_at_idx`
-- is a partial index — most courses sit in `draft` for some time, and the
-- analytics queries only need rows where the timestamp has fired.
-- `lesson_progress_completed_idx` is also partial so it only carries the
-- rows the completion_top aggregation actually scans.
CREATE INDEX IF NOT EXISTS courses_created_at_idx
  ON public.courses (created_at);

CREATE INDEX IF NOT EXISTS courses_published_at_idx
  ON public.courses (published_at)
  WHERE published_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS enrollments_enrolled_at_idx
  ON public.enrollments (enrolled_at);

CREATE INDEX IF NOT EXISTS lesson_progress_completed_idx
  ON public.lesson_progress (course_id, user_id)
  WHERE completed;

-- ── 5. compute_analytics_snapshot RPC — extended with content writes ─────
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
  -- Per CONTEXT.md "Completion-rate bar chart" + ADR-0009 duplication rule:
  -- the top-10 list is a property of the course, not the period. We compute
  -- it once and embed the same array in all four content range rows.
  --
  -- Formula: for each published course, average (per-enrollee) the ratio
  --   completed_lessons_for_enrollee / total_lessons_in_course
  -- across that course's enrollments. Total-lessons-in-course is a scalar
  -- per course; per-enrollee numerator is the count of `lesson_progress`
  -- rows where `completed = true` for that user × course.
  --
  -- NO minimum enrollment threshold — courses with 1 enrollee still
  -- appear (the CONTEXT.md decision).
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

  -- ── 90-day retention ────────────────────────────────────────────────
  DELETE FROM public.analytics_snapshots
   WHERE snapshot_date < (now() - interval '90 days')::date;
END;
$$;

COMMENT ON FUNCTION public.compute_analytics_snapshot(boolean) IS
  'Writes / upserts the daily analytics_snapshots rows. Slice 3 (migration '
  '076) extends the Financial body with the four category=''content'' range '
  'rows (KPIs: new_courses / published_courses / total_enrollments; '
  'distribution: by_level + by_language; completion_top — range-independent, '
  'same array on all four range rows per ADR-0009). Idempotent via PK upsert. '
  'SECURITY DEFINER so both pg_cron (null auth.uid) and admin callers can write.';

COMMIT;
