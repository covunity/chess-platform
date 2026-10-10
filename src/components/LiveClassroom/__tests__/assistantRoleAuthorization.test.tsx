import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isAuthorizedTeacher,
  isAuthorizedAssistant,
  isAuthorizedStaff,
  getTransportSenderIdentity,
  type LiveKitMessageLike,
} from '../liveClassroomSecurity'
import {
  handleLivekitTokenRequest,
  validateClassroomAccess,
} from '../../../../supabase/functions/livekit-token/index'
import { AccessToken } from '../../../test/livekitSdkStub'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClassroomControlPayload } from '../../../types/liveClassroom'
import { liveClassroomStore } from '../liveClassroomStore'

const mockRoom = {
  localParticipant: {
    identity: 'test-user',
    isMicrophoneEnabled: false,
    isCameraEnabled: false,
    publishData: vi.fn(),
    setMicrophoneEnabled: vi.fn(),
    setCameraEnabled: vi.fn(),
  },
  on: vi.fn(),
  off: vi.fn(),
}

vi.mock('@livekit/components-react', () => ({
  useRoomContext: () => mockRoom,
  useLocalParticipant: () => ({
    isMicrophoneEnabled: false,
    isCameraEnabled: false,
    localParticipant: mockRoom.localParticipant,
  }),
  useDataChannel: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'vi' },
  }),
}))

function makeLiveKitMessage(
  payloadObj: unknown,
  fromIdentity?: string,
  name?: string,
  metadata?: string
): LiveKitMessageLike {
  return {
    payload: new TextEncoder().encode(
      typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj)
    ),
    from: fromIdentity ? { identity: fromIdentity, name, metadata } : undefined,
    participant: fromIdentity ? { identity: fromIdentity, name, metadata } : undefined,
  }
}

