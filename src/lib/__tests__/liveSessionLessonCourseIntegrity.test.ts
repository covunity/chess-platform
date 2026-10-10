import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import { isDockerDbAvailable } from '../../test/dbTestHelper'

function runSql(query: string): string {
  const cmd = 'docker exec -i supabase_db_chess-course-platform psql -U postgres -d postgres -t -A -q -v ON_ERROR_STOP=1'
  const output = execSync(cmd, { input: query, encoding: 'utf-8' }).trim()
  return output.split('\n')[0]?.trim() ?? ''
}

describe.skipIf(!isDockerDbAvailable())('TASK 4A — Live Session & Lesson Course Integrity Enforcement', () => {
  const creatorId = '00000000-0000-0000-0000-000000000001'
  let course1Id: string
  let course2Id: string
  let chapter1Id: string
  let chapter2Id: string
  let lesson1AId: string
  let lesson1BId: string
  let lesson2AId: string

  beforeAll(() => {
    // 1. Create Course 1 and Course 2
    course1Id = runSql(`
      INSERT INTO public.courses (creator_id, title, price, status, course_type)
      VALUES ('${creatorId}', 'Course 1 - Lesson Integrity', 0, 'published', 'live')
      RETURNING id;
    `)
    course2Id = runSql(`
      INSERT INTO public.courses (creator_id, title, price, status, course_type)
      VALUES ('${creatorId}', 'Course 2 - Lesson Integrity', 0, 'published', 'live')
      RETURNING id;
    `)
    expect(course1Id).toBeTruthy()
    expect(course2Id).toBeTruthy()

    // 2. Create Chapter 1 under Course 1, Chapter 2 under Course 2
    chapter1Id = runSql(`
      INSERT INTO public.chapters (course_id, title, position)
      VALUES ('${course1Id}', 'Chapter 1 of Course 1', 1)
      RETURNING id;
    `)
    chapter2Id = runSql(`
      INSERT INTO public.chapters (course_id, title, position)
      VALUES ('${course2Id}', 'Chapter 2 of Course 2', 1)
      RETURNING id;
    `)
    expect(chapter1Id).toBeTruthy()
    expect(chapter2Id).toBeTruthy()

    // 3. Create Lesson 1A and Lesson 1B under Chapter 1 (Course 1)
    lesson1AId = runSql(`
      INSERT INTO public.lessons (chapter_id, title, type, position, free_preview, pgn_data, board_perspective, duration_seconds)
      VALUES ('${chapter1Id}', 'Lesson 1A', 'chess', 1, false, '', 'white', 600)
      RETURNING id;
    `)
    lesson1BId = runSql(`
      INSERT INTO public.lessons (chapter_id, title, type, position, free_preview, pgn_data, board_perspective, duration_seconds)
      VALUES ('${chapter1Id}', 'Lesson 1B', 'chess', 2, false, '', 'white', 600)
      RETURNING id;
    `)
    expect(lesson1AId).toBeTruthy()
    expect(lesson1BId).toBeTruthy()

    // 4. Create Lesson 2A under Chapter 2 (Course 2)
    lesson2AId = runSql(`
      INSERT INTO public.lessons (chapter_id, title, type, position, free_preview, pgn_data, board_perspective, duration_seconds)
      VALUES ('${chapter2Id}', 'Lesson 2A', 'chess', 1, false, '', 'white', 600)
      RETURNING id;
    `)
    expect(lesson2AId).toBeTruthy()
  })

  afterAll(() => {
    if (course1Id) {
      runSql(`DELETE FROM public.courses WHERE id = '${course1Id}';`)
    }
    if (course2Id) {
      runSql(`DELETE FROM public.courses WHERE id = '${course2Id}';`)
    }
  })

  it('A. Create session with lesson from same course => PASS', () => {
    const roomName = `room-test-same-${Date.now()}`
    const sessionId = runSql(`
      INSERT INTO public.live_sessions (course_id, lesson_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${course1Id}', '${lesson1AId}', 'Session with Same Course Lesson', now() + interval '1 day', 'SCHEDULED', '${roomName}')
      RETURNING id;
    `)

    expect(sessionId).toBeTruthy()
    const storedLessonId = runSql(`SELECT lesson_id FROM public.live_sessions WHERE id = '${sessionId}';`)
    expect(storedLessonId).toBe(lesson1AId)
  })

  it('B. Create session with lesson from different course => FAIL', () => {
    const roomName = `room-test-cross-${Date.now()}`

    expect(() => {
      runSql(`
        INSERT INTO public.live_sessions (course_id, lesson_id, title, scheduled_start_at, status, livekit_room_name)
        VALUES ('${course1Id}', '${lesson2AId}', 'Cross Course Session', now() + interval '1 day', 'SCHEDULED', '${roomName}');
      `)
    }).toThrow(/Cross-course lesson link is forbidden/)
  })

  it('C. Create session with lesson_id NULL => PASS', () => {
    const roomName = `room-test-null-${Date.now()}`
    const sessionId = runSql(`
      INSERT INTO public.live_sessions (course_id, lesson_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${course1Id}', NULL, 'Session without Lesson', now() + interval '1 day', 'SCHEDULED', '${roomName}')
      RETURNING id;
    `)

    expect(sessionId).toBeTruthy()
    const storedLessonId = runSql(`SELECT lesson_id FROM public.live_sessions WHERE id = '${sessionId}';`)
    expect(storedLessonId).toBe('')
  })

  it('D. Update existing session from valid lesson A to valid lesson B of same course => PASS', () => {
    const roomName = `room-test-upd-same-${Date.now()}`
    const sessionId = runSql(`
      INSERT INTO public.live_sessions (course_id, lesson_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${course1Id}', '${lesson1AId}', 'Session to Update', now() + interval '1 day', 'SCHEDULED', '${roomName}')
      RETURNING id;
    `)

    runSql(`
      UPDATE public.live_sessions
      SET lesson_id = '${lesson1BId}'
      WHERE id = '${sessionId}';
    `)

    const updatedLessonId = runSql(`SELECT lesson_id FROM public.live_sessions WHERE id = '${sessionId}';`)
    expect(updatedLessonId).toBe(lesson1BId)
  })

  it('E. Update lesson_id from valid lesson A to lesson belonging to another course B => FAIL', () => {
    const roomName = `room-test-upd-cross-${Date.now()}`
    const sessionId = runSql(`
      INSERT INTO public.live_sessions (course_id, lesson_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${course1Id}', '${lesson1AId}', 'Session for Cross Update', now() + interval '1 day', 'SCHEDULED', '${roomName}')
      RETURNING id;
    `)

    expect(() => {
      runSql(`
        UPDATE public.live_sessions
        SET lesson_id = '${lesson2AId}'
        WHERE id = '${sessionId}';
      `)
    }).toThrow(/Cross-course lesson link is forbidden/)

    // Verify session lesson_id was not modified
    const currentLessonId = runSql(`SELECT lesson_id FROM public.live_sessions WHERE id = '${sessionId}';`)
    expect(currentLessonId).toBe(lesson1AId)
  })

  it('F. Update course_id to another course while current lesson belongs to original course => FAIL', () => {
    const roomName = `room-test-upd-course-${Date.now()}`
    const sessionId = runSql(`
      INSERT INTO public.live_sessions (course_id, lesson_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${course1Id}', '${lesson1AId}', 'Session Course Switch', now() + interval '1 day', 'DRAFT', '${roomName}')
      RETURNING id;
    `)

    expect(() => {
      runSql(`
        UPDATE public.live_sessions
        SET course_id = '${course2Id}'
        WHERE id = '${sessionId}';
      `)
    }).toThrow(/Cross-course lesson link is forbidden/)

    // Verify course_id was not modified
    const currentCourseId = runSql(`SELECT course_id FROM public.live_sessions WHERE id = '${sessionId}';`)
    expect(currentCourseId).toBe(course1Id)
  })

  it('G. Remove lesson_id -> NULL => PASS', () => {
    const roomName = `room-test-rem-lesson-${Date.now()}`
    const sessionId = runSql(`
      INSERT INTO public.live_sessions (course_id, lesson_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${course1Id}', '${lesson1AId}', 'Session Lesson Removal', now() + interval '1 day', 'SCHEDULED', '${roomName}')
      RETURNING id;
    `)

    runSql(`
      UPDATE public.live_sessions
      SET lesson_id = NULL
      WHERE id = '${sessionId}';
    `)

    const currentLessonId = runSql(`SELECT lesson_id FROM public.live_sessions WHERE id = '${sessionId}';`)
    expect(currentLessonId).toBe('')
  })

  it('H. Nonexistent lesson_id => FAIL', () => {
    const roomName = `room-test-nonexistent-${Date.now()}`
    const fakeLessonId = '00000000-0000-0000-0000-999999999999'

    expect(() => {
      runSql(`
        INSERT INTO public.live_sessions (course_id, lesson_id, title, scheduled_start_at, status, livekit_room_name)
        VALUES ('${course1Id}', '${fakeLessonId}', 'Nonexistent Lesson', now() + interval '1 day', 'SCHEDULED', '${roomName}');
      `)
    }).toThrow(/lesson_not_found/)
  })
})

