import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import { isDockerDbAvailable } from '../../test/dbTestHelper'

function runSql(query: string): string {
  const cmd = 'docker exec -i supabase_db_chess-course-platform psql -U postgres -d postgres -t -A -q -v ON_ERROR_STOP=1'
  const output = execSync(cmd, { input: query, encoding: 'utf-8' }).trim()
  return output.split('\n')[0]?.trim() ?? ''
}

describe.skipIf(!isDockerDbAvailable())('TASK 3C — Database Level Live Session DELETE Policy Enforcement', () => {
  const creatorId = '00000000-0000-0000-0000-000000000001'
  let courseId: string

  beforeAll(() => {
    courseId = runSql(`
      INSERT INTO public.courses (creator_id, title, price, status, course_type)
      VALUES ('${creatorId}', 'Delete Policy Test Course', 0, 'published', 'live')
      RETURNING id;
    `)
    expect(courseId).toBeTruthy()
  })

  afterAll(() => {
    if (courseId) {
      runSql(`DELETE FROM public.courses WHERE id = '${courseId}';`)
    }
  })

  function createSession(status: 'DRAFT' | 'SCHEDULED', title: string): string {
    const roomName = `room-del-${status.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    return runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${courseId}', '${title}', now() + interval '1 day', '${status}', '${roomName}')
      RETURNING id;
    `)
  }

  function transitionToLive(sessionId: string): void {
    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        PERFORM public.start_live_session('${sessionId}'::uuid);
      END $body$;
    `)
  }

  function transitionToEnd(sessionId: string): void {
    transitionToLive(sessionId)
    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        PERFORM public.end_live_session('${sessionId}'::uuid);
      END $body$;
    `)
  }

  function transitionToCancelled(sessionId: string): void {
    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}')::text, true);
        PERFORM public.cancel_live_session('${sessionId}'::uuid);
      END $body$;
    `)
  }

  it('A & G. DRAFT: direct DELETE => PASS and row is actually removed', () => {
    const draftId = createSession('DRAFT', 'Draft Session for Deletion')

    // Verify row exists
    const beforeCount = runSql(`SELECT count(*) FROM public.live_sessions WHERE id = '${draftId}';`)
    expect(beforeCount).toBe('1')

    // Execute DELETE
    runSql(`DELETE FROM public.live_sessions WHERE id = '${draftId}';`)

    // Verify row is actually gone
    const afterCount = runSql(`SELECT count(*) FROM public.live_sessions WHERE id = '${draftId}';`)
    expect(afterCount).toBe('0')
  })

  it('B. SCHEDULED: direct DELETE => FAIL with clear exception', () => {
    const schedId = createSession('SCHEDULED', 'Scheduled Session Protected from Delete')

    expect(() => {
      runSql(`DELETE FROM public.live_sessions WHERE id = '${schedId}';`)
    }).toThrow(/Cannot delete session in SCHEDULED status\. Only DRAFT sessions can be deleted/)
  })

  it('C. LIVE: direct DELETE => FAIL with clear exception', () => {
    const liveId = createSession('SCHEDULED', 'Live Session Protected from Delete')
    transitionToLive(liveId)

    expect(() => {
      runSql(`DELETE FROM public.live_sessions WHERE id = '${liveId}';`)
    }).toThrow(/Cannot delete session in LIVE status\. Only DRAFT sessions can be deleted/)
  })

  it('D. ENDED: direct DELETE => FAIL with clear exception', () => {
    const endedId = createSession('SCHEDULED', 'Ended Session Protected from Delete')
    transitionToEnd(endedId)

    expect(() => {
      runSql(`DELETE FROM public.live_sessions WHERE id = '${endedId}';`)
    }).toThrow(/Cannot delete session in ENDED status\. Only DRAFT sessions can be deleted/)
  })

  it('E. CANCELLED: direct DELETE => FAIL with clear exception', () => {
    const cancId = createSession('SCHEDULED', 'Cancelled Session Protected from Delete')
    transitionToCancelled(cancId)

    expect(() => {
      runSql(`DELETE FROM public.live_sessions WHERE id = '${cancId}';`)
    }).toThrow(/Cannot delete session in CANCELLED status\. Only DRAFT sessions can be deleted/)
  })

  it('F. Verify failed DELETE attempts do NOT remove the rows from the database', () => {
    const sId = createSession('SCHEDULED', 'Persistence Sched Check')
    const lId = createSession('SCHEDULED', 'Persistence Live Check')
    transitionToLive(lId)
    const eId = createSession('SCHEDULED', 'Persistence Ended Check')
    transitionToEnd(eId)
    const cId = createSession('SCHEDULED', 'Persistence Canc Check')
    transitionToCancelled(cId)

    // Attempt and fail all deletes
    expect(() => runSql(`DELETE FROM public.live_sessions WHERE id = '${sId}';`)).toThrow()
    expect(() => runSql(`DELETE FROM public.live_sessions WHERE id = '${lId}';`)).toThrow()
    expect(() => runSql(`DELETE FROM public.live_sessions WHERE id = '${eId}';`)).toThrow()
    expect(() => runSql(`DELETE FROM public.live_sessions WHERE id = '${cId}';`)).toThrow()

    // All 4 rows must still exist in database
    const count = runSql(`
      SELECT count(*) FROM public.live_sessions
      WHERE id IN ('${sId}', '${lId}', '${eId}', '${cId}');
    `)
    expect(count).toBe('4')
  })

  it('H. Admin role attempt: direct DELETE on non-DRAFT session => FAIL (no admin bypass)', () => {
    const schedId = createSession('SCHEDULED', 'Admin Delete Test')

    expect(() => {
      runSql(`
        DO $body$
        BEGIN
          PERFORM set_config('request.jwt.claims', json_build_object('sub', '${creatorId}', 'role', 'admin')::text, true);
          DELETE FROM public.live_sessions WHERE id = '${schedId}';
        END $body$;
      `)
    }).toThrow(/Cannot delete session in SCHEDULED status\. Only DRAFT sessions can be deleted/)

    const count = runSql(`SELECT count(*) FROM public.live_sessions WHERE id = '${schedId}';`)
    expect(count).toBe('1')
  })
})
