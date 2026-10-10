import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import { isDockerDbAvailable } from '../../test/dbTestHelper'

function runSql(query: string): string {
  const cmd = 'docker exec -i supabase_db_chess-course-platform psql -U postgres -d postgres -t -A -q -v ON_ERROR_STOP=1'
  const output = execSync(cmd, { input: query, encoding: 'utf-8' }).trim()
  return output.split('\n')[0]?.trim() ?? ''
}

describe.skipIf(!isDockerDbAvailable())('TASK 4C.1 — Lifecycle-Aware Live Session Field Mutability Enforcement', () => {
  const creatorId = '00000000-0000-0000-0000-000000000001'
  let course1Id: string
  let course2Id: string
  let chapter1Id: string
  let chapter2Id: string
  let lesson1AId: string
  let lesson1BId: string
  let lesson2AId: string

  beforeAll(() => {
    // 1. Create two live courses
    course1Id = runSql(`
      INSERT INTO public.courses (creator_id, title, price, status, course_type)
      VALUES ('${creatorId}', 'Course 1 - Field Mutability', 0, 'published', 'live')
      RETURNING id;
    `)
    course2Id = runSql(`
      INSERT INTO public.courses (creator_id, title, price, status, course_type)
      VALUES ('${creatorId}', 'Course 2 - Field Mutability', 0, 'published', 'live')
      RETURNING id;
    `)

    // 2. Create chapters
    chapter1Id = runSql(`
      INSERT INTO public.chapters (course_id, title, position)
      VALUES ('${course1Id}', 'Chapter 1', 1)
      RETURNING id;
    `)
    chapter2Id = runSql(`
      INSERT INTO public.chapters (course_id, title, position)
      VALUES ('${course2Id}', 'Chapter 2', 1)
      RETURNING id;
    `)

    // 3. Create lessons
    lesson1AId = runSql(`
      INSERT INTO public.lessons (chapter_id, title, type, position)
      VALUES ('${chapter1Id}', 'Lesson 1A', 'chess', 1)
      RETURNING id;
    `)
    lesson1BId = runSql(`
      INSERT INTO public.lessons (chapter_id, title, type, position)
      VALUES ('${chapter1Id}', 'Lesson 1B', 'chess', 2)
      RETURNING id;
    `)
    lesson2AId = runSql(`
      INSERT INTO public.lessons (chapter_id, title, type, position)
      VALUES ('${chapter2Id}', 'Lesson 2A', 'chess', 1)
      RETURNING id;
    `)

    expect(course1Id).toBeTruthy()
    expect(course2Id).toBeTruthy()
  })

  afterAll(() => {
    if (course1Id) runSql(`DELETE FROM public.courses WHERE id = '${course1Id}';`)
    if (course2Id) runSql(`DELETE FROM public.courses WHERE id = '${course2Id}';`)
  })

  describe('1. DRAFT Sessions', () => {
    it('allows editing normal metadata and moving course_id when valid', () => {
      const room = `room-draft-${Date.now()}`
      const draftId = runSql(`
        INSERT INTO public.live_sessions (course_id, lesson_id, title, scheduled_start_at, status, livekit_room_name)
        VALUES ('${course1Id}', '${lesson1AId}', 'Draft Initial Title', now() + interval '1 day', 'DRAFT', '${room}')
        RETURNING id;
      `)

      // Update editable metadata
      runSql(`
        UPDATE public.live_sessions
        SET title = 'Draft Updated Title',
            description = 'Draft Description',
            agenda = '[{"title": "Intro", "duration_minutes": 10}]'::jsonb,
            max_participants = 25,
            lesson_id = '${lesson1BId}'
        WHERE id = '${draftId}';
      `)

      const updatedTitle = runSql(`SELECT title FROM public.live_sessions WHERE id = '${draftId}';`)
      expect(updatedTitle).toBe('Draft Updated Title')

      const updatedLesson = runSql(`SELECT lesson_id FROM public.live_sessions WHERE id = '${draftId}';`)
      expect(updatedLesson).toBe(lesson1BId)

      // In DRAFT, course_id can change if lesson_id is cleared or points to the new course
      runSql(`
        UPDATE public.live_sessions
        SET course_id = '${course2Id}',
            lesson_id = '${lesson2AId}'
        WHERE id = '${draftId}';
      `)

      const updatedCourse = runSql(`SELECT course_id FROM public.live_sessions WHERE id = '${draftId}';`)
      expect(updatedCourse).toBe(course2Id)
    })
  })

  describe('2. SCHEDULED Sessions', () => {
    let scheduledId: string

    beforeAll(() => {
      const room = `room-sched-${Date.now()}`
      scheduledId = runSql(`
        INSERT INTO public.live_sessions (course_id, lesson_id, title, scheduled_start_at, status, livekit_room_name)
        VALUES ('${course1Id}', '${lesson1AId}', 'Scheduled Initial Title', now() + interval '2 days', 'SCHEDULED', '${room}')
        RETURNING id;
      `)
    })

    it('allows updating title, description, agenda, schedule, lesson_id, and max_participants', () => {
      runSql(`
        UPDATE public.live_sessions
        SET title = 'Scheduled Rescheduled Title',
            description = 'Scheduled New Desc',
            scheduled_start_at = now() + interval '3 days',
            scheduled_end_at = now() + interval '3 days 2 hours',
            lesson_id = '${lesson1BId}',
            max_participants = 35
        WHERE id = '${scheduledId}';
      `)

      const title = runSql(`SELECT title FROM public.live_sessions WHERE id = '${scheduledId}';`)
      expect(title).toBe('Scheduled Rescheduled Title')

      const lesson = runSql(`SELECT lesson_id FROM public.live_sessions WHERE id = '${scheduledId}';`)
      expect(lesson).toBe(lesson1BId)

      const maxP = runSql(`SELECT max_participants FROM public.live_sessions WHERE id = '${scheduledId}';`)
      expect(maxP).toBe('35')
    })

    it('REJECTS changing course_id once session is SCHEDULED', () => {
      expect(() => {
        runSql(`
          UPDATE public.live_sessions
          SET course_id = '${course2Id}',
              lesson_id = NULL
          WHERE id = '${scheduledId}';
        `)
      }).toThrow(/Cannot change course_id once session is SCHEDULED/)

      // Verify course_id remains unchanged
      const course = runSql(`SELECT course_id FROM public.live_sessions WHERE id = '${scheduledId}';`)
      expect(course).toBe(course1Id)
    })
  })

  describe('3. LIVE Sessions', () => {
    let liveId: string

    beforeAll(() => {
      const room = `room-live-${Date.now()}`
      liveId = runSql(`
        INSERT INTO public.live_sessions (course_id, lesson_id, title, scheduled_start_at, scheduled_end_at, status, livekit_room_name)
        VALUES ('${course1Id}', '${lesson1AId}', 'Live Session Title', now(), now() + interval '1 hour', 'SCHEDULED', '${room}')
        RETURNING id;
      `)

      // Transition to LIVE via server transition simulation
      runSql(`
        SELECT set_config('app.live_session_transition', 'true', false);
        UPDATE public.live_sessions SET status = 'LIVE', started_at = now() WHERE id = '${liveId}';
        SELECT set_config('app.live_session_transition', 'false', false);
      `)
    })

    it('REJECTS changing course_id while session is LIVE', () => {
      expect(() => {
        runSql(`
          UPDATE public.live_sessions
          SET course_id = '${course2Id}'
          WHERE id = '${liveId}';
        `)
      }).toThrow(/Cannot change course_id while session is in LIVE status/)

      const currentCourse = runSql(`SELECT course_id FROM public.live_sessions WHERE id = '${liveId}';`)
      expect(currentCourse).toBe(course1Id)
    })

    it('REJECTS changing lesson_id while session is LIVE', () => {
      expect(() => {
        runSql(`
          UPDATE public.live_sessions
          SET lesson_id = '${lesson1BId}'
          WHERE id = '${liveId}';
        `)
      }).toThrow(/Cannot change lesson_id while session is in LIVE status/)

      const currentLesson = runSql(`SELECT lesson_id FROM public.live_sessions WHERE id = '${liveId}';`)
      expect(currentLesson).toBe(lesson1AId)
    })

    it('REJECTS changing scheduled_start_at while session is LIVE', () => {
      expect(() => {
        runSql(`
          UPDATE public.live_sessions
          SET scheduled_start_at = now() + interval '10 days'
          WHERE id = '${liveId}';
        `)
      }).toThrow(/Cannot change scheduled_start_at while session is in LIVE status/)
    })

    it('REJECTS changing scheduled_end_at while session is LIVE', () => {
      expect(() => {
        runSql(`
          UPDATE public.live_sessions
          SET scheduled_end_at = now() + interval '10 days 2 hours'
          WHERE id = '${liveId}';
        `)
      }).toThrow(/Cannot change scheduled_end_at while session is in LIVE status/)
    })

    it('ALLOWS updating title, description, agenda, and max_participants while LIVE', () => {
      runSql(`
        UPDATE public.live_sessions
        SET title = 'Updated Title During Live',
            description = 'Live Description',
            max_participants = 100,
            agenda = '[{"title": "Bonus Round", "duration_minutes": 20}]'::jsonb
        WHERE id = '${liveId}';
      `)

      const title = runSql(`SELECT title FROM public.live_sessions WHERE id = '${liveId}';`)
      expect(title).toBe('Updated Title During Live')

      const maxP = runSql(`SELECT max_participants FROM public.live_sessions WHERE id = '${liveId}';`)
      expect(maxP).toBe('100')
    })
  })

  describe('4. ENDED Sessions', () => {
    let endedId: string

    beforeAll(() => {
      const room = `room-ended-${Date.now()}`
      endedId = runSql(`
        INSERT INTO public.live_sessions (course_id, lesson_id, title, scheduled_start_at, status, livekit_room_name)
        VALUES ('${course1Id}', '${lesson1AId}', 'Ended Session Title', now() - interval '2 hours', 'SCHEDULED', '${room}')
        RETURNING id;
      `)

      // Transition SCHEDULED -> LIVE -> ENDED
      runSql(`
        SELECT set_config('app.live_session_transition', 'true', false);
        UPDATE public.live_sessions SET status = 'LIVE', started_at = now() - interval '2 hours' WHERE id = '${endedId}';
        UPDATE public.live_sessions SET status = 'ENDED', ended_at = now() - interval '30 minutes' WHERE id = '${endedId}';
        SELECT set_config('app.live_session_transition', 'false', false);
      `)
    })

    it('REJECTS modifying any normal editable field on an ENDED session', () => {
      // 1. title
      expect(() => {
        runSql(`UPDATE public.live_sessions SET title = 'Hacked Title' WHERE id = '${endedId}';`)
      }).toThrow(/Cannot modify session in ENDED status\. Session is read-only\./)

      // 2. description
      expect(() => {
        runSql(`UPDATE public.live_sessions SET description = 'Hacked Desc' WHERE id = '${endedId}';`)
      }).toThrow(/Cannot modify session in ENDED status\. Session is read-only\./)

      // 3. lesson_id
      expect(() => {
        runSql(`UPDATE public.live_sessions SET lesson_id = '${lesson1BId}' WHERE id = '${endedId}';`)
      }).toThrow(/Cannot modify session in ENDED status\. Session is read-only\./)

      // 4. scheduled_start_at
      expect(() => {
        runSql(`UPDATE public.live_sessions SET scheduled_start_at = now() WHERE id = '${endedId}';`)
      }).toThrow(/Cannot modify session in ENDED status\. Session is read-only\./)

      // 5. scheduled_end_at
      expect(() => {
        runSql(`UPDATE public.live_sessions SET scheduled_end_at = now() + interval '1 hour' WHERE id = '${endedId}';`)
      }).toThrow(/Cannot modify session in ENDED status\. Session is read-only\./)

      // 6. timezone
      expect(() => {
        runSql(`UPDATE public.live_sessions SET timezone = 'UTC' WHERE id = '${endedId}';`)
      }).toThrow(/Cannot modify session in ENDED status\. Session is read-only\./)

      // 7. agenda
      expect(() => {
        runSql(`UPDATE public.live_sessions SET agenda = '[{"title": "Modified", "duration_minutes": 10}]'::jsonb WHERE id = '${endedId}';`)
      }).toThrow(/Cannot modify session in ENDED status\. Session is read-only\./)

      // 8. max_participants
      expect(() => {
        runSql(`UPDATE public.live_sessions SET max_participants = 999 WHERE id = '${endedId}';`)
      }).toThrow(/Cannot modify session in ENDED status\. Session is read-only\./)

      // 9. course_id
      expect(() => {
        runSql(`UPDATE public.live_sessions SET course_id = '${course2Id}' WHERE id = '${endedId}';`)
      }).toThrow(/Cannot modify session in ENDED status\. Session is read-only\./)

      // Verify row is unchanged
      const title = runSql(`SELECT title FROM public.live_sessions WHERE id = '${endedId}';`)
      expect(title).toBe('Ended Session Title')
    })
  })

  describe('5. CANCELLED Sessions', () => {
    let cancelledId: string

    beforeAll(() => {
      const room = `room-canc-${Date.now()}`
      cancelledId = runSql(`
        INSERT INTO public.live_sessions (course_id, lesson_id, title, scheduled_start_at, status, livekit_room_name)
        VALUES ('${course1Id}', '${lesson1AId}', 'Cancelled Session Title', now() + interval '5 days', 'SCHEDULED', '${room}')
        RETURNING id;
      `)

      // Transition to CANCELLED via server transition
      runSql(`
        SELECT set_config('app.live_session_transition', 'true', false);
        UPDATE public.live_sessions SET status = 'CANCELLED' WHERE id = '${cancelledId}';
        SELECT set_config('app.live_session_transition', 'false', false);
      `)
    })

    it('REJECTS modifying normal editable fields on a CANCELLED session', () => {
      expect(() => {
        runSql(`UPDATE public.live_sessions SET title = 'Hacked Cancelled' WHERE id = '${cancelledId}';`)
      }).toThrow(/Cannot modify session in CANCELLED status\. Session is read-only\./)

      expect(() => {
        runSql(`UPDATE public.live_sessions SET max_participants = 50 WHERE id = '${cancelledId}';`)
      }).toThrow(/Cannot modify session in CANCELLED status\. Session is read-only\./)

      expect(() => {
        runSql(`UPDATE public.live_sessions SET scheduled_start_at = now() + interval '10 days' WHERE id = '${cancelledId}';`)
      }).toThrow(/Cannot modify session in CANCELLED status\. Session is read-only\./)

      const title = runSql(`SELECT title FROM public.live_sessions WHERE id = '${cancelledId}';`)
      expect(title).toBe('Cancelled Session Title')
    })
  })
})