describe.skipIf(!isDockerDbAvailable())('TASK 4A.1 — Preserve live_sessions lesson/course invariant when lessons or chapters move', () => {
  const creatorId = '00000000-0000-0000-0000-000000000001'
  let courseAId: string
  let courseBId: string
  let chapA1Id: string
  let chapA2Id: string
  let chapA3Id: string
  let chapB1Id: string
  let lessonA1Id: string
  let lessonA3Id: string
  let unreferencedLessonAId: string
  let sessionA1Id: string
  let sessionA3Id: string
  let sessionNullId: string

  beforeAll(() => {
    // Create Course A and Course B
    courseAId = runSql(`
      INSERT INTO public.courses (creator_id, title, price, status, course_type)
      VALUES ('${creatorId}', 'Course A - Task 4A.1', 0, 'published', 'live')
      RETURNING id;
    `)
    courseBId = runSql(`
      INSERT INTO public.courses (creator_id, title, price, status, course_type)
      VALUES ('${creatorId}', 'Course B - Task 4A.1', 0, 'published', 'live')
      RETURNING id;
    `)

    // Create Chapters under Course A and Course B
    chapA1Id = runSql(`
      INSERT INTO public.chapters (course_id, title, position)
      VALUES ('${courseAId}', 'Chapter A1', 1)
      RETURNING id;
    `)
    chapA2Id = runSql(`
      INSERT INTO public.chapters (course_id, title, position)
      VALUES ('${courseAId}', 'Chapter A2', 2)
      RETURNING id;
    `)
    chapA3Id = runSql(`
      INSERT INTO public.chapters (course_id, title, position)
      VALUES ('${courseAId}', 'Chapter A3', 3)
      RETURNING id;
    `)
    chapB1Id = runSql(`
      INSERT INTO public.chapters (course_id, title, position)
      VALUES ('${courseBId}', 'Chapter B1', 1)
      RETURNING id;
    `)

    // Create Lessons
    lessonA1Id = runSql(`
      INSERT INTO public.lessons (chapter_id, title, type, position, free_preview, pgn_data, board_perspective, duration_seconds)
      VALUES ('${chapA1Id}', 'Lesson A1 (Referenced)', 'chess', 1, false, '', 'white', 600)
      RETURNING id;
    `)
    lessonA3Id = runSql(`
      INSERT INTO public.lessons (chapter_id, title, type, position, free_preview, pgn_data, board_perspective, duration_seconds)
      VALUES ('${chapA3Id}', 'Lesson A3 (In Chap A3)', 'chess', 1, false, '', 'white', 600)
      RETURNING id;
    `)
    unreferencedLessonAId = runSql(`
      INSERT INTO public.lessons (chapter_id, title, type, position, free_preview, pgn_data, board_perspective, duration_seconds)
      VALUES ('${chapA1Id}', 'Lesson A Unreferenced', 'chess', 2, false, '', 'white', 600)
      RETURNING id;
    `)

    // Create Sessions under Course A
    const roomA1 = `room-test-4a1-a1-${Date.now()}`
    sessionA1Id = runSql(`
      INSERT INTO public.live_sessions (course_id, lesson_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${courseAId}', '${lessonA1Id}', 'Session referencing Lesson A1', now() + interval '1 day', 'SCHEDULED', '${roomA1}')
      RETURNING id;
    `)

    const roomA3 = `room-test-4a1-a3-${Date.now()}`
    sessionA3Id = runSql(`
      INSERT INTO public.live_sessions (course_id, lesson_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${courseAId}', '${lessonA3Id}', 'Session referencing Lesson A3', now() + interval '1 day', 'SCHEDULED', '${roomA3}')
      RETURNING id;
    `)

    const roomNull = `room-test-4a1-null-${Date.now()}`
    sessionNullId = runSql(`
      INSERT INTO public.live_sessions (course_id, lesson_id, title, scheduled_start_at, status, livekit_room_name)
      VALUES ('${courseAId}', NULL, 'Session with NULL lesson', now() + interval '1 day', 'SCHEDULED', '${roomNull}')
      RETURNING id;
    `)
  })

  afterAll(() => {
    if (courseAId) {
      runSql(`DELETE FROM public.courses WHERE id = '${courseAId}';`)
    }
    if (courseBId) {
      runSql(`DELETE FROM public.courses WHERE id = '${courseBId}';`)
    }
  })

  it('A. Existing valid session + lesson: move lesson to another chapter SAME course => PASS', () => {
    runSql(`
      UPDATE public.lessons
      SET chapter_id = '${chapA2Id}'
      WHERE id = '${lessonA1Id}';
    `)

    const currentChapterId = runSql(`SELECT chapter_id FROM public.lessons WHERE id = '${lessonA1Id}';`)
    expect(currentChapterId).toBe(chapA2Id)

    const sessionData = runSql(`SELECT course_id, lesson_id FROM public.live_sessions WHERE id = '${sessionA1Id}';`)
    expect(sessionData).toContain(courseAId)
    expect(sessionData).toContain(lessonA1Id)
  })

  it('B. Existing valid session + lesson: move lesson to chapter belonging to DIFFERENT course => FAIL', () => {
    expect(() => {
      runSql(`
        UPDATE public.lessons
        SET chapter_id = '${chapB1Id}'
        WHERE id = '${lessonA1Id}';
      `)
    }).toThrow(/Cannot move lesson.*referenced by live session/)
  })

  it('C. After failed move: lesson.chapter_id remains unchanged', () => {
    const currentChapterId = runSql(`SELECT chapter_id FROM public.lessons WHERE id = '${lessonA1Id}';`)
    expect(currentChapterId).toBe(chapA2Id)
  })

  it('D. Existing valid session remains valid', () => {
    const currentSessionLessonId = runSql(`SELECT lesson_id FROM public.live_sessions WHERE id = '${sessionA1Id}';`)
    expect(currentSessionLessonId).toBe(lessonA1Id)

    const currentSessionCourseId = runSql(`SELECT course_id FROM public.live_sessions WHERE id = '${sessionA1Id}';`)
    expect(currentSessionCourseId).toBe(courseAId)
  })

  it('E. Changing chapter ownership to another course while containing a referenced lesson => FAIL', () => {
    // chapA3 contains lessonA3, which is referenced by sessionA3 in Course A.
    // Changing chapA3 course_id to Course B must FAIL!
    expect(() => {
      runSql(`
        UPDATE public.chapters
        SET course_id = '${courseBId}'
        WHERE id = '${chapA3Id}';
      `)
    }).toThrow(/Cannot move chapter.*is referenced by live session/)

    // Chapter course_id remains unchanged
    const currentCourseId = runSql(`SELECT course_id FROM public.chapters WHERE id = '${chapA3Id}';`)
    expect(currentCourseId).toBe(courseAId)

    // A chapter without referenced lessons CAN change course without violation
    const unreferencedChapId = runSql(`
      INSERT INTO public.chapters (course_id, title, position)
      VALUES ('${courseAId}', 'Unreferenced Chapter', 99)
      RETURNING id;
    `)
    runSql(`
      UPDATE public.chapters
      SET course_id = '${courseBId}'
      WHERE id = '${unreferencedChapId}';
    `)
    const updatedChapCourseId = runSql(`SELECT course_id FROM public.chapters WHERE id = '${unreferencedChapId}';`)
    expect(updatedChapCourseId).toBe(courseBId)
  })

  it('F. live_session.lesson_id = NULL => unrelated lesson movement must not matter', () => {
    // Unreferenced lesson can move to a chapter in another course without issue
    runSql(`
      UPDATE public.lessons
      SET chapter_id = '${chapB1Id}'
      WHERE id = '${unreferencedLessonAId}';
    `)

    const currentChapter = runSql(`SELECT chapter_id FROM public.lessons WHERE id = '${unreferencedLessonAId}';`)
    expect(currentChapter).toBe(chapB1Id)

    // The NULL lesson session remains valid
    const nullSessionLesson = runSql(`SELECT lesson_id FROM public.live_sessions WHERE id = '${sessionNullId}';`)
    expect(nullSessionLesson).toBe('')
  })
})

