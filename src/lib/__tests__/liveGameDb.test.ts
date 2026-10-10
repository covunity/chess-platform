import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import { isDockerDbAvailable } from '../../test/dbTestHelper'

function runSql(query: string): string {
  const cmd = 'docker exec -i supabase_db_chess-course-platform psql -U postgres -d postgres -t -A -q -v ON_ERROR_STOP=1'
  const output = execSync(cmd, { input: query, encoding: 'utf-8' }).trim()
  return output.split('\n')[0]?.trim() ?? ''
}

function runSqlThrows(query: string): boolean {
  try {
    const cmd = 'docker exec -i supabase_db_chess-course-platform psql -U postgres -d postgres -t -A -q -v ON_ERROR_STOP=1'
    execSync(cmd, { input: query, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    return false
  } catch {
    return true
  }
}

function runAsUser(userId: string, query: string): string {
  const fullSql = `
    SET ROLE authenticated;
    SET "request.jwt.claims" = '{"sub": "${userId}"}';
    ${query}
    RESET ROLE;
  `
  const cmd = 'docker exec -i supabase_db_chess-course-platform psql -U postgres -d postgres -t -A -q -v ON_ERROR_STOP=1'
  const output = execSync(cmd, { input: fullSql, encoding: 'utf-8' }).trim()
  const lines = output.split('\n').map((l) => l.trim()).filter((l) => l && l !== 'SET' && l !== 'RESET')
  return lines.join('\n')
}

function runAsUserThrows(userId: string, query: string): boolean {
  try {
    const fullSql = `
      SET ROLE authenticated;
      SET "request.jwt.claims" = '{"sub": "${userId}"}';
      ${query}
      RESET ROLE;
    `
    const cmd = 'docker exec -i supabase_db_chess-course-platform psql -U postgres -d postgres -t -A -q -v ON_ERROR_STOP=1'
    execSync(cmd, { input: fullSql, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    return false
  } catch {
    return true
  }
}

describe.skipIf(!isDockerDbAvailable())('TASK 8 — Real PostgreSQL Verification: Live Game Persistence Foundation', () => {
  const creatorId = '11111111-aaaa-1111-aaaa-111111111111'
  const assistantId = '22222222-aaaa-2222-aaaa-222222222222'
  const studentWhiteId = '33333333-aaaa-3333-aaaa-333333333333'
  const studentBlackId = '44444444-aaaa-4444-aaaa-444444444444'
  const unrelatedStudentId = '55555555-aaaa-5555-aaaa-555555555555'
  const adminId = '66666666-aaaa-6666-aaaa-666666666666'

  let courseId: string
  let sessionId: string
  let endedSessionId: string
  let staleEndedSessionId: string
  let cancelledSessionId: string

  beforeAll(() => {
    // 1. Provision test users in auth.users and public.users
    runSql(`
      DO $body$
      DECLARE
        u_id uuid;
      BEGIN
        FOR u_id IN SELECT unnest(ARRAY[
          '${creatorId}'::uuid,
          '${assistantId}'::uuid,
          '${studentWhiteId}'::uuid,
          '${studentBlackId}'::uuid,
          '${unrelatedStudentId}'::uuid,
          '${adminId}'::uuid
        ]) LOOP
          IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = u_id) THEN
            INSERT INTO auth.users (id, email) VALUES (u_id, u_id || '@test.com');
          END IF;
          IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = u_id) THEN
            INSERT INTO public.users (id, email, name, role) VALUES (u_id, u_id || '@test.com', 'User ' || u_id, 'learner');
          END IF;
        END LOOP;
      END $body$;
    `)

    runSql(`
      UPDATE public.users SET role = 'creator' WHERE id = '${creatorId}';
      UPDATE public.users SET role = 'admin' WHERE id = '${adminId}';
      UPDATE public.users SET role = 'learner' WHERE id IN ('${assistantId}', '${studentWhiteId}', '${studentBlackId}', '${unrelatedStudentId}');
    `)

    // 2. Create live course
    courseId = runSql(`
      INSERT INTO public.courses (creator_id, title, price, status, course_type)
      VALUES ('${creatorId}', 'Live Game Test Course', 0, 'published', 'live')
      RETURNING id;
    `)

    // 3. Enroll students
    runSql(`
      INSERT INTO public.enrollments (user_id, course_id)
      VALUES
        ('${studentWhiteId}', '${courseId}'),
        ('${studentBlackId}', '${courseId}')
      ON CONFLICT DO NOTHING;
    `)

    // 4. Create live sessions via valid lifecycle state transitions
    // A: Currently LIVE session
    sessionId = runSql(`
      INSERT INTO public.live_sessions (
        course_id, title, scheduled_start_at, status, livekit_room_name
      ) VALUES (
        '${courseId}', 'Active Live Session', now() - interval '10 minutes', 'SCHEDULED',
        'live-room-game-active'
      ) RETURNING id;
    `)

    // Assign assistant
    runSql(`
      INSERT INTO public.live_session_staff (live_session_id, user_id, role)
      VALUES ('${sessionId}', '${assistantId}', 'assistant')
      ON CONFLICT DO NOTHING;
    `)

    // Start session A via server RPC
    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        PERFORM public.start_live_session('${sessionId}'::uuid);
      END $body$;
    `)

    // B: Recently ENDED session (within 2 hours window)
    endedSessionId = runSql(`
      INSERT INTO public.live_sessions (
        course_id, title, scheduled_start_at, status, livekit_room_name
      ) VALUES (
        '${courseId}', 'Recently Ended Session', now() - interval '1 hour', 'SCHEDULED',
        'live-room-game-ended'
      ) RETURNING id;
    `)

    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        PERFORM public.start_live_session('${endedSessionId}'::uuid);
        PERFORM public.end_live_session('${endedSessionId}'::uuid);
      END $body$;
    `)

    // C: Stale ENDED session (ended 5 hours ago, beyond window)
    staleEndedSessionId = runSql(`
      INSERT INTO public.live_sessions (
        course_id, title, scheduled_start_at, status, livekit_room_name
      ) VALUES (
        '${courseId}', 'Stale Ended Session', now() - interval '6 hours', 'SCHEDULED',
        'live-room-game-stale'
      ) RETURNING id;
    `)

    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        PERFORM public.start_live_session('${staleEndedSessionId}'::uuid);
        PERFORM public.end_live_session('${staleEndedSessionId}'::uuid);
        PERFORM set_config('app.live_session_transition', 'true', true);
        UPDATE public.live_sessions
        SET started_at = now() - interval '6 hours',
            ended_at = now() - interval '5 hours'
        WHERE id = '${staleEndedSessionId}'::uuid;
      END $body$;
    `)

    // D: CANCELLED session
    cancelledSessionId = runSql(`
      INSERT INTO public.live_sessions (
        course_id, title, scheduled_start_at, status, livekit_room_name
      ) VALUES (
        '${courseId}', 'Cancelled Session', now() + interval '1 hour', 'SCHEDULED',
        'live-room-game-cancelled'
      ) RETURNING id;
    `)

    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        PERFORM public.cancel_live_session('${cancelledSessionId}'::uuid);
      END $body$;
    `)
  })

  afterAll(() => {
    // Cleanup created test records
    if (courseId) {
      runSql(`DELETE FROM public.courses WHERE id = '${courseId}';`)
    }
  })

  describe('1. Schema & Table Constraints', () => {
    it('rejects foreign key violation for non-existent session', () => {
      const badSessionId = '00000000-0000-0000-0000-000000000000'
      const gameId = '10000000-0000-0000-0000-000000000001'

      const failed = runSqlThrows(`
        INSERT INTO public.live_games (id, live_session_id, board_id, game_scope, status)
        VALUES ('${gameId}', '${badSessionId}', 'main', 'MAIN', 'IN_PROGRESS');
      `)
      expect(failed).toBe(true)
    })

    it('rejects invalid game_scope', () => {
      const gameId = '10000000-0000-0000-0000-000000000002'
      const failed = runSqlThrows(`
        INSERT INTO public.live_games (id, live_session_id, board_id, game_scope)
        VALUES ('${gameId}', '${sessionId}', 'main', 'SOLO');
      `)
      expect(failed).toBe(true)
    })

    it('rejects invalid result', () => {
      const gameId = '10000000-0000-0000-0000-000000000003'
      const failed = runSqlThrows(`
        INSERT INTO public.live_games (id, live_session_id, board_id, game_scope, result)
        VALUES ('${gameId}', '${sessionId}', 'main', 'MAIN', '2-0');
      `)
      expect(failed).toBe(true)
    })

    it('rejects ended_at before started_at', () => {
      const gameId = '10000000-0000-0000-0000-000000000004'
      const failed = runSqlThrows(`
        INSERT INTO public.live_games (
          id, live_session_id, board_id, game_scope, started_at, ended_at
        ) VALUES (
          '${gameId}', '${sessionId}', 'main', 'MAIN', now(), now() - interval '1 minute'
        );
      `)
      expect(failed).toBe(true)
    })

    it('rejects board_id mismatch for MAIN (must be main) and PRACTICE (cannot be main)', () => {
      const gameId1 = '10000000-0000-0000-0000-000000000005'
      const gameId2 = '10000000-0000-0000-0000-000000000006'

      // MAIN with practice board ID -> reject
      const failMain = runSqlThrows(`
        INSERT INTO public.live_games (id, live_session_id, board_id, game_scope)
        VALUES ('${gameId1}', '${sessionId}', 'board-1', 'MAIN');
      `)
      expect(failMain).toBe(true)

      // PRACTICE with main board ID -> reject
      const failPractice = runSqlThrows(`
        INSERT INTO public.live_games (id, live_session_id, board_id, game_scope)
        VALUES ('${gameId2}', '${sessionId}', 'main', 'PRACTICE');
      `)
      expect(failPractice).toBe(true)
    })
  })

  describe('2. Authorization via finalize_live_game RPC', () => {
    it('allows course creator to finalize own MAIN game', () => {
      const gameId = '20000000-0000-0000-0000-000000000001'
      const pgn = '1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0'
      const finalFen = 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4'

      const resultJson = runAsUser(
        creatorId,
        `SELECT public.finalize_live_game(
          '${gameId}'::uuid,
          '${sessionId}'::uuid,
          'main',
          'MAIN',
          '${creatorId}'::uuid,
          '${studentWhiteId}'::uuid,
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          '${finalFen}',
          '${pgn}',
          '1-0',
          'checkmate',
          'COMPLETED',
          7,
          now() - interval '5 minutes',
          now()
        );`
      )

      expect(resultJson).toContain(gameId)
      expect(resultJson).toContain('"status": "COMPLETED"')
      expect(resultJson).toContain('"result": "1-0"')
      expect(resultJson).toContain('"termination_reason": "checkmate"')
    })

    it('rejects unauthorized learner attempting to finalize MAIN game', () => {
      const gameId = '20000000-0000-0000-0000-000000000002'

      const failed = runAsUserThrows(
        studentWhiteId,
        `SELECT public.finalize_live_game(
          '${gameId}'::uuid,
          '${sessionId}'::uuid,
          'main',
          'MAIN',
          '${creatorId}'::uuid,
          '${studentWhiteId}'::uuid,
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          '',
          '*',
          'aborted',
          'ABORTED',
          0,
          now() - interval '1 minute',
          now()
        );`
      )

      expect(failed).toBe(true)
    })

    it('allows assigned practice players (White and Black) to finalize own practice game', () => {
      const gameId = '20000000-0000-0000-0000-000000000003'
      const pgn = '1. d4 d5 2. c4 c6 1/2-1/2'
      const finalFen = 'rnbqkbnr/pp2pppp/2p5/3p4/2PP4/8/PP2PPPP/RNBQKBNR w KQkq - 0 3'

      // Submitter is studentWhiteId (assigned white player)
      const resultJson = runAsUser(
        studentWhiteId,
        `SELECT public.finalize_live_game(
          '${gameId}'::uuid,
          '${sessionId}'::uuid,
          'practice-board-1',
          'PRACTICE',
          '${studentWhiteId}'::uuid,
          '${studentBlackId}'::uuid,
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          '${finalFen}',
          '${pgn}',
          '1/2-1/2',
          'draw_agreement',
          'COMPLETED',
          4,
          now() - interval '8 minutes',
          now()
        );`
      )

      expect(resultJson).toContain(gameId)
      expect(resultJson).toContain('"result": "1/2-1/2"')
      expect(resultJson).toContain('"submitted_by": "' + studentWhiteId + '"')
    })

    it('rejects unrelated learner attempting to finalize practice game', () => {
      const gameId = '20000000-0000-0000-0000-000000000004'

      // Submitter is unrelatedStudentId who is neither White nor Black nor Creator
      const failed = runAsUserThrows(
        unrelatedStudentId,
        `SELECT public.finalize_live_game(
          '${gameId}'::uuid,
          '${sessionId}'::uuid,
          'practice-board-1',
          'PRACTICE',
          '${studentWhiteId}'::uuid,
          '${studentBlackId}'::uuid,
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          '',
          '*',
          'aborted',
          'ABORTED',
          0,
          now() - interval '1 minute',
          now()
        );`
      )

      expect(failed).toBe(true)
    })

    it('rejects assistant submitting practice game when not an assigned player', () => {
      const gameId = '20000000-0000-0000-0000-000000000005'

      // Assistant is in staff, but not an assigned player for this board
      const failed = runAsUserThrows(
        assistantId,
        `SELECT public.finalize_live_game(
          '${gameId}'::uuid,
          '${sessionId}'::uuid,
          'practice-board-2',
          'PRACTICE',
          '${studentWhiteId}'::uuid,
          '${studentBlackId}'::uuid,
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          '',
          '*',
          'aborted',
          'ABORTED',
          0,
          now() - interval '1 minute',
          now()
        );`
      )

      expect(failed).toBe(true)
    })

    it('rejects un-enrolled / arbitrary users as submitted players', () => {
      const gameId = '20000000-0000-0000-0000-000000000006'
      const fakeUserId = '99999999-9999-9999-9999-999999999999'

      const failed = runAsUserThrows(
        creatorId,
        `SELECT public.finalize_live_game(
          '${gameId}'::uuid,
          '${sessionId}'::uuid,
          'practice-board-3',
          'PRACTICE',
          '${fakeUserId}'::uuid,
          '${studentBlackId}'::uuid,
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          '',
          '*',
          'aborted',
          'ABORTED',
          0,
          now() - interval '1 minute',
          now()
        );`
      )

      expect(failed).toBe(true)
    })
  })

  describe('3. Persistence Window & Session Status Validation', () => {
    it('allows finalization for recently ENDED session within 2-hour window', () => {
      const gameId = '30000000-0000-0000-0000-000000000001'

      const resultJson = runAsUser(
        creatorId,
        `SELECT public.finalize_live_game(
          '${gameId}'::uuid,
          '${endedSessionId}'::uuid,
          'main',
          'MAIN',
          '${creatorId}'::uuid,
          NULL,
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          '',
          '*',
          'session_ended',
          'ABORTED',
          0,
          now() - interval '30 minutes',
          now() - interval '15 minutes'
        );`
      )

      expect(resultJson).toContain(gameId)
      expect(resultJson).toContain('"status": "ABORTED"')
    })

    it('rejects finalization for stale ENDED session beyond persistence window', () => {
      const gameId = '30000000-0000-0000-0000-000000000002'

      const failed = runAsUserThrows(
        creatorId,
        `SELECT public.finalize_live_game(
          '${gameId}'::uuid,
          '${staleEndedSessionId}'::uuid,
          'main',
          'MAIN',
          '${creatorId}'::uuid,
          NULL,
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          '',
          '*',
          'session_ended',
          'ABORTED',
          0,
          now() - interval '5 hours',
          now() - interval '5 hours'
        );`
      )

      expect(failed).toBe(true)
    })

    it('rejects finalization for CANCELLED session', () => {
      const gameId = '30000000-0000-0000-0000-000000000003'

      const failed = runAsUserThrows(
        creatorId,
        `SELECT public.finalize_live_game(
          '${gameId}'::uuid,
          '${cancelledSessionId}'::uuid,
          'main',
          'MAIN',
          '${creatorId}'::uuid,
          NULL,
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          '',
          '*',
          'cancelled',
          'ABORTED',
          0,
          now() - interval '1 minute',
          now()
        );`
      )

      expect(failed).toBe(true)
    })
  })

  describe('4. Idempotency & Conflict Rejection', () => {
    const idempotentGameId = '40000000-0000-0000-0000-000000000001'
    const finalFen = '8/8/8/8/8/8/8/4K2k w - - 0 1'
    const pgn = '1. e4 e5 1-0'

    it('returns existing row idempotently on retry / duplicate submission', () => {
      // First submission by Creator
      runAsUser(
        creatorId,
        `SELECT public.finalize_live_game(
          '${idempotentGameId}'::uuid,
          '${sessionId}'::uuid,
          'practice-board-idemp',
          'PRACTICE',
          '${studentWhiteId}'::uuid,
          '${studentBlackId}'::uuid,
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          '${finalFen}',
          '${pgn}',
          '1-0',
          'resignation',
          'COMPLETED',
          2,
          now() - interval '3 minutes',
          now()
        );`
      )

      // Second identical submission by studentWhiteId (assigned player retry)
      const retryResult = runAsUser(
        studentWhiteId,
        `SELECT public.finalize_live_game(
          '${idempotentGameId}'::uuid,
          '${sessionId}'::uuid,
          'practice-board-idemp',
          'PRACTICE',
          '${studentWhiteId}'::uuid,
          '${studentBlackId}'::uuid,
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          '${finalFen}',
          '${pgn}',
          '1-0',
          'resignation',
          'COMPLETED',
          2,
          now() - interval '3 minutes',
          now()
        );`
      )

      expect(retryResult).toContain(idempotentGameId)
      expect(retryResult).toContain('"result": "1-0"')

      // Verify exactly 1 row exists in DB
      const rowCount = runSql(`
        SELECT count(*)::text FROM public.live_games WHERE id = '${idempotentGameId}';
      `)
      expect(rowCount).toBe('1')
    })

    it('rejects conflicting final state for an already finalized game', () => {
      // Attempting to submit result '0-1' for game that is already finalized as '1-0'
      const failed = runAsUserThrows(
        studentBlackId,
        `SELECT public.finalize_live_game(
          '${idempotentGameId}'::uuid,
          '${sessionId}'::uuid,
          'practice-board-idemp',
          'PRACTICE',
          '${studentWhiteId}'::uuid,
          '${studentBlackId}'::uuid,
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          '8/8/8/8/8/8/8/4K2k w - - 0 1',
          '1. e4 e5 0-1',
          '0-1',
          'resignation',
          'COMPLETED',
          2,
          now() - interval '3 minutes',
          now()
        );`
      )

      expect(failed).toBe(true)
    })

    it('allows sequential games on the same practice board with distinct game IDs', () => {
      const game1Id = '40000000-0000-0000-0000-000000000010'
      const game2Id = '40000000-0000-0000-0000-000000000020'
      const sharedBoardId = 'practice-seq-board'

      // Finalize Game 1 on sharedBoardId
      runAsUser(
        creatorId,
        `SELECT public.finalize_live_game(
          '${game1Id}'::uuid,
          '${sessionId}'::uuid,
          '${sharedBoardId}',
          'PRACTICE',
          '${studentWhiteId}'::uuid,
          '${studentBlackId}'::uuid,
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          'fen-game-1',
          '1. e4 e5 1-0',
          '1-0',
          'checkmate',
          'COMPLETED',
          2,
          now() - interval '15 minutes',
          now() - interval '10 minutes'
        );`
      )

      // Finalize Game 2 on SAME sharedBoardId
      runAsUser(
        creatorId,
        `SELECT public.finalize_live_game(
          '${game2Id}'::uuid,
          '${sessionId}'::uuid,
          '${sharedBoardId}',
          'PRACTICE',
          '${studentBlackId}'::uuid,
          '${studentWhiteId}'::uuid,
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          'fen-game-2',
          '1. d4 d5 0-1',
          '0-1',
          'checkmate',
          'COMPLETED',
          2,
          now() - interval '5 minutes',
          now()
        );`
      )

      // Both games must exist independently
      const count = runSql(`
        SELECT count(*)::text FROM public.live_games
        WHERE live_session_id = '${sessionId}' AND board_id = '${sharedBoardId}';
      `)
      expect(count).toBe('2')

      const g1Result = runSql(`SELECT result FROM public.live_games WHERE id = '${game1Id}';`)
      const g2Result = runSql(`SELECT result FROM public.live_games WHERE id = '${game2Id}';`)
      expect(g1Result).toBe('1-0')
      expect(g2Result).toBe('0-1')
    })
  })

  describe('5. Immutability & Deletion Safeguards', () => {
    it('blocks direct UPDATE on finalized game row', () => {
      const gameId = '50000000-0000-0000-0000-000000000001'

      // Create finalized game
      runSql(`
        INSERT INTO public.live_games (
          id, live_session_id, board_id, game_scope, status, result
        ) VALUES (
          '${gameId}', '${sessionId}', 'main', 'MAIN', 'COMPLETED', '1-0'
        );
      `)

      // Attempt direct UPDATE -> trigger must block it
      const failed = runSqlThrows(`
        UPDATE public.live_games SET result = '0-1' WHERE id = '${gameId}';
      `)
      expect(failed).toBe(true)
    })

    it('blocks direct DELETE on game row', () => {
      const gameId = '50000000-0000-0000-0000-000000000002'

      runSql(`
        INSERT INTO public.live_games (
          id, live_session_id, board_id, game_scope, status
        ) VALUES (
          '${gameId}', '${sessionId}', 'practice-del', 'PRACTICE', 'IN_PROGRESS'
        );
      `)

      // Direct DELETE -> trigger must block it
      const failed = runSqlThrows(`
        DELETE FROM public.live_games WHERE id = '${gameId}';
      `)
      expect(failed).toBe(true)
    })

    it('preserves ON DELETE CASCADE when parent live_session is deleted', () => {
      // Create a DRAFT session (DRAFT sessions can be deleted per migration 099)
      const ephemeralSessionId = runSql(`
        INSERT INTO public.live_sessions (
          course_id, title, scheduled_start_at, status, livekit_room_name
        ) VALUES (
          '${courseId}', 'Ephemeral Session For Cascade Test', now(), 'DRAFT',
          'live-room-cascade-test-' || substr(md5(random()::text), 1, 6)
        ) RETURNING id;
      `)

      const ephemeralGameId = '50000000-0000-0000-0000-000000000099'
      runSql(`
        INSERT INTO public.live_games (
          id, live_session_id, board_id, game_scope, status
        ) VALUES (
          '${ephemeralGameId}', '${ephemeralSessionId}', 'main', 'MAIN', 'COMPLETED'
        );
      `)

      // Delete parent live_session -> cascade should succeed
      runSql(`DELETE FROM public.live_sessions WHERE id = '${ephemeralSessionId}';`)

      const gameExists = runSql(`
        SELECT count(*)::text FROM public.live_games WHERE id = '${ephemeralGameId}';
      `)
      expect(gameExists).toBe('0')
    })
  })

  describe('6. Querying Games via get_live_session_games RPC', () => {
    it('allows enrolled student and creator to fetch session games', () => {
      // Student query
      const studentResult = runAsUser(
        studentWhiteId,
        `SELECT count(*)::text FROM public.get_live_session_games('${sessionId}'::uuid);`
      )
      expect(parseInt(studentResult, 10)).toBeGreaterThan(0)

      // Creator query
      const creatorResult = runAsUser(
        creatorId,
        `SELECT count(*)::text FROM public.get_live_session_games('${sessionId}'::uuid);`
      )
      expect(parseInt(creatorResult, 10)).toBeGreaterThan(0)
    })

    it('rejects unrelated learner querying session games', () => {
      const failed = runAsUserThrows(
        unrelatedStudentId,
        `SELECT * FROM public.get_live_session_games('${sessionId}'::uuid);`
      )
      expect(failed).toBe(true)
    })
  })
})
