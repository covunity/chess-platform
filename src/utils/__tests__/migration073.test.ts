import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// Migration 073 — Drop `pending_review` from the `course_status` enum
// (ADR-0008 cleanup). The migration performs the canonical Postgres
// enum-swap dance, but five RLS policies in migrations 007/008/009
// filter on `courses.status = 'published'` and Postgres blocks
// ALTER COLUMN TYPE while a policy references the column. The
// migration must therefore drop these policies before the swap and
// recreate them with identical bodies after.

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

const POLICIES_REFERENCING_COURSE_STATUS = [
  { policy: 'Published courses are publicly readable', table: 'courses' },
  { policy: 'Chapters of published courses are publicly readable', table: 'chapters' },
  { policy: 'Lessons of published courses are publicly readable', table: 'lessons' },
  { policy: 'Anyone can view published course enrollments count', table: 'enrollments' },
  { policy: 'Anyone can view visible comments', table: 'comments' },
] as const

describe('Migration 073 — drop pending_review from course_status', () => {
  let sql: string
  let codeOnly: string

  beforeAll(() => {
    sql = readMigration('073_drop_pending_review_course_status.sql')
    codeOnly = stripSqlComments(sql)
  })

  it('wraps the swap in a transaction', () => {
    expect(codeOnly).toMatch(/\bBEGIN\b/)
    expect(codeOnly).toMatch(/\bCOMMIT\b/)
  })

  it('moves any stray pending_review rows to draft before the cast', () => {
    expect(codeOnly).toMatch(
      /UPDATE\s+public\.courses[\s\S]*?SET\s+status\s*=\s*'draft'[\s\S]*?WHERE\s+status\s*=\s*'pending_review'/i
    )
  })

  it('drops the column default before the type swap', () => {
    expect(codeOnly).toMatch(/ALTER\s+TABLE\s+public\.courses\s+ALTER\s+COLUMN\s+status\s+DROP\s+DEFAULT/i)
  })

  it('performs the rename → create → swap → restore-default → drop dance', () => {
    expect(codeOnly).toMatch(/ALTER\s+TYPE\s+public\.course_status\s+RENAME\s+TO\s+course_status_old/i)
    expect(codeOnly).toMatch(
      /CREATE\s+TYPE\s+public\.course_status\s+AS\s+ENUM\s*\(\s*'draft'\s*,\s*'published'\s*\)/i
    )
    expect(codeOnly).toMatch(
      /ALTER\s+TABLE\s+public\.courses[\s\S]*?ALTER\s+COLUMN\s+status\s+TYPE\s+public\.course_status[\s\S]*?USING\s+status::text::public\.course_status/i
    )
    expect(codeOnly).toMatch(
      /ALTER\s+TABLE\s+public\.courses\s+ALTER\s+COLUMN\s+status\s+SET\s+DEFAULT\s+'draft'::public\.course_status/i
    )
    expect(codeOnly).toMatch(/DROP\s+TYPE\s+public\.course_status_old/i)
  })

  it('drops every RLS policy that references courses.status before the swap', () => {
    for (const { policy, table } of POLICIES_REFERENCING_COURSE_STATUS) {
      const dropRe = new RegExp(
        `DROP\\s+POLICY\\s+IF\\s+EXISTS\\s+"${policy}"\\s+ON\\s+public\\.${table}`,
        'i'
      )
      expect(codeOnly).toMatch(dropRe)
    }
  })

  it('recreates every dropped policy after the swap', () => {
    for (const { policy, table } of POLICIES_REFERENCING_COURSE_STATUS) {
      const createRe = new RegExp(
        `CREATE\\s+POLICY\\s+"${policy}"\\s+ON\\s+public\\.${table}`,
        'i'
      )
      expect(codeOnly).toMatch(createRe)
    }
  })

  it('orders DROP POLICY before ALTER COLUMN TYPE, and CREATE POLICY after it', () => {
    const alterTypeIdx = codeOnly.search(
      /ALTER\s+COLUMN\s+status\s+TYPE\s+public\.course_status/i
    )
    expect(alterTypeIdx).toBeGreaterThan(-1)

    for (const { policy, table } of POLICIES_REFERENCING_COURSE_STATUS) {
      const dropIdx = codeOnly.search(
        new RegExp(`DROP\\s+POLICY\\s+IF\\s+EXISTS\\s+"${policy}"\\s+ON\\s+public\\.${table}`, 'i')
      )
      const createIdx = codeOnly.search(
        new RegExp(`CREATE\\s+POLICY\\s+"${policy}"\\s+ON\\s+public\\.${table}`, 'i')
      )
      expect(dropIdx).toBeGreaterThan(-1)
      expect(createIdx).toBeGreaterThan(-1)
      expect(dropIdx).toBeLessThan(alterTypeIdx)
      expect(createIdx).toBeGreaterThan(alterTypeIdx)
    }
  })
})
