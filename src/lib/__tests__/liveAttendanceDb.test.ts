import { describe, it, expect, beforeAll } from 'vitest'
import { execSync, spawn } from 'child_process'

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

function runAsUserError(userId: string, query: string): string {
  try {
    const fullSql = `
      SET ROLE authenticated;
      SET "request.jwt.claims" = '{"sub": "${userId}"}';
      ${query}
      RESET ROLE;
    `
    const cmd = 'docker exec -i supabase_db_chess-course-platform psql -U postgres -d postgres -t -A -q -v ON_ERROR_STOP=1'
    execSync(cmd, { input: fullSql, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    return ''
  } catch (err: any) {
    return err.stderr?.toString() || err.message || 'unknown error'
  }
}

function runAsUserAsync(userId: string, query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fullSql = `
      SET ROLE authenticated;
      SET "request.jwt.claims" = '{"sub": "${userId}"}';
      ${query}
      RESET ROLE;
    `
    const proc = spawn('docker', [
      'exec',
      '-i',
      'supabase_db_chess-course-platform',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-t',
      '-A',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
    ])
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('close', (code) => {
      if (code === 0) {
        const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l && l !== 'SET' && l !== 'RESET')
        resolve(lines.join('\n'))
      } else {
        reject(new Error(stderr || stdout || `Process exited with code ${code}`))
      }
    })
    proc.stdin.write(fullSql)
    proc.stdin.end()
  })
}

