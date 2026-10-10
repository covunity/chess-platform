import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import { isDockerDbAvailable } from '../../test/dbTestHelper'

function runSql(query: string): string {
  const cmd = 'docker exec -i supabase_db_chess-course-platform psql -U postgres -d postgres -t -A -q -v ON_ERROR_STOP=1'
  const output = execSync(cmd, { input: query, encoding: 'utf-8' }).trim()
  return output.split('\n')[0]?.trim() ?? ''
}

describe.skipIf(!isDockerDbAvailable())('TASK 4B — Live Session Course Type Integrity Enforcement', () => {
  const creatorId = '00000000-0000-0000-0000-000000000001'
  let liveCourseId: string
  let liveCourse2Id: string
  let standardCourseId: string
  let emptyLiveCourseId: string
  let sessionAId: string

  beforeAll(() => {
    // 1. Create LIVE Course 1
    liveCourseId = runSql(`
      INSERT INTO public.courses (creator_id, title, price, status, course_type)
      VALUES ('${creatorId}', 'Live Course 1', 0, 'published', 'live')
      RETURNING id;
    `)

    // 2. Create LIVE Course 2
    liveCourse2Id = runSql(`
      INSERT INTO public.courses (creator_id, title, price, status, course_type)
      VALUES ('${creatorId}', 'Live Course 2', 0, 'published', 'live')
      RETURNING id;
    `)

    // 3. Create STANDARD Course
    standardCourseId = runSql(`
      INSERT INTO public.courses (creator_id, title, price, status, course_type)
      VALUES ('${creatorId}', 'Standard Course', 0, 'published', 'standard')
      RETURNING id;
    `)

    // 4. Create Empty LIVE Course (no sessions)
    emptyLiveCourseId = runSql(`
      INSERT INTO public.courses (creator_id, title, price, status, course_type)
      VALUES ('${creatorId}', 'Empty Live Course', 0, 'published', 'live')
      RETURNING id;
    `)

    expect(liveCourseId).toBeTruthy()
    expect(liveCourse2Id).toBeTruthy()
    expect(standardCourseId).toBeTruthy()
    expect(emptyLiveCourseId).toBeTruthy()
  })

  afterAll(() => {
    if (liveCourseId) runSql(`DELETE FROM public.courses WHERE id = '${liveCourseId}';`)
    if (liveCourse2Id) runSql(`DELETE FROM public.courses WHERE id = '${liveCourse2Id}';`)
    if (standardCourseId) runSql(`DELETE FROM public.courses WHERE id = '${standardCourseId}';`)
    if (emptyLiveCourseId) runSql(`DELETE FROM public.courses WHERE id = '${emptyLiveCourseId}';`)
  })

  it('A. Create session under LIVE course => PASS', () => {
    const roomName = `room-test-live-${Date.now()}`
    sessionAId = runSql(`
      INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${liveCourseId}', 'Session in Live Course', now() + interval '1 day', 'DRAFT', '${roomName}')
      RETURNING id;
    `)

    expect(sessionAId).toBeTruthy()
    const storedCourseId = runSql(`SELECT course_id FROM public.live_sessions WHERE id = '${sessionAId}';`)
    expect(storedCourseId).toBe(liveCourseId)
  })

  it('B. Create session under STANDARD course => FAIL', () => {
    const roomName = `room-test-std-${Date.now()}`

    expect(() => {
      runSql(`
        INSERT INTO public.live_sessions (course_id, title, scheduled_start_at, status, livekit_room_name)
        VALUES ('${standardCourseId}', 'Session in Standard Course', now() + interval '1 day', 'SCHEDULED', '${roomName}');
      `)
    }).toThrow(/Live sessions are only allowed for live courses/)
  })

  it('C. Existing session LIVE course: update unrelated editable fields => PASS', () => {
    runSql(`
      UPDATE public.live_sessions
      SET title = 'Updated Title in Live Course',
          description = 'Updated Description'
      WHERE id = '${sessionAId}';
    `)

    const updatedTitle = runSql(`SELECT title FROM public.live_sessions WHERE id = '${sessionAId}';`)
    expect(updatedTitle).toBe('Updated Title in Live Course')
  })

  it('D. Existing session: change course_id to another LIVE course => PASS', () => {
    runSql(`
      UPDATE public.live_sessions
      SET course_id = '${liveCourse2Id}'
      WHERE id = '${sessionAId}';
    `)

    const currentCourseId = runSql(`SELECT course_id FROM public.live_sessions WHERE id = '${sessionAId}';`)
    expect(currentCourseId).toBe(liveCourse2Id)
  })

  it('E. Existing session: change course_id to STANDARD course => FAIL', () => {
    expect(() => {
      runSql(`
        UPDATE public.live_sessions
        SET course_id = '${standardCourseId}'
        WHERE id = '${sessionAId}';
      `)
    }).toThrow(/Live sessions are only allowed for live courses/)

    // Verify course_id remains unchanged
    const currentCourseId = runSql(`SELECT course_id FROM public.live_sessions WHERE id = '${sessionAId}';`)
    expect(currentCourseId).toBe(liveCourse2Id)
  })

  it('F. Existing LIVE course with sessions: change course_type LIVE -> STANDARD => FAIL', () => {
    // liveCourse2Id contains sessionAId
    expect(() => {
      runSql(`
        UPDATE public.courses
        SET course_type = 'standard'
        WHERE id = '${liveCourse2Id}';
      `)
    }).toThrow(/Cannot change course_type to 'standard'.*currently has.*live session/)

    // Verify course_type remains 'live'
    const currentCourseType = runSql(`SELECT course_type FROM public.courses WHERE id = '${liveCourse2Id}';`)
    expect(currentCourseType).toBe('live')
  })

  it('G. LIVE course without sessions: change LIVE -> STANDARD => PASS', () => {
    runSql(`
      UPDATE public.courses
      SET course_type = 'standard'
      WHERE id = '${emptyLiveCourseId}';
    `)

    const currentCourseType = runSql(`SELECT course_type FROM public.courses WHERE id = '${emptyLiveCourseId}';`)
    expect(currentCourseType).toBe('standard')
  })

  it('H. STANDARD course: change STANDARD -> LIVE => PASS', () => {
    runSql(`
      UPDATE public.courses
      SET course_type = 'live'
      WHERE id = '${standardCourseId}';
    `)

    const currentCourseType = runSql(`SELECT course_type FROM public.courses WHERE id = '${standardCourseId}';`)
    expect(currentCourseType).toBe('live')
  })

  it('I. Failed operations must leave original values unchanged', () => {
    // 1. Session course_id is still liveCourse2Id
    const currentSessionCourseId = runSql(`SELECT course_id FROM public.live_sessions WHERE id = '${sessionAId}';`)
    expect(currentSessionCourseId).toBe(liveCourse2Id)

    // 2. liveCourse2Id course_type is still 'live'
    const currentCourse2Type = runSql(`SELECT course_type FROM public.courses WHERE id = '${liveCourse2Id}';`)
    expect(currentCourse2Type).toBe('live')

    // 3. Count of sessions in standardCourseId is 0 (as created earlier)
    const standardCourseSessionCount = runSql(`SELECT count(*) FROM public.live_sessions WHERE course_id = '${standardCourseId}';`)
    expect(standardCourseSessionCount).toBe('0')
  })
})
