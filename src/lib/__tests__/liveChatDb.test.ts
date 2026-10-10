import { describe, it, expect, beforeAll } from 'vitest'
import { execSync } from 'child_process'

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

describe('TASK 8.1 — Real PostgreSQL Verification: Live Chat Persistence & Isolation', () => {
  const teacherId = '77777777-cccc-1111-cccc-777777777771'
  const assistantId = '77777777-cccc-2222-cccc-777777777772'
  const studentWhiteAId = '77777777-cccc-3333-cccc-777777777773'
  const studentBlackAId = '77777777-cccc-4444-cccc-777777777774'
  const studentWhiteBId = '77777777-cccc-5555-cccc-777777777775'
  const studentBlackBId = '77777777-cccc-6666-cccc-777777777776'
  const unenrolledUserId = '77777777-cccc-7777-cccc-777777777777'
  const adminId = '77777777-cccc-8888-cccc-777777777778'

  let courseId: string
  let liveSessionId: string
  let endedSessionId: string
  let cancelledSessionId: string
  let otherCourseSessionId: string

  beforeAll(() => {
    // 1. Provision test users
    runSql(`
      DO $body$
      DECLARE
        u_id uuid;
      BEGIN
        FOR u_id IN SELECT unnest(ARRAY[
          '${teacherId}'::uuid,
          '${assistantId}'::uuid,
          '${studentWhiteAId}'::uuid,
          '${studentBlackAId}'::uuid,
          '${studentWhiteBId}'::uuid,
          '${studentBlackBId}'::uuid,
          '${unenrolledUserId}'::uuid,
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

    runSql(`
      UPDATE public.users SET role = 'creator' WHERE id = '${teacherId}';
      UPDATE public.users SET role = 'admin' WHERE id = '${adminId}';
      UPDATE public.users SET role = 'learner' WHERE id IN (
        '${assistantId}', '${studentWhiteAId}', '${studentBlackAId}',
        '${studentWhiteBId}', '${studentBlackBId}', '${unenrolledUserId}'
      );
    `)

    // 2. Create courses
    courseId = runSql(`
      INSERT INTO public.courses (creator_id, title, price, status, course_type)
      VALUES ('${teacherId}', 'Live Chat Test Course', 0, 'published', 'live')
      RETURNING id;
    `)

    const otherCourseId = runSql(`
      INSERT INTO public.courses (creator_id, title, price, status, course_type)
      VALUES ('${teacherId}', 'Other Live Course', 0, 'published', 'live')
      RETURNING id;
    `)

    // 3. Enroll students in main course
    runSql(`
      INSERT INTO public.enrollments (user_id, course_id)
      VALUES
        ('${studentWhiteAId}', '${courseId}'),
        ('${studentBlackAId}', '${courseId}'),
        ('${studentWhiteBId}', '${courseId}'),
        ('${studentBlackBId}', '${courseId}')
      ON CONFLICT DO NOTHING;
    `)

    const runTag = Math.random().toString(36).substring(2, 8)

    // 4. Create active LIVE session
    liveSessionId = runSql(`
      INSERT INTO public.live_sessions (
        course_id, title, scheduled_start_at, status, livekit_room_name
      ) VALUES (
        '${courseId}', 'Live Chat Active Session', now() - interval '5 minutes', 'SCHEDULED',
        'chat-room-active-${runTag}'
      ) RETURNING id;
    `)

    // Assign assistant
    runSql(`
      INSERT INTO public.live_session_staff (live_session_id, user_id, role)
      VALUES ('${liveSessionId}', '${assistantId}', 'assistant')
      ON CONFLICT DO NOTHING;
    `)

    // Start session
    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${teacherId}')::text, true);
        PERFORM public.start_live_session('${liveSessionId}'::uuid);
      END $body$;
    `)

    // 5. Create ENDED session
    endedSessionId = runSql(`
      INSERT INTO public.live_sessions (
        course_id, title, scheduled_start_at, status, livekit_room_name
      ) VALUES (
        '${courseId}', 'Live Chat Ended Session', now() - interval '2 hours', 'SCHEDULED',
        'chat-room-ended-${runTag}'
      ) RETURNING id;
    `)
    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${teacherId}')::text, true);
        PERFORM public.start_live_session('${endedSessionId}'::uuid);
        PERFORM public.end_live_session('${endedSessionId}'::uuid);
      END $body$;
    `)

    // 6. Create CANCELLED session
    cancelledSessionId = runSql(`
      INSERT INTO public.live_sessions (
        course_id, title, scheduled_start_at, status, livekit_room_name
      ) VALUES (
        '${courseId}', 'Live Chat Cancelled Session', now() - interval '1 hour', 'SCHEDULED',
        'chat-room-cancelled-${runTag}'
      ) RETURNING id;
    `)
    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${teacherId}')::text, true);
        PERFORM public.cancel_live_session('${cancelledSessionId}'::uuid);
      END $body$;
    `)

    // 7. Create other course session
    otherCourseSessionId = runSql(`
      INSERT INTO public.live_sessions (
        course_id, title, scheduled_start_at, status, livekit_room_name
      ) VALUES (
        '${otherCourseId}', 'Other Session', now() - interval '5 minutes', 'SCHEDULED',
        'chat-room-other-${runTag}'
      ) RETURNING id;
    `)
    runSql(`
      DO $body$
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', '${teacherId}')::text, true);
        PERFORM public.start_live_session('${otherCourseSessionId}'::uuid);
      END $body$;
    `)

    // 8. Assign practice boards in live_games for isolation testing
    // Board A has studentWhiteA and studentBlackA
    runSql(`
      INSERT INTO public.live_games (
        live_session_id, board_id, game_scope, white_user_id, black_user_id, status
      ) VALUES (
        '${liveSessionId}', 'board-a', 'PRACTICE', '${studentWhiteAId}', '${studentBlackAId}', 'IN_PROGRESS'
      );
    `)
    // Board B has studentWhiteB and studentBlackB
    runSql(`
      INSERT INTO public.live_games (
        live_session_id, board_id, game_scope, white_user_id, black_user_id, status
      ) VALUES (
        '${liveSessionId}', 'board-b', 'PRACTICE', '${studentWhiteBId}', '${studentBlackBId}', 'IN_PROGRESS'
      );
    `)
  })

  // 1. Authorized student can insert MAIN message
  it('1. authorized student can insert MAIN message', () => {
    const res = runAsUser(
      studentWhiteAId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'MAIN',
        'Hello from Student White A in main chat'
      );`
    )
    expect(res).toContain('Hello from Student White A in main chat')
    expect(res).toContain('"scope": "MAIN"')
  })

  // 2. Authorized teacher can insert MAIN message
  it('2. authorized teacher can insert MAIN message', () => {
    const res = runAsUser(
      teacherId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'MAIN',
        'Welcome class from Teacher!'
      );`
    )
    expect(res).toContain('Welcome class from Teacher!')
  })

  // 3. Authorized assistant can insert MAIN message
  it('3. authorized assistant can insert MAIN message', () => {
    const res = runAsUser(
      assistantId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'MAIN',
        'Assistant here to help'
      );`
    )
    expect(res).toContain('Assistant here to help')
  })

  // 4. Authorized participant can read MAIN messages
  it('4. authorized participant can read MAIN messages', () => {
    const directSelect = runAsUser(
      studentBlackAId,
      `SELECT count(*) FROM public.live_chat_messages WHERE live_session_id = '${liveSessionId}' AND scope = 'MAIN';`
    )
    expect(Number(directSelect)).toBeGreaterThanOrEqual(3)

    const rpcRes = runAsUser(
      studentBlackAId,
      `SELECT count(*) FROM public.get_live_chat_messages('${liveSessionId}'::uuid, 'MAIN');`
    )
    expect(Number(rpcRes)).toBeGreaterThanOrEqual(3)
  })

  // 5. Unauthorized non-enrolled user cannot insert
  it('5. unauthorized non-enrolled user cannot insert', () => {
    const threwRpc = runAsUserThrows(
      unenrolledUserId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'MAIN',
        'Spam message from unenrolled'
      );`
    )
    expect(threwRpc).toBe(true)

    const threwDirect = runAsUserThrows(
      unenrolledUserId,
      `INSERT INTO public.live_chat_messages (
        live_session_id, scope, sender_user_id, message
      ) VALUES (
        '${liveSessionId}', 'MAIN', '${unenrolledUserId}', 'Direct insert hack'
      );`
    )
    expect(threwDirect).toBe(true)
  })

  // 6. Unauthorized non-enrolled user cannot read
  it('6. unauthorized non-enrolled user cannot read', () => {
    const directSelect = runAsUser(
      unenrolledUserId,
      `SELECT count(*) FROM public.live_chat_messages WHERE live_session_id = '${liveSessionId}';`
    )
    expect(Number(directSelect)).toBe(0)

    const threwRpc = runAsUserThrows(
      unenrolledUserId,
      `SELECT * FROM public.get_live_chat_messages('${liveSessionId}'::uuid, 'MAIN');`
    )
    expect(threwRpc).toBe(true)
  })

  // 7. Cross-session insert is rejected
  it('7. cross-session insert is rejected', () => {
    // Student White A is not enrolled in otherCourseSessionId
    const threw = runAsUserThrows(
      studentWhiteAId,
      `SELECT public.send_live_chat_message(
        '${otherCourseSessionId}'::uuid,
        'MAIN',
        'Cross session injection'
      );`
    )
    expect(threw).toBe(true)
  })

  // 8. PRACTICE message requires board_id
  it('8. PRACTICE message requires board_id', () => {
    const threwRpc = runAsUserThrows(
      studentWhiteAId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'PRACTICE',
        'Practice without board',
        NULL
      );`
    )
    expect(threwRpc).toBe(true)

    const threwDirect = runAsUserThrows(
      studentWhiteAId,
      `INSERT INTO public.live_chat_messages (
        live_session_id, scope, board_id, sender_user_id, message
      ) VALUES (
        '${liveSessionId}', 'PRACTICE', NULL, '${studentWhiteAId}', 'Direct practice without board'
      );`
    )
    expect(threwDirect).toBe(true)
  })

  // 9. MAIN message rejects board_id
  it('9. MAIN message rejects board_id', () => {
    const threwRpc = runAsUserThrows(
      studentWhiteAId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'MAIN',
        'Main message with board',
        'board-a'
      );`
    )
    expect(threwRpc).toBe(true)

    const threwDirect = runAsUserThrows(
      studentWhiteAId,
      `INSERT INTO public.live_chat_messages (
        live_session_id, scope, board_id, sender_user_id, message
      ) VALUES (
        '${liveSessionId}', 'MAIN', 'board-a', '${studentWhiteAId}', 'Direct main with board'
      );`
    )
    expect(threwDirect).toBe(true)
  })

  // 10. Practice message is scoped to its board
  it('10. practice message is scoped to its board', () => {
    const msgRes = runAsUser(
      studentWhiteAId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'PRACTICE',
        'Good luck on Board A!',
        'board-a'
      );`
    )
    expect(msgRes).toContain('Good luck on Board A!')
    expect(msgRes).toContain('"board_id": "board-a"')

    // Querying Board B history should NOT contain Board A messages
    const boardBMsgs = runAsUser(
      studentWhiteBId,
      `SELECT count(*) FROM public.get_live_chat_messages('${liveSessionId}'::uuid, 'PRACTICE', 'board-b');`
    )
    expect(Number(boardBMsgs)).toBe(0)
  })

  // 11. Board A participant cannot read Board B private chat
  it('11. Board A participant cannot read Board B private chat', () => {
    // Student B sends message on Board B
    runAsUser(
      studentWhiteBId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'PRACTICE',
        'Secret tactics on Board B',
        'board-b'
      );`
    )

    // Student A tries to read Board B via direct SELECT
    const directRows = runAsUser(
      studentWhiteAId,
      `SELECT count(*) FROM public.live_chat_messages WHERE live_session_id = '${liveSessionId}' AND board_id = 'board-b';`
    )
    expect(Number(directRows)).toBe(0)

    // Student A tries to read Board B via RPC
    const threwRpc = runAsUserThrows(
      studentWhiteAId,
      `SELECT * FROM public.get_live_chat_messages('${liveSessionId}'::uuid, 'PRACTICE', 'board-b');`
    )
    expect(threwRpc).toBe(true)

    // Teacher CAN read Board B
    const teacherRows = runAsUser(
      teacherId,
      `SELECT count(*) FROM public.get_live_chat_messages('${liveSessionId}'::uuid, 'PRACTICE', 'board-b');`
    )
    expect(Number(teacherRows)).toBeGreaterThanOrEqual(1)
  })

  // 12. Finalized/cancelled session read behavior matches chosen policy
  it('12. finalized/cancelled session read behavior matches chosen policy', () => {
    // Insert a message into endedSessionId as teacher before end (using admin or insert)
    runSql(`
      INSERT INTO public.live_chat_messages (
        live_session_id, scope, sender_user_id, message
      ) VALUES (
        '${endedSessionId}', 'MAIN', '${teacherId}', 'Historical ended session message'
      );
    `)

    // Enrolled student CAN read history of ended session
    const readEnded = runAsUser(
      studentWhiteAId,
      `SELECT count(*) FROM public.get_live_chat_messages('${endedSessionId}'::uuid, 'MAIN');`
    )
    expect(Number(readEnded)).toBe(1)

    // CANCELLED session rejects new inserts
    const threwCancelledInsert = runAsUserThrows(
      studentWhiteAId,
      `SELECT public.send_live_chat_message(
        '${cancelledSessionId}'::uuid,
        'MAIN',
        'Should fail inserting into cancelled session'
      );`
    )
    expect(threwCancelledInsert).toBe(true)
  })

  // 13. Duplicate client_message_id is idempotent
  it('13. duplicate client_message_id is idempotent', () => {
    const clientUuid = 'client-msg-uuid-999'

    const first = runAsUser(
      studentWhiteAId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'MAIN',
        'Idempotent message content',
        NULL,
        '${clientUuid}'
      );`
    )
    expect(first).toContain(clientUuid)

    // Send identical client_message_id again
    const second = runAsUser(
      studentWhiteAId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'MAIN',
        'Idempotent message content',
        NULL,
        '${clientUuid}'
      );`
    )
    expect(second).toContain(clientUuid)

    // Check count in DB: exactly 1 row
    const count = runSql(`
      SELECT count(*) FROM public.live_chat_messages
      WHERE live_session_id = '${liveSessionId}' AND client_message_id = '${clientUuid}';
    `)
    expect(Number(count)).toBe(1)
  })

  // 14. Oversized/empty messages are rejected
  it('14. oversized/empty messages are rejected', () => {
    // Empty message
    const emptyThrows = runAsUserThrows(
      studentWhiteAId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'MAIN',
        ''
      );`
    )
    expect(emptyThrows).toBe(true)

    // Whitespace only
    const whitespaceThrows = runAsUserThrows(
      studentWhiteAId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'MAIN',
        '     '
      );`
    )
    expect(whitespaceThrows).toBe(true)

    // Oversized message (> 1000 characters)
    const longText = 'a'.repeat(1001)
    const oversizedThrows = runAsUserThrows(
      studentWhiteAId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'MAIN',
        '${longText}'
      );`
    )
    expect(oversizedThrows).toBe(true)
  })

  // Bonus invariant tests: Immutability (no UPDATE, no direct DELETE)
  it('15. chat messages are append-only (UPDATE and direct DELETE blocked)', () => {
    const msgId = runSql(`
      SELECT id FROM public.live_chat_messages WHERE live_session_id = '${liveSessionId}' LIMIT 1;
    `)
    expect(msgId).toBeTruthy()

    // Direct UPDATE blocked
    const updateThrows = runSqlThrows(`
      UPDATE public.live_chat_messages SET message = 'Tampered' WHERE id = '${msgId}';
    `)
    expect(updateThrows).toBe(true)

    // Direct DELETE blocked
    const deleteThrows = runSqlThrows(`
      DELETE FROM public.live_chat_messages WHERE id = '${msgId}';
    `)
    expect(deleteThrows).toBe(true)
  })

  // 16. Authorized black player can persist Board A chat
  it('16. authorized black player can persist Board A chat', () => {
    const res = runAsUser(
      studentBlackAId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'PRACTICE',
        'Hello from Student Black on Board A',
        'board-a'
      );`
    )
    expect(res).toContain('Hello from Student Black on Board A')
    expect(res).toContain('"board_id": "board-a"')
  })

  // 17. Unauthorized student cannot persist Board A chat
  it('17. unauthorized student cannot persist Board A chat', () => {
    // studentWhiteB is assigned to Board B, so Board A must reject them
    const threw = runAsUserThrows(
      studentWhiteBId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'PRACTICE',
        'Intruder message on Board A',
        'board-a'
      );`
    )
    expect(threw).toBe(true)
  })

  // 18. Teacher can persist and read Board A chat
  it('18. teacher can persist and read Board A chat', () => {
    const sendRes = runAsUser(
      teacherId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'PRACTICE',
        'Teacher inspecting Board A: remember to develop your pieces!',
        'board-a'
      );`
    )
    expect(sendRes).toContain('Teacher inspecting Board A')

    const readRes = runAsUser(
      teacherId,
      `SELECT count(*) FROM public.get_live_chat_messages('${liveSessionId}'::uuid, 'PRACTICE', 'board-a');`
    )
    expect(Number(readRes)).toBeGreaterThanOrEqual(1)
  })

  // 19. Assistant behavior: can send/read MAIN chat, but cannot send/read Board A practice chat
  it('19. assistant behavior: can send/read MAIN chat, but cannot send/read Board A practice chat', () => {
    // Assistant sends to MAIN chat -> succeeds
    const mainSend = runAsUser(
      assistantId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'MAIN',
        'Assistant announcement in main room'
      );`
    )
    expect(mainSend).toContain('Assistant announcement in main room')

    // Assistant tries to send to Board A private practice chat -> REJECTED
    const threwPracticeSend = runAsUserThrows(
      assistantId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'PRACTICE',
        'Assistant attempting to send to Board A',
        'board-a'
      );`
    )
    expect(threwPracticeSend).toBe(true)

    // Assistant tries to read Board A private practice chat -> REJECTED
    const threwPracticeRead = runAsUserThrows(
      assistantId,
      `SELECT * FROM public.get_live_chat_messages('${liveSessionId}'::uuid, 'PRACTICE', 'board-a');`
    )
    expect(threwPracticeRead).toBe(true)
  })

  // 20. Unrelated admin behavior follows Task 7 semantics
  it('20. unrelated admin behavior follows Task 7 semantics (student role in classroom; cannot inject practice chat)', () => {
    // Admin sends to MAIN chat -> succeeds
    const mainSend = runAsUser(
      adminId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'MAIN',
        'Admin notice in main room'
      );`
    )
    expect(mainSend).toContain('Admin notice in main room')

    // Admin tries to send to Board A practice chat (admin is not course creator, not a board player) -> REJECTED
    const threwPracticeSend = runAsUserThrows(
      adminId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'PRACTICE',
        'Admin attempting to inject practice chat on Board A',
        'board-a'
      );`
    )
    expect(threwPracticeSend).toBe(true)
  })

  // 21. Session A participant cannot read Session B chat (cross-session read rejected)
  it('21. session A participant cannot read session B chat (cross-session read rejected)', () => {
    // studentWhiteA is enrolled in liveSessionId, but NOT in otherCourseSessionId
    const threw = runAsUserThrows(
      studentWhiteAId,
      `SELECT * FROM public.get_live_chat_messages('${otherCourseSessionId}'::uuid, 'MAIN');`
    )
    expect(threw).toBe(true)

    // Direct SELECT on other course session returns 0 rows
    const count = runAsUser(
      studentWhiteAId,
      `SELECT count(*) FROM public.live_chat_messages WHERE live_session_id = '${otherCourseSessionId}';`
    )
    expect(Number(count)).toBe(0)
  })

  // 22. Dynamic board without live_games: teacher can post; cross-board student blocked; dynamic policy enforced
  it('22. dynamic board without live_games: teacher can post; cross-board student blocked', () => {
    const dynBoardId = 'dyn-board-unassigned-1'

    // 1. Teacher can always send and read on any dynamic board in the session
    const teacherSend = runAsUser(
      teacherId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'PRACTICE',
        'Teacher greeting on newly created dynamic board',
        '${dynBoardId}'
      );`
    )
    expect(teacherSend).toContain('Teacher greeting on newly created dynamic board')

    const teacherRead = runAsUser(
      teacherId,
      `SELECT count(*) FROM public.get_live_chat_messages('${liveSessionId}'::uuid, 'PRACTICE', '${dynBoardId}');`
    )
    expect(Number(teacherRead)).toBe(1)

    // 2. Student White A is already assigned to 'board-a' in live_games.
    // They are strictly blocked from posting to dynBoardId!
    const threwCrossBoard = runAsUserThrows(
      studentWhiteAId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'PRACTICE',
        'Student A trying to invade dynamic board',
        '${dynBoardId}'
      );`
    )
    expect(threwCrossBoard).toBe(true)

    // 3. Provision and enroll a new student dynStudentId (not assigned to board-a or board-b)
    const dynStudentId = '77777777-cccc-9999-cccc-777777777779'
    runSql(`
      DO $body$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '${dynStudentId}'::uuid) THEN
          INSERT INTO auth.users (id, email) VALUES ('${dynStudentId}', '${dynStudentId}@test.com');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = '${dynStudentId}'::uuid) THEN
          INSERT INTO public.users (id, email, name, role) VALUES ('${dynStudentId}', '${dynStudentId}@test.com', 'Dyn Student', 'learner');
        END IF;
        INSERT INTO public.enrollments (user_id, course_id) VALUES ('${dynStudentId}', '${courseId}') ON CONFLICT DO NOTHING;
      END $body$;
    `)

    // 4. Register game for dynBoardId with dynStudentId as white player
    runSql(`
      INSERT INTO public.live_games (
        live_session_id, board_id, game_scope, white_user_id, black_user_id, status
      ) VALUES (
        '${liveSessionId}', '${dynBoardId}', 'PRACTICE', '${dynStudentId}', NULL, 'IN_PROGRESS'
      );
    `)

    // Now dynStudentId (assigned white player on dynBoardId) can post to dynBoardId
    const dynStudentSend = runAsUser(
      dynStudentId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'PRACTICE',
        'Dyn Student confirmed on dynamic board',
        '${dynBoardId}'
      );`
    )
    expect(dynStudentSend).toContain('Dyn Student confirmed on dynamic board')

    // And Student White A (assigned to board-a) is still strictly blocked from dynBoardId
    const stillBlocked = runAsUserThrows(
      studentWhiteAId,
      `SELECT public.send_live_chat_message(
        '${liveSessionId}'::uuid,
        'PRACTICE',
        'Student A still blocked',
        '${dynBoardId}'
      );`
    )
    expect(stillBlocked).toBe(true)
  })
})