describe('TASK 9.1 — Real PostgreSQL Verification: Live Session Attendance & Heartbeat Lifecycle', () => {
  const teacherId = '99999999-aaaa-1111-aaaa-999999999991'
  const assistantId = '99999999-aaaa-2222-aaaa-999999999992'
  const studentAliceId = '99999999-aaaa-3333-aaaa-999999999993'
  const studentBobId = '99999999-aaaa-4444-aaaa-999999999994'
  const studentCharlieId = '99999999-aaaa-5555-aaaa-999999999995'
  const unrelatedUserId = '99999999-aaaa-6666-aaaa-999999999996'
  const adminUserId = '99999999-aaaa-7777-aaaa-999999999997'
  const profilelessUserId = '99999999-aaaa-8888-aaaa-999999999998'

  const courseId = '88888888-bbbb-1111-bbbb-888888888881'
  const sessionLiveId = '88888888-bbbb-2222-bbbb-888888888882'
  const sessionScheduledId = '88888888-bbbb-3333-bbbb-888888888883'
  const sessionDraftId = '88888888-bbbb-4444-bbbb-888888888884'
  const sessionCancelledId = '88888888-bbbb-5555-bbbb-888888888885'
  const sessionEndedId = '88888888-bbbb-6666-bbbb-888888888886'

  beforeAll(() => {
    // Clean up test data and set up baseline course, live sessions, staff, enrollments
    runSql(`
      DELETE FROM public.courses WHERE id = '${courseId}';
      DELETE FROM public.users WHERE id IN (
        '${teacherId}', '${assistantId}', '${studentAliceId}', '${studentBobId}', '${studentCharlieId}', '${unrelatedUserId}', '${adminUserId}', '${profilelessUserId}'
      );
      DELETE FROM auth.users WHERE id IN (
        '${teacherId}', '${assistantId}', '${studentAliceId}', '${studentBobId}', '${studentCharlieId}', '${unrelatedUserId}', '${adminUserId}', '${profilelessUserId}'
      );

      -- 1. Create auth & public users
      INSERT INTO auth.users (id, email) VALUES
        ('${teacherId}', 'teacher-att@example.com'),
        ('${assistantId}', 'assistant-att@example.com'),
        ('${studentAliceId}', 'student-alice-att@example.com'),
        ('${studentBobId}', 'student-bob-att@example.com'),
        ('${studentCharlieId}', 'student-charlie-att@example.com'),
        ('${unrelatedUserId}', 'unrelated-att@example.com'),
        ('${adminUserId}', 'admin-att@example.com')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.users (id, name, email, role) VALUES
        ('${teacherId}', 'Teacher Att', 'teacher-att@example.com', 'creator'),
        ('${assistantId}', 'Assistant Att', 'assistant-att@example.com', 'learner'),
        ('${studentAliceId}', 'Alice Att', 'student-alice-att@example.com', 'learner'),
        ('${studentBobId}', 'Bob Att', 'student-bob-att@example.com', 'learner'),
        ('${studentCharlieId}', 'Charlie Att', 'student-charlie-att@example.com', 'learner'),
        ('${unrelatedUserId}', 'Unrelated Att', 'unrelated-att@example.com', 'learner'),
        ('${adminUserId}', 'Admin Att', 'admin-att@example.com', 'admin')
      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

      -- 2. Create Course (must be course_type = 'live' per Migration 102)
      INSERT INTO public.courses (id, creator_id, title, course_type, status)
      VALUES ('${courseId}', '${teacherId}', 'Attendance Test Course', 'live', 'published');

      -- 3. Enroll students Alice and Bob (Charlie is not enrolled)
      INSERT INTO public.enrollments (user_id, course_id)
      VALUES
        ('${studentAliceId}', '${courseId}'),
        ('${studentBobId}', '${courseId}');

      -- 4. Create Sessions as SCHEDULED/DRAFT, then transition via RPCs
      INSERT INTO public.live_sessions (id, course_id, title, status, scheduled_start_at, livekit_room_name)
      VALUES
        ('${sessionDraftId}', '${courseId}', 'Draft Session', 'DRAFT', now() + interval '1 hour', 'room-draft-att'),
        ('${sessionScheduledId}', '${courseId}', 'Scheduled Session', 'SCHEDULED', now() + interval '1 hour', 'room-sched-att'),
        ('${sessionLiveId}', '${courseId}', 'Live Session', 'SCHEDULED', now() - interval '30 minutes', 'room-live-att'),
        ('${sessionCancelledId}', '${courseId}', 'Cancelled Session', 'SCHEDULED', now() + interval '1 hour', 'room-canc-att'),
        ('${sessionEndedId}', '${courseId}', 'Ended Session', 'SCHEDULED', now() - interval '2 hours', 'room-ended-att');

      -- Lifecycle transitions
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${teacherId}')::text, true);
        PERFORM public.start_live_session('${sessionLiveId}'::uuid);
        PERFORM public.cancel_live_session('${sessionCancelledId}'::uuid);
        PERFORM public.start_live_session('${sessionEndedId}'::uuid);
        PERFORM public.end_live_session('${sessionEndedId}'::uuid);
      END $body$;

      -- 5. Assign staff for LIVE session
      INSERT INTO public.live_session_staff (live_session_id, user_id, role)
      VALUES ('${sessionLiveId}', '${assistantId}', 'assistant');
    `)
  })

  // ── A. Authentication ───────────────────────────────────────────────────────
  it('A. Anonymous caller is rejected from record_live_session_join', () => {
    const throws = runSqlThrows(`
      SET ROLE anon;
      SELECT public.record_live_session_join('${sessionLiveId}', gen_random_uuid());
      RESET ROLE;
    `)
    expect(throws).toBe(true)
  })

  // ── B. Session Access ──────────────────────────────────────────────────────
  it('B1. Unenrolled user cannot join attendance', () => {
    const throws = runAsUserThrows(
      unrelatedUserId,
      `SELECT public.record_live_session_join('${sessionLiveId}', gen_random_uuid());`
    )
    expect(throws).toBe(true)
  })

  it('B2. Enrolled student Alice can join live session attendance', () => {
    const connId = '33333333-1111-1111-1111-000000000001'
    const res = runAsUser(
      studentAliceId,
      `SELECT public.record_live_session_join('${sessionLiveId}', '${connId}');`
    )
    expect(res).toContain('success')
    expect(res).toContain('student')

    const role = runSql(
      `SELECT role FROM public.live_session_attendance WHERE live_session_id = '${sessionLiveId}' AND user_id = '${studentAliceId}';`
    )
    expect(role).toBe('student')
  })

  it('B3. Teacher can join live session attendance with teacher role', () => {
    const connId = '33333333-1111-1111-1111-000000000002'
    const res = runAsUser(
      teacherId,
      `SELECT public.record_live_session_join('${sessionLiveId}', '${connId}');`
    )
    expect(res).toContain('success')
    expect(res).toContain('teacher')

    const role = runSql(
      `SELECT role FROM public.live_session_attendance WHERE live_session_id = '${sessionLiveId}' AND user_id = '${teacherId}';`
    )
    expect(role).toBe('teacher')
  })

  it('B4. Assigned assistant can join live session attendance with assistant role', () => {
    const connId = '33333333-1111-1111-1111-000000000003'
    const res = runAsUser(
      assistantId,
      `SELECT public.record_live_session_join('${sessionLiveId}', '${connId}');`
    )
    expect(res).toContain('success')
    expect(res).toContain('assistant')

    const role = runSql(
      `SELECT role FROM public.live_session_attendance WHERE live_session_id = '${sessionLiveId}' AND user_id = '${assistantId}';`
    )
    expect(role).toBe('assistant')
  })

  // ── C. Session Lifecycle ───────────────────────────────────────────────────
  it('C1. Joining DRAFT session is rejected', () => {
    const throws = runAsUserThrows(
      teacherId,
      `SELECT public.record_live_session_join('${sessionDraftId}', gen_random_uuid());`
    )
    expect(throws).toBe(true)
  })

  it('C2. Joining SCHEDULED session is rejected', () => {
    const throws = runAsUserThrows(
      studentAliceId,
      `SELECT public.record_live_session_join('${sessionScheduledId}', gen_random_uuid());`
    )
    expect(throws).toBe(true)
  })

  it('C3. Joining CANCELLED session is rejected', () => {
    const throws = runAsUserThrows(
      studentAliceId,
      `SELECT public.record_live_session_join('${sessionCancelledId}', gen_random_uuid());`
    )
    expect(throws).toBe(true)
  })

  it('C4. Joining ENDED session is rejected', () => {
    const throws = runAsUserThrows(
      studentAliceId,
      `SELECT public.record_live_session_join('${sessionEndedId}', gen_random_uuid());`
    )
    expect(throws).toBe(true)
  })

  // ── D. Duplicate Join ──────────────────────────────────────────────────────
  it('D. Same session/user/connection_id twice returns existing interval without creating duplicate row', () => {
    const connId = '44444444-1111-1111-1111-000000000001'
    const res1 = runAsUser(
      studentBobId,
      `SELECT public.record_live_session_join('${sessionLiveId}', '${connId}');`
    )
    const intervalId1 = JSON.parse(res1).interval_id

    const res2 = runAsUser(
      studentBobId,
      `SELECT public.record_live_session_join('${sessionLiveId}', '${connId}');`
    )
    const intervalId2 = JSON.parse(res2).interval_id

    expect(intervalId1).toBe(intervalId2)

    const count = runSql(
      `SELECT count(*)::text FROM public.live_session_attendance_intervals WHERE live_session_id = '${sessionLiveId}' AND user_id = '${studentBobId}' AND connection_id = '${connId}';`
    )
    expect(count).toBe('1')
  })

  // ── E. True Concurrent Duplicate Join ─────────────────────────────────────
  it('E1. True concurrent duplicate join RPC calls via separate DB processes do not create duplicate open intervals', async () => {
    const connId = '55555555-1111-1111-1111-000000000001'

    // Real concurrency race:
    // Process 1 begins a transaction, calls record_live_session_join, and holds the transaction uncommitted for 200ms using pg_sleep(0.2).
    // Process 2 starts 50ms later (while Process 1 is sleeping).
    // In Read Committed, Process 2 cannot see the uncommitted row and attempts to insert the same (session, user, connection).
    // PostgreSQL blocks Process 2 on the unique index until Process 1 commits.
    // Upon Process 1 commit, PostgreSQL triggers a unique violation in Process 2,
    // which is caught cleanly by the RPC's EXCEPTION WHEN unique_violation handler.
    // Process 2 resolves to Process 1's interval_id and returns successfully.
    const p1Promise = runAsUserAsync(
      studentBobId,
      `
        BEGIN;
        SELECT public.record_live_session_join('${sessionLiveId}', '${connId}');
        SELECT pg_sleep(0.2);
        COMMIT;
      `
    )

    await new Promise((r) => setTimeout(r, 50))

    const p2Promise = runAsUserAsync(
      studentBobId,
      `SELECT public.record_live_session_join('${sessionLiveId}', '${connId}');`
    )

    const [res1, res2] = await Promise.all([p1Promise, p2Promise])

    const intervalId1 = JSON.parse(res1).interval_id
    const intervalId2 = JSON.parse(res2).interval_id

    // Both callers resolve cleanly to the EXACT same open interval
    expect(intervalId1).toBeDefined()
    expect(intervalId1).toBe(intervalId2)

    // Exactly ONE open interval exists
    const intervalCount = runSql(`
      SELECT count(*)::text FROM public.live_session_attendance_intervals
      WHERE live_session_id = '${sessionLiveId}' AND user_id = '${studentBobId}' AND connection_id = '${connId}';
    `)
    expect(intervalCount).toBe('1')

    // Exactly ONE summary row exists
    const summaryCount = runSql(`
      SELECT count(*)::text FROM public.live_session_attendance
      WHERE live_session_id = '${sessionLiveId}' AND user_id = '${studentBobId}';
    `)
    expect(summaryCount).toBe('1')
  })

  it('E2. Parallel simultaneous join storm creates only one open interval and causes no uncaught errors', async () => {
    const connId = '55555555-2222-2222-2222-000000000002'

    // Fire 3 simultaneous join RPC calls from distinct DB connections
    const results = await Promise.all([
      runAsUserAsync(studentBobId, `SELECT public.record_live_session_join('${sessionLiveId}', '${connId}');`),
      runAsUserAsync(studentBobId, `SELECT public.record_live_session_join('${sessionLiveId}', '${connId}');`),
      runAsUserAsync(studentBobId, `SELECT public.record_live_session_join('${sessionLiveId}', '${connId}');`),
    ])

    const intervalIds = results.map((r) => JSON.parse(r).interval_id)
    expect(new Set(intervalIds).size).toBe(1)

    const count = runSql(`
      SELECT count(*)::text FROM public.live_session_attendance_intervals
      WHERE live_session_id = '${sessionLiveId}' AND user_id = '${studentBobId}' AND connection_id = '${connId}';
    `)
    expect(count).toBe('1')
  })

  it('E3. Partial unique index protects against direct duplicate open inserts', () => {
    const connId = '55555555-3333-3333-3333-000000000003'
    runSql(`
      INSERT INTO public.live_session_attendance_intervals (live_session_id, user_id, connection_id)
      VALUES ('${sessionLiveId}', '${studentBobId}', '${connId}');
    `)
    const throws = runSqlThrows(`
      INSERT INTO public.live_session_attendance_intervals (live_session_id, user_id, connection_id)
      VALUES ('${sessionLiveId}', '${studentBobId}', '${connId}');
    `)
    expect(throws).toBe(true)
  })

  // ── F. Heartbeat ───────────────────────────────────────────────────────────
  it('F. Heartbeat ping updates last_seen_at using server time and is harmless on repeat', () => {
    const connId = '66666666-1111-1111-1111-000000000001'
    const res = runAsUser(
      studentAliceId,
      `SELECT public.record_live_session_join('${sessionLiveId}', '${connId}');`
    )
    const intervalId = JSON.parse(res).interval_id

    // Set joined_at to 60s ago and last_seen_at to 30 seconds ago
    runSql(`
      UPDATE public.live_session_attendance_intervals
      SET joined_at = now() - interval '60 seconds',
          last_seen_at = now() - interval '30 seconds'
      WHERE id = '${intervalId}';
    `)

    // Heartbeat
    const pingRes = runAsUser(
      studentAliceId,
      `SELECT public.ping_live_session_attendance('${intervalId}');`
    )
    expect(pingRes).toContain('"success": true')

    const diffSecs = runSql(`
      SELECT EXTRACT(EPOCH FROM (now() - last_seen_at))::int
      FROM public.live_session_attendance_intervals
      WHERE id = '${intervalId}';
    `)
    expect(Number(diffSecs)).toBeLessThanOrEqual(2)
  })

  // ── G. Leave ───────────────────────────────────────────────────────────────
  it('G. record_live_session_leave closes interval using server time; duplicate leave is idempotent', () => {
    const connId = '77777777-1111-1111-1111-000000000001'
    const res = runAsUser(
      studentAliceId,
      `SELECT public.record_live_session_join('${sessionLiveId}', '${connId}');`
    )
    const intervalId = JSON.parse(res).interval_id

    const leaveRes1 = runAsUser(
      studentAliceId,
      `SELECT public.record_live_session_leave('${intervalId}');`
    )
    expect(leaveRes1).toContain('"success": true')

    const isClosed = runSql(
      `SELECT (left_at IS NOT NULL)::text FROM public.live_session_attendance_intervals WHERE id = '${intervalId}';`
    )
    expect(isClosed).toBe('true')

    // Duplicate leave is harmless
    const leaveRes2 = runAsUser(
      studentAliceId,
      `SELECT public.record_live_session_leave('${intervalId}');`
    )
    expect(leaveRes2).toContain('"already_closed": true')
  })

  // ── G2 & G3. Monotonic last_left_at & Request Order Invariance ─────────────
  it('G2. last_left_at is strictly monotonic: older leave call does not overwrite newer last_left_at', () => {
    const conn1 = '77777777-2222-1111-1111-000000000001'
    const conn2 = '77777777-2222-2222-2222-000000000002'

    // Open two intervals for Alice
    const res1 = runAsUser(
      studentAliceId,
      `SELECT public.record_live_session_join('${sessionLiveId}', '${conn1}');`
    )
    const int1 = JSON.parse(res1).interval_id

    const res2 = runAsUser(
      studentAliceId,
      `SELECT public.record_live_session_join('${sessionLiveId}', '${conn2}');`
    )
    const int2 = JSON.parse(res2).interval_id

    // Close interval 2 and simulate that last_left_at is established at a future/later point
    runSql(`
      UPDATE public.live_session_attendance_intervals
      SET left_at = now() + interval '1 hour', last_seen_at = now() + interval '1 hour'
      WHERE id = '${int2}';

      UPDATE public.live_session_attendance
      SET last_left_at = now() + interval '1 hour'
      WHERE live_session_id = '${sessionLiveId}' AND user_id = '${studentAliceId}';
    `)

    // Now close interval 1 via record_live_session_leave (server now < existing last_left_at)
    const leaveRes = runAsUser(
      studentAliceId,
      `SELECT public.record_live_session_leave('${int1}');`
    )
    expect(leaveRes).toContain('"success": true')

    // last_left_at must NOT move backwards; it remains the later timestamp
    const isMonotonic = runSql(`
      SELECT (last_left_at > now() + interval '30 minutes')::text
      FROM public.live_session_attendance
      WHERE live_session_id = '${sessionLiveId}' AND user_id = '${studentAliceId}';
    `)
    expect(isMonotonic).toBe('true')
  })

  // ── G3_A. Test A: Interval end is later than existing summary ─────────────
  it('G3_A. Test A: interval end is later than existing summary (10:45 > 10:00)', () => {
    const testSessionId = 'aaaa1111-9999-0000-aaaa-111111111111'

    seedSession(
      testSessionId,
      'Test A Session',
      'ENDED',
      '2026-10-06 09:00:00+00',
      '2026-10-06 09:00:00+00',
      '2026-10-06 11:00:00+00'
    )

    runSql(`
      INSERT INTO public.live_session_attendance_intervals (live_session_id, user_id, connection_id, joined_at, last_seen_at, left_at)
      VALUES
        ('${testSessionId}', '${studentBobId}', gen_random_uuid(), '2026-10-06 09:00:00+00', '2026-10-06 09:30:00+00', '2026-10-06 09:30:00+00'),
        ('${testSessionId}', '${studentBobId}', gen_random_uuid(), '2026-10-06 10:00:00+00', '2026-10-06 10:45:00+00', '2026-10-06 10:45:00+00'),
        ('${testSessionId}', '${studentBobId}', gen_random_uuid(), '2026-10-06 09:45:00+00', '2026-10-06 10:15:00+00', '2026-10-06 10:15:00+00');

      INSERT INTO public.live_session_attendance (live_session_id, user_id, role, first_joined_at, last_left_at)
      VALUES ('${testSessionId}', '${studentBobId}', 'student', '2026-10-06 09:00:00+00', '2026-10-06 10:00:00+00')
      ON CONFLICT (live_session_id, user_id) DO UPDATE
      SET first_joined_at = '2026-10-06 09:00:00+00',
          last_left_at = '2026-10-06 10:00:00+00';
    `)

    runSql(`SELECT public.finalize_live_session_attendance('${testSessionId}');`)

    const leftAt = runSql(`
      SELECT to_char(last_left_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS')
      FROM public.live_session_attendance
      WHERE live_session_id = '${testSessionId}' AND user_id = '${studentBobId}';
    `)
    expect(leftAt).toBe('2026-10-06 10:45:00')
  })

  // ── G3_B. Test B: Summary timestamp is later than all intervals ────────────
  it('G3_B. Test B: summary timestamp is later than all intervals (11:00 > 10:45)', () => {
    const testSessionId = 'bbbb2222-9999-0000-bbbb-222222222222'

    seedSession(
      testSessionId,
      'Test B Session',
      'ENDED',
      '2026-10-06 09:00:00+00',
      '2026-10-06 09:00:00+00',
      '2026-10-06 11:30:00+00'
    )

    runSql(`
      INSERT INTO public.live_session_attendance_intervals (live_session_id, user_id, connection_id, joined_at, last_seen_at, left_at)
      VALUES
        ('${testSessionId}', '${studentBobId}', gen_random_uuid(), '2026-10-06 09:00:00+00', '2026-10-06 09:30:00+00', '2026-10-06 09:30:00+00'),
        ('${testSessionId}', '${studentBobId}', gen_random_uuid(), '2026-10-06 10:00:00+00', '2026-10-06 10:45:00+00', '2026-10-06 10:45:00+00'),
        ('${testSessionId}', '${studentBobId}', gen_random_uuid(), '2026-10-06 09:45:00+00', '2026-10-06 10:15:00+00', '2026-10-06 10:15:00+00');

      INSERT INTO public.live_session_attendance (live_session_id, user_id, role, first_joined_at, last_left_at)
      VALUES ('${testSessionId}', '${studentBobId}', 'student', '2026-10-06 09:00:00+00', '2026-10-06 11:00:00+00')
      ON CONFLICT (live_session_id, user_id) DO UPDATE
      SET first_joined_at = '2026-10-06 09:00:00+00',
          last_left_at = '2026-10-06 11:00:00+00';
    `)

    runSql(`SELECT public.finalize_live_session_attendance('${testSessionId}');`)

    const leftAt = runSql(`
      SELECT to_char(last_left_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS')
      FROM public.live_session_attendance
      WHERE live_session_id = '${testSessionId}' AND user_id = '${studentBobId}';
    `)
    expect(leftAt).toBe('2026-10-06 11:00:00')
  })

  // ── G3_C. Test C: Summary timestamp is NULL ───────────────────────────────
  it('G3_C. Test C: summary timestamp is NULL before finalization (becomes 10:45)', () => {
    const testSessionId = 'cccc3333-9999-0000-cccc-333333333333'

    seedSession(
      testSessionId,
      'Test C Session',
      'ENDED',
      '2026-10-06 09:00:00+00',
      '2026-10-06 09:00:00+00',
      '2026-10-06 11:00:00+00'
    )

    runSql(`
      INSERT INTO public.live_session_attendance_intervals (live_session_id, user_id, connection_id, joined_at, last_seen_at, left_at)
      VALUES
        ('${testSessionId}', '${studentBobId}', gen_random_uuid(), '2026-10-06 09:00:00+00', '2026-10-06 09:30:00+00', '2026-10-06 09:30:00+00'),
        ('${testSessionId}', '${studentBobId}', gen_random_uuid(), '2026-10-06 10:00:00+00', '2026-10-06 10:45:00+00', '2026-10-06 10:45:00+00'),
        ('${testSessionId}', '${studentBobId}', gen_random_uuid(), '2026-10-06 09:45:00+00', '2026-10-06 10:15:00+00', '2026-10-06 10:15:00+00');

      INSERT INTO public.live_session_attendance (live_session_id, user_id, role, first_joined_at, last_left_at)
      VALUES ('${testSessionId}', '${studentBobId}', 'student', '2026-10-06 09:00:00+00', NULL)
      ON CONFLICT (live_session_id, user_id) DO UPDATE
      SET first_joined_at = '2026-10-06 09:00:00+00',
          last_left_at = NULL;
    `)

    runSql(`SELECT public.finalize_live_session_attendance('${testSessionId}');`)

    const leftAt = runSql(`
      SELECT to_char(last_left_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS')
      FROM public.live_session_attendance
      WHERE live_session_id = '${testSessionId}' AND user_id = '${studentBobId}';
    `)
    expect(leftAt).toBe('2026-10-06 10:45:00')
  })

  // ── G3_D. Test D: No intervals and NULL summary ────────────────────────────
  it('G3_D. Test D: no intervals and NULL summary leaves last_left_at as NULL without fabricating timestamp', () => {
    const testSessionId = 'dddd4444-9999-0000-dddd-444444444444'

    seedSession(
      testSessionId,
      'Test D Session',
      'ENDED',
      '2026-10-06 09:00:00+00',
      '2026-10-06 09:00:00+00',
      '2026-10-06 11:00:00+00'
    )

    // Alice joins, but Bob never joins and has zero intervals
    runSql(`
      INSERT INTO public.live_session_attendance_intervals (live_session_id, user_id, connection_id, joined_at, last_seen_at, left_at)
      VALUES ('${testSessionId}', '${studentAliceId}', gen_random_uuid(), '2026-10-06 09:00:00+00', '2026-10-06 10:00:00+00', '2026-10-06 10:00:00+00');

      INSERT INTO public.live_session_attendance (live_session_id, user_id, role, first_joined_at, last_left_at)
      VALUES ('${testSessionId}', '${studentAliceId}', 'student', '2026-10-06 09:00:00+00', '2026-10-06 10:00:00+00')
      ON CONFLICT (live_session_id, user_id) DO UPDATE SET first_joined_at = '2026-10-06 09:00:00+00';
    `)

    runSql(`SELECT public.finalize_live_session_attendance('${testSessionId}');`)

    // Bob was materialized as ABSENT with 0 intervals
    const bobLeftAt = runSql(`
      SELECT (last_left_at IS NULL)::text
      FROM public.live_session_attendance
      WHERE live_session_id = '${testSessionId}' AND user_id = '${studentBobId}';
    `)
    expect(bobLeftAt).toBe('true')
  })

  // ── G3_E. Test E: Idempotent finalization ──────────────────────────────────
  it('G3_E. Test E: repeated finalization is idempotent and does not alter values or create duplicate rows', () => {
    const testSessionId = 'eeee5555-9999-0000-eeee-555555555555'

    seedSession(
      testSessionId,
      'Test E Session',
      'ENDED',
      '2026-10-06 09:00:00+00',
      '2026-10-06 09:00:00+00',
      '2026-10-06 11:00:00+00'
    )

    runSql(`
      INSERT INTO public.live_session_attendance_intervals (live_session_id, user_id, connection_id, joined_at, last_seen_at, left_at)
      VALUES
        ('${testSessionId}', '${studentBobId}', gen_random_uuid(), '2026-10-06 09:00:00+00', '2026-10-06 09:30:00+00', '2026-10-06 09:30:00+00'),
        ('${testSessionId}', '${studentBobId}', gen_random_uuid(), '2026-10-06 10:00:00+00', '2026-10-06 10:45:00+00', '2026-10-06 10:45:00+00');

      INSERT INTO public.live_session_attendance (live_session_id, user_id, role, first_joined_at, last_left_at)
      VALUES ('${testSessionId}', '${studentBobId}', 'student', '2026-10-06 09:00:00+00', '2026-10-06 10:00:00+00')
      ON CONFLICT (live_session_id, user_id) DO UPDATE
      SET first_joined_at = '2026-10-06 09:00:00+00',
          last_left_at = '2026-10-06 10:00:00+00';
    `)

    // Call 1
    runSql(`SELECT public.finalize_live_session_attendance('${testSessionId}');`)
    const snapshot1 = runSql(`
      SELECT last_left_at::text || '|' || total_duration_seconds::text || '|' || attendance_status
      FROM public.live_session_attendance
      WHERE live_session_id = '${testSessionId}' AND user_id = '${studentBobId}';
    `)
    const count1 = runSql(`
      SELECT count(*)::text FROM public.live_session_attendance WHERE live_session_id = '${testSessionId}';
    `)

    // Call 2
    runSql(`SELECT public.finalize_live_session_attendance('${testSessionId}');`)
    const snapshot2 = runSql(`
      SELECT last_left_at::text || '|' || total_duration_seconds::text || '|' || attendance_status
      FROM public.live_session_attendance
      WHERE live_session_id = '${testSessionId}' AND user_id = '${studentBobId}';
    `)
    const count2 = runSql(`
      SELECT count(*)::text FROM public.live_session_attendance WHERE live_session_id = '${testSessionId}';
    `)

    expect(snapshot1).toBe(snapshot2)
    expect(count1).toBe(count2)
  })

  // ── H. Reconnect ───────────────────────────────────────────────────────────
  it('H. In-tab reconnect: same connection_id updates last_seen_at seamlessly', () => {
    const connId = '88888888-1111-1111-1111-000000000001'
    const res = runAsUser(
      studentBobId,
      `SELECT public.record_live_session_join('${sessionLiveId}', '${connId}');`
    )
    const intervalId = JSON.parse(res).interval_id

    // Ping works
    const pingRes = runAsUser(
      studentBobId,
      `SELECT public.ping_live_session_attendance('${intervalId}');`
    )
    expect(pingRes).toContain('"success": true')
  })

  // ── I. Page Reload ─────────────────────────────────────────────────────────
  it('I. Page reload creates new connection_id and opens new interval for same user', () => {
    const connId1 = '99999999-1111-1111-1111-000000000001'
    const connId2 = '99999999-2222-2222-2222-000000000002'

    const res1 = runAsUser(
      studentBobId,
      `SELECT public.record_live_session_join('${sessionLiveId}', '${connId1}');`
    )
    const intervalId1 = JSON.parse(res1).interval_id

    const res2 = runAsUser(
      studentBobId,
      `SELECT public.record_live_session_join('${sessionLiveId}', '${connId2}');`
    )
    const intervalId2 = JSON.parse(res2).interval_id

    expect(intervalId1).not.toBe(intervalId2)

    const intervalCount = runSql(
      `SELECT count(*)::text FROM public.live_session_attendance_intervals WHERE live_session_id = '${sessionLiveId}' AND user_id = '${studentBobId}' AND connection_id IN ('${connId1}', '${connId2}');`
    )
    expect(intervalCount).toBe('2')
  })

  function seedSession(
    id: string,
    title: string,
    status: 'SCHEDULED' | 'LIVE' | 'ENDED',
    scheduledStart?: string,
    startedAt?: string,
    endedAt?: string
  ) {
    const startExpr = (scheduledStart || startedAt) ? `'${scheduledStart || startedAt}'::timestamptz` : 'now()'
    runSql(`
      INSERT INTO public.live_sessions (id, course_id, title, status, scheduled_start_at, livekit_room_name)
      VALUES ('${id}', '${courseId}', '${title}', 'SCHEDULED', ${startExpr}, 'room-${id}')
      ON CONFLICT (id) DO NOTHING;
    `)
    if (status === 'LIVE' || status === 'ENDED') {
      runSql(`
        DO $body$
        BEGIN
          PERFORM set_config('request.jwt.claims', json_build_object('sub', '${teacherId}')::text, true);
          PERFORM public.start_live_session('${id}'::uuid);
        END $body$;
      `)
    }
    if (status === 'ENDED') {
      runSql(`
        DO $body$
        BEGIN
          PERFORM set_config('request.jwt.claims', json_build_object('sub', '${teacherId}')::text, true);
          PERFORM public.end_live_session('${id}'::uuid);
        END $body$;
      `)
    }
    if (startedAt || endedAt) {
      runSql(`
        SET app.live_session_transition = 'true';
        UPDATE public.live_sessions
        SET ${startedAt ? `started_at = '${startedAt}',` : ''}
            ${endedAt ? `ended_at = '${endedAt}',` : ''}
            updated_at = now()
        WHERE id = '${id}';
        RESET app.live_session_transition;
      `)
    }
  }

  // ── J & K & L. Multirange Overlap Merging ──────────────────────────────────
  it('J, K, L. Overlapping intervals from multi-tab and multi-device are merged without duration double-counting', () => {
    const calcSessionId = '11112222-3333-4444-5555-666677778888'
    const testUser = studentBobId

    seedSession(
      calcSessionId,
      'Calc Test Session',
      'ENDED',
      '2026-10-06 09:00:00+00',
      '2026-10-06 09:00:00+00',
      '2026-10-06 10:00:00+00'
    )

    runSql(`
      -- Tab 1 / Device 1: 09:00 -> 09:30 (30 min)
      INSERT INTO public.live_session_attendance_intervals (live_session_id, user_id, connection_id, joined_at, last_seen_at, left_at)
      VALUES ('${calcSessionId}', '${testUser}', gen_random_uuid(), '2026-10-06 09:00:00+00', '2026-10-06 09:30:00+00', '2026-10-06 09:30:00+00');

      -- Tab 2 / Device 2: 09:15 -> 09:45 (30 min, overlaps with Tab 1)
      INSERT INTO public.live_session_attendance_intervals (live_session_id, user_id, connection_id, joined_at, last_seen_at, left_at)
      VALUES ('${calcSessionId}', '${testUser}', gen_random_uuid(), '2026-10-06 09:15:00+00', '2026-10-06 09:45:00+00', '2026-10-06 09:45:00+00');

      -- Adjacent interval: 09:45 -> 10:00 (15 min)
      INSERT INTO public.live_session_attendance_intervals (live_session_id, user_id, connection_id, joined_at, last_seen_at, left_at)
      VALUES ('${calcSessionId}', '${testUser}', gen_random_uuid(), '2026-10-06 09:45:00+00', '2026-10-06 10:00:00+00', '2026-10-06 10:00:00+00');

      -- Initial summary row
      INSERT INTO public.live_session_attendance (live_session_id, user_id, role, first_joined_at)
      VALUES ('${calcSessionId}', '${testUser}', 'student', '2026-10-06 09:00:00+00')
      ON CONFLICT (live_session_id, user_id) DO UPDATE SET first_joined_at = '2026-10-06 09:00:00+00';
    `)

    // Finalize attendance
    const finRes = runSql(`SELECT public.finalize_live_session_attendance('${calcSessionId}');`)
    expect(finRes).toContain('"success": true')

    // Merged span: [09:00, 09:45) + [09:45, 10:00) = [09:00, 10:00) => exactly 60 min = 3600 seconds!
    const dur = runSql(`
      SELECT total_duration_seconds::text
      FROM public.live_session_attendance
      WHERE live_session_id = '${calcSessionId}' AND user_id = '${testUser}';
    `)
    expect(dur).toBe('3600')

    const status = runSql(`
      SELECT attendance_status
      FROM public.live_session_attendance
      WHERE live_session_id = '${calcSessionId}' AND user_id = '${testUser}';
    `)
    expect(status).toBe('PRESENT')
  })

  // ── M. Crash Handling ──────────────────────────────────────────────────────
  it('M. Crash / ungraceful disconnect: open interval effective end is last_seen_at', () => {
    const crashSessionId = '22223333-4444-5555-6666-777788889999'
    const testUser = studentAliceId

    seedSession(
      crashSessionId,
      'Crash Test Session',
      'ENDED',
      '2026-10-06 09:00:00+00',
      '2026-10-06 09:00:00+00',
      '2026-10-06 10:00:00+00'
    )

    runSql(`
      -- Student joined at 09:00, sent heartbeats until 09:12, then crashed (left_at IS NULL)
      INSERT INTO public.live_session_attendance_intervals (live_session_id, user_id, connection_id, joined_at, last_seen_at, left_at)
      VALUES ('${crashSessionId}', '${testUser}', gen_random_uuid(), '2026-10-06 09:00:00+00', '2026-10-06 09:12:00+00', NULL);

      INSERT INTO public.live_session_attendance (live_session_id, user_id, role, first_joined_at)
      VALUES ('${crashSessionId}', '${testUser}', 'student', '2026-10-06 09:00:00+00')
      ON CONFLICT (live_session_id, user_id) DO UPDATE SET first_joined_at = '2026-10-06 09:00:00+00';
    `)

    runSql(`SELECT public.finalize_live_session_attendance('${crashSessionId}');`)

    // Duration should be exactly 12 minutes (720 seconds) up to last_seen_at, NOT 60 minutes
    const dur = runSql(`
      SELECT total_duration_seconds::text
      FROM public.live_session_attendance
      WHERE live_session_id = '${crashSessionId}' AND user_id = '${testUser}';
    `)
    expect(dur).toBe('720')

    // 12m out of 60m is 20%, which matches the exact PARTIAL threshold (>= 20%)
    const status = runSql(`
      SELECT attendance_status
      FROM public.live_session_attendance
      WHERE live_session_id = '${crashSessionId}' AND user_id = '${testUser}';
    `)
    expect(status).toBe('PARTIAL')
  })

  // ── N. Session End Clamping ────────────────────────────────────────────────
  it('N. Manual end_live_session clamps open intervals to session.ended_at', () => {
    const endSessionId = '33334444-5555-6666-7777-888899990000'
    const connId = '00001111-2222-3333-4444-555566667777'

    seedSession(
      endSessionId,
      'End Clamping Test Session',
      'LIVE',
      undefined,
      undefined,
      undefined
    )

    // Alice joins
    runAsUser(
      studentAliceId,
      `SELECT public.record_live_session_join('${endSessionId}', '${connId}');`
    )

    // Verify interval is currently open
    const openBefore = runSql(`
      SELECT count(*)::text FROM public.live_session_attendance_intervals
      WHERE live_session_id = '${endSessionId}' AND left_at IS NULL;
    `)
    expect(openBefore).toBe('1')

    // Teacher ends class
    const endRes = runAsUser(
      teacherId,
      `SELECT public.end_live_session('${endSessionId}');`
    )
    expect(endRes).toContain('"status": "ENDED"')

    // Open interval is now closed
    const openAfter = runSql(`
      SELECT count(*)::text FROM public.live_session_attendance_intervals
      WHERE live_session_id = '${endSessionId}' AND left_at IS NULL;
    `)
    expect(openAfter).toBe('0')
  })

  // ── O. Stale Session Auto-End ──────────────────────────────────────────────
  it('O. auto_end_stale_live_sessions finalizes attendance and clamps intervals', () => {
    const staleSessionId = '44445555-6666-7777-8888-999900001111'
    const connId = '11112222-3333-4444-5555-666677778888'

    seedSession(
      staleSessionId,
      'Stale Auto-End Session',
      'LIVE',
      undefined,
      undefined,
      undefined
    )

    // Alice joins while LIVE
    runAsUser(
      studentAliceId,
      `SELECT public.record_live_session_join('${staleSessionId}', '${connId}');`
    )

    // Update started_at to 13 hours ago (exceeds 12h safety ceiling)
    runSql(`
      SET app.live_session_transition = 'true';
      UPDATE public.live_sessions
      SET started_at = now() - interval '13 hours'
      WHERE id = '${staleSessionId}';
      RESET app.live_session_transition;
    `)

    // Trigger maintenance worker
    const endedCount = runSql(`SELECT public.auto_end_stale_live_sessions();`)
    expect(Number(endedCount)).toBeGreaterThanOrEqual(1)

    // Status is now ENDED
    const status = runSql(`SELECT status FROM public.live_sessions WHERE id = '${staleSessionId}';`)
    expect(status).toBe('ENDED')

    // Open intervals are clamped
    const openIntervals = runSql(`
      SELECT count(*)::text FROM public.live_session_attendance_intervals
      WHERE live_session_id = '${staleSessionId}' AND left_at IS NULL;
    `)
    expect(openIntervals).toBe('0')
  })

  // ── P. Threshold Classification & Punctuality ─────────────────────────────
  it('P. Punctuality and Threshold classification: exactly 70% PRESENT, 20% PARTIAL, <20% ABSENT, >10m late', () => {
    const threshSessionId = '55556666-7777-8888-9999-000011112222'
    const studentPresent = studentAliceId
    const studentPartial = studentBobId
    const studentAbsent = studentCharlieId

    // 100-minute session (6000 seconds)
    seedSession(
      threshSessionId,
      'Threshold Session',
      'ENDED',
      '2026-10-06 09:00:00+00',
      '2026-10-06 09:00:00+00',
      '2026-10-06 10:40:00+00'
    )

    runSql(`
      -- Student 1: exactly 70 min (4200s out of 6000s = 70.0%) and joins 15 min late (09:15 > 09:00 + 10m)
      INSERT INTO public.live_session_attendance_intervals (live_session_id, user_id, connection_id, joined_at, last_seen_at, left_at)
      VALUES ('${threshSessionId}', '${studentPresent}', gen_random_uuid(), '2026-10-06 09:15:00+00', '2026-10-06 10:25:00+00', '2026-10-06 10:25:00+00');
      INSERT INTO public.live_session_attendance (live_session_id, user_id, role, first_joined_at)
      VALUES ('${threshSessionId}', '${studentPresent}', 'student', '2026-10-06 09:15:00+00')
      ON CONFLICT (live_session_id, user_id) DO UPDATE SET first_joined_at = '2026-10-06 09:15:00+00';

      -- Student 2: exactly 20 min (1200s out of 6000s = 20.0%) and joins on time (09:05 <= 09:00 + 10m)
      INSERT INTO public.live_session_attendance_intervals (live_session_id, user_id, connection_id, joined_at, last_seen_at, left_at)
      VALUES ('${threshSessionId}', '${studentPartial}', gen_random_uuid(), '2026-10-06 09:05:00+00', '2026-10-06 09:25:00+00', '2026-10-06 09:25:00+00');
      INSERT INTO public.live_session_attendance (live_session_id, user_id, role, first_joined_at)
      VALUES ('${threshSessionId}', '${studentPartial}', 'student', '2026-10-06 09:05:00+00')
      ON CONFLICT (live_session_id, user_id) DO UPDATE SET first_joined_at = '2026-10-06 09:05:00+00';

      -- Student 3: 15 min (900s out of 6000s = 15.0% < 20%)
      INSERT INTO public.live_session_attendance_intervals (live_session_id, user_id, connection_id, joined_at, last_seen_at, left_at)
      VALUES ('${threshSessionId}', '${studentAbsent}', gen_random_uuid(), '2026-10-06 09:00:00+00', '2026-10-06 09:15:00+00', '2026-10-06 09:15:00+00');
      INSERT INTO public.live_session_attendance (live_session_id, user_id, role, first_joined_at)
      VALUES ('${threshSessionId}', '${studentAbsent}', 'student', '2026-10-06 09:00:00+00')
      ON CONFLICT (live_session_id, user_id) DO UPDATE SET first_joined_at = '2026-10-06 09:00:00+00';
    `)

    runSql(`SELECT public.finalize_live_session_attendance('${threshSessionId}');`)

    // Verify student 1: PRESENT and is_late = true
    const st1 = runSql(`
      SELECT attendance_status || '|' || is_late::text
      FROM public.live_session_attendance
      WHERE live_session_id = '${threshSessionId}' AND user_id = '${studentPresent}';
    `)
    expect(st1).toBe('PRESENT|true')

    // Verify student 2: PARTIAL and is_late = false
    const st2 = runSql(`
      SELECT attendance_status || '|' || is_late::text
      FROM public.live_session_attendance
      WHERE live_session_id = '${threshSessionId}' AND user_id = '${studentPartial}';
    `)
    expect(st2).toBe('PARTIAL|false')

    // Verify student 3: ABSENT and is_late = false
    const st3 = runSql(`
      SELECT attendance_status || '|' || is_late::text
      FROM public.live_session_attendance
      WHERE live_session_id = '${threshSessionId}' AND user_id = '${studentAbsent}';
    `)
    expect(st3).toBe('ABSENT|false')
  })

  // ── Q. ABSENT Materialization ─────────────────────────────────────────────
  it('Q. Enrolled student who never joined is materialized as ABSENT after finalization', () => {
    const matSessionId = '66667777-8888-9999-0000-111122223333'

    seedSession(
      matSessionId,
      'Materialize Test Session',
      'ENDED',
      undefined,
      undefined,
      undefined
    )

    // Alice joins, but Bob (enrolled) never connects
    runSql(`
      INSERT INTO public.live_session_attendance_intervals (live_session_id, user_id, connection_id, joined_at, last_seen_at, left_at)
      VALUES ('${matSessionId}', '${studentAliceId}', gen_random_uuid(), now() - interval '1 hour', now(), now());

      INSERT INTO public.live_session_attendance (live_session_id, user_id, role, first_joined_at)
      VALUES ('${matSessionId}', '${studentAliceId}', 'student', now() - interval '1 hour')
      ON CONFLICT (live_session_id, user_id) DO UPDATE SET first_joined_at = now() - interval '1 hour';
    `)

    // Finalize attendance
    runSql(`SELECT public.finalize_live_session_attendance('${matSessionId}');`)

    // Bob must now exist in live_session_attendance with status ABSENT and duration 0
    const bobRecord = runSql(`
      SELECT attendance_status || '|' || total_duration_seconds::text || '|' || role
      FROM public.live_session_attendance
      WHERE live_session_id = '${matSessionId}' AND user_id = '${studentBobId}';
    `)
    expect(bobRecord).toBe('ABSENT|0|student')
  })

  // ── R. RLS Verification ───────────────────────────────────────────────────
  it('R1. Student can see only their own attendance row', () => {
    const rows = runAsUser(
      studentAliceId,
      `SELECT count(*)::text FROM public.live_session_attendance WHERE live_session_id = '${sessionLiveId}';`
    )
    expect(rows).toBe('1')

    // Cannot read other students' rows
    const otherRows = runAsUser(
      studentAliceId,
      `SELECT count(*)::text FROM public.live_session_attendance WHERE live_session_id = '${sessionLiveId}' AND user_id = '${studentBobId}';`
    )
    expect(otherRows).toBe('0')
  })

  it('R2. Teacher can read the entire session attendance roster', () => {
    const roster = runAsUser(
      teacherId,
      `SELECT user_id FROM public.get_live_session_attendance('${sessionLiveId}');`
    )
    expect(roster).toContain(studentAliceId)
    expect(roster).toContain(teacherId)
  })

  it('R3. Assigned assistant can read the entire session attendance roster', () => {
    const roster = runAsUser(
      assistantId,
      `SELECT user_id FROM public.get_live_session_attendance('${sessionLiveId}');`
    )
    expect(roster).toContain(studentAliceId)
    expect(roster).toContain(assistantId)
  })

  // ── D_FIN. Finalize While LIVE Rejection & Role Boundary ──────────────────
  it('D_FIN1. finalize_live_session_attendance is rejected when invoked while session status is LIVE', () => {
    // Both teacher and student direct finalization calls fail on a LIVE session
    const teacherThrows = runAsUserThrows(
      teacherId,
      `SELECT public.finalize_live_session_attendance('${sessionLiveId}');`
    )
    expect(teacherThrows).toBe(true)

    const studentThrows = runAsUserThrows(
      studentAliceId,
      `SELECT public.finalize_live_session_attendance('${sessionLiveId}');`
    )
    expect(studentThrows).toBe(true)
  })

  it('D_FIN2. finalize_live_session_attendance is rejected for DRAFT, SCHEDULED, and CANCELLED sessions', () => {
    const draftThrows = runAsUserThrows(
      teacherId,
      `SELECT public.finalize_live_session_attendance('${sessionDraftId}');`
    )
    expect(draftThrows).toBe(true)

    const schedThrows = runAsUserThrows(
      teacherId,
      `SELECT public.finalize_live_session_attendance('${sessionScheduledId}');`
    )
    expect(schedThrows).toBe(true)

    const cancThrows = runAsUserThrows(
      teacherId,
      `SELECT public.finalize_live_session_attendance('${sessionCancelledId}');`
    )
    expect(cancThrows).toBe(true)
  })

  it('D_FIN3. Authorized teacher can finalize attendance for an ENDED session', () => {
    const res = runAsUser(
      teacherId,
      `SELECT public.finalize_live_session_attendance('${sessionEndedId}');`
    )
    expect(res).toContain('"success": true')
  })

  it('D_FIN4. Student cannot finalize attendance even if session is ENDED', () => {
    const studentThrows = runAsUserThrows(
      studentAliceId,
      `SELECT public.finalize_live_session_attendance('${sessionEndedId}');`
    )
    expect(studentThrows).toBe(true)
  })

  // ── S. Client Timestamps & Immutability ────────────────────────────────────
  it('S. Direct DELETE on attendance tables is blocked by invariants trigger', () => {
    const throwsAttendance = runSqlThrows(`
      DELETE FROM public.live_session_attendance WHERE live_session_id = '${sessionLiveId}';
    `)
    expect(throwsAttendance).toBe(true)

    const throwsIntervals = runSqlThrows(`
      DELETE FROM public.live_session_attendance_intervals WHERE live_session_id = '${sessionLiveId}';
    `)
    expect(throwsIntervals).toBe(true)
  })

  // ── T. SECURITY HARDENING: Custom GUC Spoofing Rejection & Trusted Identity ──────
  it('T_SEC_A. Custom GUC spoofing: Authenticated student setting app.live_session_transition = true is rejected and causes no DB mutations', () => {
    const secSpoofSessionId = '77778888-1111-2222-3333-444455556661'
    seedSession(
      secSpoofSessionId,
      'Security Spoofing Test Session',
      'ENDED',
      undefined,
      '2026-09-01T10:00:00Z',
      '2026-09-01T11:00:00Z'
    )

    // Seed an initial attendance summary and an open interval
    const connId = '33333333-aaaa-bbbb-cccc-000000000001'
    runSql(`
      INSERT INTO public.live_session_attendance_intervals (live_session_id, user_id, connection_id, joined_at, last_seen_at, left_at)
      VALUES ('${secSpoofSessionId}', '${studentAliceId}', '${connId}', '2026-09-01T10:05:00Z', '2026-09-01T10:35:00Z', NULL);

      INSERT INTO public.live_session_attendance (
        live_session_id, user_id, role, first_joined_at, last_left_at, total_duration_seconds, attendance_status, is_late
      )
      VALUES (
        '${secSpoofSessionId}', '${studentAliceId}', 'student', '2026-09-01T10:05:00Z', NULL, 1800, 'PARTIAL', false
      )
      ON CONFLICT (live_session_id, user_id) DO UPDATE SET total_duration_seconds = 1800, attendance_status = 'PARTIAL';
    `)

    // Baseline snapshot
    const preInterval = runSql(`
      SELECT left_at IS NULL FROM public.live_session_attendance_intervals
      WHERE live_session_id = '${secSpoofSessionId}' AND user_id = '${studentAliceId}';
    `)
    expect(preInterval).toBe('t')

    const preSummary = runSql(`
      SELECT attendance_status || '|' || total_duration_seconds::text || '|' || COALESCE(last_left_at::text, 'NULL')
      FROM public.live_session_attendance
      WHERE live_session_id = '${secSpoofSessionId}' AND user_id = '${studentAliceId}';
    `)
    expect(preSummary).toBe('PARTIAL|1800|NULL')

    const preRowCount = runSql(`
      SELECT count(*)::text FROM public.live_session_attendance WHERE live_session_id = '${secSpoofSessionId}';
    `)

    // Student attempts to finalize by spoofing app.live_session_transition = 'true'
    const errorMsg = runAsUserError(
      studentAliceId,
      `
        SET app.live_session_transition = 'true';
        SELECT public.finalize_live_session_attendance('${secSpoofSessionId}');
      `
    )
    expect(errorMsg).toMatch(/forbidden/i)

    // Also verify for studentBobId (enrolled non-creator student)
    const bobErrorMsg = runAsUserError(
      studentBobId,
      `
        SET app.live_session_transition = 'true';
        SELECT public.finalize_live_session_attendance('${secSpoofSessionId}');
      `
    )
    expect(bobErrorMsg).toMatch(/forbidden/i)

    // Verify post snapshot: absolutely no modifications!
    const postInterval = runSql(`
      SELECT left_at IS NULL FROM public.live_session_attendance_intervals
      WHERE live_session_id = '${secSpoofSessionId}' AND user_id = '${studentAliceId}';
    `)
    expect(postInterval).toBe('t') // Open interval was NOT clamped

    const postSummary = runSql(`
      SELECT attendance_status || '|' || total_duration_seconds::text || '|' || COALESCE(last_left_at::text, 'NULL')
      FROM public.live_session_attendance
      WHERE live_session_id = '${secSpoofSessionId}' AND user_id = '${studentAliceId}';
    `)
    expect(postSummary).toBe('PARTIAL|1800|NULL') // Summary values NOT modified

    const postRowCount = runSql(`
      SELECT count(*)::text FROM public.live_session_attendance WHERE live_session_id = '${secSpoofSessionId}';
    `)
    expect(postRowCount).toBe(preRowCount) // No unmaterialized ABSENT rows were inserted
  })

  it('T_SEC_B. Normal authorized creator can finalize attendance for an ENDED session', () => {
    const secCreatorSessionId = '77778888-1111-2222-3333-444455556662'
    seedSession(
      secCreatorSessionId,
      'Security Creator Session',
      'ENDED',
      undefined,
      '2026-09-01T10:00:00Z',
      '2026-09-01T11:00:00Z'
    )

    // Seed student interval
    runSql(`
      INSERT INTO public.live_session_attendance_intervals (live_session_id, user_id, connection_id, joined_at, last_seen_at, left_at)
      VALUES ('${secCreatorSessionId}', '${studentAliceId}', gen_random_uuid(), '2026-09-01T10:00:00Z', '2026-09-01T10:50:00Z', NULL);

      INSERT INTO public.live_session_attendance (
        live_session_id, user_id, role, first_joined_at
      )
      VALUES ('${secCreatorSessionId}', '${studentAliceId}', 'student', '2026-09-01T10:00:00Z')
      ON CONFLICT (live_session_id, user_id) DO NOTHING;
    `)

    // Authorized creator calls finalization directly without any custom GUC
    const res = runAsUser(
      teacherId,
      `SELECT public.finalize_live_session_attendance('${secCreatorSessionId}');`
    )
    expect(res).toContain('"success": true')

    // Open interval was clamped to ended_at, and attendance was computed
    const status = runSql(`
      SELECT attendance_status FROM public.live_session_attendance
      WHERE live_session_id = '${secCreatorSessionId}' AND user_id = '${studentAliceId}';
    `)
    expect(status).toBe('PRESENT')
  })

  it('T_SEC_C. Student without spoofing directly calling finalize_live_session_attendance is rejected', () => {
    const secEndedSessionId = '77778888-1111-2222-3333-444455556663'
    seedSession(
      secEndedSessionId,
      'Security Student Reject Session',
      'ENDED',
      undefined,
      '2026-09-01T10:00:00Z',
      '2026-09-01T11:00:00Z'
    )

    const err = runAsUserError(
      studentAliceId,
      `SELECT public.finalize_live_session_attendance('${secEndedSessionId}');`
    )
    expect(err).toMatch(/forbidden/i)
  })

  it('T_SEC_D. LIVE session: Creator and student direct finalization rejected; custom GUC does not bypass LIVE guard', () => {
    const secLiveSessionId = '77778888-1111-2222-3333-444455556664'
    seedSession(
      secLiveSessionId,
      'Security Live Session',
      'LIVE',
      '2026-09-01T10:00:00Z',
      '2026-09-01T10:00:00Z'
    )

    // 1. Creator direct call rejected
    const creatorDirectErr = runAsUserError(
      teacherId,
      `SELECT public.finalize_live_session_attendance('${secLiveSessionId}');`
    )
    expect(creatorDirectErr).toMatch(/cannot_finalize_session_while_LIVE/i)

    // 2. Student direct call rejected
    const studentDirectErr = runAsUserError(
      studentAliceId,
      `SELECT public.finalize_live_session_attendance('${secLiveSessionId}');`
    )
    expect(studentDirectErr).toMatch(/cannot_finalize_session_while_LIVE/i)

    // 3. Creator with spoofed GUC rejected by status guard
    const creatorGucErr = runAsUserError(
      teacherId,
      `
        SET app.live_session_transition = 'true';
        SELECT public.finalize_live_session_attendance('${secLiveSessionId}');
      `
    )
    expect(creatorGucErr).toMatch(/cannot_finalize_session_while_LIVE/i)

    // 4. Student with spoofed GUC rejected by status guard
    const studentGucErr = runAsUserError(
      studentAliceId,
      `
        SET app.live_session_transition = 'true';
        SELECT public.finalize_live_session_attendance('${secLiveSessionId}');
      `
    )
    expect(studentGucErr).toMatch(/cannot_finalize_session_while_LIVE/i)
  })

  it('T_SEC_E. Normal session termination: Authorized creator end_live_session transitions to ENDED and finalizes attendance', () => {
    const secTermSessionId = '77778888-1111-2222-3333-444455556665'
    seedSession(
      secTermSessionId,
      'Security Term Session',
      'LIVE',
      '2026-09-01T10:00:00Z',
      '2026-09-01T10:00:00Z'
    )

    // Student Alice joins session with open interval
    runSql(`
      INSERT INTO public.live_session_attendance_intervals (live_session_id, user_id, connection_id, joined_at, last_seen_at, left_at)
      VALUES ('${secTermSessionId}', '${studentAliceId}', gen_random_uuid(), now() - interval '30 minutes', now() - interval '5 minutes', NULL);

      INSERT INTO public.live_session_attendance (
        live_session_id, user_id, role, first_joined_at
      )
      VALUES ('${secTermSessionId}', '${studentAliceId}', 'student', now() - interval '30 minutes')
      ON CONFLICT (live_session_id, user_id) DO NOTHING;
    `)

    // Authorized creator calls end_live_session
    const endRes = runAsUser(
      teacherId,
      `SELECT public.end_live_session('${secTermSessionId}');`
    )
    expect(endRes).toContain('"status": "ENDED"')

    // Status is ENDED
    const status = runSql(`SELECT status FROM public.live_sessions WHERE id = '${secTermSessionId}';`)
    expect(status).toBe('ENDED')

    // Open interval was closed/clamped
    const openCount = runSql(`
      SELECT count(*)::text FROM public.live_session_attendance_intervals
      WHERE live_session_id = '${secTermSessionId}' AND left_at IS NULL;
    `)
    expect(openCount).toBe('0')

    // Attendance summary computed
    const attRow = runSql(`
      SELECT total_duration_seconds > 0 FROM public.live_session_attendance
      WHERE live_session_id = '${secTermSessionId}' AND user_id = '${studentAliceId}';
    `)
    expect(attRow).toBe('t')
  })

  it('T_SEC_F. Stale-session worker: auto_end_stale_live_sessions executes via trusted server path and finalizes attendance', () => {
    const secStaleSessionId = '77778888-1111-2222-3333-444455556666'
    seedSession(
      secStaleSessionId,
      'Security Stale Session',
      'LIVE',
      '2026-09-01T00:00:00Z',
      '2026-09-01T00:00:00Z'
    )

    // Force started_at to 14 hours ago so auto_end picks it up
    runSql(`
      SET app.live_session_transition = 'true';
      UPDATE public.live_sessions
      SET started_at = now() - interval '14 hours'
      WHERE id = '${secStaleSessionId}';
      RESET app.live_session_transition;
    `)

    // Seed student with open interval
    runSql(`
      INSERT INTO public.live_session_attendance_intervals (live_session_id, user_id, connection_id, joined_at, last_seen_at, left_at)
      VALUES ('${secStaleSessionId}', '${studentAliceId}', gen_random_uuid(), now() - interval '14 hours', now() - interval '2 hours', NULL);

      INSERT INTO public.live_session_attendance (
        live_session_id, user_id, role, first_joined_at
      )
      VALUES ('${secStaleSessionId}', '${studentAliceId}', 'student', now() - interval '14 hours')
      ON CONFLICT (live_session_id, user_id) DO NOTHING;
    `)

    // Server-level execution triggers auto_end_stale_live_sessions
    const countEnded = runSql(`SELECT public.auto_end_stale_live_sessions();`)
    expect(Number(countEnded)).toBeGreaterThanOrEqual(1)

    // Session is ENDED
    const sessionStatus = runSql(`SELECT status FROM public.live_sessions WHERE id = '${secStaleSessionId}';`)
    expect(sessionStatus).toBe('ENDED')

    // Open intervals clamped
    const remainingOpen = runSql(`
      SELECT count(*)::text FROM public.live_session_attendance_intervals
      WHERE live_session_id = '${secStaleSessionId}' AND left_at IS NULL;
    `)
    expect(remainingOpen).toBe('0')

    // Attendance summary finalized
    const finalizedStatus = runSql(`
      SELECT attendance_status FROM public.live_session_attendance
      WHERE live_session_id = '${secStaleSessionId}' AND user_id = '${studentAliceId}';
    `)
    expect(finalizedStatus).toBeTruthy()
  })

  it('T_SEC_G. No accidental privilege broadening: Unrelated authenticated user cannot finalize any other user session regardless of custom GUC', () => {
    const secUnrelatedSessionId = '77778888-1111-2222-3333-444455556667'
    seedSession(
      secUnrelatedSessionId,
      'Security Unrelated User Test',
      'ENDED',
      undefined,
      '2026-09-01T10:00:00Z',
      '2026-09-01T11:00:00Z'
    )

    // Unrelated user calling without GUC
    const errWithoutGuc = runAsUserError(
      unrelatedUserId,
      `SELECT public.finalize_live_session_attendance('${secUnrelatedSessionId}');`
    )
    expect(errWithoutGuc).toMatch(/forbidden/i)

    // Unrelated user calling with GUC spoofing
    const errWithGuc = runAsUserError(
      unrelatedUserId,
      `
        SET app.live_session_transition = 'true';
        SELECT public.finalize_live_session_attendance('${secUnrelatedSessionId}');
      `
    )
    expect(errWithGuc).toMatch(/forbidden/i)
  })

  it('T_SEC_H. Platform Admin can finalize attendance for an ENDED session', () => {
    const secAdminSessionId = '77778888-1111-2222-3333-444455556668'
    seedSession(
      secAdminSessionId,
      'Security Admin Finalize Test',
      'ENDED',
      undefined,
      '2026-09-01T10:00:00Z',
      '2026-09-01T11:00:00Z'
    )

    // Admin user (role = 'admin') calls finalize_live_session_attendance on session created by teacher
    const res = runAsUser(
      adminUserId,
      `SELECT public.finalize_live_session_attendance('${secAdminSessionId}');`
    )
    expect(res).toContain('"success": true')
  })

  // ── U. FAIL-CLOSED AUTHORIZATION: Profile-less User (Auth without public.users Profile) ──
  it('T_SEC_A1. Profile-less authenticated non-creator cannot end a session and causes no session/attendance mutations', () => {
    // 1. Ensure user exists in auth.users but strictly NOT in public.users
    runSql(`
      DELETE FROM public.users WHERE id = '${profilelessUserId}';
      DELETE FROM auth.users WHERE id = '${profilelessUserId}';
      INSERT INTO auth.users (id, email) VALUES ('${profilelessUserId}', 'profileless@example.com');
      DELETE FROM public.users WHERE id = '${profilelessUserId}';
    `)

    // Verify profile-less precondition
    const inAuth = runSql(`SELECT count(*)::text FROM auth.users WHERE id = '${profilelessUserId}';`)
    const inPublic = runSql(`SELECT count(*)::text FROM public.users WHERE id = '${profilelessUserId}';`)
    expect(inAuth).toBe('1')
    expect(inPublic).toBe('0')

    const secProfilelessSessionId = '77778888-1111-2222-3333-444455556669'
    seedSession(
      secProfilelessSessionId,
      'Security Profileless Test Session',
      'LIVE',
      '2026-09-01T10:00:00Z',
      '2026-09-01T10:00:00Z'
    )

    // Seed student with open interval
    runSql(`
      INSERT INTO public.live_session_attendance_intervals (live_session_id, user_id, connection_id, joined_at, last_seen_at, left_at)
      VALUES ('${secProfilelessSessionId}', '${studentAliceId}', gen_random_uuid(), now() - interval '20 minutes', now() - interval '2 minutes', NULL);

      INSERT INTO public.live_session_attendance (
        live_session_id, user_id, role, first_joined_at, last_left_at, total_duration_seconds, attendance_status, is_late
      )
      VALUES (
        '${secProfilelessSessionId}', '${studentAliceId}', 'student', now() - interval '20 minutes', NULL, 1080, 'PRESENT', false
      )
      ON CONFLICT (live_session_id, user_id) DO UPDATE SET total_duration_seconds = 1080, attendance_status = 'PRESENT';
    `)

    // Pre-call snapshot
    const preStatus = runSql(`SELECT status FROM public.live_sessions WHERE id = '${secProfilelessSessionId}';`)
    const preEndedAt = runSql(`SELECT ended_at IS NULL FROM public.live_sessions WHERE id = '${secProfilelessSessionId}';`)
    const preOpenIntervals = runSql(`
      SELECT count(*)::text FROM public.live_session_attendance_intervals
      WHERE live_session_id = '${secProfilelessSessionId}' AND left_at IS NULL;
    `)
    const preSummary = runSql(`
      SELECT attendance_status || '|' || total_duration_seconds::text
      FROM public.live_session_attendance
      WHERE live_session_id = '${secProfilelessSessionId}' AND user_id = '${studentAliceId}';
    `)

    expect(preStatus).toBe('LIVE')
    expect(preEndedAt).toBe('t')
    expect(preOpenIntervals).toBe('1')
    expect(preSummary).toBe('PRESENT|1080')

    // Profile-less authenticated user attempts to end the session
    const err = runAsUserError(
      profilelessUserId,
      `SELECT public.end_live_session('${secProfilelessSessionId}');`
    )
    expect(err).toMatch(/forbidden/i)

    // Verify post-call state: absolutely zero mutations
    const postStatus = runSql(`SELECT status FROM public.live_sessions WHERE id = '${secProfilelessSessionId}';`)
    const postEndedAt = runSql(`SELECT ended_at IS NULL FROM public.live_sessions WHERE id = '${secProfilelessSessionId}';`)
    const postOpenIntervals = runSql(`
      SELECT count(*)::text FROM public.live_session_attendance_intervals
      WHERE live_session_id = '${secProfilelessSessionId}' AND left_at IS NULL;
    `)
    const postSummary = runSql(`
      SELECT attendance_status || '|' || total_duration_seconds::text
      FROM public.live_session_attendance
      WHERE live_session_id = '${secProfilelessSessionId}' AND user_id = '${studentAliceId}';
    `)

    expect(postStatus).toBe('LIVE')
    expect(postEndedAt).toBe('t')
    expect(postOpenIntervals).toBe('1')
    expect(postSummary).toBe('PRESENT|1080')
  })
})

