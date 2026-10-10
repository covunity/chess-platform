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

describe('TASK 8 — Migration 110: Live Game Persistence Foundation (Static Verification)', () => {
  let sql: string
  let codeOnly: string

  beforeAll(() => {
    sql = readMigration('110_live_games.sql')
    codeOnly = stripSqlComments(sql)
  })

  describe('1. Table Definition & Constraints', () => {
    it('creates table public.live_games with correct primary key and foreign keys', () => {
      expect(codeOnly).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.live_games/i)
      expect(codeOnly).toMatch(/id\s+uuid\s+PRIMARY\s+KEY/i)
      expect(codeOnly).toMatch(/live_session_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+public\.live_sessions\(id\)\s+ON\s+DELETE\s+CASCADE/i)
      expect(codeOnly).toMatch(/white_user_id\s+uuid\s+NULL\s+REFERENCES\s+auth\.users\(id\)\s+ON\s+DELETE\s+SET\s+NULL/i)
      expect(codeOnly).toMatch(/black_user_id\s+uuid\s+NULL\s+REFERENCES\s+auth\.users\(id\)\s+ON\s+DELETE\s+SET\s+NULL/i)
    })

    it('enforces game_scope check constraint (MAIN or PRACTICE)', () => {
      expect(codeOnly).toMatch(/game_scope\s+text\s+NOT\s+NULL\s+CHECK\s*\(\s*game_scope\s+IN\s*\(\s*'MAIN'\s*,\s*'PRACTICE'\s*\)\s*\)/i)
    })

    it('enforces result check constraint (1-0, 0-1, 1/2-1/2, *)', () => {
      expect(codeOnly).toMatch(/result\s+text\s+NOT\s+NULL\s+DEFAULT\s+'\*'\s+CHECK\s*\(\s*result\s+IN\s*\(\s*'1-0'\s*,\s*'0-1'\s*,\s*'1\/2-1\/2'\s*,\s*'\*'\s*\)\s*\)/i)
    })

    it('enforces status check constraint (IN_PROGRESS, COMPLETED, ABORTED)', () => {
      expect(codeOnly).toMatch(/status\s+text\s+NOT\s+NULL\s+DEFAULT\s+'IN_PROGRESS'\s+CHECK\s*\(\s*status\s+IN\s*\(\s*'IN_PROGRESS'\s*,\s*'COMPLETED'\s*,\s*'ABORTED'\s*\)\s*\)/i)
    })

    it('enforces move_count >= 0 and timestamps constraint', () => {
      expect(codeOnly).toMatch(/move_count\s+integer\s+NOT\s+NULL\s+DEFAULT\s+0\s+CHECK\s*\(\s*move_count\s*>=\s+0\s*\)/i)
      expect(codeOnly).toMatch(/ended_at\s+IS\s+NULL\s+OR\s+ended_at\s*>=\s*started_at/i)
    })

    it('enforces board_id context mapping (main for MAIN, non-main for PRACTICE)', () => {
      expect(codeOnly).toMatch(/game_scope\s*=\s*'MAIN'\s+AND\s+board_id\s*=\s*'main'/i)
      expect(codeOnly).toMatch(/game_scope\s*=\s*'PRACTICE'\s+AND\s+board_id\s*!=\s*'main'/i)
    })
  })

  describe('2. Indexes', () => {
    it('creates indexes on session_id, board_id, started_at, ended_at, and players', () => {
      expect(codeOnly).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_live_games_session_id/i)
      expect(codeOnly).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_live_games_board_id/i)
      expect(codeOnly).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_live_games_started_at/i)
      expect(codeOnly).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_live_games_ended_at/i)
      expect(codeOnly).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_live_games_game_scope/i)
      expect(codeOnly).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_live_games_white_user/i)
      expect(codeOnly).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_live_games_black_user/i)
    })
  })

  describe('3. Invariants & Immutability Trigger', () => {
    it('creates trg_enforce_live_games_invariants on UPDATE OR DELETE', () => {
      expect(codeOnly).toMatch(/CREATE\s+TRIGGER\s+trg_enforce_live_games_invariants/i)
      expect(codeOnly).toMatch(/BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+public\.live_games/i)
    })

    it('prevents direct DELETE while allowing cascade deletion via pg_trigger_depth() > 1', () => {
      expect(codeOnly).toMatch(/pg_trigger_depth\(\)\s*>\s*1/i)
      expect(codeOnly).toMatch(/direct_delete_not_allowed/i)
    })

    it('prevents mutation of finalized games (COMPLETED or ABORTED)', () => {
      expect(codeOnly).toMatch(/OLD\.status\s+IN\s*\(\s*'COMPLETED'\s*,\s*'ABORTED'\s*\)/i)
      expect(codeOnly).toMatch(/cannot_modify_finalized_game/i)
    })
  })

  describe('4. Server-side RPCs', () => {
    it('defines record_live_game_start with security definer and authorization checks', () => {
      expect(codeOnly).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.record_live_game_start/i)
      expect(codeOnly).toMatch(/SECURITY\s+DEFINER/i)
      expect(codeOnly).toMatch(/unauthorized_main_game_submission/i)
      expect(codeOnly).toMatch(/unauthorized_practice_game_submission/i)
    })

    it('defines finalize_live_game with idempotency and conflicting final state checks', () => {
      expect(codeOnly).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.finalize_live_game/i)
      expect(codeOnly).toMatch(/SECURITY\s+DEFINER/i)
      expect(codeOnly).toMatch(/session_persistence_window_expired/i)
      expect(codeOnly).toMatch(/conflicting_final_game_state/i)
    })

    it('defines get_live_session_games with session authorization check', () => {
      expect(codeOnly).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_live_session_games/i)
      expect(codeOnly).toMatch(/SECURITY\s+DEFINER/i)
      expect(codeOnly).toMatch(/not_authorized_for_session_games/i)
    })
  })

  describe('5. RLS & Permissions', () => {
    it('enables RLS on public.live_games', () => {
      expect(codeOnly).toMatch(/ALTER\s+TABLE\s+public\.live_games\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i)
    })

    it('restricts SELECT to authorized course creator, session staff, and enrolled students', () => {
      expect(codeOnly).toMatch(/CREATE\s+POLICY\s+"Authorized users can view live_games"/i)
      expect(codeOnly).toMatch(/c\.creator_id\s*=\s*auth\.uid\(\)/i)
      expect(codeOnly).toMatch(/live_session_staff/i)
      expect(codeOnly).toMatch(/enrollments/i)
    })

    it('grants permissions to authenticated and service_role', () => {
      expect(codeOnly).toMatch(/GRANT\s+ALL\s+ON\s+TABLE\s+public\.live_games\s+TO\s+authenticated/i)
      expect(codeOnly).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.finalize_live_game/i)
    })
  })
})
