import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const MIGRATIONS_DIR = join(__dirname, '../../../supabase/migrations')

function readMigration(name: string): string {
  const path = join(MIGRATIONS_DIR, name)
  if (!existsSync(path)) throw new Error(`Migration not found: ${name}`)
  return readFileSync(path, 'utf-8')
}

function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

describe('TASK 7.1 — Migration 109: Terminal Staff DELETE Invariant & Teacher Authority Hardening', () => {
  let sql: string
  let codeOnly: string

  beforeAll(() => {
    sql = readMigration('109_terminal_staff_delete_and_teacher_authority.sql')
    codeOnly = stripSqlComments(sql)
  })

  describe('1. Invariant Trigger DELETE Support & Cascade Handling', () => {
    it('extends trg_enforce_live_session_staff_invariants to BEFORE INSERT OR UPDATE OR DELETE', () => {
      expect(codeOnly).toMatch(/CREATE\s+TRIGGER\s+trg_enforce_live_session_staff_invariants/i)
      expect(codeOnly).toMatch(/BEFORE\s+INSERT\s+OR\s+UPDATE\s+OR\s+DELETE\s+ON\s+public\.live_session_staff/i)
    })

    it('correctly uses OLD.live_session_id for DELETE operations', () => {
      expect(codeOnly).toMatch(/IF\s+TG_OP\s*=\s*'DELETE'\s+THEN/i)
      expect(codeOnly).toMatch(/OLD\.live_session_id/i)
      expect(codeOnly).toMatch(/NEW\.live_session_id/i)
    })

    it('preserves foreign key cascade deletion using pg_trigger_depth() > 1', () => {
      expect(codeOnly).toMatch(/pg_trigger_depth\(\)\s*>\s*1/i)
      expect(codeOnly).toMatch(/RETURN\s+OLD;/i)
    })

    it('blocks direct modification and deletion on terminal sessions (ENDED or CANCELLED)', () => {
      expect(codeOnly).toMatch(/v_session\.status\s+IN\s*\(\s*'ENDED'\s*,\s*'CANCELLED'\s*\)/i)
      expect(codeOnly).toMatch(/cannot_modify_staff_on_terminal_session/i)
    })
  })

  describe('2. Authoritative Teacher Authority Model in check_live_classroom_access', () => {
    it('resolves course creator as the sole teacher and platform admin as student', () => {
      expect(codeOnly).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.check_live_classroom_access/i)
      // Creator check assigns teacher
      expect(codeOnly).toMatch(/v_session\.creator_id\s*=\s*p_user_id/i)
      expect(codeOnly).toMatch(/v_assigned_role\s*:=\s*'teacher'/i)
      // Admin receives student role with is_admin flag
      expect(codeOnly).toMatch(/v_is_admin\s*:=\s*\(v_user_role\s*=\s*'admin'\)/i)
      expect(codeOnly).toMatch(/IF\s+v_is_enrolled\s+OR\s+v_is_admin\s+THEN/i)
      expect(codeOnly).toMatch(/v_assigned_role\s*:=\s*'student'/i)
    })

    it('returns authoritative teacher_id and creator_id matching course creator', () => {
      expect(codeOnly).toMatch(/'teacher_id',\s*v_session\.creator_id/i)
      expect(codeOnly).toMatch(/'creator_id',\s*v_session\.creator_id/i)
    })
  })
})
