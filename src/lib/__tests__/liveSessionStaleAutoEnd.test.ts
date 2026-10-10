import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync, spawn } from 'child_process'
import { isDockerDbAvailable } from '../../test/dbTestHelper'

function runSql(query: string): string {
  const cmd = 'docker exec -i supabase_db_chess-course-platform psql -U postgres -d postgres -t -A -q -v ON_ERROR_STOP=1'
  const output = execSync(cmd, { input: query, encoding: 'utf-8' }).trim()
  return output.split('\n')[0]?.trim() ?? ''
}

function runSqlAsync(query: string): Promise<string> {
  return new Promise((resolve, reject) => {
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
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => { out += d.toString() })
    proc.stderr.on('data', (d) => { err += d.toString() })
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || out.trim() || `psql process exited with code ${code}`))
      } else {
        resolve(out.split('\n')[0]?.trim() ?? '')
      }
    })
    proc.stdin.write(query)
    proc.stdin.end()
  })
}

describe.skipIf(!isDockerDbAvailable())('TASK 5.2 — Stale Live Session Safety Auto-End (Migration 105)', () => {
  const creatorId = '00000000-0000-0000-0000-000000000001'
  let courseId: string

  beforeAll(() => {
    courseId = runSql(`
      INSERT INTO public.courses (creator_id, title, price, status, course_type)
      VALUES ('${creatorId}', 'Stale Safety Test Course', 0, 'published', 'live')
      RETURNING id;
    `)
    expect(courseId).toBeTruthy()
  })

  afterAll(() => {
    if (courseId) {
      runSql(`DELETE FROM public.courses WHERE id = '${courseId}';`)
    }
  })

  function createLiveSession(params: {
    scheduledStart?: string
    scheduledEnd?: string | null
    startedAt: string
  }): string {
    const sStart = params.scheduledStart || "now() - interval '1 hour'"
    const sEnd = params.scheduledEnd ? `'${params.scheduledEnd}'::timestamptz` : 'NULL'
    const roomName = `room-stale-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    const sid = runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, scheduled_end_at, status, livekit_room_name)
      VALUES ('${courseId}', 'Stale Test Session', ${sStart}, ${sEnd}, 'SCHEDULED', '${roomName}')
      RETURNING id;
    `)

    runSql(`
      DO $$
      BEGIN
        PERFORM set_config('app.live_session_transition', 'true', true);
        UPDATE public.live_sessions
        SET status = 'LIVE', started_at = ${params.startedAt}
        WHERE id = '${sid}';
      END $$;
    `)

    return sid
  }

  it('1. LIVE < 12h without scheduled_end_at => not stale', () => {
    const sid = createLiveSession({
      startedAt: "now() - interval '11 hours 50 minutes'",
      scheduledEnd: null,
    })

    const endedCount = runSql(`SELECT public.auto_end_stale_live_sessions();`)
    expect(endedCount).toBe('0')

    const status = runSql(`SELECT status FROM public.live_sessions WHERE id = '${sid}';`)
    expect(status).toBe('LIVE')
  })

  it('2 & 3. LIVE >= 12h without scheduled_end_at => stale (auto-ends)', () => {
    const sid = createLiveSession({
      startedAt: "now() - interval '12 hours 5 minutes'",
      scheduledEnd: null,
    })

    const endedCount = runSql(`SELECT public.auto_end_stale_live_sessions();`)
    expect(Number(endedCount)).toBeGreaterThanOrEqual(1)

    const status = runSql(`SELECT status FROM public.live_sessions WHERE id = '${sid}';`)
    const hasEndedAt = runSql(`SELECT ended_at IS NOT NULL FROM public.live_sessions WHERE id = '${sid}';`)
    expect(status).toBe('ENDED')
    expect(hasEndedAt).toBe('t')
  })

  it('4. scheduled_end_at future / +6h grace not reached => not stale', () => {
    const sid = createLiveSession({
      scheduledStart: "now() - interval '5 hours'",
      scheduledEnd: runSql(`SELECT (now() - interval '3 hours')::text;`), // scheduled_end in past, but only 3h ago (< 6h grace)
      startedAt: "now() - interval '4 hours'",
    })

    const endedCount = runSql(`SELECT public.auto_end_stale_live_sessions();`)
    expect(endedCount).toBe('0')

    const status = runSql(`SELECT status FROM public.live_sessions WHERE id = '${sid}';`)
    expect(status).toBe('LIVE')
  })

  it('5. scheduled_end_at + 6h grace reached (and scheduled_end > started) => stale', () => {
    const sid = createLiveSession({
      scheduledStart: "now() - interval '9 hours'",
      scheduledEnd: runSql(`SELECT (now() - interval '7 hours')::text;`), // scheduled_end 7h ago (> 6h grace)
      startedAt: "now() - interval '8 hours'", // scheduled_end (7h ago) > started_at (8h ago)
    })

    const endedCount = runSql(`SELECT public.auto_end_stale_live_sessions();`)
    expect(Number(endedCount)).toBeGreaterThanOrEqual(1)

    const status = runSql(`SELECT status FROM public.live_sessions WHERE id = '${sid}';`)
    expect(status).toBe('ENDED')
  })

  it('6 & 7. scheduled_end_at NULL: not stale at 11h, stale at 12h', () => {
    const sidFresh = createLiveSession({
      startedAt: "now() - interval '11 hours'",
      scheduledEnd: null,
    })
    const sidStale = createLiveSession({
      startedAt: "now() - interval '12 hours 1 minute'",
      scheduledEnd: null,
    })

    const count = runSql(`SELECT public.auto_end_stale_live_sessions();`)
    expect(Number(count)).toBeGreaterThanOrEqual(1)

    expect(runSql(`SELECT status FROM public.live_sessions WHERE id = '${sidFresh}';`)).toBe('LIVE')
    expect(runSql(`SELECT status FROM public.live_sessions WHERE id = '${sidStale}';`)).toBe('ENDED')
  })

  it('8 & 9. scheduled_end_at <= started_at => schedule ceiling IGNORED, late-started session does not auto-end', () => {
    // Example: scheduled was 19:00 - 20:30. Teacher started class late at 22:00.
    // scheduled_end_at (20:30) is before started_at (22:00).
    // Now it is 03:00 (6.5 hours after scheduled_end_at, but only 5 hours into the 12h live duration).
    // The schedule ceiling MUST be ignored. Session must NOT be auto-ended!
    const sidLate = createLiveSession({
      scheduledStart: "now() - interval '10 hours'",
      scheduledEnd: runSql(`SELECT (now() - interval '8 hours')::text;`), // 8 hours ago
      startedAt: "now() - interval '6 hours'", // started 6 hours ago (after scheduled_end_at)
    })

    const count = runSql(`SELECT public.auto_end_stale_live_sessions();`)
    expect(count).toBe('0')

    const status = runSql(`SELECT status FROM public.live_sessions WHERE id = '${sidLate}';`)
    expect(status).toBe('LIVE')
  })

  it('10. SCHEDULED overdue remains SCHEDULED (never auto-cancelled)', () => {
    const roomName = `room-sched-overdue-${Date.now()}`
    const schedId = runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, scheduled_end_at, status, livekit_room_name)
      VALUES ('${courseId}', 'Overdue Scheduled', now() - interval '3 days', now() - interval '2 days', 'SCHEDULED', '${roomName}')
      RETURNING id;
    `)

    runSql(`SELECT public.auto_end_stale_live_sessions();`)

    const status = runSql(`SELECT status FROM public.live_sessions WHERE id = '${schedId}';`)
    expect(status).toBe('SCHEDULED')
  })

  it('11. Manual early END still works regardless of auto-end safety job', () => {
    const sid = createLiveSession({
      startedAt: "now() - interval '30 minutes'",
      scheduledEnd: null,
    })

    runSql(`
      DO $$
      BEGIN
        PERFORM set_config('request.jwt.claim.sub', '${creatorId}', true);
        PERFORM public.end_live_session('${sid}'::uuid);
      END $$;
    `)

    const status = runSql(`SELECT status FROM public.live_sessions WHERE id = '${sid}';`)
    expect(status).toBe('ENDED')
  })

  it('12. Auto-ended session satisfies all timestamp invariants', () => {
    const sid = createLiveSession({
      startedAt: "now() - interval '13 hours'",
      scheduledEnd: null,
    })

    runSql(`SELECT public.auto_end_stale_live_sessions();`)

    const row = runSql(`
      SELECT (status = 'ENDED' AND started_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at >= started_at)::text
      FROM public.live_sessions WHERE id = '${sid}';
    `)
    expect(row).toBe('true')
  })

  it('13. True Concurrency: Two independent processes execute auto_end_stale_live_sessions with forced overlap', async () => {
    const sid = createLiveSession({
      startedAt: "now() - interval '14 hours'",
      scheduledEnd: null,
    })

    // Process 1 starts transaction, invokes auto_end_stale_live_sessions() which acquires row lock (FOR UPDATE),
    // and holds the transaction open with pg_sleep(0.35) before committing.
    // Process 2 starts independently after 0.1s while Process 1 is sleeping with the row lock held.
    // Process 2 executes auto_end_stale_live_sessions(), which uses FOR UPDATE SKIP LOCKED.
    // Process 2 skips the row locked by Process 1, updates 0 rows, and returns 0 without waiting or erroring.
    // Process 1 finishes its sleep, commits, and returns 1.
    const [res1, res2] = await Promise.all([
      runSqlAsync(`
        BEGIN;
        SELECT public.auto_end_stale_live_sessions();
        SELECT pg_sleep(0.35);
        COMMIT;
      `),
      runSqlAsync(`
        SELECT pg_sleep(0.1);
        SELECT public.auto_end_stale_live_sessions();
      `),
    ])

    const count1 = Number(res1)
    const count2 = Number(res2)
    // Exactly one logical transition occurred
    expect(count1 + count2).toBe(1)
    expect(Math.max(count1, count2)).toBe(1)
    expect(Math.min(count1, count2)).toBe(0)

    const finalRow = runSql(`
      SELECT status, started_at IS NOT NULL, ended_at IS NOT NULL, ended_at >= started_at
      FROM public.live_sessions WHERE id = '${sid}';
    `)
    expect(finalRow).toBe('ENDED|t|t|t')
  })

  it('14. True Concurrency: Manual end + auto cleanup race across two independent processes', async () => {
    const sid = createLiveSession({
      startedAt: "now() - interval '15 hours'",
      scheduledEnd: null,
    })

    // Process A: invokes manual end_live_session() after a slight 0.05s delay
    // Process B: invokes auto_end_stale_live_sessions() after a slight 0.05s delay
    // Both processes execute concurrently across two separate PostgreSQL backend connections.
    const results = await Promise.allSettled([
      runSqlAsync(`
        DO $$
        BEGIN
          PERFORM set_config('request.jwt.claim.sub', '${creatorId}', true);
          PERFORM pg_sleep(0.05);
          PERFORM public.end_live_session('${sid}'::uuid);
        END $$;
      `),
      runSqlAsync(`
        DO $$
        BEGIN
          PERFORM pg_sleep(0.05);
          PERFORM public.auto_end_stale_live_sessions();
        END $$;
      `),
    ])

    const [manualResult, autoResult] = results

    // A. Auto cleanup must succeed (or cleanly observe terminal state without unexpected error)
    expect(autoResult.status).toBe('fulfilled')
    if (autoResult.status === 'rejected') {
      expect(autoResult.reason.message).not.toMatch(/deadlock|timeout|permission denied|could not serialize/i)
    }

    // B & C. Manual end must succeed OR cleanly receive the exact domain error 'session_already_ended'
    if (manualResult.status === 'rejected') {
      expect(manualResult.reason.message).toMatch(/session_already_ended/)
      expect(manualResult.reason.message).not.toMatch(/deadlock|timeout|permission denied|could not serialize/i)
    } else {
      expect(manualResult.status).toBe('fulfilled')
    }

    // D. Final row must satisfy all terminal state and timestamp invariants
    const finalRow = runSql(`
      SELECT status, started_at IS NOT NULL, ended_at IS NOT NULL, ended_at >= started_at
      FROM public.live_sessions WHERE id = '${sid}';
    `)
    expect(finalRow).toBe('ENDED|t|t|t')
  })

  it('15. Cleanup worker does not modify non-LIVE sessions (DRAFT, CANCELLED)', () => {
    const roomDraft = `room-draft-${Date.now()}`
    const roomCanc = `room-canc-${Date.now()}`

    const draftId = runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${courseId}', 'Draft Session', now() - interval '2 days', 'DRAFT', '${roomDraft}')
      RETURNING id;
    `)

    const cancId = runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${courseId}', 'Cancelled Session', now() - interval '2 days', 'SCHEDULED', '${roomCanc}')
      RETURNING id;
    `)
    runSql(`
      DO $$
      BEGIN
        PERFORM set_config('request.jwt.claim.sub', '${creatorId}', true);
        PERFORM public.cancel_live_session('${cancId}'::uuid);
      END $$;
    `)

    runSql(`SELECT public.auto_end_stale_live_sessions();`)

    expect(runSql(`SELECT status FROM public.live_sessions WHERE id = '${draftId}';`)).toBe('DRAFT')
    expect(runSql(`SELECT status FROM public.live_sessions WHERE id = '${cancId}';`)).toBe('CANCELLED')
  })

  it('16. Security: Non-privileged authenticated user cannot invoke auto_end_stale_live_sessions', () => {
    expect(() => {
      runSql(`
        DO $$
        BEGIN
          PERFORM set_config('role', 'authenticated', true);
          PERFORM public.auto_end_stale_live_sessions();
        END $$;
      `)
    }).toThrow(/permission denied/)
  })

  it('17. pg_cron verification: auto_end_stale_live_sessions job is active and correctly configured (Migration 106)', () => {
    const ext = runSql(`SELECT extname FROM pg_extension WHERE extname = 'pg_cron';`)
    expect(ext).toBe('pg_cron')

    const job = runSql(`
      SELECT schedule, trim(command), active, username
      FROM cron.job
      WHERE jobname = 'auto_end_stale_live_sessions';
    `)
    expect(job).toBe('*/10 * * * *|SELECT public.auto_end_stale_live_sessions();|t|postgres')
  })
})
