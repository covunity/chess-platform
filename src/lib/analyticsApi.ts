import type { SupabaseClient } from '@supabase/supabase-js'

// ── Domain types ────────────────────────────────────────────────────────────
// These mirror the JSONB payload shapes defined in CONTEXT.md
// ("analytics_snapshots schema" → "payload shape"). The DB layer is
// loose-typed (JSONB); the TypeScript surface here is what every consumer
// (page, leaderboard, chart) sees.

export type TimeRange = '7d' | 'mtd' | 'last_month' | 'all_time'
export type AnalyticsCategory = 'financial' | 'content' | 'users'

export interface KpiValue {
  value: number
  /** Percent change vs the comparable prior period.
   *  NULL when prior period is undefined (all_time) or undefined-by-zero. */
  delta_pct: number | null
}

export interface FinancialKpis {
  revenue: KpiValue
  order_count: KpiValue
  platform_fee: KpiValue
  creator_payout: KpiValue
}

export interface RevenueTrendPoint {
  /** ISO bucket key — `YYYY-MM-DD` for daily ranges (7d / mtd / last_month),
   *  `YYYY-MM` for the monthly all_time range. The frontend renders this
   *  string as-is on the X axis; it does not parse + reformat. */
  bucket: string
  value: number
}

export interface TopCourseRow {
  course_id: string
  title: string
  revenue: number
}

export interface TopCreatorRow {
  creator_id: string
  name: string
  /** SUM(orders.creator_payout_amount) — what the creator actually earns,
   *  not gross learner-paid amount. See CONTEXT.md "Leaderboards" notes. */
  revenue: number
}

export interface FinancialPayload {
  kpis: FinancialKpis
  /** Daily for 7d/mtd/last_month, monthly for all_time. Buckets are
   *  precomputed by the RPC so the FE never aggregates client-side. */
  revenue_trend?: RevenueTrendPoint[]
  top_courses?: TopCourseRow[]
  top_creators?: TopCreatorRow[]
}

// ── Content category ───────────────────────────────────────────────────────
// Mirrors the `category='content'` payload defined in CONTEXT.md
// ("payload shape" → "category = 'content'"). The three KPIs are
// period-bounded by the selected range; `completion_top` is range-independent
// (the same array is duplicated across all four range rows per ADR-0009).

export interface ContentKpis {
  /** COUNT(*) FROM courses WHERE created_at IN range */
  new_courses: KpiValue
  /** COUNT(*) FROM courses WHERE published_at IN range */
  published_courses: KpiValue
  /** COUNT(*) FROM enrollments WHERE enrolled_at IN range */
  total_enrollments: KpiValue
}

/** Bucket row for the "by level" donut chart. `level` is the
 *  `course_level` enum from migration 003 (beginner / intermediate /
 *  advanced). The donut groups raw `courses` rows filtered to
 *  `created_at IN range`. */
export interface LevelBucketRow {
  level: 'beginner' | 'intermediate' | 'advanced'
  count: number
}

/** Bucket row for the "by language" pie chart. `language` is the
 *  `courses.language` check-constraint value (`vi` or `en`). */
export interface LanguageBucketRow {
  language: 'vi' | 'en'
  count: number
}

/** A row in the top-10 completion bar chart. `completion_rate` is the
 *  per-course average of (completed lessons / total lessons) across
 *  all enrollments of that course — see CONTEXT.md "Completion-rate
 *  bar chart". No minimum-enrollment threshold is applied. */
export interface CompletionRow {
  course_id: string
  title: string
  /** 0..1 ratio. UI multiplies by 100 + formats with one decimal. */
  completion_rate: number
  enrollment_count: number
}

export interface ContentPayload {
  kpis: ContentKpis
  by_level?: LevelBucketRow[]
  by_language?: LanguageBucketRow[]
  /** Range-independent — duplicated across all four range rows per ADR-0009. */
  completion_top?: CompletionRow[]
}

export interface AnalyticsSnapshotRow {
  snapshot_date: string
  time_range: TimeRange
  category: AnalyticsCategory
  payload: FinancialPayload
  computed_at: string
}

export interface ContentSnapshotRow {
  snapshot_date: string
  time_range: TimeRange
  category: AnalyticsCategory
  payload: ContentPayload
  computed_at: string
}

export type FinancialSnapshotsByRange = Partial<Record<TimeRange, AnalyticsSnapshotRow>>
export type ContentSnapshotsByRange = Partial<Record<TimeRange, ContentSnapshotRow>>

// ── fetchLatestFinancialSnapshots ───────────────────────────────────────────
// Returns the four Financial snapshot rows for the most recent snapshot_date
// available, keyed by `time_range` so the page can read them by selector.
//
// RLS on `analytics_snapshots` (migration 074) gates SELECT to admins, so a
// non-admin caller transparently sees `{}` here.
export async function fetchLatestFinancialSnapshots(
  client: SupabaseClient
): Promise<{ snapshots: FinancialSnapshotsByRange; error: Error | null }> {
  const { data, error } = await client
    .from('analytics_snapshots')
    .select('snapshot_date, time_range, category, payload, computed_at')
    .eq('category', 'financial')
    .order('snapshot_date', { ascending: false })

  if (error) {
    return { snapshots: {}, error: error as Error }
  }

  const rows = (data ?? []) as AnalyticsSnapshotRow[]
  if (rows.length === 0) {
    return { snapshots: {}, error: null }
  }

  // Pick the rows whose snapshot_date equals the latest date in the result.
  // The ORDER BY desc above guarantees rows[0].snapshot_date is the max.
  const latest = rows[0].snapshot_date
  const snapshots: FinancialSnapshotsByRange = {}
  for (const row of rows) {
    if (row.snapshot_date !== latest) continue
    snapshots[row.time_range] = row
  }
  return { snapshots, error: null }
}

// ── fetchLatestContentSnapshots ─────────────────────────────────────────────
// Mirror of `fetchLatestFinancialSnapshots` for the `category='content'`
// rows. Returns the four content snapshot rows for the most recent
// snapshot_date available, keyed by `time_range`.
//
// RLS on `analytics_snapshots` (migration 074) gates SELECT to admins, so a
// non-admin caller transparently sees `{}` here.
export async function fetchLatestContentSnapshots(
  client: SupabaseClient
): Promise<{ snapshots: ContentSnapshotsByRange; error: Error | null }> {
  const { data, error } = await client
    .from('analytics_snapshots')
    .select('snapshot_date, time_range, category, payload, computed_at')
    .eq('category', 'content')
    .order('snapshot_date', { ascending: false })

  if (error) {
    return { snapshots: {}, error: error as Error }
  }

  const rows = (data ?? []) as ContentSnapshotRow[]
  if (rows.length === 0) {
    return { snapshots: {}, error: null }
  }

  const latest = rows[0].snapshot_date
  const snapshots: ContentSnapshotsByRange = {}
  for (const row of rows) {
    if (row.snapshot_date !== latest) continue
    snapshots[row.time_range] = row
  }
  return { snapshots, error: null }
}

// ── recomputeAnalyticsSnapshot ──────────────────────────────────────────────
// Calls the admin-only RPC that upserts today's snapshot rows. Invoked by the
// "Làm mới" button. The 30-second client-side cooldown lives in the page, not
// here — the RPC itself is idempotent (UPSERT) per ADR-0009.
export async function recomputeAnalyticsSnapshot(
  client: SupabaseClient
): Promise<{ error: Error | null }> {
  const { error } = await client.rpc('compute_analytics_snapshot', { force_now: true })
  return { error: (error as Error) ?? null }
}
