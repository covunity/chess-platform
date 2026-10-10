import { describe, it, expect, vi } from 'vitest'
import { checkLiveClassroomAccess } from '../../../lib/coursesApi'
import type { SupabaseClient } from '@supabase/supabase-js'

describe('TASK 2 — Enforce live_sessions.status Security Policy', () => {
  describe('A. LIVE Session Status', () => {
    it('allows access and token issuance when session status is LIVE for authorized teacher', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          is_course_room: true,
          is_session: true,
          allowed: true,
          role: 'teacher',
          is_creator: true,
          session_id: 'session-live-1',
          session_title: 'Buổi 1: Khai cuộc',
          session_status: 'LIVE',
          livekit_room_name: 'live-course-c1-session-s1',
          course_id: 'c1',
          course_title: 'Khóa học Cờ Vua Live',
        },
        error: null,
      })
      const client = { rpc: mockRpc } as unknown as SupabaseClient

      const { access, error } = await checkLiveClassroomAccess(client, 'session-live-1', 'creator-id')
      expect(error).toBeNull()
      expect(access?.allowed).toBe(true)
      expect(access?.role).toBe('teacher')
      expect(access?.session_status).toBe('LIVE')
      expect(access?.livekit_room_name).toBe('live-course-c1-session-s1')
    })

    it('allows access and token issuance when session status is LIVE for enrolled student', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          is_course_room: true,
          is_session: true,
          allowed: true,
          role: 'student',
          is_enrolled: true,
          session_id: 'session-live-1',
          session_title: 'Buổi 1: Khai cuộc',
          session_status: 'LIVE',
          livekit_room_name: 'live-course-c1-session-s1',
          course_id: 'c1',
          course_title: 'Khóa học Cờ Vua Live',
        },
        error: null,
      })
      const client = { rpc: mockRpc } as unknown as SupabaseClient

      const { access, error } = await checkLiveClassroomAccess(client, 'session-live-1', 'student-id')
      expect(error).toBeNull()
      expect(access?.allowed).toBe(true)
      expect(access?.role).toBe('student')
      expect(access?.session_status).toBe('LIVE')
    })
  })

  describe('B. SCHEDULED Session Status', () => {
    it('denies access with session_not_live even for authorized teacher before class is started', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          is_course_room: true,
          is_session: true,
          allowed: false,
          reason: 'session_not_live',
          session_id: 'session-scheduled-1',
          session_title: 'Buổi 2: Trung cuộc',
          session_status: 'SCHEDULED',
          course_id: 'c1',
          course_title: 'Khóa học Cờ Vua Live',
          role: 'teacher',
        },
        error: null,
      })
      const client = { rpc: mockRpc } as unknown as SupabaseClient

      const { access, error } = await checkLiveClassroomAccess(client, 'session-scheduled-1', 'creator-id')
      expect(error).toBeNull()
      expect(access?.allowed).toBe(false)
      expect(access?.reason).toBe('session_not_live')
      expect(access?.session_status).toBe('SCHEDULED')
    })

    it('denies access with session_not_live for enrolled student when session is SCHEDULED', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          is_course_room: true,
          is_session: true,
          allowed: false,
          reason: 'session_not_live',
          session_id: 'session-scheduled-1',
          session_title: 'Buổi 2: Trung cuộc',
          session_status: 'SCHEDULED',
          course_id: 'c1',
          course_title: 'Khóa học Cờ Vua Live',
          role: 'student',
        },
        error: null,
      })
      const client = { rpc: mockRpc } as unknown as SupabaseClient

      const { access, error } = await checkLiveClassroomAccess(client, 'session-scheduled-1', 'student-id')
      expect(error).toBeNull()
      expect(access?.allowed).toBe(false)
      expect(access?.reason).toBe('session_not_live')
    })
  })

  describe('C. DRAFT Session Status', () => {
    it('denies access with session_not_live when session is in DRAFT', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          is_course_room: true,
          is_session: true,
          allowed: false,
          reason: 'session_not_live',
          session_id: 'session-draft-1',
          session_title: 'Buổi 3: Tàn cuộc',
          session_status: 'DRAFT',
          course_id: 'c1',
          course_title: 'Khóa học Cờ Vua Live',
        },
        error: null,
      })
      const client = { rpc: mockRpc } as unknown as SupabaseClient

      const { access, error } = await checkLiveClassroomAccess(client, 'session-draft-1', 'creator-id')
      expect(error).toBeNull()
      expect(access?.allowed).toBe(false)
      expect(access?.reason).toBe('session_not_live')
      expect(access?.session_status).toBe('DRAFT')
    })
  })

  describe('D. CANCELLED Session Status', () => {
    it('denies access with session_not_live when session is CANCELLED', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          is_course_room: true,
          is_session: true,
          allowed: false,
          reason: 'session_not_live',
          session_id: 'session-cancelled-1',
          session_title: 'Buổi 4: Đấu bù',
          session_status: 'CANCELLED',
          course_id: 'c1',
          course_title: 'Khóa học Cờ Vua Live',
        },
        error: null,
      })
      const client = { rpc: mockRpc } as unknown as SupabaseClient

      const { access, error } = await checkLiveClassroomAccess(client, 'session-cancelled-1', 'creator-id')
      expect(error).toBeNull()
      expect(access?.allowed).toBe(false)
      expect(access?.reason).toBe('session_not_live')
      expect(access?.session_status).toBe('CANCELLED')
    })
  })

  describe('E. ENDED Session Status', () => {
    it('denies access with session_not_live after session has ENDED', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          is_course_room: true,
          is_session: true,
          allowed: false,
          reason: 'session_not_live',
          session_id: 'session-ended-1',
          session_title: 'Buổi 1: Khai cuộc (Đã xong)',
          session_status: 'ENDED',
          course_id: 'c1',
          course_title: 'Khóa học Cờ Vua Live',
        },
        error: null,
      })
      const client = { rpc: mockRpc } as unknown as SupabaseClient

      const { access, error } = await checkLiveClassroomAccess(client, 'session-ended-1', 'student-id')
      expect(error).toBeNull()
      expect(access?.allowed).toBe(false)
      expect(access?.reason).toBe('session_not_live')
      expect(access?.session_status).toBe('ENDED')
    })
  })

  describe('F. Unauthorized Users', () => {
    it('denies unauthenticated user before checking status', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          is_course_room: true,
          is_session: true,
          allowed: false,
          reason: 'unauthenticated',
          session_id: 'session-live-1',
          session_title: 'Buổi 1: Khai cuộc',
          session_status: 'LIVE',
          course_id: 'c1',
          course_title: 'Khóa học Cờ Vua Live',
        },
        error: null,
      })
      const client = { rpc: mockRpc } as unknown as SupabaseClient

      const { access, error } = await checkLiveClassroomAccess(client, 'session-live-1', null)
      expect(error).toBeNull()
      expect(access?.allowed).toBe(false)
      expect(access?.reason).toBe('unauthenticated')
    })

    it('denies unenrolled learner with not_enrolled before checking status', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          is_course_room: true,
          is_session: true,
          allowed: false,
          reason: 'not_enrolled',
          session_id: 'session-live-1',
          session_title: 'Buổi 1: Khai cuộc',
          session_status: 'LIVE',
          course_id: 'c1',
          course_title: 'Khóa học Cờ Vua Live',
          price: 500000,
        },
        error: null,
      })
      const client = { rpc: mockRpc } as unknown as SupabaseClient

      const { access, error } = await checkLiveClassroomAccess(client, 'session-live-1', 'stranger-id')
      expect(error).toBeNull()
      expect(access?.allowed).toBe(false)
      expect(access?.reason).toBe('not_enrolled')
    })
  })

  describe('G. Legacy Course Rooms', () => {
    it('preserves existing legacy room access behavior when request is not a live_sessions record', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          is_course_room: true,
          is_session: false,
          allowed: true,
          role: 'student',
          is_enrolled: true,
          course_id: 'c-legacy-1',
          course_title: 'Legacy Course Title',
          livekit_room_name: 'legacy-room-uuid',
        },
        error: null,
      })
      const client = { rpc: mockRpc } as unknown as SupabaseClient

      const { access, error } = await checkLiveClassroomAccess(client, 'legacy-room-uuid', 'enrolled-student')
      expect(error).toBeNull()
      expect(access?.is_session).toBe(false)
      expect(access?.allowed).toBe(true)
      expect(access?.role).toBe('student')
      expect(access?.livekit_room_name).toBe('legacy-room-uuid')
    })
  })
})
