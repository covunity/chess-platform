import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// Migration 076 — Slice 3 of PRD-0008 (issue #330): Content section.
//
// Adds two pieces:
//   1. `courses.published_at timestamptz` + a BEFORE UPDATE trigger that
//      stamps the FIRST `draft → published` transition only (idempotent on
//      subsequent withdraw/republish cycles). Backfill existing published
//      courses with `created_at` so historical data is sane.
//   2. CREATE OR REPLACE compute_analytics_snapshot — preserves slice 2's
//      Financial body, ADDS four `category='content'` writes (one per
//      range). Content payload: kpis (new_courses / published_courses /
//      total_enrollments), by_level, by_language, completion_top
//      (range-independent — same array duplicated across all four ranges
//      per ADR-0009).
//
// Static-content checks on the migration SQL — same pattern as
// migration074 / migration075 tests.

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

describe('Migration 076 — analytics_snapshots content section + courses.published_at', () => {
  let sql: string
  let codeOnly: string

  beforeAll(() => {
    sql = readMigration('076_analytics_content_section.sql')
    codeOnly = stripSqlComments(sql)
  })

  // ── courses.published_at column + trigger ────────────────────────────────
  it('adds courses.published_at timestamptz column idempotently', () => {
    expect(codeOnly).toMatch(
      /ALTER\s+TABLE\s+(public\.)?courses\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+published_at\s+timestamptz/i
    )
  })

  it('defines a BEFORE UPDATE trigger that stamps only the FIRST draft→published transition', () => {
    // Function body must guard `NEW.published_at IS NULL` so re-publishing
    // doesn't reset the timestamp. CONTEXT.md "Content metrics" + AC #A14.
    expect(codeOnly).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.enforce_course_first_published_at/i
    )
    expect(codeOnly).toMatch(
      /OLD\.status[\s\S]*?!=\s*'published'[\s\S]*?NEW\.status\s*=\s*'published'[\s\S]*?NEW\.published_at\s+IS\s+NULL/i
    )
    expect(codeOnly).toMatch(/NEW\.published_at\s*:=\s*now\(\)/i)
    expect(codeOnly).toMatch(
      /CREATE\s+TRIGGER\s+enforce_course_first_published_at[\s\S]*?BEFORE\s+UPDATE\s+ON\s+(public\.)?courses/i
    )
  })

  it('backfills existing published courses so historical data is sane', () => {
    expect(codeOnly).toMatch(
      /UPDATE\s+(public\.)?courses\s+SET\s+published_at\s*=\s*created_at[\s\S]*?WHERE\s+status\s*=\s*'published'[\s\S]*?published_at\s+IS\s+NULL/i
    )
  })

  // ── Indexes for the content section queries ──────────────────────────────
  it('creates the four content-section indexes (courses.created_at, courses.published_at, enrollments.enrolled_at, lesson_progress completed partial)', () => {
    expect(codeOnly).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+courses_created_at_idx[\s\S]*?ON\s+(public\.)?courses\s*\(\s*created_at\s*\)/i
    )
    expect(codeOnly).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+courses_published_at_idx[\s\S]*?ON\s+(public\.)?courses\s*\(\s*published_at\s*\)[\s\S]*?WHERE\s+published_at\s+IS\s+NOT\s+NULL/i
    )
    expect(codeOnly).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+enrollments_enrolled_at_idx[\s\S]*?ON\s+(public\.)?enrollments\s*\(\s*enrolled_at\s*\)/i
    )
    expect(codeOnly).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+lesson_progress_completed_idx[\s\S]*?WHERE\s+completed/i
    )
  })

  // ── Compute RPC body ─────────────────────────────────────────────────────
  it('CREATE OR REPLACEs compute_analytics_snapshot (does NOT edit migrations 074 / 075)', () => {
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

  // ── Content category writes ──────────────────────────────────────────────
  it("writes 4 category='content' rows (one per range) into analytics_snapshots", () => {
    const contentInserts = codeOnly.match(/'content'/gi) ?? []
    // 4 INSERT...VALUES (v_today, '<range>', 'content', ...) sites.
    expect(contentInserts.length).toBeGreaterThanOrEqual(4)
  })

  it('emits the three content KPI keys (new_courses / published_courses / total_enrollments) in every content payload', () => {
    const newCourses = codeOnly.match(/'new_courses'/gi) ?? []
    const publishedCourses = codeOnly.match(/'published_courses'/gi) ?? []
    const totalEnrollments = codeOnly.match(/'total_enrollments'/gi) ?? []
    expect(newCourses.length).toBe(4)
    expect(publishedCourses.length).toBe(4)
    expect(totalEnrollments.length).toBe(4)
  })

  it('content KPIs use the locked formulas: COUNT(*) courses created_at / published_at / enrollments enrolled_at', () => {
    // Tổng khoá học mới
    expect(codeOnly).toMatch(/FROM\s+(public\.)?courses[\s\S]*?WHERE\s+created_at/i)
    // Khoá publish trong kỳ
    expect(codeOnly).toMatch(/FROM\s+(public\.)?courses[\s\S]*?WHERE\s+published_at/i)
    // Lượt enrollment trong kỳ
    expect(codeOnly).toMatch(/FROM\s+(public\.)?enrollments[\s\S]*?WHERE\s+enrolled_at/i)
  })

  it('by_level groups by courses.level filtered to created_at IN range (4 inserts)', () => {
    const byLevel = codeOnly.match(/'by_level'/gi) ?? []
    expect(byLevel.length).toBe(4)
    // The aggregation must GROUP BY level.
    expect(codeOnly).toMatch(/GROUP\s+BY\s+level/i)
  })

  it('by_language groups by courses.language filtered to created_at IN range (4 inserts)', () => {
    const byLang = codeOnly.match(/'by_language'/gi) ?? []
    expect(byLang.length).toBe(4)
    expect(codeOnly).toMatch(/GROUP\s+BY\s+language/i)
  })

  it("completion_top: the SAME array is included in all 4 content rows (range-independent per ADR-0009)", () => {
    // The implementation should compute v_completion_top ONCE outside the
    // per-range blocks, then reference it in every content INSERT — exactly
    // 4 references to the variable in the INSERT contexts.
    const completionTops = codeOnly.match(/'completion_top'\s*,\s*v_completion_top/gi) ?? []
    expect(completionTops.length).toBe(4)
  })

  it('completion_top formula is lesson_progress.completed / lessons_in_course averaged across enrollments (no threshold)', () => {
    // Load-bearing tokens: it must reference lesson_progress, lessons,
    // enrollments, and NOT contain a HAVING COUNT(*) >= N enrollment-threshold
    // clause (the "no minimum enrollment threshold" rule from CONTEXT.md).
    expect(codeOnly).toMatch(/lesson_progress/i)
    expect(codeOnly).toMatch(/lessons/i)
    expect(codeOnly).toMatch(/enrollments/i)
    // No HAVING-style minimum-enrollee filter on the completion_top subquery.
    expect(codeOnly).not.toMatch(/HAVING\s+COUNT\([^)]+\)\s*>=?\s*\d+/i)
  })

  it('completion_top caps at top 10 and filters to published courses only', () => {
    // Per PRD §5.5 + CONTEXT.md.
    expect(codeOnly).toMatch(/LIMIT\s+10/i)
    expect(codeOnly).toMatch(/status\s*=\s*'published'/i)
  })

  it('upserts on the (snapshot_date, time_range, category) PK', () => {
    expect(codeOnly).toMatch(
      /ON\s+CONFLICT\s*\(\s*snapshot_date\s*,\s*time_range\s*,\s*category\s*\)\s+DO\s+UPDATE/i
    )
  })

  it('uses Asia/Ho_Chi_Minh for range bound computations', () => {
    expect(codeOnly).toMatch(/AT\s+TIME\s+ZONE\s+'Asia\/Ho_Chi_Minh'/i)
  })

  it('emits empty JSON arrays (not NULL) for empty by_level / by_language / completion_top', () => {
    expect(codeOnly).toMatch(/COALESCE\(\s*jsonb_agg/i)
  })

  it('wraps in BEGIN/COMMIT', () => {
    expect(sql).toMatch(/^\s*BEGIN\s*;/im)
    expect(sql).toMatch(/COMMIT\s*;\s*$/m)
  })
})