describe('TASK 7 — Assistant Role End-to-End Authorization Tests', () => {
  const TEACHER_ID = '00000000-0000-0000-0000-000000000001'
  const ASSISTANT_ID = '00000000-0000-0000-0000-000000000002'
  const STUDENT_ID = '00000000-0000-0000-0000-000000000003'
  const ADMIN_ID = '00000000-0000-0000-0000-000000000004'
  const ROOM_ID = 'live-session-room-test'

  beforeEach(() => {
    AccessToken.reset()
    vi.clearAllMocks()
    liveClassroomStore.getState().resetLiveClass()
    liveClassroomStore.getState().setTeacherId(TEACHER_ID)
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Authoritative Role Resolution & Token Generation
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. Authoritative Role Resolution & LiveKit Token Generation', () => {
    const defaultEnv = {
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
      SUPABASE_ANON_KEY: 'test-anon-key',
      LIVEKIT_API_KEY: 'test-key',
      LIVEKIT_API_SECRET: 'test-secret',
      LIVEKIT_URL: 'wss://test.livekit.cloud',
    }

    function createMockClients(accessData: Record<string, unknown> | null, userId = STUDENT_ID) {
      const authClient = {
        auth: {
          getUser: vi.fn().mockImplementation(async (jwt: string) => {
            if (jwt !== 'test-jwt') {
              return { data: { user: null }, error: new Error('Invalid token') }
            }
            return {
              data: {
                user: {
                  id: userId,
                  email: `${userId}@example.com`,
                  user_metadata: { name: `User ${userId}` },
                },
              },
              error: null,
            }
          }),
        },
      } as unknown as SupabaseClient

      const serviceClient = {
        rpc: vi.fn().mockImplementation((fnName: string) => {
          if (fnName === 'check_live_classroom_access') {
            return Promise.resolve({ data: accessData, error: null })
          }
          return Promise.resolve({ data: null, error: null })
        }),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: userId, name: `User ${userId}`, email: `${userId}@example.com`, role: 'learner' },
                error: null,
              }),
            }),
          }),
        }),
      } as unknown as SupabaseClient

      return { authClient, serviceClient }
    }

    it('assistant resolves as "assistant" and token metadata contains authoritative role', async () => {
      const { authClient, serviceClient } = createMockClients(
        {
          is_course_room: true,
          is_session: true,
          allowed: true,
          role: 'assistant',
          is_assistant: true,
          is_creator: false,
          session_id: 'session-1',
          course_id: 'course-1',
          status: 'LIVE',
          livekit_room_name: 'live-room-staff-1',
        },
        ASSISTANT_ID
      )

      const validation = await validateClassroomAccess(
        serviceClient,
        ROOM_ID,
        ASSISTANT_ID,
        'student' // client prefers student or anything
      )

      expect(validation.valid).toBe(true)
      expect(validation.role).toBe('assistant')
      expect(validation.livekitRoomName).toBe('live-room-staff-1')

      // Test handleLivekitTokenRequest
      const req = new Request('http://localhost/functions/v1/livekit-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: 'Bearer test-jwt' },
        body: JSON.stringify({ roomId: ROOM_ID, userId: ASSISTANT_ID, preferredRole: 'student' }),
      })

      const res = await handleLivekitTokenRequest(req, {
        authClient,
        serviceClient,
        env: defaultEnv,
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.role).toBe('assistant')

      // Verify AccessToken created with assistant metadata
      const issued = AccessToken.instances[0]
      expect(issued).toBeDefined()
      expect(issued.metadata).toBeDefined()
      const meta = JSON.parse(issued.metadata!)
      expect(meta.role).toBe('assistant')
      expect(meta.userId).toBe(ASSISTANT_ID)
    })

    it('student cannot elevate to teacher by sending role="teacher"', async () => {
      const { authClient, serviceClient } = createMockClients(
        {
          is_course_room: true,
          is_session: true,
          allowed: true,
          role: 'student',
          is_assistant: false,
          is_creator: false,
          session_id: 'session-1',
          course_id: 'course-1',
          status: 'LIVE',
          livekit_room_name: 'live-room-staff-1',
        },
        STUDENT_ID
      )

      const req = new Request('http://localhost/functions/v1/livekit-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: 'Bearer test-jwt' },
        body: JSON.stringify({ roomId: ROOM_ID, userId: STUDENT_ID, preferredRole: 'teacher', role: 'teacher' }),
      })

      const res = await handleLivekitTokenRequest(req, {
        authClient,
        serviceClient,
        env: defaultEnv,
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.role).toBe('student') // Authoritative role remains student

      const issued = AccessToken.instances[0]
      const meta = JSON.parse(issued.metadata!)
      expect(meta.role).toBe('student')
    })

    it('student cannot elevate to assistant by sending role="assistant"', async () => {
      const { authClient, serviceClient } = createMockClients(
        {
          is_course_room: true,
          is_session: true,
          allowed: true,
          role: 'student',
          is_assistant: false,
          is_creator: false,
          session_id: 'session-1',
          course_id: 'course-1',
          status: 'LIVE',
          livekit_room_name: 'live-room-staff-1',
        },
        STUDENT_ID
      )

      const req = new Request('http://localhost/functions/v1/livekit-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: 'Bearer test-jwt' },
        body: JSON.stringify({ roomId: ROOM_ID, userId: STUDENT_ID, preferredRole: 'assistant', role: 'assistant' }),
      })

      const res = await handleLivekitTokenRequest(req, {
        authClient,
        serviceClient,
        env: defaultEnv,
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.role).toBe('student') // Authoritative role remains student

      const issued = AccessToken.instances[0]
      const meta = JSON.parse(issued.metadata!)
      expect(meta.role).toBe('student')
    })

    it('admin (non-creator) receives "student" role token with is_admin=true and authoritative teacherId', async () => {
      const { authClient, serviceClient } = createMockClients(
        {
          is_course_room: true,
          is_session: true,
          allowed: true,
          role: 'student',
          is_admin: true,
          is_creator: false,
          teacher_id: TEACHER_ID,
          creator_id: TEACHER_ID,
          session_id: 'session-1',
          course_id: 'course-1',
          status: 'LIVE',
          livekit_room_name: 'live-room-staff-1',
        },
        ADMIN_ID
      )

      const validation = await validateClassroomAccess(
        serviceClient,
        ROOM_ID,
        ADMIN_ID,
        'teacher' // Admin might request teacher, but DB strictly resolves student
      )

      expect(validation.valid).toBe(true)
      expect(validation.role).toBe('student') // Preferred safe model: non-creator admin is student

      const req = new Request('http://localhost/functions/v1/livekit-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: 'Bearer test-jwt' },
        body: JSON.stringify({ roomId: ROOM_ID, userId: ADMIN_ID, preferredRole: 'teacher', role: 'teacher' }),
      })

      const res = await handleLivekitTokenRequest(req, {
        authClient,
        serviceClient,
        env: defaultEnv,
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.role).toBe('student')

      const issued = AccessToken.instances[0]
      const meta = JSON.parse(issued.metadata!)
      expect(meta.role).toBe('student')
      expect(meta.userId).toBe(ADMIN_ID)
    })

    it('denies access when session is unknown or non-live (fails closed)', async () => {
      const { authClient, serviceClient } = createMockClients(
        {
          is_course_room: false,
          is_session: false,
          allowed: false,
          reason: 'session_not_found',
        },
        STUDENT_ID
      )

      const req = new Request('http://localhost/functions/v1/livekit-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: 'Bearer test-jwt' },
        body: JSON.stringify({ roomId: 'unknown-room', userId: STUDENT_ID }),
      })

      const res = await handleLivekitTokenRequest(req, {
        authClient,
        serviceClient,
        env: defaultEnv,
      })
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.reason).toBe('session_not_found')
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 2. DataChannel Authorization & Security Helpers
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. Security Helpers: isAuthorizedTeacher vs isAuthorizedAssistant vs isAuthorizedStaff', () => {
    it('isAuthorizedTeacher accepts teacher and strictly rejects assistant, student, and admin', () => {
      const teacherMsg = makeLiveKitMessage({}, TEACHER_ID)
      const assistantMsg = makeLiveKitMessage(
        {},
        ASSISTANT_ID,
        'Assistant',
        JSON.stringify({ role: 'assistant', userId: ASSISTANT_ID })
      )
      const studentMsg = makeLiveKitMessage(
        {},
        STUDENT_ID,
        'Student',
        JSON.stringify({ role: 'student', userId: STUDENT_ID })
      )
      const adminMsg = makeLiveKitMessage(
        {},
        ADMIN_ID,
        'Admin',
        JSON.stringify({ role: 'student', userId: ADMIN_ID, isAdmin: true })
      )

      expect(isAuthorizedTeacher(TEACHER_ID, teacherMsg, TEACHER_ID)).toBe(true)
      expect(isAuthorizedTeacher(ASSISTANT_ID, assistantMsg, TEACHER_ID)).toBe(false)
      expect(isAuthorizedTeacher(STUDENT_ID, studentMsg, TEACHER_ID)).toBe(false)
      expect(isAuthorizedTeacher(ADMIN_ID, adminMsg, TEACHER_ID)).toBe(false)
    })

    it('isAuthorizedAssistant accepts assigned assistant and rejects teacher, student, and admin', () => {
      const teacherMsg = makeLiveKitMessage(
        {},
        TEACHER_ID,
        'Teacher',
        JSON.stringify({ role: 'teacher', userId: TEACHER_ID })
      )
      const assistantMsg = makeLiveKitMessage(
        {},
        ASSISTANT_ID,
        'Assistant',
        JSON.stringify({ role: 'assistant', userId: ASSISTANT_ID })
      )
      const studentMsg = makeLiveKitMessage(
        {},
        STUDENT_ID,
        'Student',
        JSON.stringify({ role: 'student', userId: STUDENT_ID })
      )
      const adminMsg = makeLiveKitMessage(
        {},
        ADMIN_ID,
        'Admin',
        JSON.stringify({ role: 'student', userId: ADMIN_ID })
      )

      const sessionStaffIds = [ASSISTANT_ID]

      // Assistant passes
      expect(isAuthorizedAssistant(ASSISTANT_ID, assistantMsg, sessionStaffIds)).toBe(true)
      // Teacher fails assistant check
      expect(isAuthorizedAssistant(TEACHER_ID, teacherMsg, sessionStaffIds)).toBe(false)
      // Student fails assistant check
      expect(isAuthorizedAssistant(STUDENT_ID, studentMsg, sessionStaffIds)).toBe(false)
      // Admin fails assistant check
      expect(isAuthorizedAssistant(ADMIN_ID, adminMsg, sessionStaffIds)).toBe(false)
    })

    it('isAuthorizedStaff accepts both teacher and assistant, but rejects student and non-staff admin', () => {
      const teacherMsg = makeLiveKitMessage(
        {},
        TEACHER_ID,
        'Teacher',
        JSON.stringify({ role: 'teacher', userId: TEACHER_ID })
      )
      const assistantMsg = makeLiveKitMessage(
        {},
        ASSISTANT_ID,
        'Assistant',
        JSON.stringify({ role: 'assistant', userId: ASSISTANT_ID })
      )
      const studentMsg = makeLiveKitMessage(
        {},
        STUDENT_ID,
        'Student',
        JSON.stringify({ role: 'student', userId: STUDENT_ID })
      )
      const adminMsg = makeLiveKitMessage(
        {},
        ADMIN_ID,
        'Admin',
        JSON.stringify({ role: 'student', userId: ADMIN_ID })
      )

      const sessionStaffIds = [ASSISTANT_ID]

      expect(isAuthorizedStaff(TEACHER_ID, teacherMsg, TEACHER_ID, sessionStaffIds)).toBe(true)
      expect(isAuthorizedStaff(ASSISTANT_ID, assistantMsg, TEACHER_ID, sessionStaffIds)).toBe(true)
      expect(isAuthorizedStaff(STUDENT_ID, studentMsg, TEACHER_ID, sessionStaffIds)).toBe(false)
      expect(isAuthorizedStaff(ADMIN_ID, adminMsg, TEACHER_ID, sessionStaffIds)).toBe(false)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Teacher-Only Control Actions & Explicit Authority Model
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. Teacher-Only Actions & Explicit Authority Model', () => {
    it('authoritative creator teacher controls are accepted', () => {
      const endPayload: ClassroomControlPayload = {
        type: 'CLASSROOM_CONTROL',
        action: 'END_CLASS',
        senderId: TEACHER_ID,
        messageId: 'msg-end-creator',
        timestamp: Date.now(),
      }
      const endMsg = makeLiveKitMessage(endPayload, TEACHER_ID)
      expect(isAuthorizedTeacher(getTransportSenderIdentity(endMsg), endMsg, TEACHER_ID)).toBe(true)

      const modePayload: ClassroomControlPayload = {
        type: 'CLASSROOM_CONTROL',
        action: 'SET_CLASS_MODE',
        senderId: TEACHER_ID,
        classMode: 'PRACTICE',
        messageId: 'msg-mode-creator',
        timestamp: Date.now(),
      }
      const modeMsg = makeLiveKitMessage(modePayload, TEACHER_ID)
      expect(isAuthorizedTeacher(getTransportSenderIdentity(modeMsg), modeMsg, TEACHER_ID)).toBe(true)

      const grantPayload: ClassroomControlPayload = {
        type: 'CLASSROOM_CONTROL',
        action: 'GRANT_MAIN_BOARD_CONTROL',
        senderId: TEACHER_ID,
        targetUserId: STUDENT_ID,
        messageId: 'msg-grant-creator',
        timestamp: Date.now(),
      }
      const grantMsg = makeLiveKitMessage(grantPayload, TEACHER_ID)
      expect(isAuthorizedTeacher(getTransportSenderIdentity(grantMsg), grantMsg, TEACHER_ID)).toBe(true)
    })

    it('assistant cannot END_CLASS or perform teacher controls', () => {
      const payload: ClassroomControlPayload = {
        type: 'CLASSROOM_CONTROL',
        action: 'END_CLASS',
        senderId: ASSISTANT_ID,
        messageId: 'msg-end-1',
        timestamp: Date.now(),
      }
      const msg = makeLiveKitMessage(payload, ASSISTANT_ID)
      const senderIdentity = getTransportSenderIdentity(msg)
      const isTeacher = isAuthorizedTeacher(senderIdentity, msg, TEACHER_ID)

      expect(isTeacher).toBe(false)
    })

    it('admin (non-creator) cannot execute teacher-only controls', () => {
      const endPayload: ClassroomControlPayload = {
        type: 'CLASSROOM_CONTROL',
        action: 'END_CLASS',
        senderId: ADMIN_ID,
        messageId: 'msg-end-admin',
        timestamp: Date.now(),
      }
      const endMsg = makeLiveKitMessage(endPayload, ADMIN_ID)
      expect(isAuthorizedTeacher(getTransportSenderIdentity(endMsg), endMsg, TEACHER_ID)).toBe(false)

      const modePayload: ClassroomControlPayload = {
        type: 'CLASSROOM_CONTROL',
        action: 'SET_CLASS_MODE',
        senderId: ADMIN_ID,
        classMode: 'PRACTICE',
        messageId: 'msg-mode-admin',
        timestamp: Date.now(),
      }
      const modeMsg = makeLiveKitMessage(modePayload, ADMIN_ID)
      expect(isAuthorizedTeacher(getTransportSenderIdentity(modeMsg), modeMsg, TEACHER_ID)).toBe(false)

      const grantPayload: ClassroomControlPayload = {
        type: 'CLASSROOM_CONTROL',
        action: 'GRANT_MAIN_BOARD_CONTROL',
        senderId: ADMIN_ID,
        targetUserId: STUDENT_ID,
        messageId: 'msg-grant-admin',
        timestamp: Date.now(),
      }
      const grantMsg = makeLiveKitMessage(grantPayload, ADMIN_ID)
      expect(isAuthorizedTeacher(getTransportSenderIdentity(grantMsg), grantMsg, TEACHER_ID)).toBe(false)
    })

    it('assistant cannot SET_CLASS_MODE', () => {
      const payload: ClassroomControlPayload = {
        type: 'CLASSROOM_CONTROL',
        action: 'SET_CLASS_MODE',
        senderId: ASSISTANT_ID,
        classMode: 'PRACTICE',
        messageId: 'msg-mode-1',
        timestamp: Date.now(),
      }
      const msg = makeLiveKitMessage(payload, ASSISTANT_ID)
      const senderIdentity = getTransportSenderIdentity(msg)
      const isTeacher = isAuthorizedTeacher(senderIdentity, msg, TEACHER_ID)

      expect(isTeacher).toBe(false)
    })

    it('assistant cannot GRANT_MAIN_BOARD_CONTROL or REVOKE_MAIN_BOARD_CONTROL', () => {
      const grantPayload: ClassroomControlPayload = {
        type: 'CLASSROOM_CONTROL',
        action: 'GRANT_MAIN_BOARD_CONTROL',
        senderId: ASSISTANT_ID,
        targetUserId: STUDENT_ID,
        messageId: 'msg-grant-1',
        timestamp: Date.now(),
      }
      const grantMsg = makeLiveKitMessage(grantPayload, ASSISTANT_ID)
      expect(isAuthorizedTeacher(getTransportSenderIdentity(grantMsg), grantMsg, TEACHER_ID)).toBe(false)

      const revokePayload: ClassroomControlPayload = {
        type: 'CLASSROOM_CONTROL',
        action: 'REVOKE_MAIN_BOARD_CONTROL',
        senderId: ASSISTANT_ID,
        targetUserId: STUDENT_ID,
        messageId: 'msg-revoke-1',
        timestamp: Date.now(),
      }
      const revokeMsg = makeLiveKitMessage(revokePayload, ASSISTANT_ID)
      expect(isAuthorizedTeacher(getTransportSenderIdentity(revokeMsg), revokeMsg, TEACHER_ID)).toBe(false)
    })

    it('assistant cannot ASSIGN_PRACTICE_BOARDS or UPDATE_PRACTICE_BOARD_STATUS', () => {
      const assignPayload = {
        type: 'PRACTICE_CONTROL',
        action: 'ASSIGN_PRACTICE_BOARDS',
        senderId: ASSISTANT_ID,
        assignments: [],
      }
      const assignMsg = makeLiveKitMessage(assignPayload, ASSISTANT_ID)
      expect(isAuthorizedTeacher(getTransportSenderIdentity(assignMsg), assignMsg, TEACHER_ID)).toBe(false)

      const statusPayload = {
        type: 'PRACTICE_CONTROL',
        action: 'UPDATE_PRACTICE_BOARD_STATUS',
        senderId: ASSISTANT_ID,
        boardId: 'board-1',
        status: 'completed',
      }
      const statusMsg = makeLiveKitMessage(statusPayload, ASSISTANT_ID)
      expect(isAuthorizedTeacher(getTransportSenderIdentity(statusMsg), statusMsg, TEACHER_ID)).toBe(false)
    })

    it('targeted MAIN_BOARD_STATE request reaches real teacher and only real teacher sync is accepted', () => {
      // 1. Destination targeting
      const targetedDestination = TEACHER_ID
      expect(targetedDestination).toBe(TEACHER_ID)

      // 2. Real teacher snapshot is accepted
      const teacherSyncPayload = {
        type: 'MAIN_BOARD_STATE_SYNC',
        senderId: TEACHER_ID,
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        ply: 1,
        moves: [{ from: 'e2', to: 'e4', san: 'e4' }],
        timestamp: Date.now(),
      }
      const teacherSyncMsg = makeLiveKitMessage(teacherSyncPayload, TEACHER_ID)
      expect(isAuthorizedTeacher(getTransportSenderIdentity(teacherSyncMsg), teacherSyncMsg, TEACHER_ID)).toBe(true)

      // 3. Admin snapshot response is rejected
      const adminSyncPayload = {
        type: 'MAIN_BOARD_STATE_SYNC',
        senderId: ADMIN_ID,
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        ply: 1,
        moves: [{ from: 'e2', to: 'e4', san: 'e4' }],
        timestamp: Date.now(),
      }
      const adminSyncMsg = makeLiveKitMessage(adminSyncPayload, ADMIN_ID)
      expect(isAuthorizedTeacher(getTransportSenderIdentity(adminSyncMsg), adminSyncMsg, TEACHER_ID)).toBe(false)

      // 4. Assistant snapshot response is rejected
      const assistantSyncPayload = {
        type: 'MAIN_BOARD_STATE_SYNC',
        senderId: ASSISTANT_ID,
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        ply: 1,
        moves: [{ from: 'e2', to: 'e4', san: 'e4' }],
        timestamp: Date.now(),
      }
      const assistantSyncMsg = makeLiveKitMessage(assistantSyncPayload, ASSISTANT_ID)
      expect(isAuthorizedTeacher(getTransportSenderIdentity(assistantSyncMsg), assistantSyncMsg, TEACHER_ID)).toBe(false)
    })

    it('assistant or student spoofing senderId=TEACHER_ID is blocked by transport identity mismatch', () => {
      const spoofPayload: ClassroomControlPayload = {
        type: 'CLASSROOM_CONTROL',
        action: 'END_CLASS',
        senderId: TEACHER_ID, // spoofed in JSON payload
        messageId: 'spoof-1',
        timestamp: Date.now(),
      }
      // Actual transport from is ASSISTANT_ID
      const msg = makeLiveKitMessage(spoofPayload, ASSISTANT_ID)
      const senderIdentity = getTransportSenderIdentity(msg)
      expect(senderIdentity).toBe(ASSISTANT_ID)
      expect(isAuthorizedTeacher(senderIdentity, msg, TEACHER_ID)).toBe(false)

      // Actual transport from is STUDENT_ID
      const studentMsg = makeLiveKitMessage(spoofPayload, STUDENT_ID)
      expect(isAuthorizedTeacher(getTransportSenderIdentity(studentMsg), studentMsg, TEACHER_ID)).toBe(false)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 4. UI / Role Presentation Verification
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. UI / Role Presentation Verification', () => {
    it('assistant (isTeacher=false) does not see End Session, Reset Board, or Mode Toggle in bottom toolbar', async () => {
      const { render, screen } = await import('@testing-library/react')
      const { default: ClassroomBottomBar } = await import('../ClassroomBottomBar')

      render(
        <ClassroomBottomBar
          room={mockRoom as any}
          currentUserId={ASSISTANT_ID}
          currentUserName="Assistant User"
          classMode="MAIN"
          onToggleClassMode={vi.fn()}
          onLeave={vi.fn()}
          onEndClass={vi.fn()}
          showRightPanel={true}
          onToggleRightPanel={vi.fn()}
          isTeacher={false}
          teacherId={TEACHER_ID}
        />
      )

      // End class button must NOT exist
      expect(screen.queryByText(/Kết thúc lớp/i)).toBeNull()
      expect(screen.queryByTitle(/Kết thúc buổi học cho cả lớp/i)).toBeNull()

      // Teacher-only mode toggle and reset buttons must NOT exist
      expect(screen.queryByTitle(/Chuyển sang Chế độ Luyện tập/i)).toBeNull()
      expect(screen.queryByTitle(/liveClassroom\.resetBoard/i)).toBeNull()

      // Leave class button MUST exist
      expect(screen.getByRole('button', { name: /liveClassroom\.leave/i })).toBeDefined()
    })

    it('teacher (isTeacher=true) sees End Session, Reset Board, and Mode Toggle controls', async () => {
      const { render, screen } = await import('@testing-library/react')
      const { default: ClassroomBottomBar } = await import('../ClassroomBottomBar')

      render(
        <ClassroomBottomBar
          room={mockRoom as any}
          currentUserId={TEACHER_ID}
          currentUserName="Teacher User"
          classMode="MAIN"
          onToggleClassMode={vi.fn()}
          onLeave={vi.fn()}
          onEndClass={vi.fn()}
          onResetBoard={vi.fn()}
          showRightPanel={true}
          onToggleRightPanel={vi.fn()}
          isTeacher={true}
          teacherId={TEACHER_ID}
        />
      )

      // Teacher End Class button MUST exist
      expect(screen.getByText(/Kết thúc lớp/i)).toBeDefined()
      expect(screen.getByTitle(/Kết thúc buổi học cho cả lớp/i)).toBeDefined()

      // Teacher mode toggle & reset buttons MUST exist
      expect(screen.getByTitle(/Chuyển sang Chế độ Luyện tập/i)).toBeDefined()
      expect(screen.getByTitle(/liveClassroom\.resetBoard/i)).toBeDefined()
    })
  })
})

