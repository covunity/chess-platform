import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  generateSessionRoomName,
  listLiveSessions,
  getLiveSession,
  createLiveSession,
  updateLiveSession,
  deleteLiveSession,
  startLiveSession,
  endLiveSession,
  cancelLiveSession,
} from '../liveSessionApi'
import { checkLiveClassroomAccess } from '../coursesApi'
import { mapLiveSessionRow, type LiveSessionRow, type CreateLiveSessionInput } from '../../types/liveSession'

describe('Live Session Layer — liveSessionApi', () => {
  describe('Room Name Generation', () => {
    it('generates session-specific LiveKit room identity', () => {
      const courseId = 'course-uuid-123'
      const sessionId = 'session-uuid-456'
      const roomName = generateSessionRoomName(courseId, sessionId)
      expect(roomName).toBe('live-course-course-uuid-123-session-session-uuid-456')
    })
  })

  describe('mapLiveSessionRow', () => {
    it('correctly transforms PostgreSQL row to camelCase LiveSession', () => {
      const row: LiveSessionRow = {
        id: 'sess-1',
        course_id: 'course-1',
        lesson_id: 'lesson-1',
        title: 'Buổi 1: Khai cuộc',
        description: 'Mô tả bài học',
        scheduled_start_at: '2026-10-10T19:30:00Z',
        scheduled_end_at: '2026-10-10T21:00:00Z',
        timezone: 'Asia/Ho_Chi_Minh',
        status: 'SCHEDULED',
        agenda: [{ title: 'Khai cuộc', duration_minutes: 30 }],
        learning_objectives: ['Hiểu nguyên tắc phát triển quân'],
        preparation_notes: 'Xem trước bài 1',
        max_participants: 25,
        livekit_room_name: 'live-course-course-1-session-sess-1',
        started_at: null,
        ended_at: null,
        created_at: '2026-10-04T00:00:00Z',
        updated_at: '2026-10-04T00:00:00Z',
        lessons: { id: 'lesson-1', title: 'Lesson 1 Title' },
        courses: { id: 'course-1', title: 'Course 1 Title', creator_id: 'creator-1' },
      }

      const session = mapLiveSessionRow(row)
      expect(session.id).toBe('sess-1')
      expect(session.courseId).toBe('course-1')
      expect(session.lessonId).toBe('lesson-1')
      expect(session.title).toBe('Buổi 1: Khai cuộc')
      expect(session.scheduledStartAt).toBe('2026-10-10T19:30:00Z')
      expect(session.scheduledEndAt).toBe('2026-10-10T21:00:00Z')
      expect(session.status).toBe('SCHEDULED')
      expect(session.agenda).toEqual([{ title: 'Khai cuộc', duration_minutes: 30 }])
      expect(session.learningObjectives).toEqual(['Hiểu nguyên tắc phát triển quân'])
      expect(session.livekitRoomName).toBe('live-course-course-1-session-sess-1')
      expect(session.lessonTitle).toBe('Lesson 1 Title')
      expect(session.courseTitle).toBe('Course 1 Title')
    })

    it('handles nullable and empty fields gracefully', () => {
      const row: LiveSessionRow = {
        id: 'sess-2',
        course_id: 'course-2',
        lesson_id: null,
        title: 'Buổi 2: Tự do',
        description: null,
        scheduled_start_at: '2026-10-11T19:30:00Z',
        scheduled_end_at: null,
        timezone: 'Asia/Ho_Chi_Minh',
        status: 'DRAFT',
        agenda: [],
        learning_objectives: [],
        preparation_notes: null,
        max_participants: null,
        livekit_room_name: 'live-course-course-2-session-sess-2',
        started_at: null,
        ended_at: null,
        created_at: '2026-10-04T00:00:00Z',
        updated_at: '2026-10-04T00:00:00Z',
      }

      const session = mapLiveSessionRow(row)
      expect(session.lessonId).toBeNull()
      expect(session.description).toBeNull()
      expect(session.scheduledEndAt).toBeNull()
      expect(session.maxParticipants).toBeNull()
      expect(session.agenda).toEqual([])
      expect(session.learningObjectives).toEqual([])
    })
  })

  describe('createLiveSession', () => {
    it('validates required fields', async () => {
      const mockClient = {} as unknown as SupabaseClient

      const res1 = await createLiveSession(mockClient, {
        courseId: 'c-1',
        title: '',
        scheduledStartAt: '2026-10-10T19:30:00Z',
      })
      expect(res1.error?.message).toMatch(/title is required/i)

      const res2 = await createLiveSession(mockClient, {
        courseId: 'c-1',
        title: 'Valid Title',
        scheduledStartAt: '',
      })
      expect(res2.error?.message).toMatch(/start time is required/i)

      const res3 = await createLiveSession(mockClient, {
        courseId: 'c-1',
        title: 'Valid Title',
        scheduledStartAt: '2026-10-10T19:30:00Z',
        scheduledEndAt: '2026-10-10T18:00:00Z', // Before start
      })
      expect(res3.error?.message).toMatch(/must be after start/i)

      const res4 = await createLiveSession(mockClient, {
        courseId: 'c-1',
        title: 'Valid Title',
        scheduledStartAt: '2026-10-10T19:30:00Z',
        maxParticipants: -5,
      })
      expect(res4.error?.message).toMatch(/greater than 0/i)
    })

    it('rejects creating session in LIVE, ENDED, or CANCELLED status', async () => {
      const mockClient = {} as unknown as SupabaseClient

      const resLive = await createLiveSession(mockClient, {
        courseId: 'c-1',
        title: 'Invalid Live',
        scheduledStartAt: '2026-10-10T19:30:00Z',
        status: 'LIVE' as unknown as CreateLiveSessionInput['status'],
      })
      expect(resLive.error?.message).toMatch(/only be created as DRAFT or SCHEDULED/i)

      const resEnded = await createLiveSession(mockClient, {
        courseId: 'c-1',
        title: 'Invalid Ended',
        scheduledStartAt: '2026-10-10T19:30:00Z',
        status: 'ENDED' as unknown as CreateLiveSessionInput['status'],
      })
      expect(resEnded.error?.message).toMatch(/only be created as DRAFT or SCHEDULED/i)

      const resCancelled = await createLiveSession(mockClient, {
        courseId: 'c-1',
        title: 'Invalid Cancelled',
        scheduledStartAt: '2026-10-10T19:30:00Z',
        status: 'CANCELLED' as unknown as CreateLiveSessionInput['status'],
      })
      expect(resCancelled.error?.message).toMatch(/only be created as DRAFT or SCHEDULED/i)
    })

    it('allows creating session in DRAFT status', async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: {
          id: 'mock-draft-id',
          course_id: 'c-1',
          lesson_id: null,
          title: 'Bản nháp 1',
          description: null,
          scheduled_start_at: '2026-10-10T19:30:00Z',
          scheduled_end_at: null,
          timezone: 'Asia/Ho_Chi_Minh',
          status: 'DRAFT',
          agenda: [],
          learning_objectives: [],
          preparation_notes: null,
          max_participants: null,
          livekit_room_name: 'live-course-c-1-session-mock-draft-id',
          created_at: '2026-10-04T00:00:00Z',
          updated_at: '2026-10-04T00:00:00Z',
        },
        error: null,
      })
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
      const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert })
      const mockClient = { from: mockFrom } as unknown as SupabaseClient

      const { session, error } = await createLiveSession(mockClient, {
        courseId: 'c-1',
        title: 'Bản nháp 1',
        scheduledStartAt: '2026-10-10T19:30:00Z',
        status: 'DRAFT',
      })

      expect(error).toBeNull()
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'DRAFT',
        })
      )
      expect(session?.status).toBe('DRAFT')
    })

    it('inserts live session with unique LiveKit room name', async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: {
          id: 'mock-session-id',
          course_id: 'c-1',
          lesson_id: 'l-1',
          title: 'Chiến thuật chiếu hết',
          description: 'Học cách chiếu hết 2 xe',
          scheduled_start_at: '2026-10-10T19:30:00Z',
          scheduled_end_at: '2026-10-10T21:00:00Z',
          timezone: 'Asia/Ho_Chi_Minh',
          status: 'SCHEDULED',
          agenda: [{ title: 'Lý thuyết', duration_minutes: 40 }],
          learning_objectives: ['Chiếu hết 2 xe'],
          preparation_notes: 'Xem video',
          max_participants: 20,
          livekit_room_name: 'live-course-c-1-session-mock-session-id',
          created_at: '2026-10-04T00:00:00Z',
          updated_at: '2026-10-04T00:00:00Z',
        },
        error: null,
      })

      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
      const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert })
      const mockClient = { from: mockFrom } as unknown as SupabaseClient

      const { session, error } = await createLiveSession(mockClient, {
        courseId: 'c-1',
        lessonId: 'l-1',
        title: 'Chiến thuật chiếu hết',
        description: 'Học cách chiếu hết 2 xe',
        scheduledStartAt: '2026-10-10T19:30:00Z',
        scheduledEndAt: '2026-10-10T21:00:00Z',
        agenda: [{ title: 'Lý thuyết', duration_minutes: 40 }],
        learningObjectives: ['Chiếu hết 2 xe'],
        preparationNotes: 'Xem video',
        maxParticipants: 20,
      })

      expect(error).toBeNull()
      expect(mockFrom).toHaveBeenCalledWith('live_sessions')
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          course_id: 'c-1',
          lesson_id: 'l-1',
          title: 'Chiến thuật chiếu hết',
          scheduled_start_at: '2026-10-10T19:30:00Z',
          scheduled_end_at: '2026-10-10T21:00:00Z',
          status: 'SCHEDULED',
          livekit_room_name: expect.stringMatching(/^live-course-c-1-session-/),
        })
      )
      expect(session?.title).toBe('Chiến thuật chiếu hết')
      expect(session?.lessonId).toBe('l-1')
    })
  })

  describe('updateLiveSession', () => {
    it('updates editable fields and NEVER includes server-owned fields in payload', async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: {
          id: 'sess-123',
          course_id: 'c-1',
          title: 'Tiêu đề mới',
          scheduled_start_at: '2026-10-12T19:30:00Z',
          scheduled_end_at: '2026-10-12T21:00:00Z',
          status: 'SCHEDULED',
          timezone: 'Asia/Ho_Chi_Minh',
          agenda: [{ title: 'Mục 1', duration_minutes: 30 }],
          learning_objectives: ['Mục tiêu 1'],
          preparation_notes: 'Chuẩn bị',
          max_participants: 30,
          livekit_room_name: 'live-course-c-1-session-sess-123',
          started_at: null,
          ended_at: null,
          created_at: '2026-10-04T00:00:00Z',
          updated_at: '2026-10-04T01:00:00Z',
        },
        error: null,
      })

      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
      const mockEq = vi.fn().mockReturnValue({ select: mockSelect })
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
      const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate })
      const mockClient = { from: mockFrom } as unknown as SupabaseClient

      const { session, error } = await updateLiveSession(mockClient, 'sess-123', {
        title: 'Tiêu đề mới',
        scheduledStartAt: '2026-10-12T19:30:00Z',
        scheduledEndAt: '2026-10-12T21:00:00Z',
        timezone: 'Asia/Ho_Chi_Minh',
        agenda: [{ title: 'Mục 1', duration_minutes: 30 }],
        learningObjectives: ['Mục tiêu 1'],
        preparationNotes: 'Chuẩn bị',
        maxParticipants: 30,
      })

      expect(error).toBeNull()
      expect(mockUpdate).toHaveBeenCalledWith({
        title: 'Tiêu đề mới',
        scheduled_start_at: '2026-10-12T19:30:00Z',
        scheduled_end_at: '2026-10-12T21:00:00Z',
        timezone: 'Asia/Ho_Chi_Minh',
        agenda: [{ title: 'Mục 1', duration_minutes: 30 }],
        learning_objectives: ['Mục tiêu 1'],
        preparation_notes: 'Chuẩn bị',
        max_participants: 30,
      })

      // Explicitly assert server-owned fields are NEVER in updatePayload
      const updateArg = mockUpdate.mock.calls[0][0]
      expect(updateArg).not.toHaveProperty('status')
      expect(updateArg).not.toHaveProperty('livekit_room_name')
      expect(updateArg).not.toHaveProperty('started_at')
      expect(updateArg).not.toHaveProperty('ended_at')

      expect(mockEq).toHaveBeenCalledWith('id', 'sess-123')
      expect(session?.title).toBe('Tiêu đề mới')
    })

    it('rejects updating an ENDED or CANCELLED session when currentStatus is provided', async () => {
      const mockClient = { from: vi.fn() } as unknown as SupabaseClient

      const resEnded = await updateLiveSession(mockClient, 'sess-ended', { title: 'New Title' }, 'ENDED')
      expect(resEnded.error?.message).toMatch(/Cannot modify session in ENDED status\. Session is read-only\./)

      const resCancelled = await updateLiveSession(mockClient, 'sess-cancelled', { title: 'New Title' }, 'CANCELLED')
      expect(resCancelled.error?.message).toMatch(/Cannot modify session in CANCELLED status\. Session is read-only\./)
      expect(mockClient.from).not.toHaveBeenCalled()
    })

    it('rejects updating lesson or schedule of a LIVE session when currentStatus is provided', async () => {
      const mockClient = { from: vi.fn() } as unknown as SupabaseClient

      const resLesson = await updateLiveSession(mockClient, 'sess-live', { lessonId: 'l-new' }, 'LIVE')
      expect(resLesson.error?.message).toMatch(/Cannot change lesson while session is in LIVE status/)

      const resStart = await updateLiveSession(mockClient, 'sess-live', { scheduledStartAt: '2026-10-15T19:30:00Z' }, 'LIVE')
      expect(resStart.error?.message).toMatch(/Cannot change scheduled start time while session is in LIVE status/)

      const resEnd = await updateLiveSession(mockClient, 'sess-live', { scheduledEndAt: '2026-10-15T21:00:00Z' }, 'LIVE')
      expect(resEnd.error?.message).toMatch(/Cannot change scheduled end time while session is in LIVE status/)
      expect(mockClient.from).not.toHaveBeenCalled()
    })
  })

  describe('deleteLiveSession', () => {
    it('allows deleting a DRAFT session', async () => {
      const mockEq = vi.fn().mockResolvedValue({ error: null })
      const mockDelete = vi.fn().mockReturnValue({ eq: mockEq })
      const mockFrom = vi.fn().mockReturnValue({ delete: mockDelete })
      const mockClient = { from: mockFrom } as unknown as SupabaseClient

      const { success, error } = await deleteLiveSession(mockClient, 'sess-draft', 'DRAFT')
      expect(error).toBeNull()
      expect(success).toBe(true)
      expect(mockDelete).toHaveBeenCalled()
      expect(mockEq).toHaveBeenCalledWith('id', 'sess-draft')
    })

    it('rejects deleting a SCHEDULED session and does NOT call delete()', async () => {
      const mockDelete = vi.fn()
      const mockFrom = vi.fn().mockReturnValue({ delete: mockDelete })
      const mockClient = { from: mockFrom } as unknown as SupabaseClient

      const { success, error } = await deleteLiveSession(mockClient, 'sess-scheduled', 'SCHEDULED')
      expect(success).toBe(false)
      expect(error?.message).toMatch(/only DRAFT sessions can be deleted/i)
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it('rejects deleting a LIVE session and does NOT call delete()', async () => {
      const mockDelete = vi.fn()
      const mockFrom = vi.fn().mockReturnValue({ delete: mockDelete })
      const mockClient = { from: mockFrom } as unknown as SupabaseClient

      const { success, error } = await deleteLiveSession(mockClient, 'sess-live', 'LIVE')
      expect(success).toBe(false)
      expect(error?.message).toMatch(/only DRAFT sessions can be deleted/i)
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it('rejects deleting an ENDED session and does NOT call delete()', async () => {
      const mockDelete = vi.fn()
      const mockFrom = vi.fn().mockReturnValue({ delete: mockDelete })
      const mockClient = { from: mockFrom } as unknown as SupabaseClient

      const { success, error } = await deleteLiveSession(mockClient, 'sess-ended', 'ENDED')
      expect(success).toBe(false)
      expect(error?.message).toMatch(/only DRAFT sessions can be deleted/i)
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it('rejects deleting a CANCELLED session and does NOT call delete()', async () => {
      const mockDelete = vi.fn()
      const mockFrom = vi.fn().mockReturnValue({ delete: mockDelete })
      const mockClient = { from: mockFrom } as unknown as SupabaseClient

      const { success, error } = await deleteLiveSession(mockClient, 'sess-cancelled', 'CANCELLED')
      expect(success).toBe(false)
      expect(error?.message).toMatch(/only DRAFT sessions can be deleted/i)
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it('fetches status from database if currentStatus not provided and rejects if non-DRAFT', async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({
        data: { status: 'SCHEDULED' },
        error: null,
      })
      const mockEqSelect = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle })
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEqSelect })
      const mockDelete = vi.fn()
      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'live_sessions') {
          return { select: mockSelect, delete: mockDelete }
        }
        return {}
      })
      const mockClient = { from: mockFrom } as unknown as SupabaseClient

      const { success, error } = await deleteLiveSession(mockClient, 'sess-scheduled')
      expect(success).toBe(false)
      expect(error?.message).toMatch(/only DRAFT sessions can be deleted/i)
      expect(mockDelete).not.toHaveBeenCalled()
    })
  })

  describe('Server-controlled Lifecycle RPCs', () => {
    it('calls start_live_session RPC and does NOT call update()', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          session_id: 'sess-123',
          status: 'LIVE',
          livekit_room_name: 'live-course-c-1-session-sess-123',
          started_at: '2026-10-04T12:00:00Z',
        },
        error: null,
      })
      const mockFrom = vi.fn()
      const mockClient = { rpc: mockRpc, from: mockFrom } as unknown as SupabaseClient

      const { success, data, error } = await startLiveSession(mockClient, 'sess-123')
      expect(error).toBeNull()
      expect(success).toBe(true)
      expect(mockRpc).toHaveBeenCalledWith('start_live_session', {
        p_session_id: 'sess-123',
      })
      expect(data?.status).toBe('LIVE')
      expect(mockFrom).not.toHaveBeenCalled()
    })

    it('calls cancel_live_session RPC and does NOT call update()', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          session_id: 'sess-123',
          status: 'CANCELLED',
        },
        error: null,
      })
      const mockFrom = vi.fn()
      const mockClient = { rpc: mockRpc, from: mockFrom } as unknown as SupabaseClient

      const { success, data, error } = await cancelLiveSession(mockClient, 'sess-123')
      expect(error).toBeNull()
      expect(success).toBe(true)
      expect(mockRpc).toHaveBeenCalledWith('cancel_live_session', {
        p_session_id: 'sess-123',
      })
      expect(data?.status).toBe('CANCELLED')
      expect(mockFrom).not.toHaveBeenCalled()
    })

    it('calls end_live_session RPC and does NOT call update()', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          session_id: 'sess-123',
          status: 'ENDED',
          ended_at: '2026-10-04T13:30:00Z',
        },
        error: null,
      })
      const mockFrom = vi.fn()
      const mockClient = { rpc: mockRpc, from: mockFrom } as unknown as SupabaseClient

      const { success, data, error } = await endLiveSession(mockClient, 'sess-123')
      expect(error).toBeNull()
      expect(success).toBe(true)
      expect(mockRpc).toHaveBeenCalledWith('end_live_session', {
        p_session_id: 'sess-123',
      })
      expect(data?.status).toBe('ENDED')
      expect(mockFrom).not.toHaveBeenCalled()
    })
  })

  describe('Session-aware Classroom Access Check (Backward Compatibility)', () => {
    it('resolves session room and returns session title & livekit room name', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          is_course_room: true,
          is_session: true,
          allowed: true,
          role: 'teacher',
          session_id: 'sess-abc',
          session_title: 'Buổi 1: Khai cuộc',
          livekit_room_name: 'live-course-c1-session-sess-abc',
          course_id: 'c1',
          course_title: 'Khóa học cờ vua Pro',
        },
        error: null,
      })
      const client = { rpc: mockRpc } as unknown as SupabaseClient

      const { access, error } = await checkLiveClassroomAccess(client, 'sess-abc', 'teacher-1')
      expect(error).toBeNull()
      expect(access?.is_session).toBe(true)
      expect(access?.session_title).toBe('Buổi 1: Khai cuộc')
      expect(access?.livekit_room_name).toBe('live-course-c1-session-sess-abc')
      expect(access?.role).toBe('teacher')
    })

    it('continues supporting legacy course rooms', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          is_course_room: true,
          is_session: false,
          allowed: true,
          role: 'student',
          course_id: 'c-legacy',
          course_title: 'Khóa học cũ',
          livekit_room_name: 'room-legacy-123',
        },
        error: null,
      })
      const client = { rpc: mockRpc } as unknown as SupabaseClient

      const { access, error } = await checkLiveClassroomAccess(client, 'room-legacy-123', 'student-1')
      expect(error).toBeNull()
      expect(access?.is_session).toBe(false)
      expect(access?.course_title).toBe('Khóa học cũ')
      expect(access?.allowed).toBe(true)
    })
  })
})
