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

describe.skipIf(!isDockerDbAvailable())('TASK 7 & 7.1 — Real Database Authorization, Terminal DELETE Invariant & Teacher Authority', () => {
  const creatorId = '11111111-1111-1111-1111-111111111111'
  const otherCreatorId = '22222222-2222-2222-2222-222222222222'
  const assistantId = '33333333-3333-3333-3333-333333333333'
  const studentId = '44444444-4444-4444-4444-444444444444'
  const unassignedId = '55555555-5555-5555-5555-555555555555'
  const adminId = '66666666-6666-6666-6666-666666666666'

  let courseId: string
  let otherCourseId: string
  let sessionId: string
  let otherSessionId: string
  let endedSessionId: string
  let cancelledSessionId: string

  beforeAll(() => {
    // 1. Ensure test users exist in auth.users and public.users
    runSql(`
      DO $body$
      DECLARE
        u_id uuid;
      BEGIN
        FOR u_id IN SELECT unnest(ARRAY[
          '${creatorId}'::uuid,
          '${otherCreatorId}'::uuid,
          '${assistantId}'::uuid,
          '${studentId}'::uuid,
          '${unassignedId}'::uuid,
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

    // Set roles in public.users
    runSql(`
      UPDATE public.users SET role = 'creator' WHERE id IN ('${creatorId}', '${otherCreatorId}');
      UPDATE public.users SET role = 'admin' WHERE id = '${adminId}';
      UPDATE public.users SET role = 'learner' WHERE id IN ('${assistantId}', '${studentId}', '${unassignedId}');
    `)

    // 2. Create courses
    courseId = runSql(`
      INSERT INTO public.courses (creator_id, title, price, status, course_type)
      VALUES ('${creatorId}', 'Assistant Test Course 1', 0, 'published', 'live')
      RETURNING id;
    `)

    otherCourseId = runSql(`
      INSERT INTO public.courses (creator_id, title, price, status, course_type)
      VALUES ('${otherCreatorId}', 'Assistant Test Course 2', 0, 'published', 'live')
      RETURNING id;
    `)

    // 3. Create live sessions
    sessionId = runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${courseId}', 'Live Session 1', now() - interval '10 minutes', 'SCHEDULED', 'live-room-staff-test-1')
      RETURNING id;
    `)

    otherSessionId = runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${otherCourseId}', 'Live Session 2', now() - interval '10 minutes', 'DRAFT', 'live-room-staff-test-2')
      RETURNING id;
    `)

    // Transition session 1 to LIVE via RPC
    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        PERFORM public.start_live_session('${sessionId}'::uuid);
      END $body$;
    `)

    // Create session to be ended
    endedSessionId = runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${courseId}', 'Ended Session', now() - interval '30 minutes', 'SCHEDULED', 'live-room-staff-ended-test')
      RETURNING id;
    `)

    // Add assistant to endedSession while SCHEDULED
    runSql(`
      INSERT INTO public.live_session_staff (live_session_id, user_id, role)
      VALUES ('${endedSessionId}', '${assistantId}', 'assistant');
    `)

    // Start and end the session
    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        PERFORM public.start_live_session('${endedSessionId}'::uuid);
        PERFORM public.end_live_session('${endedSessionId}'::uuid);
      END $body$;
    `)

    // Create session to be cancelled
    cancelledSessionId = runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${courseId}', 'Cancelled Session', now() - interval '20 minutes', 'SCHEDULED', 'live-room-staff-cancelled-test')
      RETURNING id;
    `)

    // Add assistant to cancelledSession while SCHEDULED
    runSql(`
      INSERT INTO public.live_session_staff (live_session_id, user_id, role)
      VALUES ('${cancelledSessionId}', '${assistantId}', 'assistant');
    `)

    // Cancel the session
    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        PERFORM public.cancel_live_session('${cancelledSessionId}'::uuid);
      END $body$;
    `)

    // 4. Enroll studentId in course 1
    runSql(`
      INSERT INTO public.enrollments (course_id, user_id)
      VALUES ('${courseId}', '${studentId}')
      ON CONFLICT DO NOTHING;
    `)
  })

  afterAll(() => {
    // Cleanup
    if (courseId) runSql(`DELETE FROM public.courses WHERE id = '${courseId}';`)
    if (otherCourseId) runSql(`DELETE FROM public.courses WHERE id = '${otherCourseId}';`)
  })

  it('A. Creator can add assistant to own session via add_live_session_assistant RPC', () => {
    const res = runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        PERFORM public.add_live_session_assistant('${sessionId}'::uuid, '${assistantId}'::uuid);
      END $body$;
      SELECT COUNT(*) FROM public.live_session_staff WHERE live_session_id = '${sessionId}' AND user_id = '${assistantId}';
    `)
    expect(res).toBe('1')
  })

  it('B. Assigned assistant resolves as "assistant" in check_live_classroom_access with teacher_id = creatorId', () => {
    const accessJson = runSql(`
      SELECT public.check_live_classroom_access('live-room-staff-test-1', '${assistantId}'::uuid)::text;
    `)
    const access = JSON.parse(accessJson)
    expect(access.allowed).toBe(true)
    expect(access.role).toBe('assistant')
    expect(access.is_assistant).toBe(true)
    expect(access.is_creator).toBe(false)
    expect(access.teacher_id).toBe(creatorId)
    expect(access.creator_id).toBe(creatorId)
  })

  it('C. Creator resolves as "teacher" in check_live_classroom_access with teacher_id = creatorId', () => {
    const accessJson = runSql(`
      SELECT public.check_live_classroom_access('live-room-staff-test-1', '${creatorId}'::uuid)::text;
    `)
    const access = JSON.parse(accessJson)
    expect(access.allowed).toBe(true)
    expect(access.role).toBe('teacher')
    expect(access.is_creator).toBe(true)
    expect(access.teacher_id).toBe(creatorId)
    expect(access.creator_id).toBe(creatorId)
  })

  it('D. Enrolled student resolves as "student" in check_live_classroom_access with teacher_id = creatorId', () => {
    const accessJson = runSql(`
      SELECT public.check_live_classroom_access('live-room-staff-test-1', '${studentId}'::uuid)::text;
    `)
    const access = JSON.parse(accessJson)
    expect(access.allowed).toBe(true)
    expect(access.role).toBe('student')
    expect(access.is_enrolled).toBe(true)
    expect(access.teacher_id).toBe(creatorId)
    expect(access.creator_id).toBe(creatorId)
  })

  it('E. Platform admin (non-creator) resolves as "student" with is_admin=true and teacher_id=creatorId', () => {
    const accessJson = runSql(`
      SELECT public.check_live_classroom_access('live-room-staff-test-1', '${adminId}'::uuid)::text;
    `)
    const access = JSON.parse(accessJson)
    expect(access.allowed).toBe(true)
    expect(access.role).toBe('student')
    expect(access.is_admin).toBe(true)
    expect(access.is_creator).toBe(false)
    expect(access.teacher_id).toBe(creatorId)
    expect(access.creator_id).toBe(creatorId)
  })

  it('F. Unassigned and non-enrolled learner is denied in check_live_classroom_access', () => {
    const accessJson = runSql(`
      SELECT public.check_live_classroom_access('live-room-staff-test-1', '${unassignedId}'::uuid)::text;
    `)
    const access = JSON.parse(accessJson)
    expect(access.allowed).toBe(false)
    expect(access.reason).toBe('not_enrolled')
  })

  it('G. Creator cannot assign themselves as assistant (blocked by trigger and RPC)', () => {
    const throws = runSqlThrows(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        PERFORM public.add_live_session_assistant('${sessionId}'::uuid, '${creatorId}'::uuid);
      END $body$;
    `)
    expect(throws).toBe(true)
  })

  it('H. Unrelated creator cannot add assistant to another course session', () => {
    const throws = runSqlThrows(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${otherCreatorId}')::text, true);
        PERFORM public.add_live_session_assistant('${sessionId}'::uuid, '${studentId}'::uuid);
      END $body$;
    `)
    expect(throws).toBe(true)
  })

  it('I. Student or assistant cannot add assistant (unauthorized / permission denied)', () => {
    const throws = runSqlThrows(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${studentId}')::text, true);
        PERFORM public.add_live_session_assistant('${sessionId}'::uuid, '${unassignedId}'::uuid);
      END $body$;
    `)
    expect(throws).toBe(true)
  })

  it('J. Duplicate assistant assignment is rejected by UNIQUE constraint', () => {
    const throws = runSqlThrows(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        PERFORM public.add_live_session_assistant('${sessionId}'::uuid, '${assistantId}'::uuid);
      END $body$;
    `)
    expect(throws).toBe(true)
  })

  it('K. Creator can remove assistant via remove_live_session_assistant RPC', () => {
    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        PERFORM public.remove_live_session_assistant('${sessionId}'::uuid, '${assistantId}'::uuid);
      END $body$;
    `)
    const count = runSql(`
      SELECT COUNT(*) FROM public.live_session_staff WHERE live_session_id = '${sessionId}' AND user_id = '${assistantId}';
    `)
    expect(count).toBe('0')

    // After removal, assistantId is no longer assistant
    const accessJson = runSql(`
      SELECT public.check_live_classroom_access('live-room-staff-test-1', '${assistantId}'::uuid)::text;
    `)
    const access = JSON.parse(accessJson)
    expect(access.allowed).toBe(false) // not enrolled in course 1
  })

  it('L. Deleting a live_session cascades and removes all staff rows', () => {
    // Re-add assistant to session 2
    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${otherCreatorId}')::text, true);
        PERFORM public.add_live_session_assistant('${otherSessionId}'::uuid, '${assistantId}'::uuid);
      END $body$;
    `)
    expect(runSql(`SELECT COUNT(*) FROM public.live_session_staff WHERE live_session_id = '${otherSessionId}';`)).toBe('1')

    // Delete session 2
    runSql(`DELETE FROM public.live_sessions WHERE id = '${otherSessionId}';`)

    // Verify staff rows were cascaded
    expect(runSql(`SELECT COUNT(*) FROM public.live_session_staff WHERE live_session_id = '${otherSessionId}';`)).toBe('0')
  })

  // ──────────────────────────────────────────────────────────────────────────
  // TASK 7.1 Real PostgreSQL Invariant Verification
  // ──────────────────────────────────────────────────────────────────────────

  it('M. Creator direct DELETE on ENDED staff row -> MUST fail', () => {
    const throws = runSqlThrows(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        DELETE FROM public.live_session_staff WHERE live_session_id = '${endedSessionId}';
      END $body$;
    `)
    expect(throws).toBe(true)
    // Verify row is still intact
    expect(runSql(`SELECT COUNT(*) FROM public.live_session_staff WHERE live_session_id = '${endedSessionId}';`)).toBe('1')
  })

  it('N. Admin direct DELETE on ENDED staff row -> MUST fail', () => {
    const throws = runSqlThrows(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${adminId}')::text, true);
        DELETE FROM public.live_session_staff WHERE live_session_id = '${endedSessionId}';
      END $body$;
    `)
    expect(throws).toBe(true)
    // Verify row is still intact
    expect(runSql(`SELECT COUNT(*) FROM public.live_session_staff WHERE live_session_id = '${endedSessionId}';`)).toBe('1')
  })

  it('O. Creator direct DELETE on CANCELLED staff row -> MUST fail', () => {
    const throws = runSqlThrows(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        DELETE FROM public.live_session_staff WHERE live_session_id = '${cancelledSessionId}';
      END $body$;
    `)
    expect(throws).toBe(true)
    // Verify row is still intact
    expect(runSql(`SELECT COUNT(*) FROM public.live_session_staff WHERE live_session_id = '${cancelledSessionId}';`)).toBe('1')
  })

  it('P. Admin direct DELETE on CANCELLED staff row -> MUST fail', () => {
    const throws = runSqlThrows(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${adminId}')::text, true);
        DELETE FROM public.live_session_staff WHERE live_session_id = '${cancelledSessionId}';
      END $body$;
    `)
    expect(throws).toBe(true)
    // Verify row is still intact
    expect(runSql(`SELECT COUNT(*) FROM public.live_session_staff WHERE live_session_id = '${cancelledSessionId}';`)).toBe('1')
  })

  it('Q. Parent course deletion still cascades terminal live_sessions and their staff rows', () => {
    // Count before delete
    expect(runSql(`SELECT COUNT(*) FROM public.live_session_staff WHERE live_session_id IN ('${endedSessionId}', '${cancelledSessionId}');`)).toBe('2')

    // Deleting course 1 cascades through live_sessions to live_session_staff (pg_trigger_depth() > 1)
    runSql(`DELETE FROM public.courses WHERE id = '${courseId}';`)

    // Verify both terminal sessions and their staff rows were cascaded cleanly
    expect(runSql(`SELECT COUNT(*) FROM public.live_session_staff WHERE live_session_id IN ('${endedSessionId}', '${cancelledSessionId}');`)).toBe('0')
    expect(runSql(`SELECT COUNT(*) FROM public.live_sessions WHERE id IN ('${endedSessionId}', '${cancelledSessionId}');`)).toBe('0')
  })
})
