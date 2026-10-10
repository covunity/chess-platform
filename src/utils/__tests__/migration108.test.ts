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

describe('TASK 7 — Migration 108: Authoritative Assistant Role & live_session_staff', () => {
  let sql: string
  let codeOnly: string

  beforeAll(() => {
    sql = readMigration('108_live_session_staff.sql')
    codeOnly = stripSqlComments(sql)
  })

  describe('1. Table Definition & Invariants', () => {
    it('defines public.live_session_staff table with required columns and constraints', () => {
      expect(codeOnly).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.live_session_staff/i)
      expect(codeOnly).toMatch(/live_session_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+public\.live_sessions\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i)
      expect(codeOnly).toMatch(/user_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+auth\.users\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i)
      expect(codeOnly).toMatch(/role\s+text\s+NOT\s+NULL\s+CHECK\s*\(\s*role\s+IN\s*\(\s*'assistant'\s*\)\s*\)/i)
      expect(codeOnly).toMatch(/UNIQUE\s*\(\s*live_session_id\s*,\s*user_id\s*\)/i)
    })

    it('creates performance indexes on live_session_id and user_id', () => {
      expect(codeOnly).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_live_session_staff_session_id/i)
      expect(codeOnly).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_live_session_staff_user_id/i)
    })

    it('attaches trigger function enforce_live_session_staff_invariants', () => {
      expect(codeOnly).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.enforce_live_session_staff_invariants/i)
      expect(codeOnly).toMatch(/creator_cannot_be_assistant/i)
      expect(codeOnly).toMatch(/cannot_modify_staff_on_terminal_session/i)
      expect(codeOnly).toMatch(/CREATE\s+TRIGGER\s+trg_enforce_live_session_staff_invariants/i)
      expect(codeOnly).toMatch(/BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+public\.live_session_staff/i)
    })
  })

  describe('2. Row Level Security Policies', () => {
    it('enables RLS on public.live_session_staff', () => {
      expect(codeOnly).toMatch(/ALTER\s+TABLE\s+public\.live_session_staff\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i)
    })

    it('restricts INSERT, UPDATE, DELETE to course creator or platform admin only', () => {
      expect(codeOnly).toMatch(/CREATE\s+POLICY\s+"Creator or admin can insert live_session_staff"/i)
      expect(codeOnly).toMatch(/CREATE\s+POLICY\s+"Creator or admin can update live_session_staff"/i)
      expect(codeOnly).toMatch(/CREATE\s+POLICY\s+"Creator or admin can delete live_session_staff"/i)
      expect(codeOnly).toMatch(/c\.creator_id\s*=\s*auth\.uid\(\)/i)
      expect(codeOnly).toMatch(/is_current_user_admin\(\)/i)
    })

    it('permits SELECT for assigned staff, creator, admin, and enrolled learners', () => {
      expect(codeOnly).toMatch(/CREATE\s+POLICY\s+"Users can view live_session_staff"/i)
      expect(codeOnly).toMatch(/user_id\s*=\s*auth\.uid\(\)/i)
    })
  })

  describe('3. Authoritative check_live_classroom_access Role Resolution', () => {
    it('resolves creator and admin as teacher, live_session_staff as assistant, and enrollments as student', () => {
      expect(codeOnly).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.check_live_classroom_access/i)
      expect(codeOnly).toMatch(/v_assigned_role\s*:=\s*'teacher'/i)
      expect(codeOnly).toMatch(/FROM\s+public\.live_session_staff/i)
      expect(codeOnly).toMatch(/v_assigned_role\s*:=\s*'assistant'/i)
      expect(codeOnly).toMatch(/v_assigned_role\s*:=\s*'student'/i)
      expect(codeOnly).toMatch(/'is_assistant',\s*v_is_assistant/i)
    })
  })

  describe('4. Staff Management RPCs', () => {
    it('defines get_live_session_staff, add_live_session_assistant, remove_live_session_assistant, lookup_user_for_assistant', () => {
      expect(codeOnly).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_live_session_staff/i)
      expect(codeOnly).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.add_live_session_assistant/i)
      expect(codeOnly).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.remove_live_session_assistant/i)
      expect(codeOnly).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.lookup_user_for_assistant/i)
    })
  })
})
