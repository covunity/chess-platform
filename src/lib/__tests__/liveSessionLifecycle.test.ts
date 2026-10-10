import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'

function runSql(query: string): string {
  const cmd = 'docker exec -i supabase_db_chess-course-platform psql -U postgres -d postgres -t -A -q -v ON_ERROR_STOP=1'
  const output = execSync(cmd, { input: query, encoding: 'utf-8' }).trim()
  return output.split('\n')[0]?.trim() ?? ''
}

describe('TASK 3A — Database Level Live Session Lifecycle Enforcement', () => {
  const creatorId = '00000000-0000-0000-0000-000000000001'
  let courseId: string

  beforeAll(() => {
    // Create test course for live session tests
    courseId = runSql(`
      INSERT INTO public.courses (creator_id, title, price, status, course_type)
      VALUES ('${creatorId}', 'Lifecycle Test Course', 0, 'published', 'live')
      RETURNING id;
    `)
    expect(courseId).toBeTruthy()
  })

  afterAll(() => {
    // Clean up test course and all cascading sessions
    if (courseId) {
      runSql(`DELETE FROM public.courses WHERE id = '${courseId}';`)
    }
  })

  // Helper to create a session in a given status
  function createSession(status: 'DRAFT' | 'SCHEDULED', title: string): string {
    const roomName = `room-${status.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    return runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${courseId}', '${title}', now() + interval '1 day', '${status}', '${roomName}')
      RETURNING id;
    `)
  }

  it('A. SCHEDULED -> LIVE: via start_live_session() => PASS', () => {
    const sessionId = createSession('SCHEDULED', 'Session A - Start Test')

    const res = runSql(`
      DO $body$
      DECLARE
        v_res jsonb;
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        v_res := public.start_live_session('${sessionId}'::uuid);
        IF (v_res->>'status') != 'LIVE' THEN
          RAISE EXCEPTION 'Expected LIVE, got %', v_res->>'status';
        END IF;
      END $body$;
      SELECT status FROM public.live_sessions WHERE id = '${sessionId}';
    `)

    expect(res).toBe('LIVE')
  })

  it('B. LIVE -> ENDED: via end_live_session() => PASS', () => {
    const sessionId = createSession('SCHEDULED', 'Session B - End Test')

    // Transition to LIVE first
    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        PERFORM public.start_live_session('${sessionId}'::uuid);
      END $body$;
    `)

    // Now transition LIVE -> ENDED via end_live_session()
    const res = runSql(`
      DO $body$
      DECLARE
        v_res jsonb;
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        v_res := public.end_live_session('${sessionId}'::uuid);
        IF (v_res->>'status') != 'ENDED' THEN
          RAISE EXCEPTION 'Expected ENDED, got %', v_res->>'status';
        END IF;
      END $body$;
      SELECT status FROM public.live_sessions WHERE id = '${sessionId}';
    `)

    expect(res).toBe('ENDED')
  })

  it('C. DRAFT -> LIVE directly: via start_live_session() or direct UPDATE => FAIL', () => {
    const sessionId = createSession('DRAFT', 'Session C - Draft To Live Test')

    // 1. Calling start_live_session on DRAFT must fail
    expect(() => {
      runSql(`
        DO $body$
        BEGIN
          PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
          PERFORM public.start_live_session('${sessionId}'::uuid);
        END $body$;
      `)
    }).toThrow(/cannot_start_session_in_DRAFT_status/)

    // 2. Direct SQL UPDATE to LIVE must fail
    expect(() => {
      runSql(`UPDATE public.live_sessions SET status = 'LIVE' WHERE id = '${sessionId}';`)
    }).toThrow(/Invalid session status transition from DRAFT to LIVE/)
  })

  it('D. DRAFT -> ENDED directly: via end_live_session() or direct UPDATE => FAIL', () => {
    const sessionId = createSession('DRAFT', 'Session D - Draft To Ended Test')

    expect(() => {
      runSql(`
        DO $body$
        BEGIN
          PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
          PERFORM public.end_live_session('${sessionId}'::uuid);
        END $body$;
      `)
    }).toThrow(/cannot_end_session_in_DRAFT_status/)

    expect(() => {
      runSql(`UPDATE public.live_sessions SET status = 'ENDED' WHERE id = '${sessionId}';`)
    }).toThrow(/Invalid session status transition from DRAFT to ENDED/)
  })

  it('E. SCHEDULED -> ENDED directly: via end_live_session() or direct UPDATE => FAIL', () => {
    const sessionId = createSession('SCHEDULED', 'Session E - Scheduled To Ended Test')

    expect(() => {
      runSql(`
        DO $body$
        BEGIN
          PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
          PERFORM public.end_live_session('${sessionId}'::uuid);
        END $body$;
      `)
    }).toThrow(/cannot_end_session_in_SCHEDULED_status/)

    expect(() => {
      runSql(`UPDATE public.live_sessions SET status = 'ENDED' WHERE id = '${sessionId}';`)
    }).toThrow(/Invalid session status transition from SCHEDULED to ENDED/)
  })

  it('F. LIVE -> SCHEDULED directly: via direct UPDATE => FAIL', () => {
    const sessionId = createSession('SCHEDULED', 'Session F - Live To Scheduled Test')

    // Transition to LIVE first
    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        PERFORM public.start_live_session('${sessionId}'::uuid);
      END $body$;
    `)

    // Attempt direct UPDATE LIVE -> SCHEDULED
    expect(() => {
      runSql(`UPDATE public.live_sessions SET status = 'SCHEDULED' WHERE id = '${sessionId}';`)
    }).toThrow(/Invalid session status transition from LIVE to SCHEDULED/)
  })

  it('G. LIVE -> CANCELLED directly: via cancel_live_session() or direct UPDATE => FAIL', () => {
    const sessionId = createSession('SCHEDULED', 'Session G - Live To Cancelled Test')

    // Transition to LIVE first
    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        PERFORM public.start_live_session('${sessionId}'::uuid);
      END $body$;
    `)

    expect(() => {
      runSql(`
        DO $body$
        BEGIN
          PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
          PERFORM public.cancel_live_session('${sessionId}'::uuid);
        END $body$;
      `)
    }).toThrow(/cannot_cancel_live_session/)

    expect(() => {
      runSql(`UPDATE public.live_sessions SET status = 'CANCELLED' WHERE id = '${sessionId}';`)
    }).toThrow(/Invalid session status transition from LIVE to CANCELLED/)
  })

  it('H. ENDED -> LIVE: via start_live_session() or direct UPDATE => FAIL', () => {
    const sessionId = createSession('SCHEDULED', 'Session H - Ended To Live Test')

    // SCHEDULED -> LIVE -> ENDED
    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        PERFORM public.start_live_session('${sessionId}'::uuid);
        PERFORM public.end_live_session('${sessionId}'::uuid);
      END $body$;
    `)

    expect(() => {
      runSql(`
        DO $body$
        BEGIN
          PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
          PERFORM public.start_live_session('${sessionId}'::uuid);
        END $body$;
      `)
    }).toThrow(/cannot_start_session_in_ENDED_status/)

    expect(() => {
      runSql(`UPDATE public.live_sessions SET status = 'LIVE' WHERE id = '${sessionId}';`)
    }).toThrow(/Invalid session status transition from ENDED to LIVE/)
  })

  it('I. CANCELLED -> LIVE: via start_live_session() or direct UPDATE => FAIL', () => {
    const sessionId = createSession('SCHEDULED', 'Session I - Cancelled To Live Test')

    // Cancel session
    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        PERFORM public.cancel_live_session('${sessionId}'::uuid);
      END $body$;
    `)

    expect(() => {
      runSql(`
        DO $body$
        BEGIN
          PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
          PERFORM public.start_live_session('${sessionId}'::uuid);
        END $body$;
      `)
    }).toThrow(/cannot_start_session_in_CANCELLED_status/)

    expect(() => {
      runSql(`UPDATE public.live_sessions SET status = 'LIVE' WHERE id = '${sessionId}';`)
    }).toThrow(/Invalid session status transition from CANCELLED to LIVE/)
  })

  it('J. Creator UPDATE status directly: attempts to set status = LIVE => FAIL', () => {
    const sessionId = createSession('SCHEDULED', 'Session J - Direct Status Update Test')

    expect(() => {
      runSql(`UPDATE public.live_sessions SET status = 'LIVE' WHERE id = '${sessionId}';`)
    }).toThrow(/Direct transition to LIVE is forbidden. Use start_live_session\(\)\./)
  })

  it('K. Creator UPDATE livekit_room_name directly: attempts to modify room name => FAIL', () => {
    const sessionId = createSession('SCHEDULED', 'Session K - Room Name Tamper Test')

    expect(() => {
      runSql(`UPDATE public.live_sessions SET livekit_room_name = 'arbitrary-injected-room' WHERE id = '${sessionId}';`)
    }).toThrow(/livekit_room_name cannot be modified/)
  })

  it('L. Creator UPDATE normal editable fields: title, description, schedule, agenda => PASS', () => {
    const sessionId = createSession('SCHEDULED', 'Session L - Normal Editable Fields Test')

    runSql(`
      UPDATE public.live_sessions
      SET title = 'Brand New Title 2026',
          description = 'Updated session syllabus details',
          scheduled_start_at = now() + interval '3 days',
          scheduled_end_at = now() + interval '3 days 90 minutes',
          agenda = '[{"title": "Openings Deep Dive", "duration_minutes": 45}]'::jsonb,
          learning_objectives = ARRAY['Grasp pawn structures'],
          preparation_notes = 'Review chapter 4',
          max_participants = 30
      WHERE id = '${sessionId}';
    `)

    const updatedTitle = runSql(`SELECT title FROM public.live_sessions WHERE id = '${sessionId}';`)
    const updatedMax = runSql(`SELECT max_participants FROM public.live_sessions WHERE id = '${sessionId}';`)

    expect(updatedTitle).toBe('Brand New Title 2026')
    expect(updatedMax).toBe('30')
  })

  it('M. Existing start_live_session() and end_live_session() behavior: unauthenticated / unauthorized enforcement', () => {
    const sessionId = createSession('SCHEDULED', 'Session M - Auth Enforcement Test')

    // Unauthenticated call must fail
    expect(() => {
      runSql(`
        DO $body$
        BEGIN
          PERFORM public.start_live_session('${sessionId}'::uuid);
        END $body$;
      `)
    }).toThrow(/unauthenticated/)

    // Unauthorized call (not creator, not admin) must fail
    expect(() => {
      runSql(`
        DO $body$
        BEGIN
          PERFORM set_config('request.jwt.claims', json_build_object('sub', '8f7cf944-7fe4-4577-a8c4-5644b05bcd83')::text, true);
          PERFORM public.start_live_session('${sessionId}'::uuid);
        END $body$;
      `)
    }).toThrow(/forbidden/)
  })
})
