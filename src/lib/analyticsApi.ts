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

export interface FinancialPayload {
  kpis: FinancialKpis
  // Trend + leaderboards land in later slices; the type stays narrow until
  // the RPC actually populates them so consumers can't read undefined.
  revenue_trend?: Array<{ bucket: string; value: number }>
  top_courses?: Array<{ course_id: string; title: string; revenue: number }>
  top_creators?: Array<{ creator_id: string; name: string; revenue: number }>
}

export interface AnalyticsSnapshotRow {
  snapshot_date: string
  time_range: TimeRange
  category: AnalyticsCategory
  payload: FinancialPayload
  computed_at: string
}

export type FinancialSnapshotsByRange = Partial<Record<TimeRange, AnalyticsSnapshotRow>>

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
