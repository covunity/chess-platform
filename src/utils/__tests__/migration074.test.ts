import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// Migration 074 — Slice 1 of PRD-0008: analytics_snapshots table + RLS +
// compute_analytics_snapshot RPC + pg_cron daily job + partial indexes for
// the Financial KPIs.
//
// This test file is a static-content check of the migration. It does not
// execute Postgres — the project ships SQL migration tests as pattern
// assertions against the file body, matching the pattern in migration070.test.ts.

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

describe('Migration 074 — analytics_snapshots foundation', () => {
  let sql: string
  let codeOnly: string
  beforeAll(() => {
    sql = readMigration('074_analytics_snapshots.sql')
    codeOnly = stripSqlComments(sql)
  })

  // ── Schema ─────────────────────────────────────────────────────────────
  it('creates analytics_snapshots with the exact CONTEXT.md schema', () => {
    expect(codeOnly).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.analytics_snapshots/i)
    expect(codeOnly).toMatch(/snapshot_date\s+date\s+NOT\s+NULL/i)
    expect(codeOnly).toMatch(/time_range\s+text\s+NOT\s+NULL/i)
    expect(codeOnly).toMatch(/category\s+text\s+NOT\s+NULL/i)
    expect(codeOnly).toMatch(/payload\s+jsonb\s+NOT\s+NULL/i)
    expect(codeOnly).toMatch(/computed_at\s+timestamptz\s+NOT\s+NULL\s+DEFAULT\s+now\(\)/i)
    expect(codeOnly).toMatch(
      /PRIMARY\s+KEY\s*\(\s*snapshot_date\s*,\s*time_range\s*,\s*category\s*\)/i
    )
  })

  it('encodes the CHECK constraint vocabulary from CONTEXT.md', () => {
    expect(codeOnly).toMatch(/CHECK\s*\(\s*time_range\s+IN\s*\(\s*'7d'\s*,\s*'mtd'\s*,\s*'last_month'\s*,\s*'all_time'\s*\)/i)
    expect(codeOnly).toMatch(/CHECK\s*\(\s*category\s+IN\s*\(\s*'financial'\s*,\s*'content'\s*,\s*'users'\s*\)/i)
  })

  // ── RLS ────────────────────────────────────────────────────────────────
  it('enables RLS and creates an admin-only SELECT policy', () => {
    expect(codeOnly).toMatch(/ALTER\s+TABLE\s+(public\.)?analytics_snapshots\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i)
    expect(codeOnly).toMatch(/CREATE\s+POLICY\s+analytics_snapshots_admin_select/i)
    expect(codeOnly).toMatch(/FOR\s+SELECT[\s\S]*?role\s*=\s*'admin'/i)
  })

  // ── Partial indexes on orders ──────────────────────────────────────────
  it('creates the three orders partial indexes the Financial KPIs need', () => {
    expect(codeOnly).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+orders_active_confirmed_at_idx[\s\S]*?confirmed_at[\s\S]*?WHERE\s+status\s*=\s*'active'/i
    )
    expect(codeOnly).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+orders_user_confirmed_idx[\s\S]*?user_id\s*,\s*confirmed_at[\s\S]*?WHERE\s+status\s*=\s*'active'/i
    )
    expect(codeOnly).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+orders_course_confirmed_idx[\s\S]*?course_id\s*,\s*confirmed_at[\s\S]*?WHERE\s+status\s*=\s*'active'/i
    )
  })

  // ── Compute RPC ────────────────────────────────────────────────────────
  it('defines compute_analytics_snapshot(force_now boolean DEFAULT false) RETURNS void as SECURITY DEFINER', () => {
    expect(codeOnly).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.compute_analytics_snapshot\s*\(\s*force_now\s+boolean\s+DEFAULT\s+false\s*\)/i
    )
    expect(codeOnly).toMatch(/RETURNS\s+void/i)
    expect(codeOnly).toMatch(/SECURITY\s+DEFINER/i)
    expect(codeOnly).toMatch(/SET\s+search_path\s*=\s*public/i)
  })

  it('admin gate allows null auth.uid() (pg_cron) and rejects non-admin', () => {
    // The guard pattern from the issue spec: pg_cron's null auth.uid() is allowed
    // (null caller skips the role check) but a logged-in non-admin caller raises
    // 42501. We assert the three load-bearing tokens are present together:
    //   1. an `IS NOT NULL` guard on auth.uid()/caller (so null cron caller passes)
    //   2. a role='admin' lookup
    //   3. an explicit 42501 raise
    expect(codeOnly).toMatch(/auth\.uid\(\)/i)
    expect(codeOnly).toMatch(/IS\s+NOT\s+NULL[\s\S]*?role\s*=\s*'admin'/i)
    expect(codeOnly).toMatch(/RAISE\s+EXCEPTION[\s\S]*?42501/i)
  })

  it('upserts on the (snapshot_date, time_range, category) primary key', () => {
    expect(codeOnly).toMatch(
      /ON\s+CONFLICT\s*\(\s*snapshot_date\s*,\s*time_range\s*,\s*category\s*\)\s+DO\s+UPDATE/i
    )
  })

  it('writes the four financial range rows in one RPC call', () => {
    // The compute RPC must produce a row for each of the four ranges with
    // category='financial'. We assert the literal range tags appear in the
    // RPC body so any rewrite preserves the contract.
    expect(codeOnly).toMatch(/'7d'/)
    expect(codeOnly).toMatch(/'mtd'/)
    expect(codeOnly).toMatch(/'last_month'/)
    expect(codeOnly).toMatch(/'all_time'/)
    expect(codeOnly).toMatch(/'financial'/)
  })

  it('excludes refunded + refund_pending orders from all financial sums', () => {
    // The Financial KPIs MUST exclude `status='refunded'` and
    // `status='refund_pending'`. The naive `status='active'` filter already
    // does this, but we want the migration to make the intent explicit so a
    // future refactor cannot accidentally let refunds in.
    expect(codeOnly).toMatch(/status\s*=\s*'active'/i)
  })

  it('uses confirmed_at (not created_at) as the bucketing timestamp', () => {
    // Per CONTEXT.md: revenue is counted when it actually lands.
    expect(codeOnly).toMatch(/confirmed_at/i)
  })

  it('counts free orders (amount=0) toward order_count but contributes 0 to money sums', () => {
    // The SUM(amount) is naturally 0 for free orders so COUNT(*) suffices.
    // Assert COUNT(*) over the same filter is used for order_count.
    expect(codeOnly).toMatch(/COUNT\s*\(\s*\*\s*\)/i)
    expect(codeOnly).toMatch(/SUM\s*\(\s*amount\s*\)/i)
    expect(codeOnly).toMatch(/SUM\s*\(\s*platform_fee_amount\s*\)/i)
    expect(codeOnly).toMatch(/SUM\s*\(\s*creator_payout_amount\s*\)/i)
  })

  it('schedules a pg_cron job named compute_analytics_snapshot_daily at 17:05 UTC (= 00:05 ICT)', () => {
    expect(codeOnly).toMatch(/cron\.schedule\s*\(\s*'compute_analytics_snapshot_daily'/i)
    // Supabase ships a pg_cron version that does not accept the
    // `CRON_TZ=` per-job prefix. We schedule in UTC instead: 00:05 ICT
    // = 17:05 UTC the previous day → expression `5 17 * * *`. The
    // snapshot's `snapshot_date` is computed inside the function via
    // `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`, so the ICT
    // calendar day is preserved regardless of cron's UTC firing time.
    expect(codeOnly).toMatch(/cron\.schedule\s*\([^)]*?'5\s+17\s+\*\s+\*\s+\*'/i)
    // CRON_TZ form must NOT appear (incompatible with shipped pg_cron).
    expect(codeOnly).not.toMatch(/CRON_TZ=/)
    // The ICT timezone string still appears in the function body via
    // AT TIME ZONE, so we keep an assertion that ICT is referenced.
    expect(codeOnly).toMatch(/Asia\/Ho_Chi_Minh/)
  })

  it('also enforces 90-day retention of analytics_snapshots rows', () => {
    expect(codeOnly).toMatch(/DELETE\s+FROM\s+(public\.)?analytics_snapshots/i)
    expect(codeOnly).toMatch(/snapshot_date\s*<[\s\S]*?'90 days'/i)
  })

  it('grants EXECUTE on the RPC to authenticated (so the manual refresh button works)', () => {
    expect(codeOnly).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(public\.)?compute_analytics_snapshot[\s\S]*?TO\s+authenticated/i)
  })

  it('wraps in BEGIN/COMMIT and is idempotent (CREATE OR REPLACE / IF NOT EXISTS / IF EXISTS)', () => {
    expect(sql).toMatch(/^\s*BEGIN\s*;/im)
    expect(sql).toMatch(/COMMIT\s*;\s*$/m)
    expect(codeOnly).toMatch(/CREATE\s+OR\s+REPLACE/i)
    expect(codeOnly).toMatch(/IF\s+NOT\s+EXISTS/i)
  })
})
