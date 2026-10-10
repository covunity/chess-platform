import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'

function runSql(query: string): string {
  const cmd = 'docker exec -i supabase_db_chess-course-platform psql -U postgres -d postgres -t -A -q -v ON_ERROR_STOP=1'
  const output = execSync(cmd, { input: query, encoding: 'utf-8' }).trim()
  return output.split('\n')[0]?.trim() ?? ''
}

describe('TASK 5.1 — Live Session Timestamp Invariants (Migration 104)', () => {
  const creatorId = '00000000-0000-0000-0000-000000000001'
  let courseId: string

  beforeAll(() => {
    courseId = runSql(`
      INSERT INTO public.courses (creator_id, title, price, status, course_type)
      VALUES ('${creatorId}', 'Course for Timestamp Invariants', 0, 'published', 'live')
      RETURNING id;
    `)
    expect(courseId).toBeTruthy()
  })

  afterAll(() => {
    if (courseId) {
      runSql(`DELETE FROM public.courses WHERE id = '${courseId}';`)
    }
  })

  it('1. Valid DRAFT, SCHEDULED, LIVE, ENDED, and CANCELLED passes normal lifecycle flows', () => {
    // A. DRAFT
    const draftId = runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${courseId}', 'Draft Session', now() + interval '1 day', 'DRAFT', 'room-ts-draft-${Date.now()}')
      RETURNING id;
    `)
    const draftRow = runSql(`SELECT status, started_at, ended_at FROM public.live_sessions WHERE id = '${draftId}';`)
    expect(draftRow).toBe('DRAFT||')

    // B. SCHEDULED
    const schedId = runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${courseId}', 'Sched Session', now() + interval '1 day', 'SCHEDULED', 'room-ts-sched-${Date.now()}')
      RETURNING id;
    `)
    const schedRow = runSql(`SELECT status, started_at, ended_at FROM public.live_sessions WHERE id = '${schedId}';`)
    expect(schedRow).toBe('SCHEDULED||')

    // C. START -> LIVE
    runSql(`
      DO $$
      BEGIN
        PERFORM set_config('request.jwt.claim.sub', '${creatorId}', true);
        PERFORM public.start_live_session('${schedId}'::uuid);
      END $$;
    `)
    const liveStatus = runSql(`SELECT status FROM public.live_sessions WHERE id = '${schedId}';`)
    const liveStarted = runSql(`SELECT started_at IS NOT NULL FROM public.live_sessions WHERE id = '${schedId}';`)
    const liveEnded = runSql(`SELECT ended_at IS NULL FROM public.live_sessions WHERE id = '${schedId}';`)
    expect(liveStatus).toBe('LIVE')
    expect(liveStarted).toBe('t')
    expect(liveEnded).toBe('t')

    // D. END -> ENDED
    runSql(`
      DO $$
      BEGIN
        PERFORM set_config('request.jwt.claim.sub', '${creatorId}', true);
        PERFORM public.end_live_session('${schedId}'::uuid);
      END $$;
    `)
    const endedStatus = runSql(`SELECT status FROM public.live_sessions WHERE id = '${schedId}';`)
    const endedValid = runSql(`SELECT (started_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at >= started_at) FROM public.live_sessions WHERE id = '${schedId}';`)
    expect(endedStatus).toBe('ENDED')
    expect(endedValid).toBe('t')

    // E. CANCELLED
    const cancelId = runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${courseId}', 'Cancel Session', now() + interval '1 day', 'SCHEDULED', 'room-ts-cancel-${Date.now()}')
      RETURNING id;
    `)
    runSql(`
      DO $$
      BEGIN
        PERFORM set_config('request.jwt.claim.sub', '${creatorId}', true);
        PERFORM public.cancel_live_session('${cancelId}'::uuid);
      END $$;
    `)
    const cancelRow = runSql(`SELECT status, started_at, ended_at FROM public.live_sessions WHERE id = '${cancelId}';`)
    expect(cancelRow).toBe('CANCELLED||')
  })

  it('2. REJECTS LIVE session without started_at (live_sessions_live_started_at_chk)', () => {
    const sid = runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${courseId}', 'Test Live Check', now() + interval '1 day', 'SCHEDULED', 'room-inv-live-${Date.now()}')
      RETURNING id;
    `)

    expect(() => {
      runSql(`
        DO $$
        BEGIN
          PERFORM set_config('app.live_session_transition', 'true', true);
          UPDATE public.live_sessions
          SET status = 'LIVE', started_at = NULL
          WHERE id = '${sid}';
        END $$;
      `)
    }).toThrow(/live_sessions_live_started_at_chk/)
  })

  it('3. REJECTS ENDED session without started_at (live_sessions_ended_timestamps_chk)', () => {
    const sid = runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${courseId}', 'Test Ended Check 1', now() + interval '1 day', 'SCHEDULED', 'room-inv-ended1-${Date.now()}')
      RETURNING id;
    `)
    runSql(`
      DO $$
      BEGIN
        PERFORM set_config('app.live_session_transition', 'true', true);
        UPDATE public.live_sessions
        SET status = 'LIVE', started_at = now()
        WHERE id = '${sid}';
      END $$;
    `)

    expect(() => {
      runSql(`
        DO $$
        BEGIN
          PERFORM set_config('app.live_session_transition', 'true', true);
          UPDATE public.live_sessions
          SET status = 'ENDED', started_at = NULL, ended_at = now()
          WHERE id = '${sid}';
        END $$;
      `)
    }).toThrow(/live_sessions_ended_timestamps_chk/)
  })

  it('4. REJECTS ENDED session without ended_at (live_sessions_ended_timestamps_chk)', () => {
    const sid = runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${courseId}', 'Test Ended Check 2', now() + interval '1 day', 'SCHEDULED', 'room-inv-ended2-${Date.now()}')
      RETURNING id;
    `)
    runSql(`
      DO $$
      BEGIN
        PERFORM set_config('app.live_session_transition', 'true', true);
        UPDATE public.live_sessions
        SET status = 'LIVE', started_at = now()
        WHERE id = '${sid}';
      END $$;
    `)

    expect(() => {
      runSql(`
        DO $$
        BEGIN
          PERFORM set_config('app.live_session_transition', 'true', true);
          UPDATE public.live_sessions
          SET status = 'ENDED', started_at = now(), ended_at = NULL
          WHERE id = '${sid}';
        END $$;
      `)
    }).toThrow(/live_sessions_ended_timestamps_chk/)
  })

  it('5. REJECTS ENDED session where ended_at < started_at (live_sessions_ended_timestamps_chk / live_sessions_timestamp_ordering_chk)', () => {
    const sid = runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${courseId}', 'Test Reversed Timestamps', now() + interval '1 day', 'SCHEDULED', 'room-inv-rev-${Date.now()}')
      RETURNING id;
    `)
    runSql(`
      DO $$
      BEGIN
        PERFORM set_config('app.live_session_transition', 'true', true);
        UPDATE public.live_sessions
        SET status = 'LIVE', started_at = now()
        WHERE id = '${sid}';
      END $$;
    `)

    expect(() => {
      runSql(`
        DO $$
        BEGIN
          PERFORM set_config('app.live_session_transition', 'true', true);
          UPDATE public.live_sessions
          SET status = 'ENDED', started_at = now(), ended_at = now() - interval '1 hour'
          WHERE id = '${sid}';
        END $$;
      `)
    }).toThrow(/live_sessions_ended_timestamps_chk|live_sessions_timestamp_ordering_chk/)
  })

  it('6. REJECTS SCHEDULED session with started_at (live_sessions_pre_live_timestamps_chk)', () => {
    const sid = runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${courseId}', 'Test Sched Stamp', now() + interval '1 day', 'SCHEDULED', 'room-inv-sched-${Date.now()}')
      RETURNING id;
    `)

    expect(() => {
      runSql(`
        DO $$
        BEGIN
          PERFORM set_config('app.live_session_transition', 'true', true);
          UPDATE public.live_sessions
          SET started_at = now()
          WHERE id = '${sid}';
        END $$;
      `)
    }).toThrow(/live_sessions_pre_live_timestamps_chk/)
  })

  it('7. REJECTS CANCELLED session with started_at or ended_at (live_sessions_pre_live_timestamps_chk)', () => {
    const sid = runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${courseId}', 'Test Cancel Stamp', now() + interval '1 day', 'SCHEDULED', 'room-inv-cancel-${Date.now()}')
      RETURNING id;
    `)

    expect(() => {
      runSql(`
        DO $$
        BEGIN
          PERFORM set_config('app.live_session_transition', 'true', true);
          UPDATE public.live_sessions
          SET status = 'CANCELLED', started_at = now()
          WHERE id = '${sid}';
        END $$;
      `)
    }).toThrow(/live_sessions_pre_live_timestamps_chk/)
  })

  it('8. REJECTS DRAFT session with started_at or ended_at (live_sessions_pre_live_timestamps_chk)', () => {
    const sid = runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${courseId}', 'Test Draft Stamp', now() + interval '1 day', 'DRAFT', 'room-inv-draft-${Date.now()}')
      RETURNING id;
    `)

    expect(() => {
      runSql(`
        DO $$
        BEGIN
          PERFORM set_config('app.live_session_transition', 'true', true);
          UPDATE public.live_sessions
          SET ended_at = now()
          WHERE id = '${sid}';
        END $$;
      `)
    }).toThrow(/live_sessions_pre_live_timestamps_chk/)
  })
})
