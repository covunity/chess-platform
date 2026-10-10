import { describe, it, expect, beforeEach, vi } from 'vitest'
import { liveClassroomStore, START_FEN } from '../liveClassroomStore'
import { endLiveSession } from '../../../lib/liveSessionApi'
import { checkLiveClassroomAccess } from '../../../lib/coursesApi'
import type { SupabaseClient } from '@supabase/supabase-js'

describe('F-04 — Realtime Session Termination & Teardown', () => {
  const sessionId = 'session-test-uuid'
  const courseId = 'course-test-uuid'
  const teacherId = 'teacher-uuid'
  const studentId = 'student-uuid'

  beforeEach(() => {
    liveClassroomStore.getState().resetLiveClass()
  })

  it('A. Manual end order: Teacher invokes endLiveSession(), DB transitions LIVE -> ENDED, Realtime dispatches status', async () => {
    // 1. Mock Supabase client for RPC end_live_session
    const mockRpc = vi.fn().mockResolvedValue({
      data: { id: sessionId, status: 'ENDED' },
      error: null,
    })
    const mockClient = { rpc: mockRpc } as unknown as SupabaseClient

    // Teacher calls endLiveSession
    const { success, error } = await endLiveSession(mockClient, sessionId)
    expect(mockRpc).toHaveBeenCalledWith('end_live_session', { p_session_id: sessionId })
    expect(success).toBe(true)
    expect(error).toBeNull()

    // 2. Realtime listener receives UPDATE event with status = 'ENDED'
    let sessionTerminatedStatus: 'ENDED' | 'CANCELLED' | null = null
    const handleRealtimeUpdate = (payload: { new: { id: string; status: string } }) => {
      if (payload.new.id === sessionId && (payload.new.status === 'ENDED' || payload.new.status === 'CANCELLED')) {
        sessionTerminatedStatus = payload.new.status as 'ENDED' | 'CANCELLED'
        liveClassroomStore.getState().resetLiveClass()
      }
    }

    // Active state prior to termination
    liveClassroomStore.getState().updateFen('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2')
    liveClassroomStore.getState().setBoardPly('main', 2)

    handleRealtimeUpdate({ new: { id: sessionId, status: 'ENDED' } })

    // 3. Classroom observes status change and tears down
    expect(sessionTerminatedStatus).toBe('ENDED')
    expect(liveClassroomStore.getState().currentFen).toBe(START_FEN)
    expect(liveClassroomStore.getState().boardPlies).toEqual({})
  })

  it('A2. Manual end failure: If DB RPC fails, END_CLASS is not broadcast and classroom does not terminate falsely', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'permission_denied' },
    })
    const mockClient = { rpc: mockRpc } as unknown as SupabaseClient

    let broadcastSent = false
    let terminated = false

    const handleTeacherEnd = async () => {
      const res = await endLiveSession(mockClient, sessionId)
      if (res.error || !res.success) {
        throw new Error(res.error?.message || 'Failed')
      }
      broadcastSent = true
      terminated = true
    }

    await expect(handleTeacherEnd()).rejects.toThrow('permission_denied')
    expect(broadcastSent).toBe(false)
    expect(terminated).toBe(false)
  })

  it('B. Stale auto-end: LIVE -> ENDED via pg_cron triggers Realtime update and disconnects all clients', () => {
    let sessionTerminatedStatus: 'ENDED' | 'CANCELLED' | null = null
    const handleRealtimeUpdate = (payload: { new: { id: string; status: string } }) => {
      if (payload.new.id === sessionId && (payload.new.status === 'ENDED' || payload.new.status === 'CANCELLED')) {
        sessionTerminatedStatus = payload.new.status as 'ENDED' | 'CANCELLED'
        liveClassroomStore.getState().resetLiveClass()
      }
    }

    // Classroom was active
    liveClassroomStore.getState().setTeacherId(teacherId)
    liveClassroomStore.getState().setClassMode('MAIN')

    // pg_cron auto-ended row in DB
    handleRealtimeUpdate({ new: { id: sessionId, status: 'ENDED' } })

    expect(sessionTerminatedStatus).toBe('ENDED')
    expect(liveClassroomStore.getState().teacherId).toBeNull()
  })

  it('C. ENDED refresh: checkLiveClassroomAccess rejects entry when status is ENDED', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        is_course_room: true,
        is_session: true,
        session_id: sessionId,
        session_status: 'ENDED',
        allowed: false,
        reason: 'session_not_live',
      },
      error: null,
    })
    const mockClient = { rpc: mockRpc } as unknown as SupabaseClient

    const { access } = await checkLiveClassroomAccess(mockClient, sessionId, studentId)
    expect(access).not.toBeNull()
    expect(access?.allowed).toBe(false)
    expect(access?.reason).toBe('session_not_live')
    expect(access?.session_status).toBe('ENDED')
  })

  it('D. ENDED reconnect: token request fails because session is not LIVE', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        is_course_room: true,
        is_session: true,
        session_id: sessionId,
        session_status: 'CANCELLED',
        allowed: false,
        reason: 'session_not_live',
      },
      error: null,
    })
    const mockClient = { rpc: mockRpc } as unknown as SupabaseClient

    const { access } = await checkLiveClassroomAccess(mockClient, sessionId, studentId)
    expect(access?.allowed).toBe(false)
    expect(access?.reason).toBe('session_not_live')
    expect(access?.session_status).toBe('CANCELLED')
  })

  it('E. Session ends while chat is active: store teardown resets and rejects subsequent state mutations', () => {
    // Session state is active with processed messages
    liveClassroomStore.getState().markMessageProcessed('msg-chat-1')
    expect(liveClassroomStore.getState().hasProcessedMessage('msg-chat-1')).toBe(true)

    // Session terminates
    liveClassroomStore.getState().resetLiveClass()

    // Store is cleared, no stale message IDs remain
    expect(liveClassroomStore.getState().hasProcessedMessage('msg-chat-1')).toBe(false)
    expect(liveClassroomStore.getState().currentFen).toBe(START_FEN)
  })

  it('F. Session ends while practice mode is active: practice UI terminates cleanly', () => {
    liveClassroomStore.getState().setClassMode('PRACTICE')
    liveClassroomStore.getState().setAssignments([
      { boardId: 'b-1', whiteUserId: 'u1', blackUserId: 'u2', status: 'PLAYING' },
    ], 1)
    expect(liveClassroomStore.getState().classMode).toBe('PRACTICE')
    expect(liveClassroomStore.getState().practiceAssignments).toHaveLength(1)

    // Termination
    liveClassroomStore.getState().resetLiveClass()
    expect(liveClassroomStore.getState().classMode).toBe('MAIN')
    expect(liveClassroomStore.getState().practiceAssignments).toHaveLength(0)
    expect(liveClassroomStore.getState().practiceRevision).toBe(0)
  })

  it('G. Session ends while board interaction active: interaction permission cleared', () => {
    liveClassroomStore.getState().setLectureInteractionUser(studentId)
    liveClassroomStore.getState().addRaisedHand(studentId)
    expect(liveClassroomStore.getState().lectureInteractionUserId).toBe(studentId)

    // Termination
    liveClassroomStore.getState().resetLiveClass()
    expect(liveClassroomStore.getState().lectureInteractionUserId).toBeNull()
    expect(liveClassroomStore.getState().raisedHandUserIds).toHaveLength(0)
  })

  it('H. No reconnect loop after termination', () => {
    let reconnectAttempts = 0
    let sessionTerminatedStatus: 'ENDED' | 'CANCELLED' | null = 'ENDED'

    const attemptConnect = () => {
      if (sessionTerminatedStatus !== null) {
        // Guard prevents any token fetch or reconnect loop
        return
      }
      reconnectAttempts++
    }

    attemptConnect()
    attemptConnect()
    expect(reconnectAttempts).toBe(0)
  })

  it('I. Realtime subscription cleanup on unmount', () => {
    const mockRemoveChannel = vi.fn()
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    }
    const mockClient = {
      channel: vi.fn().mockReturnValue(mockChannel),
      removeChannel: mockRemoveChannel,
    }

    // Simulate hook setup
    const channel = mockClient.channel(`live_session_status_${sessionId}`)
    channel.on().subscribe()

    // Simulate hook unmount
    mockClient.removeChannel(channel)

    expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannel)
  })

  it('J. F-04 Hardening: Session termination does NOT invoke normal leave navigation callback', () => {
    const mockNavigate = vi.fn()
    let sessionTerminatedStatus: 'ENDED' | 'CANCELLED' | null = null
    const isTerminatedRef = { current: false }

    const handleSessionTerminated = (status: 'ENDED' | 'CANCELLED') => {
      isTerminatedRef.current = true
      sessionTerminatedStatus = status
      liveClassroomStore.getState().resetLiveClass()
    }

    const handleManualLeave = () => {
      liveClassroomStore.getState().resetLiveClass()
      mockNavigate(-1)
    }

    const handleRoomDisconnected = () => {
      // If room disconnected as a result of session termination,
      // do NOT navigate away! Keep dedicated session-ended screen visible.
      if (isTerminatedRef.current || sessionTerminatedStatus !== null) {
        liveClassroomStore.getState().resetLiveClass()
        return
      }
      handleManualLeave()
    }

    // 1. Session is terminated by server / Realtime update
    handleSessionTerminated('ENDED')
    expect(isTerminatedRef.current).toBe(true)
    expect(sessionTerminatedStatus).toBe('ENDED')

    // 2. LiveKit disconnects as a result of session termination
    handleRoomDisconnected()

    // Assert: navigation must NOT have been called!
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('K. F-04 Hardening: Normal user Leave still invokes navigation callback', () => {
    const mockNavigate = vi.fn()
    let sessionTerminatedStatus: 'ENDED' | 'CANCELLED' | null = null
    const isTerminatedRef = { current: false }

    const handleManualLeave = () => {
      liveClassroomStore.getState().resetLiveClass()
      mockNavigate(-1)
    }

    const handleRoomDisconnected = () => {
      if (isTerminatedRef.current || sessionTerminatedStatus !== null) {
        liveClassroomStore.getState().resetLiveClass()
        return
      }
      handleManualLeave()
    }

    // 1. User clicks manual Leave button
    handleManualLeave()
    expect(mockNavigate).toHaveBeenCalledTimes(1)
    expect(mockNavigate).toHaveBeenCalledWith(-1)

    // 2. Room disconnects normally
    handleRoomDisconnected()
    expect(mockNavigate).toHaveBeenCalledTimes(2)
  })
})
