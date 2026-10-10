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

describe('TASK 3A — Migration 098: Enforce live_sessions Lifecycle Transitions', () => {
  let sql: string
  let codeOnly: string

  beforeAll(() => {
    sql = readMigration('098_enforce_live_session_lifecycle.sql')
    codeOnly = stripSqlComments(sql)
  })

  describe('1. Trigger & Lifecycle Function Definition', () => {
    it('defines trigger function enforce_live_sessions_lifecycle', () => {
      expect(codeOnly).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.enforce_live_sessions_lifecycle\s*\(\s*\)/i)
      expect(codeOnly).toMatch(/RETURNS\s+trigger/i)
      expect(codeOnly).toMatch(/LANGUAGE\s+plpgsql/i)
    })

    it('attaches BEFORE INSERT OR UPDATE trigger to public.live_sessions', () => {
      expect(codeOnly).toMatch(/DROP\s+TRIGGER\s+IF\s+EXISTS\s+trg_live_sessions_lifecycle\s+ON\s+public\.live_sessions/i)
      expect(codeOnly).toMatch(/CREATE\s+TRIGGER\s+trg_live_sessions_lifecycle/i)
      expect(codeOnly).toMatch(/BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+public\.live_sessions/i)
      expect(codeOnly).toMatch(/FOR\s+EACH\s+ROW/i)
      expect(codeOnly).toMatch(/EXECUTE\s+FUNCTION\s+public\.enforce_live_sessions_lifecycle\s*\(\s*\)/i)
    })
  })

  describe('2. Protection of Server-Owned Fields', () => {
    it('enforces status must start as DRAFT or SCHEDULED on INSERT', () => {
      expect(codeOnly).toMatch(/IF\s+TG_OP\s*=\s*'INSERT'\s+THEN/i)
      expect(codeOnly).toMatch(/NEW\.status\s+NOT\s+IN\s*\(\s*'DRAFT'\s*,\s*'SCHEDULED'\s*\)/i)
      expect(codeOnly).toMatch(/NEW\.started_at\s*:=\s*NULL/i)
      expect(codeOnly).toMatch(/NEW\.ended_at\s*:=\s*NULL/i)
    })

    it('enforces livekit_room_name immutability on UPDATE', () => {
      expect(codeOnly).toMatch(/NEW\.livekit_room_name\s+IS\s+DISTINCT\s+FROM\s+OLD\.livekit_room_name/i)
      expect(codeOnly).toMatch(/livekit_room_name\s+cannot\s+be\s+modified/i)
    })

    it('enforces started_at and ended_at cannot be modified directly', () => {
      expect(codeOnly).toMatch(/NEW\.started_at\s+IS\s+DISTINCT\s+FROM\s+OLD\.started_at/i)
      expect(codeOnly).toMatch(/NEW\.ended_at\s+IS\s+DISTINCT\s+FROM\s+OLD\.ended_at/i)
    })
  })

  describe('3. Lifecycle State Machine Enforcement', () => {
    it('blocks direct update of status to LIVE without start_live_session()', () => {
      expect(codeOnly).toMatch(/OLD\.status\s*=\s*'SCHEDULED'\s+AND\s+NEW\.status\s*=\s*'LIVE'/i)
      expect(codeOnly).toMatch(/Direct\s+transition\s+to\s+LIVE\s+is\s+forbidden/i)
    })

    it('blocks direct update of status to ENDED without end_live_session()', () => {
      expect(codeOnly).toMatch(/OLD\.status\s*=\s*'LIVE'\s+AND\s+NEW\.status\s*=\s*'ENDED'/i)
      expect(codeOnly).toMatch(/Direct\s+transition\s+to\s+ENDED\s+is\s+forbidden/i)
    })

    it('blocks direct update of status to CANCELLED without cancel_live_session()', () => {
      expect(codeOnly).toMatch(/OLD\.status\s*=\s*'SCHEDULED'\s+AND\s+NEW\.status\s*=\s*'CANCELLED'/i)
      expect(codeOnly).toMatch(/Direct\s+transition\s+to\s+CANCELLED\s+is\s+forbidden/i)
    })

    it('rejects any invalid lifecycle transition (LIVE->SCHEDULED, ENDED->any, CANCELLED->any, etc.)', () => {
      expect(codeOnly).toMatch(/Invalid\s+session\s+status\s+transition\s+from\s+%\s+to\s+%/i)
    })
  })

  describe('4. Server-Side RPC Enhancements', () => {
    it('upgrades start_live_session to reject non-SCHEDULED sessions and prevent re-starting LIVE', () => {
      expect(codeOnly).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.start_live_session/i)
      expect(codeOnly).toMatch(/v_current_status\s*=\s*'LIVE'/i)
      expect(codeOnly).toMatch(/session_already_live/i)
      expect(codeOnly).toMatch(/v_current_status\s*!=\s*'SCHEDULED'/i)
      expect(codeOnly).toMatch(/cannot_start_session_in_%_status/i)
      expect(codeOnly).toMatch(/set_config\('app\.live_session_transition',\s*'true',\s*true\)/i)
      expect(codeOnly).toMatch(/set_config\('app\.live_session_transition',\s*'false',\s*true\)/i)
    })

    it('upgrades end_live_session to reject non-LIVE sessions and prevent re-ending ENDED', () => {
      expect(codeOnly).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.end_live_session/i)
      expect(codeOnly).toMatch(/v_current_status\s*=\s*'ENDED'/i)
      expect(codeOnly).toMatch(/session_already_ended/i)
      expect(codeOnly).toMatch(/v_current_status\s*!=\s*'LIVE'/i)
      expect(codeOnly).toMatch(/cannot_end_session_in_%_status/i)
      expect(codeOnly).toMatch(/set_config\('app\.live_session_transition',\s*'true',\s*true\)/i)
      expect(codeOnly).toMatch(/set_config\('app\.live_session_transition',\s*'false',\s*true\)/i)
    })

    it('creates cancel_live_session RPC for clean lifecycle cancellation', () => {
      expect(codeOnly).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.cancel_live_session/i)
      expect(codeOnly).toMatch(/cannot_cancel_live_session/i)
      expect(codeOnly).toMatch(/cannot_cancel_ended_session/i)
      expect(codeOnly).toMatch(/session_already_cancelled/i)
      expect(codeOnly).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cancel_live_session\(uuid\)\s+TO\s+authenticated/i)
    })
  })
})
