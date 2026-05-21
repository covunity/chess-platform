import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// Migration 077 — Slice 4 of PRD-0008 (issue #331): Users section.
//
// Adds two pieces:
//   1. Indexes for the users-section queries: users.created_at (signups +
//      conversion denominator), lesson_progress.viewed_at (active users).
//   2. CREATE OR REPLACE compute_analytics_snapshot — preserves slice 3's
//      Financial + Content body, ADDS four `category='users'` writes (one
//      per range). Users payload: kpis (new_signups / active_users /
//      conversion_rate), signup_trend (daily for 7d/mtd/last_month, monthly
//      for all_time), top_buyers (sorted by spend, free claims naturally
//      land at zero).
//
// Static-content checks on the migration SQL — same pattern as the prior
// migration tests.

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

describe('Migration 077 — analytics_snapshots users section', () => {
  let sql: string
  let codeOnly: string

  beforeAll(() => {
    sql = readMigration('077_analytics_users_section.sql')
    codeOnly = stripSqlComments(sql)
  })

  // ── Indexes for the users-section queries ────────────────────────────────
  it('creates the users.created_at and lesson_progress.viewed_at indexes', () => {
    expect(codeOnly).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+users_created_at_idx[\s\S]*?ON\s+(public\.)?users\s*\(\s*created_at\s*\)/i
    )
    expect(codeOnly).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+lesson_progress_viewed_at_idx[\s\S]*?ON\s+(public\.)?lesson_progress\s*\(\s*viewed_at\s*\)/i
    )
  })

  // ── Compute RPC body ─────────────────────────────────────────────────────
  it('CREATE OR REPLACEs compute_analytics_snapshot (does NOT edit migrations 074 / 075 / 076)', () => {
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

  it('preserves slice-2 financial writes (revenue_trend / top_courses / top_creators × 4 ranges)', () => {
    const trendInserts = codeOnly.match(/'revenue_trend'\s*,\s*v_trend/gi) ?? []
    expect(trendInserts.length).toBe(4)
    const coursesInserts = codeOnly.match(/'top_courses'\s*,\s*v_top_courses/gi) ?? []
    expect(coursesInserts.length).toBe(4)
    const creatorsInserts = codeOnly.match(/'top_creators'\s*,\s*v_top_creators/gi) ?? []
    expect(creatorsInserts.length).toBe(4)
  })

  it('preserves slice-3 content writes (4 content rows: by_level / by_language / completion_top)', () => {
    const contentInserts = codeOnly.match(/'content'/gi) ?? []
    expect(contentInserts.length).toBeGreaterThanOrEqual(4)
    const byLevel = codeOnly.match(/'by_level'/gi) ?? []
    expect(byLevel.length).toBe(4)
    const byLang = codeOnly.match(/'by_language'/gi) ?? []
    expect(byLang.length).toBe(4)
    const completionTops = codeOnly.match(/'completion_top'\s*,\s*v_completion_top/gi) ?? []
    expect(completionTops.length).toBe(4)
  })

  // ── Users category writes ────────────────────────────────────────────────
  it("writes 4 category='users' rows (one per range) into analytics_snapshots", () => {
    const usersInserts = codeOnly.match(/'users'/gi) ?? []
    // At least 4 (one INSERT per range). Higher is fine — there may be extra
    // 'users' literals in identifiers (`public.users`) which we don't filter.
    expect(usersInserts.length).toBeGreaterThanOrEqual(4)
  })

  it('emits the three users KPI keys (new_signups / active_users / conversion_rate) in every users payload', () => {
    const newSignups = codeOnly.match(/'new_signups'/gi) ?? []
    const activeUsers = codeOnly.match(/'active_users'/gi) ?? []
    const conversionRate = codeOnly.match(/'conversion_rate'/gi) ?? []
    expect(newSignups.length).toBe(4)
    expect(activeUsers.length).toBe(4)
    expect(conversionRate.length).toBe(4)
  })

  it('new_signups uses COUNT(*) FROM users with NO role filter (CONTEXT.md "New signups")', () => {
    // Look for the new_signups SELECT — must hit users + created_at but
    // must NOT add a `role = '<x>'` predicate in the new_signups scan.
    // Anchor: "v_new_signups" followed by FROM users WHERE created_at IN range.
    expect(codeOnly).toMatch(
      /v_new_signups[\s\S]*?FROM\s+(public\.)?users[\s\S]*?WHERE\s+created_at/i
    )
    // The new_signups KPI body must not contain a role check immediately
    // around the COUNT(*) (other KPIs like the conversion denominator DO
    // include role = 'learner'). Heuristic: SELECT COUNT(*) INTO v_new_signups
    // followed by FROM users WHERE created_at >= v_..._start AND created_at <
    // ... with no role clause before the semicolon.
    const block = codeOnly.match(
      /SELECT\s+COUNT\(\*\)\s+INTO\s+v_new_signups[\s\S]*?;/gi
    ) ?? []
    expect(block.length).toBeGreaterThanOrEqual(4)
    for (const b of block) {
      expect(b).not.toMatch(/role\s*=/i)
    }
  })

  it('active_users counts DISTINCT user_id on lesson_progress.viewed_at IN range', () => {
    expect(codeOnly).toMatch(
      /v_active_users[\s\S]*?COUNT\(\s*DISTINCT\s+user_id\s*\)[\s\S]*?FROM\s+(public\.)?lesson_progress[\s\S]*?viewed_at/i
    )
  })

  it('conversion denominator: COUNT(*) users role=learner created_at IN range', () => {
    expect(codeOnly).toMatch(
      /v_conv_denom[\s\S]*?FROM\s+(public\.)?users[\s\S]*?role\s*=\s*'learner'[\s\S]*?created_at/i
    )
  })

  it("conversion numerator counts learners with at least one status='active' order in same range — free claims included (no amount filter)", () => {
    // Numerator: DISTINCT learners who also joined orders with status='active'
    // and confirmed_at IN range. There must be NO `amount > 0` clause in the
    // numerator scan, otherwise free claims are wrongly excluded.
    // Anchor on the `SELECT ... INTO v_conv_num` blocks (not the variable
    // declaration line which has no SELECT before the semicolon).
    const numeratorBlocks = codeOnly.match(
      /SELECT[\s\S]*?INTO\s+v_conv_num\b[\s\S]*?;/gi
    ) ?? []
    expect(numeratorBlocks.length).toBeGreaterThanOrEqual(4)
    for (const b of numeratorBlocks) {
      // Must reference orders + status='active' + confirmed_at (the all_time
      // block has no confirmed_at IN range — it covers the whole history).
      expect(b).toMatch(/orders/i)
      expect(b).toMatch(/status\s*=\s*'active'/i)
      // MUST NOT filter on amount > 0 — that would exclude free claims.
      expect(b).not.toMatch(/amount\s*>\s*0/i)
    }
  })

  it('emits signup_trend in every users payload (4 inserts)', () => {
    const trendInserts = codeOnly.match(/'signup_trend'\s*,\s*v_signup_trend/gi) ?? []
    expect(trendInserts.length).toBe(4)
  })

  it('signup trend uses daily buckets for 7d/mtd/last_month and monthly buckets for all_time', () => {
    // Same shape as the financial revenue_trend in migration 075 —
    // generate_series + LEFT JOIN with `date_trunc('day', ...)` for the
    // bounded ranges and `date_trunc('month', ...)` for all_time.
    expect(codeOnly).toMatch(
      /v_signup_trend[\s\S]*?generate_series[\s\S]*?date_trunc\(\s*'day'/i
    )
    expect(codeOnly).toMatch(
      /v_signup_trend[\s\S]*?date_trunc\(\s*'month'/i
    )
  })

  it('emits top_buyers in every users payload (4 inserts)', () => {
    const tb = codeOnly.match(/'top_buyers'\s*,\s*v_top_buyers/gi) ?? []
    expect(tb.length).toBe(4)
  })

  it("top_buyers: sorts by SUM(orders.amount) DESC, filters status='active', excludes refunded naturally, LIMIT 10", () => {
    // Must SUM(amount) (not amount > 0 filter), ORDER BY spend DESC,
    // tie-break user_id ASC, LIMIT 10. status='active' is the canonical
    // refund exclusion path (migration 058 flips refunded → no longer active).
    expect(codeOnly).toMatch(/SUM\(\s*o?\.?amount\s*\)/i)
    expect(codeOnly).toMatch(
      /v_top_buyers[\s\S]*?status\s*=\s*'active'[\s\S]*?confirmed_at/i
    )
    expect(codeOnly).toMatch(
      /v_top_buyers[\s\S]*?ORDER\s+BY\s+spend\s+DESC/i
    )
    expect(codeOnly).toMatch(/v_top_buyers[\s\S]*?LIMIT\s+10/i)
    // MUST NOT filter on `amount > 0` — free claimers are allowed to appear,
    // they just sort to the bottom because their spend = 0.
    const buyerBlocks = codeOnly.match(/v_top_buyers[\s\S]*?LIMIT\s+10[\s\S]*?\)/gi) ?? []
    expect(buyerBlocks.length).toBeGreaterThanOrEqual(4)
    for (const b of buyerBlocks) {
      expect(b).not.toMatch(/amount\s*>\s*0/i)
    }
  })

  it('upserts on the (snapshot_date, time_range, category) PK', () => {
    expect(codeOnly).toMatch(
      /ON\s+CONFLICT\s*\(\s*snapshot_date\s*,\s*time_range\s*,\s*category\s*\)\s+DO\s+UPDATE/i
    )
  })

  it('uses Asia/Ho_Chi_Minh for range bound computations', () => {
    expect(codeOnly).toMatch(/AT\s+TIME\s+ZONE\s+'Asia\/Ho_Chi_Minh'/i)
  })

  it('emits empty JSON arrays (not NULL) for empty signup_trend / top_buyers', () => {
    expect(codeOnly).toMatch(/COALESCE\(\s*jsonb_agg/i)
  })

  // ── 90-day retention sweep (PRD-0008 §3 "Snapshots older than 90 days are
  //    removed". Originally added in migration 074; must be carried forward
  //    by each CREATE OR REPLACE of the RPC body so cron + manual force_now
  //    keep pruning stale rows.) ─────────────────────────────────────────────
  it('runs a DELETE FROM analytics_snapshots for rows older than 90 days inside the RPC body', () => {
    // The DELETE must reference the snapshot_date < (now() - interval '90 days')
    // predicate. Comparison is against a date cast (snapshot_date is DATE).
    expect(codeOnly).toMatch(
      /DELETE\s+FROM\s+(public\.)?analytics_snapshots[\s\S]*?snapshot_date\s*<[\s\S]*?'90 days'/i
    )
  })

  it('wraps in BEGIN/COMMIT', () => {
    expect(sql).toMatch(/^\s*BEGIN\s*;/im)
    expect(sql).toMatch(/COMMIT\s*;\s*$/m)
  })
})
