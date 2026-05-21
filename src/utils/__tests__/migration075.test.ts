import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// Migration 075 — Slice 2 of PRD-0008 (issue #329): extend the Financial
// snapshot payload with revenue_trend + top_courses + top_creators.
//
// Static-content checks on the migration SQL — same pattern as
// migration074.test.ts.

const MIGRATIONS_DIR = join(__dirname, '../../../supabase/migrations')

function readMigration(name: string): string {
  const path = join(MIGRATIONS_DIR, name)
  if (!existsSync(path)) throw new Error(`Migration not found: ${name}`)
  return readFileSync(path, 'utf-8')
}

function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map(line => line.replace(/--.*$/, ''))
    .join('\n')
}

describe('Migration 075 — analytics_snapshots financial trend + leaderboards', () => {
  let sql: string
  let codeOnly: string

  beforeAll(() => {
    sql = readMigration('075_analytics_financial_charts.sql')
    codeOnly = stripSqlComments(sql)
  })

  it('CREATE OR REPLACEs compute_analytics_snapshot (does NOT edit migration 074)', () => {
    expect(codeOnly).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.compute_analytics_snapshot\s*\(\s*force_now\s+boolean\s+DEFAULT\s+false\s*\)/i
    )
    expect(codeOnly).toMatch(/RETURNS\s+void/i)
    expect(codeOnly).toMatch(/SECURITY\s+DEFINER/i)
  })

  it('preserves the admin gate (null auth.uid passes; non-admin caller raises 42501)', () => {
    expect(codeOnly).toMatch(/auth\.uid\(\)/i)
    expect(codeOnly).toMatch(/IS\s+NOT\s+NULL[\s\S]*?role\s*=\s*'admin'/i)
    expect(codeOnly).toMatch(/RAISE\s+EXCEPTION[\s\S]*?42501/i)
  })

  it('upserts on the (snapshot_date, time_range, category) PK', () => {
    expect(codeOnly).toMatch(
      /ON\s+CONFLICT\s*\(\s*snapshot_date\s*,\s*time_range\s*,\s*category\s*\)\s+DO\s+UPDATE/i
    )
  })

  it('writes payload.revenue_trend, payload.top_courses, payload.top_creators for every financial row', () => {
    // The jsonb_build_object call in each INSERT must include all three keys.
    // Count occurrences — one per range × one per INSERT block = 4.
    const trendInserts = codeOnly.match(/'revenue_trend'\s*,\s*v_trend/gi) ?? []
    expect(trendInserts.length).toBe(4)
    const coursesInserts = codeOnly.match(/'top_courses'\s*,\s*v_top_courses/gi) ?? []
    expect(coursesInserts.length).toBe(4)
    const creatorsInserts = codeOnly.match(/'top_creators'\s*,\s*v_top_creators/gi) ?? []
    expect(creatorsInserts.length).toBe(4)
  })

  it('uses daily buckets (YYYY-MM-DD via to_char + generate_series day) for 7d / mtd / last_month', () => {
    expect(codeOnly).toMatch(/to_char\([^)]+,\s*'YYYY-MM-DD'\)/i)
    expect(codeOnly).toMatch(/generate_series\([\s\S]*?interval\s+'1 day'/i)
  })

  it('uses monthly buckets (YYYY-MM via to_char + generate_series month) for all_time', () => {
    expect(codeOnly).toMatch(/to_char\([^)]+,\s*'YYYY-MM'\)/i)
    expect(codeOnly).toMatch(/generate_series\([\s\S]*?interval\s+'1 month'/i)
  })

  it('LEFT JOINs trend buckets against orders so empty days/months show as 0', () => {
    expect(codeOnly).toMatch(/LEFT\s+JOIN/i)
    expect(codeOnly).toMatch(/COALESCE\(\s*o\.value\s*,\s*0\s*\)/i)
  })

  it('top_creators ranks by SUM(creator_payout_amount), NOT SUM(amount)', () => {
    // Each top_creators subquery selects SUM(creator_payout_amount) — the
    // critical CONTEXT.md "Leaderboards" rule.
    const matches = codeOnly.match(/SUM\(\s*o\.creator_payout_amount\s*\)/gi) ?? []
    // 4 ranges = 4 occurrences.
    expect(matches.length).toBe(4)
  })

  it('top_courses ranks by SUM(amount) (gross learner-paid revenue)', () => {
    const matches = codeOnly.match(/SUM\(\s*o\.amount\s*\)::bigint\s+AS\s+revenue/gi) ?? []
    // 4 ranges = 4 occurrences.
    expect(matches.length).toBe(4)
  })

  it('caps top_courses and top_creators at 10 rows each', () => {
    const limits = codeOnly.match(/LIMIT\s+10/gi) ?? []
    // 4 ranges × 2 leaderboards = 8 LIMIT 10 occurrences.
    expect(limits.length).toBe(8)
  })

  it('breaks ties deterministically by course_id / creator_id ASC', () => {
    expect(codeOnly).toMatch(/ORDER\s+BY\s+revenue\s+DESC\s*,\s*o\.course_id\s+ASC/i)
    expect(codeOnly).toMatch(/ORDER\s+BY\s+payout\s+DESC\s*,\s*c\.creator_id\s+ASC/i)
  })

  it('filters all chart + leaderboard queries to status=active + confirmed_at range', () => {
    // Every chart/leaderboard subquery must include status='active'.
    // Migration 074's KPI block already asserts this; we re-assert here for
    // the new trend / leaderboard subqueries.
    expect(codeOnly).toMatch(/status\s*=\s*'active'/i)
    expect(codeOnly).toMatch(/confirmed_at/i)
  })

  it('joins orders → courses → users to resolve creator name for top_creators', () => {
    expect(codeOnly).toMatch(/JOIN\s+public\.courses\s+c\s+ON\s+c\.id\s*=\s*o\.course_id/i)
    expect(codeOnly).toMatch(/JOIN\s+public\.users\s+u\s+ON\s+u\.id\s*=\s*c\.creator_id/i)
  })

  it('bucket aggregation uses Asia/Ho_Chi_Minh for day boundaries', () => {
    expect(codeOnly).toMatch(/AT\s+TIME\s+ZONE\s+'Asia\/Ho_Chi_Minh'/i)
  })

  it('emits empty JSON array (not NULL) for empty trend / leaderboard', () => {
    // COALESCE(jsonb_agg(...), '[]'::jsonb) — three load-bearing sites.
    const empties = codeOnly.match(/COALESCE\(\s*jsonb_agg/gi) ?? []
    // 3 aggregates × 4 ranges = 12 occurrences.
    expect(empties.length).toBe(12)
  })

  it('wraps in BEGIN/COMMIT', () => {
    expect(sql).toMatch(/^\s*BEGIN\s*;/im)
    expect(sql).toMatch(/COMMIT\s*;\s*$/m)
  })
})
