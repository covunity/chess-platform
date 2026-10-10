import { describe, it, expect, beforeAll } from 'vitest'
import { execSync } from 'child_process'
import { isDockerDbAvailable } from '../../test/dbTestHelper'
import {
  computeSessionOperationalMetrics,
  computeSessionGameAnalytics,
} from '../liveSessionAnalyticsApi'
import type { LiveSession } from '../../types/liveSession'
import type { LiveSessionAttendance } from '../../types/liveAttendance'
import type { LiveGame } from '../../types/liveGame'

function runSql(query: string): string {
  const cmd = 'docker exec -i supabase_db_chess-course-platform psql -U postgres -d postgres -t -A -q -v ON_ERROR_STOP=1'
  const output = execSync(cmd, { input: query, encoding: 'utf-8' }).trim()
  return output.split('\n')[0]?.trim() ?? ''
}

function runSqlRows(query: string): string[] {
  const cmd = 'docker exec -i supabase_db_chess-course-platform psql -U postgres -d postgres -t -A -q -v ON_ERROR_STOP=1'
  const output = execSync(cmd, { input: query, encoding: 'utf-8' }).trim()
  if (!output) return []
  return output.split('\n').map((l) => l.trim()).filter(Boolean)
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

describe.skipIf(!isDockerDbAvailable())('TASK 9.4 — Real PostgreSQL Verification: Live Session Operational & Chess Analytics', () => {
  const creatorId = '94949494-0001-4444-9494-111111111111'
  const assistantId = '94949494-0002-4444-9494-222222222222'
  const studentAliceId = '94949494-0003-4444-9494-333333333333'
  const studentBobId = '94949494-0004-4444-9494-444444444444'
  const studentCharlieId = '94949494-0005-4444-9494-555555555555'
  const strangerId = '94949494-0006-4444-9494-666666666666'
  const adminId = '94949494-0007-4444-9494-777777777777'

  let courseId: string
  let sessionAId: string
  let sessionBId: string

  beforeAll(() => {
    // 0. Clean up any previous test course
    runSql(`
      DELETE FROM public.courses WHERE title = 'Masterclass Analytics Course';
    `)

    // 1. Provision users
    runSql(`
      DO $body$
      DECLARE
        u_id uuid;
      BEGIN
        FOR u_id IN SELECT unnest(ARRAY[
          '${creatorId}'::uuid,
          '${assistantId}'::uuid,
          '${studentAliceId}'::uuid,
          '${studentBobId}'::uuid,
          '${studentCharlieId}'::uuid,
          '${strangerId}'::uuid,
          '${adminId}'::uuid
        ]) LOOP
          IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = u_id) THEN
            INSERT INTO auth.users (id, email) VALUES (u_id, u_id || '@test.com');
          END IF;
          INSERT INTO public.users (id, email, name, role)
          VALUES (
            u_id,
            u_id || '@test.com',
            CASE
              WHEN u_id = '${creatorId}' THEN 'Grandmaster Teacher'
              WHEN u_id = '${assistantId}' THEN 'Session Assistant'
              WHEN u_id = '${studentAliceId}' THEN 'Alice Student'
              WHEN u_id = '${studentBobId}' THEN 'Bob Student'
              WHEN u_id = '${studentCharlieId}' THEN 'Charlie Student'
              WHEN u_id = '${adminId}' THEN 'Platform Admin'
              ELSE 'Stranger'
            END,
            CASE
              WHEN u_id = '${creatorId}' THEN 'creator'
              WHEN u_id = '${adminId}' THEN 'admin'
              ELSE 'learner'
            END
          )
          ON CONFLICT (id) DO UPDATE
          SET role = EXCLUDED.role, name = EXCLUDED.name;
        END LOOP;
      END $body$;
    `)

    // 2. Provision course and enrollments
    courseId = runSql(`
      INSERT INTO public.courses (
        title,
        description,
        creator_id,
        level,
        language,
        price,
        status,
        course_type,
        published_at
      ) VALUES (
        'Masterclass Analytics Course',
        'Testing Analytics Layer',
        '${creatorId}',
        'advanced',
        'en',
        700000,
        'published',
        'live',
        now()
      ) RETURNING id;
    `)

    runSql(`
      INSERT INTO public.enrollments (user_id, course_id)
      VALUES
        ('${studentAliceId}', '${courseId}'),
        ('${studentBobId}', '${courseId}'),
        ('${studentCharlieId}', '${courseId}')
      ON CONFLICT DO NOTHING;
    `)

    // 3. Create Session A and Session B with dynamic IDs
    sessionAId = crypto.randomUUID()
    sessionBId = crypto.randomUUID()

    runSql(`
      INSERT INTO public.live_sessions (
        id,
        course_id,
        title,
        status,
        scheduled_start_at,
        scheduled_end_at,
        livekit_room_name
      ) VALUES
        ('${sessionAId}', '${courseId}', 'Tactics Lab Session A', 'SCHEDULED', now() - interval '2 hours', now() - interval '1 hour', 'room-analytics-a'),
        ('${sessionBId}', '${courseId}', 'Tactics Lab Session B (Isolated)', 'SCHEDULED', now() - interval '4 hours', now() - interval '3 hours', 'room-analytics-b')
      ON CONFLICT DO NOTHING;

      -- Assign staff before ending session
      INSERT INTO public.live_session_staff (live_session_id, user_id, role)
      VALUES ('${sessionAId}', '${assistantId}', 'assistant')
      ON CONFLICT DO NOTHING;

      -- Transition to LIVE then ENDED via authoritative RPCs
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        PERFORM public.start_live_session('${sessionAId}'::uuid);
        PERFORM public.end_live_session('${sessionAId}'::uuid);
        PERFORM public.start_live_session('${sessionBId}'::uuid);
        PERFORM public.end_live_session('${sessionBId}'::uuid);
      END $body$;
    `)

    // 5. Populate Session A attendance summary
    // Total session duration = 3600 seconds (1 hour).
    // Teacher: 3600s PRESENT
    // Assistant: 3600s PRESENT
    // Alice: 2880s (80%) PRESENT, not late
    // Bob: 1440s (40%) PARTIAL, is_late true
    // Charlie: 0s ABSENT, not late
    runSql(`
      INSERT INTO public.live_session_attendance (
        live_session_id, user_id, role, first_joined_at, last_left_at,
        total_duration_seconds, attendance_status, is_late
      ) VALUES
        ('${sessionAId}', '${creatorId}', 'teacher', now() - interval '2 hours', now() - interval '1 hour', 3600, 'PRESENT', false),
        ('${sessionAId}', '${assistantId}', 'assistant', now() - interval '2 hours', now() - interval '1 hour', 3600, 'PRESENT', false),
        ('${sessionAId}', '${studentAliceId}', 'student', now() - interval '2 hours', now() - interval '1 hour 12 minutes', 2880, 'PRESENT', false),
        ('${sessionAId}', '${studentBobId}', 'student', now() - interval '1 hour 45 minutes', now() - interval '1 hour', 1440, 'PARTIAL', true),
        ('${sessionAId}', '${studentCharlieId}', 'student', NULL, NULL, 0, 'ABSENT', false)
      ON CONFLICT (live_session_id, user_id) DO UPDATE
      SET
        total_duration_seconds = EXCLUDED.total_duration_seconds,
        attendance_status = EXCLUDED.attendance_status,
        is_late = EXCLUDED.is_late,
        role = EXCLUDED.role,
        first_joined_at = EXCLUDED.first_joined_at,
        last_left_at = EXCLUDED.last_left_at;
    `)

    // Populate Session B attendance (for isolation test)
    runSql(`
      INSERT INTO public.live_session_attendance (
        live_session_id, user_id, role, first_joined_at, last_left_at,
        total_duration_seconds, attendance_status, is_late
      ) VALUES
        ('${sessionBId}', '${studentAliceId}', 'student', now() - interval '4 hours', now() - interval '3 hours', 3600, 'PRESENT', false)
      ON CONFLICT DO NOTHING;
    `)

    // 6. Populate Session A games:
    // Game 1: MAIN, 1-0, COMPLETED, 30 moves
    // Game 2: PRACTICE, board-1, 0-1, COMPLETED, 20 moves
    // Game 3: PRACTICE, board-2, 1/2-1/2, COMPLETED, 25 moves
    // Game 4: PRACTICE, board-1, *, IN_PROGRESS, 8 moves
    runSql(`
      INSERT INTO public.live_games (
        id, live_session_id, board_id, game_scope, white_user_id, black_user_id,
        result, status, move_count, started_at, ended_at
      ) VALUES
        ('aaaaaaaa-1111-aaaa-1111-aaaaaaaaaaaa', '${sessionAId}', 'main', 'MAIN', '${creatorId}', '${studentAliceId}', '1-0', 'COMPLETED', 30, now() - interval '110 minutes', now() - interval '90 minutes'),
        ('aaaaaaaa-2222-aaaa-2222-aaaaaaaaaaaa', '${sessionAId}', 'board-1', 'PRACTICE', '${studentAliceId}', '${studentBobId}', '0-1', 'COMPLETED', 20, now() - interval '85 minutes', now() - interval '70 minutes'),
        ('aaaaaaaa-3333-aaaa-3333-aaaaaaaaaaaa', '${sessionAId}', 'board-2', 'PRACTICE', '${studentBobId}', '${studentCharlieId}', '1/2-1/2', 'COMPLETED', 25, now() - interval '85 minutes', now() - interval '65 minutes'),
        ('aaaaaaaa-4444-aaaa-4444-aaaaaaaaaaaa', '${sessionAId}', 'board-1', 'PRACTICE', '${studentAliceId}', '${studentBobId}', '*', 'IN_PROGRESS', 8, now() - interval '64 minutes', NULL)
      ON CONFLICT DO NOTHING;
    `)

    // Populate Session B games (for isolation test)
    runSql(`
      INSERT INTO public.live_games (
        id, live_session_id, board_id, game_scope, white_user_id, black_user_id,
        result, status, move_count, started_at, ended_at
      ) VALUES
        ('bbbbbbbb-1111-bbbb-1111-bbbbbbbbbbbb', '${sessionBId}', 'practice-B', 'PRACTICE', '${studentAliceId}', '${studentBobId}', '1-0', 'COMPLETED', 45, now() - interval '230 minutes', now() - interval '200 minutes')
      ON CONFLICT DO NOTHING;
    `)
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Authoritative Roster and Access Restrictions
  // ───────────────────────────────────────────────────────────────────────────
  describe('Authoritative Database Access Restrictions', () => {
    it('Teacher (course creator) can read the entire session attendance roster', () => {
      const rows = runSqlRows(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${creatorId}"}';
        SELECT user_id, role, attendance_status, total_duration_seconds
        FROM public.get_live_session_attendance('${sessionAId}');
      `)
      // 5 rows: teacher, assistant, Alice, Bob, Charlie
      expect(rows.length).toBe(5)
    })

    it('Assigned assistant can read the entire session attendance roster', () => {
      const rows = runSqlRows(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${assistantId}"}';
        SELECT user_id, role, attendance_status
        FROM public.get_live_session_attendance('${sessionAId}');
      `)
      expect(rows.length).toBe(5)
    })

    it('Platform Admin can read the entire session attendance roster', () => {
      const rows = runSqlRows(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${adminId}"}';
        SELECT user_id, role, attendance_status
        FROM public.get_live_session_attendance('${sessionAId}');
      `)
      expect(rows.length).toBe(5)
    })

    it('Enrolled student Alice receives only her own attendance record', () => {
      const rows = runSqlRows(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${studentAliceId}"}';
        SELECT user_id, role, attendance_status
        FROM public.get_live_session_attendance('${sessionAId}');
      `)
      expect(rows.length).toBe(1)
      expect(rows[0]).toContain(studentAliceId)
    })

    it('Unenrolled stranger is rejected from get_live_session_attendance with forbidden', () => {
      const throws = runAsUserThrows(
        strangerId,
        `SELECT * FROM public.get_live_session_attendance('${sessionAId}');`
      )
      expect(throws).toBe(true)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Accurate Operational Aggregation on Real Database Records
  // ───────────────────────────────────────────────────────────────────────────
  describe('Operational Metrics Aggregation', () => {
    it('accurately computes attendance and duration metrics from real database rows', () => {
      // Fetch full roster as teacher
      const rawRoster = runSqlRows(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${creatorId}"}';
        SELECT a.id, a.live_session_id, a.user_id, a.role, a.first_joined_at, a.last_left_at,
               a.total_duration_seconds, a.attendance_status, a.is_late, a.created_at, a.updated_at,
               u.name, u.email
        FROM public.live_session_attendance a
        LEFT JOIN public.users u ON u.id = a.user_id
        WHERE a.live_session_id = '${sessionAId}';
      `)

      const attendanceRows: LiveSessionAttendance[] = rawRoster.map((r) => {
        const parts = r.split('|')
        return {
          id: parts[0],
          live_session_id: parts[1],
          user_id: parts[2],
          role: parts[3] as any,
          first_joined_at: parts[4] || null,
          last_left_at: parts[5] || null,
          total_duration_seconds: parseInt(parts[6] || '0', 10),
          attendance_status: parts[7] as any,
          is_late: parts[8] === 't',
          created_at: parts[9],
          updated_at: parts[10],
          user_name: parts[11],
          user_email: parts[12],
        }
      })

      const session: LiveSession = {
        id: sessionAId,
        courseId,
        lessonId: null,
        title: 'Tactics Lab Session A',
        description: null,
        scheduledStartAt: '2026-10-09T10:00:00Z',
        scheduledEndAt: '2026-10-09T11:00:00Z',
        timezone: 'UTC',
        status: 'ENDED',
        agenda: [],
        learningObjectives: [],
        preparationNotes: null,
        maxParticipants: 30,
        livekitRoomName: `live-course-${courseId}-session-${sessionAId}`,
        startedAt: '2026-10-09T10:00:00Z',
        endedAt: '2026-10-09T11:00:00Z',
        createdAt: '2026-10-09T09:00:00Z',
        updatedAt: '2026-10-09T11:00:00Z',
      }

      const operational = computeSessionOperationalMetrics(session, attendanceRows)

      // Student metrics:
      // Alice (2880s, PRESENT), Bob (1440s, PARTIAL, late), Charlie (0s, ABSENT)
      expect(operational.studentAttendance.totalEnrolled).toBe(3)
      expect(operational.studentAttendance.presentCount).toBe(1)
      expect(operational.studentAttendance.partialCount).toBe(1)
      expect(operational.studentAttendance.absentCount).toBe(1)
      expect(operational.studentAttendance.attendedCount).toBe(2)
      // 2 / 3 = 66.7%
      expect(operational.studentAttendance.attendanceRatePct).toBe(66.7)
      expect(operational.studentAttendance.lateCount).toBe(1)
      // 1 / 2 = 50.0%
      expect(operational.studentAttendance.lateRatePct).toBe(50.0)

      // Duration metrics (Alice: 2880s, Bob: 1440s):
      // Total = 4320s. Average = 2160s. Min = 1440s. Max = 2880s.
      expect(operational.durationStats.totalDurationSeconds).toBe(4320)
      expect(operational.durationStats.averageDurationSeconds).toBe(2160)
      expect(operational.durationStats.minDurationSeconds).toBe(1440)
      expect(operational.durationStats.maxDurationSeconds).toBe(2880)

      // Staff metrics: Teacher & Assistant
      expect(operational.staffAttendance.totalStaff).toBe(2)
      expect(operational.staffAttendance.presentStaff).toBe(2)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Accurate Chess Aggregation on Real Database Records
  // ───────────────────────────────────────────────────────────────────────────
  describe('Chess Metrics Aggregation', () => {
    it('accurately computes chess statistics from real database rows', () => {
      const rawGames = runSqlRows(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${creatorId}"}';
        SELECT id, live_session_id, board_id, game_scope, white_user_id, black_user_id,
               starting_fen, final_fen, pgn, result, termination_reason, status,
               move_count, started_at, ended_at, submitted_by, created_at, updated_at
        FROM public.get_live_session_games('${sessionAId}');
      `)

      const games: LiveGame[] = rawGames.map((r) => {
        const parts = r.split('|')
        return {
          id: parts[0],
          live_session_id: parts[1],
          board_id: parts[2],
          game_scope: parts[3] as any,
          white_user_id: parts[4] || null,
          black_user_id: parts[5] || null,
          starting_fen: parts[6],
          final_fen: parts[7] || null,
          pgn: parts[8] || null,
          result: parts[9] as any,
          termination_reason: parts[10] || null,
          status: parts[11] as any,
          move_count: parseInt(parts[12] || '0', 10),
          started_at: parts[13],
          ended_at: parts[14] || null,
          submitted_by: parts[15] || null,
          created_at: parts[16],
          updated_at: parts[17],
        }
      })

      expect(games.length).toBe(4)

      const chess = computeSessionGameAnalytics(sessionAId, games)

      expect(chess.totalGames).toBe(4)
      expect(chess.completedGames).toBe(3)
      expect(chess.unfinishedGames).toBe(1)
      expect(chess.scopeBreakdown.main).toBe(1)
      expect(chess.scopeBreakdown.practice).toBe(3)

      expect(chess.resultBreakdown.whiteWins).toBe(1)
      expect(chess.resultBreakdown.blackWins).toBe(1)
      expect(chess.resultBreakdown.draws).toBe(1)
      expect(chess.resultBreakdown.unfinishedOrUnknown).toBe(1)

      // Completed move stats (30, 20, 25): Sum = 75. Count = 3. Avg = 25.0. Min = 20. Max = 30.
      expect(chess.moveStats.sampleGameCount).toBe(3)
      expect(chess.moveStats.totalMoves).toBe(75)
      expect(chess.moveStats.averageMoves).toBe(25.0)
      expect(chess.moveStats.minMoves).toBe(20)
      expect(chess.moveStats.maxMoves).toBe(30)

      // Board grouping: 'main', 'board-1', 'board-2'
      expect(chess.byBoard.length).toBe(3)
      expect(chess.byBoard[0].boardId).toBe('main')
      expect(chess.byBoard[1].boardId).toBe('board-1')
      expect(chess.byBoard[2].boardId).toBe('board-2')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Multi-Session Isolation Verification
  // ───────────────────────────────────────────────────────────────────────────
  describe('Multi-Session Isolation', () => {
    it('guarantees queries for Session A never return records from Session B', () => {
      const gamesA = runSqlRows(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${creatorId}"}';
        SELECT id FROM public.get_live_session_games('${sessionAId}');
      `)

      const gamesB = runSqlRows(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${creatorId}"}';
        SELECT id FROM public.get_live_session_games('${sessionBId}');
      `)

      expect(gamesA.length).toBe(4)
      expect(gamesB.length).toBe(1)
      expect(gamesA).not.toContain(gamesB[0])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Read-Only Invariant Verification
  // ───────────────────────────────────────────────────────────────────────────
  describe('Read-Only Invariant', () => {
    it('verifies analytics execution causes zero database modifications or writes', () => {
      const countBefore = runSql(`
        SELECT (
          (SELECT COUNT(*) FROM public.live_session_attendance WHERE live_session_id = '${sessionAId}') +
          (SELECT COUNT(*) FROM public.live_session_attendance_intervals WHERE live_session_id = '${sessionAId}') +
          (SELECT COUNT(*) FROM public.live_games WHERE live_session_id = '${sessionAId}') +
          (SELECT COUNT(*) FROM public.live_sessions WHERE id = '${sessionAId}')
        )::text;
      `)

      // Execute repeated analytics queries as creator
      runSqlRows(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${creatorId}"}';
        SELECT * FROM public.get_live_session_attendance('${sessionAId}');
        SELECT * FROM public.get_live_session_games('${sessionAId}');
      `)

      const countAfter = runSql(`
        SELECT (
          (SELECT COUNT(*) FROM public.live_session_attendance WHERE live_session_id = '${sessionAId}') +
          (SELECT COUNT(*) FROM public.live_session_attendance_intervals WHERE live_session_id = '${sessionAId}') +
          (SELECT COUNT(*) FROM public.live_games WHERE live_session_id = '${sessionAId}') +
          (SELECT COUNT(*) FROM public.live_sessions WHERE id = '${sessionAId}')
        )::text;
      `)

      expect(countAfter).toBe(countBefore)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 6. BLOCKER A Verification: Enrollment Visibility Under Supported Roles
  // ───────────────────────────────────────────────────────────────────────────
  describe('BLOCKER A: Real PostgreSQL Enrollment Count Visibility Under Supported Roles', () => {
    it('Platform Admin can query enrollments count for any course', () => {
      const count = runSql(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${adminId}"}';
        SELECT COUNT(*)::text FROM public.enrollments WHERE course_id = '${courseId}';
      `)
      expect(parseInt(count, 10)).toBe(3)
    })

    it('Creator can query course enrollments via published policy and course.enrollment_count', () => {
      // Direct count on public.enrollments (allowed because course is published)
      const count = runSql(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${creatorId}"}';
        SELECT COUNT(*)::text FROM public.enrollments WHERE course_id = '${courseId}';
      `)
      expect(parseInt(count, 10)).toBe(3)

      // Cached trigger count on courses table
      const cachedCount = runSql(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${creatorId}"}';
        SELECT enrollment_count::text FROM public.courses WHERE id = '${courseId}';
      `)
      expect(parseInt(cachedCount, 10)).toBe(3)
    })

    it('Assigned assistant can query enrollments for published course', () => {
      const count = runSql(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${assistantId}"}';
        SELECT COUNT(*)::text FROM public.enrollments WHERE course_id = '${courseId}';
      `)
      expect(parseInt(count, 10)).toBe(3)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 7. BLOCKER B Verification: Late Student with ABSENT Status Never Exceeds 100%
  // ───────────────────────────────────────────────────────────────────────────
  describe('BLOCKER B: Late Rate Calculation with ABSENT Student in Real DB', () => {
    it('asserts lateRatePct cannot exceed 100% when a student is late and ABSENT', () => {
      // In Session A, Bob is late (1440s, PARTIAL) and Charlie is absent (0s, not late).
      // Let's create an isolated session with 1 student who was late AND absent.
      const lateAbsentSessionId = crypto.randomUUID()
      runSql(`
        INSERT INTO public.live_sessions (
          id, course_id, title, status, scheduled_start_at, scheduled_end_at, livekit_room_name
        ) VALUES (
          '${lateAbsentSessionId}', '${courseId}', 'Late Absent Test', 'SCHEDULED', now() - interval '1 hour', now(), 'room-late-absent'
        );
        DO $body$
        BEGIN
          PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
          PERFORM public.start_live_session('${lateAbsentSessionId}'::uuid);
          PERFORM public.end_live_session('${lateAbsentSessionId}'::uuid);
        END $body$;

        -- Update Alice to be late AND absent (stayed 100 seconds)
        INSERT INTO public.live_session_attendance (
          live_session_id, user_id, role, first_joined_at, last_left_at,
          total_duration_seconds, attendance_status, is_late
        ) VALUES (
          '${lateAbsentSessionId}', '${studentAliceId}', 'student', now() - interval '40 minutes', now() - interval '38 minutes',
          100, 'ABSENT', true
        )
        ON CONFLICT (live_session_id, user_id) DO UPDATE
        SET total_duration_seconds = 100, attendance_status = 'ABSENT', is_late = true, first_joined_at = now() - interval '40 minutes';
      `)

      const rawRoster = runSqlRows(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${creatorId}"}';
        SELECT a.id, a.live_session_id, a.user_id, a.role, a.first_joined_at, a.last_left_at,
               a.total_duration_seconds, a.attendance_status, a.is_late
        FROM public.live_session_attendance a
        WHERE a.live_session_id = '${lateAbsentSessionId}' AND a.user_id = '${studentAliceId}';
      `)

      expect(rawRoster.length).toBe(1)
      const parts = rawRoster[0].split('|')
      const attendanceRow: LiveSessionAttendance = {
        id: parts[0],
        live_session_id: parts[1],
        user_id: parts[2],
        role: parts[3] as any,
        first_joined_at: parts[4],
        last_left_at: parts[5],
        total_duration_seconds: parseInt(parts[6] || '0', 10),
        attendance_status: parts[7] as any,
        is_late: parts[8] === 't',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const session: LiveSession = {
        id: lateAbsentSessionId,
        courseId,
        lessonId: null,
        title: 'Late Absent Test',
        description: null,
        scheduledStartAt: '2026-10-09T10:00:00Z',
        scheduledEndAt: '2026-10-09T11:00:00Z',
        timezone: 'UTC',
        status: 'ENDED',
        agenda: [],
        learningObjectives: [],
        preparationNotes: null,
        maxParticipants: 30,
        livekitRoomName: 'room-late-absent',
        startedAt: '2026-10-09T10:00:00Z',
        endedAt: '2026-10-09T11:00:00Z',
        createdAt: '2026-10-09T09:00:00Z',
        updatedAt: '2026-10-09T11:00:00Z',
      }

      const operational = computeSessionOperationalMetrics(session, [attendanceRow], 1, true)

      expect(operational.studentAttendance.lateCount).toBe(1)
      expect(operational.studentAttendance.joinedCount).toBe(1)
      expect(operational.studentAttendance.attendedCount).toBe(0) // PRESENT + PARTIAL = 0
      // Denominator is joinedCount (1) -> 100%, NEVER exceeds 100% or divides by 0!
      expect(operational.studentAttendance.lateRatePct).toBe(100.0)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 8. BLOCKER A & B: Finalized Roster Authoritative Denominator & CANCELLED Lifecycle in DB
  // ───────────────────────────────────────────────────────────────────────────
  describe('BLOCKER A & B: Finalized Denominator and CANCELLED Lifecycle Semantics', () => {
    it('BLOCKER A: preserves finalized roster size of 3 as authoritative when course has 5 enrollments', () => {
      const finSessionId = '94949494-0008-4444-9494-888888888888'

      // Clean up & create session
      runSql(`
        DELETE FROM public.live_session_attendance WHERE live_session_id = '${finSessionId}';
        DELETE FROM public.live_sessions WHERE id = '${finSessionId}';

        INSERT INTO public.live_sessions (
          id, course_id, title, scheduled_start_at, status, livekit_room_name
        ) VALUES (
          '${finSessionId}', '${courseId}', 'Finalized Denominator Session',
          now() - interval '2 hours', 'SCHEDULED',
          'room-fin-denom'
        );

        DO $body$
        BEGIN
          PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
          PERFORM public.start_live_session('${finSessionId}'::uuid);
          PERFORM public.end_live_session('${finSessionId}'::uuid);
        END $body$;

        -- Materialize 3 student attendance rows: 2 present, 1 absent
        INSERT INTO public.live_session_attendance (
          live_session_id, user_id, role, first_joined_at, last_left_at, total_duration_seconds, attendance_status, is_late
        ) VALUES
          ('${finSessionId}', '${studentAliceId}', 'student', now() - interval '115 minutes', now() - interval '65 minutes', 3000, 'PRESENT', false),
          ('${finSessionId}', '${studentBobId}', 'student', now() - interval '110 minutes', now() - interval '70 minutes', 2400, 'PRESENT', false),
          ('${finSessionId}', '${studentCharlieId}', 'student', null, null, 0, 'ABSENT', false)
        ON CONFLICT (live_session_id, user_id) DO UPDATE
        SET attendance_status = EXCLUDED.attendance_status, total_duration_seconds = EXCLUDED.total_duration_seconds;
      `)

      // Query real DB attendance rows
      const rawRows = runSqlRows(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${creatorId}"}';
        SELECT id, live_session_id, user_id, role, attendance_status, total_duration_seconds, is_late
        FROM public.get_live_session_attendance('${finSessionId}');
      `)

      expect(rawRows.length).toBe(3)

      const dbStudentRows: LiveSessionAttendance[] = rawRows.map((line, idx) => {
        const parts = line.split('|')
        return {
          id: parts[0],
          live_session_id: parts[1],
          user_id: parts[2],
          role: parts[3] as any,
          attendance_status: parts[4] as any,
          total_duration_seconds: parseInt(parts[5] || '0', 10),
          is_late: parts[6] === 't',
          first_joined_at: null,
          last_left_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      })

      const session: LiveSession = {
        id: finSessionId,
        courseId,
        lessonId: null,
        title: 'Finalized Denominator Session',
        description: null,
        scheduledStartAt: '2026-10-09T10:00:00Z',
        scheduledEndAt: '2026-10-09T11:00:00Z',
        timezone: 'UTC',
        status: 'ENDED',
        agenda: [],
        learningObjectives: [],
        preparationNotes: null,
        maxParticipants: 30,
        livekitRoomName: 'room-fin-denom',
        startedAt: '2026-10-09T10:00:00Z',
        endedAt: '2026-10-09T11:00:00Z',
        createdAt: '2026-10-09T09:00:00Z',
        updatedAt: '2026-10-09T11:00:00Z',
      }

      // Course currently has 5 enrollments (inflated due to subsequent course growth)
      const operational = computeSessionOperationalMetrics(session, dbStudentRows, 5, true)

      // Total enrolled must remain 3 (authoritative finalized roster), NOT 5
      expect(operational.studentAttendance.totalEnrolled).toBe(3)
      expect(operational.studentAttendance.attendedCount).toBe(2)
      expect(operational.studentAttendance.absentCount).toBe(1)
      expect(operational.studentAttendance.notJoinedCount).toBe(0)
      // 2 / 3 = 66.7%
      expect(operational.studentAttendance.attendanceRatePct).toBe(66.7)
      expect(operational.studentAttendance.completeness).toBe('FINALIZED')
      expect(operational.studentAttendance.isPartialData).toBe(false)
    })

    it('BLOCKER B: CANCELLED session in DB reports completeness=CANCELLED and isPartialData=true', () => {
      const cancSessionId = '94949494-0009-4444-9494-999999999999'

      runSql(`
        DELETE FROM public.live_session_attendance WHERE live_session_id = '${cancSessionId}';
        DELETE FROM public.live_sessions WHERE id = '${cancSessionId}';

        INSERT INTO public.live_sessions (
          id, course_id, title, scheduled_start_at, status, livekit_room_name
        ) VALUES (
          '${cancSessionId}', '${courseId}', 'Cancelled Test Session',
          now() + interval '1 hour', 'SCHEDULED',
          'room-canc-test'
        );

        DO $body$
        BEGIN
          PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
          PERFORM public.cancel_live_session('${cancSessionId}'::uuid);
        END $body$;
      `)

      const session: LiveSession = {
        id: cancSessionId,
        courseId,
        lessonId: null,
        title: 'Cancelled Test Session',
        description: null,
        scheduledStartAt: '2026-10-09T14:00:00Z',
        scheduledEndAt: '2026-10-09T15:00:00Z',
        timezone: 'UTC',
        status: 'CANCELLED',
        agenda: [],
        learningObjectives: [],
        preparationNotes: null,
        maxParticipants: 30,
        livekitRoomName: 'room-canc-test',
        startedAt: null,
        endedAt: null,
        createdAt: '2026-10-09T09:00:00Z',
        updatedAt: '2026-10-09T09:30:00Z',
      }

      const operational = computeSessionOperationalMetrics(session, [], 5, true)

      expect(operational.studentAttendance.completeness).toBe('CANCELLED')
      expect(operational.studentAttendance.totalEnrolled).toBe(5)
      expect(operational.studentAttendance.attendanceRatePct).toBeNull() // Not applicable (never started)
      expect(operational.studentAttendance.isPartialData).toBe(true) // Cancellation is never complete finalized
      expect(operational.studentAttendance.notJoinedCount).toBe(5)
      expect(operational.studentAttendance.absentCount).toBe(0)
    })

    it('BLOCKER B: verifies PostgreSQL RLS hides enrollments (count=0) without error for unpublished draft course and tests resolution', () => {
      const draftCourseId = '94949494-0010-4444-9494-000000000001'

      // Clean up & create draft course with 2 enrollments
      runSql(`
        DELETE FROM public.courses WHERE id = '${draftCourseId}';

        INSERT INTO public.courses (
          id, title, creator_id, status, course_type
        ) VALUES (
          '${draftCourseId}', 'Restricted Draft Course', '${creatorId}', 'draft', 'live'
        );

        INSERT INTO public.enrollments (user_id, course_id)
        VALUES
          ('${studentAliceId}', '${draftCourseId}'),
          ('${studentBobId}', '${draftCourseId}')
        ON CONFLICT DO NOTHING;
      `)

      // 1. As Creator: direct enrollments query returns 0 without error because RLS hides rows
      const creatorDirectCount = runSql(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${creatorId}"}';
        SELECT count(*)::text FROM public.enrollments WHERE course_id = '${draftCourseId}';
      `)
      // Direct count is 0 because the creator is not enrolled and course is not published!
      expect(creatorDirectCount).toBe('0')

      // But Creator CAN read cached courses.enrollment_count
      const creatorCachedCount = runSql(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${creatorId}"}';
        SELECT enrollment_count::text FROM public.courses WHERE id = '${draftCourseId}';
      `)
      expect(creatorCachedCount).toBe('2')

      // 2. As Assistant: direct enrollments query also returns 0 without error
      const assistantDirectCount = runSql(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${assistantId}"}';
        SELECT count(*)::text FROM public.enrollments WHERE course_id = '${draftCourseId}';
      `)
      expect(assistantDirectCount).toBe('0')

      // And Assistant CANNOT read courses row for unpublished draft course (returns empty)
      const assistantCachedCount = runSql(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${assistantId}"}';
        SELECT enrollment_count::text FROM public.courses WHERE id = '${draftCourseId}';
      `)
      expect(assistantCachedCount).toBe('')

      // 3. As Platform Admin: direct enrollments query bypasses RLS and returns actual count 2
      const adminDirectCount = runSql(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${adminId}"}';
        SELECT count(*)::text FROM public.enrollments WHERE course_id = '${draftCourseId}';
      `)
      expect(adminDirectCount).toBe('2')

      // Cleanup
      runSql(`
        DELETE FROM public.courses WHERE id = '${draftCourseId}';
      `)
    })

    it('TASK 9.4: verifies published course count/cache mismatch scenario in real PostgreSQL and evaluates source consistency', () => {
      const pubCourseId = '94949494-0010-4444-9494-000000000002'
      const pubSessionId = '94949494-0010-4444-9494-000000000003'

      // Clean up & create a published course with 0 enrollment rows, but cached enrollment_count = 8
      runSql(`
        DELETE FROM public.courses WHERE id = '${pubCourseId}';

        INSERT INTO public.courses (
          id, title, creator_id, status, course_type, enrollment_count
        ) VALUES (
          '${pubCourseId}', 'Published Mismatch Course', '${creatorId}', 'published', 'live', 8
        );
      `)

      // 1. As Creator: direct enrollments query succeeds and returns 0 (since no rows exist)
      const creatorDirectCountStr = runSql(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${creatorId}"}';
        SELECT count(*)::text FROM public.enrollments WHERE course_id = '${pubCourseId}';
      `)
      expect(creatorDirectCountStr).toBe('0')
      const creatorDirectCount = parseInt(creatorDirectCountStr, 10)

      // Creator reads cached count from courses table -> 8
      const creatorCachedCountStr = runSql(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${creatorId}"}';
        SELECT enrollment_count::text FROM public.courses WHERE id = '${pubCourseId}';
      `)
      expect(creatorCachedCountStr).toBe('8')
      const creatorCachedCount = parseInt(creatorCachedCountStr, 10)

      // 2. As Assistant: direct enrollments query also succeeds under RLS and returns 0
      const assistantDirectCountStr = runSql(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${assistantId}"}';
        SELECT count(*)::text FROM public.enrollments WHERE course_id = '${pubCourseId}';
      `)
      expect(assistantDirectCountStr).toBe('0')

      // Assistant can also read published course cached count
      const assistantCachedCountStr = runSql(`
        SET ROLE authenticated;
        SET "request.jwt.claims" = '{"sub": "${assistantId}"}';
        SELECT enrollment_count::text FROM public.courses WHERE id = '${pubCourseId}';
      `)
      expect(assistantCachedCountStr).toBe('8')

      // 3. Verify operational metrics resolution for this mismatch:
      // Direct count is authoritative (0), but cache mismatch (0 vs 8) marks isPartialData = true
      const hasCacheMismatch = creatorDirectCount === 0 && creatorCachedCount > 0
      expect(hasCacheMismatch).toBe(true)

      const liveSession: LiveSession = {
        id: pubSessionId,
        courseId: pubCourseId,
        lessonId: null,
        title: 'Live Published Session',
        description: null,
        scheduledStartAt: '2026-10-09T10:00:00Z',
        scheduledEndAt: '2026-10-09T11:00:00Z',
        timezone: 'UTC',
        status: 'LIVE',
        agenda: [],
        learningObjectives: [],
        preparationNotes: null,
        maxParticipants: 50,
        livekitRoomName: 'room-pub-mismatch',
        startedAt: new Date(Date.now() - 60000).toISOString(),
        endedAt: null,
        createdAt: '2026-10-09T09:00:00Z',
        updatedAt: '2026-10-09T09:00:00Z',
      }

      const operational = computeSessionOperationalMetrics(
        liveSession,
        [],
        creatorDirectCount, // authoritative direct count (0)
        true,
        hasCacheMismatch
      )

      expect(operational.studentAttendance.totalEnrolled).toBe(0) // authoritative direct count
      expect(operational.studentAttendance.isPartialData).toBe(true) // exposed mismatch in LIVE session
      expect(operational.studentAttendance.hasCacheMismatch).toBe(true)
      expect(operational.studentAttendance.hasRosterConflict).toBe(false) // 0 rows <= 0 enrolled
      expect(operational.isPartialData).toBe(true)
      expect(operational.hasCacheMismatch).toBe(true)
      expect(operational.hasRosterConflict).toBe(false)

      // Test LIVE conflict when attendance rows exist but direct enrollment is 0:
      const liveWithRows = computeSessionOperationalMetrics(
        liveSession,
        [
          {
            id: 'att-live-tmp',
            live_session_id: pubSessionId,
            user_id: studentAliceId,
            role: 'student',
            first_joined_at: '2026-10-09T10:05:00Z',
            last_left_at: null,
            total_duration_seconds: 600,
            attendance_status: 'PRESENT',
            is_late: false,
            created_at: '2026-10-09T10:00:00Z',
            updated_at: '2026-10-09T10:10:00Z',
          },
        ],
        creatorDirectCount, // 0
        true,
        hasCacheMismatch // true (0 vs 8)
      )
      expect(liveWithRows.studentAttendance.totalEnrolled).toBe(0) // NEVER substituted with 1
      expect(liveWithRows.studentAttendance.hasRosterConflict).toBe(true)
      expect(liveWithRows.hasRosterConflict).toBe(true)
      expect(liveWithRows.studentAttendance.attendanceRatePct).toBeNull()
      expect(liveWithRows.studentAttendance.notJoinedCount).toBeNull()
      expect(liveWithRows.studentAttendance.isPartialData).toBe(true)
      expect(liveWithRows.isPartialData).toBe(true)

      // 4. BLOCKER A: Verify that for a completed ENDED session with 3 student rows,
      // hasCacheMismatch does NOT corrupt the finalized attendance rate or notJoinedCount:
      const endedSession: LiveSession = {
        ...liveSession,
        status: 'ENDED',
        startedAt: '2026-10-09T10:00:00Z',
        endedAt: '2026-10-09T11:00:00Z',
      }

      const completedRoster: LiveSessionAttendance[] = [
        {
          id: 'att-db-1',
          live_session_id: endedSession.id,
          user_id: studentAliceId,
          role: 'student',
          first_joined_at: '2026-10-09T10:05:00Z',
          last_left_at: '2026-10-09T10:55:00Z',
          total_duration_seconds: 3000,
          attendance_status: 'PRESENT',
          is_late: false,
          created_at: '2026-10-09T10:00:00Z',
          updated_at: '2026-10-09T11:00:00Z',
        },
        {
          id: 'att-db-2',
          live_session_id: endedSession.id,
          user_id: studentBobId,
          role: 'student',
          first_joined_at: '2026-10-09T10:20:00Z',
          last_left_at: '2026-10-09T10:40:00Z',
          total_duration_seconds: 1200,
          attendance_status: 'PARTIAL',
          is_late: true,
          created_at: '2026-10-09T10:00:00Z',
          updated_at: '2026-10-09T11:00:00Z',
        },
        {
          id: 'att-db-3',
          live_session_id: endedSession.id,
          user_id: studentCharlieId,
          role: 'student',
          first_joined_at: null,
          last_left_at: null,
          total_duration_seconds: 0,
          attendance_status: 'ABSENT',
          is_late: false,
          created_at: '2026-10-09T10:00:00Z',
          updated_at: '2026-10-09T11:00:00Z',
        },
      ]

      const endedOperational = computeSessionOperationalMetrics(
        endedSession,
        completedRoster,
        creatorDirectCount, // direct count 0
        true,
        hasCacheMismatch // true (0 vs 8)
      )

      // Authoritative finalized roster size of 3 preserved
      expect(endedOperational.studentAttendance.totalEnrolled).toBe(3)
      expect(endedOperational.studentAttendance.attendedCount).toBe(2)
      expect(endedOperational.studentAttendance.notJoinedCount).toBe(0)
      expect(endedOperational.studentAttendance.attendanceRatePct).toBe(66.7)
      // Attendance data is complete, course cache mismatch is exposed separately
      expect(endedOperational.studentAttendance.isPartialData).toBe(false)
      expect(endedOperational.studentAttendance.hasCacheMismatch).toBe(true)
      expect(endedOperational.studentAttendance.hasRosterConflict).toBe(false)
      expect(endedOperational.isPartialData).toBe(false)
      expect(endedOperational.hasCacheMismatch).toBe(true)
      expect(endedOperational.hasRosterConflict).toBe(false)

      // Cleanup
      runSql(`
        DELETE FROM public.courses WHERE id = '${pubCourseId}';
      `)
    })
  })
})


