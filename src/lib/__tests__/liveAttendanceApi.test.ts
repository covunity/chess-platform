import { describe, it, expect, vi } from 'vitest'
import {
  recordLiveSessionJoin,
  pingLiveSessionAttendance,
  recordLiveSessionLeave,
  finalizeLiveSessionAttendance,
  getLiveSessionAttendance,
} from '../liveAttendanceApi'

describe('liveAttendanceApi client helpers', () => {
  const validSessionId = '11111111-1111-1111-1111-111111111111'
  const validConnId = '22222222-2222-2222-2222-222222222222'
  const validIntervalId = '33333333-3333-3333-3333-333333333333'

  describe('recordLiveSessionJoin', () => {
    it('rejects invalid sessionId', async () => {
      const mockClient = { rpc: vi.fn() } as any
      const { data, error } = await recordLiveSessionJoin(mockClient, {
        sessionId: 'invalid',
        connectionId: validConnId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toContain('sessionId must be a valid UUID')
      expect(data).toBeNull()
      expect(mockClient.rpc).not.toHaveBeenCalled()
    })

    it('rejects invalid connectionId', async () => {
      const mockClient = { rpc: vi.fn() } as any
      const { data, error } = await recordLiveSessionJoin(mockClient, {
        sessionId: validSessionId,
        connectionId: 'not-a-uuid',
      })
      expect(error).not.toBeNull()
      expect(error?.message).toContain('connectionId must be a valid UUID')
      expect(data).toBeNull()
    })

    it('calls RPC record_live_session_join and maps response', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          interval_id: validIntervalId,
          session_id: validSessionId,
          user_id: 'user-1',
          connection_id: validConnId,
          role: 'student',
          is_late: false,
        },
        error: null,
      })
      const mockClient = { rpc: mockRpc } as any

      const { data, error } = await recordLiveSessionJoin(mockClient, {
        sessionId: validSessionId,
        connectionId: validConnId,
      })

      expect(error).toBeNull()
      expect(mockRpc).toHaveBeenCalledWith('record_live_session_join', {
        p_session_id: validSessionId,
        p_connection_id: validConnId,
      })
      expect(data).toEqual({
        intervalId: validIntervalId,
        sessionId: validSessionId,
        userId: 'user-1',
        connectionId: validConnId,
        role: 'student',
        isLate: false,
      })
    })

    it('propagates RPC error', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'cannot_join_session_in_SCHEDULED_status' },
      })
      const mockClient = { rpc: mockRpc } as any

      const { data, error } = await recordLiveSessionJoin(mockClient, {
        sessionId: validSessionId,
        connectionId: validConnId,
      })

      expect(data).toBeNull()
      expect(error?.message).toBe('cannot_join_session_in_SCHEDULED_status')
    })
  })

  describe('pingLiveSessionAttendance', () => {
    it('rejects invalid intervalId', async () => {
      const mockClient = { rpc: vi.fn() } as any
      const { success, error } = await pingLiveSessionAttendance(mockClient, 'invalid')
      expect(success).toBe(false)
      expect(error?.message).toContain('intervalId must be a valid UUID')
    })

    it('calls ping_live_session_attendance RPC', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: { success: true },
        error: null,
      })
      const mockClient = { rpc: mockRpc } as any

      const { success, error } = await pingLiveSessionAttendance(mockClient, validIntervalId)
      expect(error).toBeNull()
      expect(success).toBe(true)
      expect(mockRpc).toHaveBeenCalledWith('ping_live_session_attendance', {
        p_interval_id: validIntervalId,
      })
    })
  })

  describe('recordLiveSessionLeave', () => {
    it('calls record_live_session_leave RPC', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: { success: true },
        error: null,
      })
      const mockClient = { rpc: mockRpc } as any

      const { success, error } = await recordLiveSessionLeave(mockClient, validIntervalId)
      expect(error).toBeNull()
      expect(success).toBe(true)
      expect(mockRpc).toHaveBeenCalledWith('record_live_session_leave', {
        p_interval_id: validIntervalId,
      })
    })
  })

  describe('finalizeLiveSessionAttendance', () => {
    it('calls finalize_live_session_attendance RPC', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: { success: true, session_duration_seconds: 3600 },
        error: null,
      })
      const mockClient = { rpc: mockRpc } as any

      const { success, sessionDurationSeconds, error } = await finalizeLiveSessionAttendance(
        mockClient,
        validSessionId
      )
      expect(error).toBeNull()
      expect(success).toBe(true)
      expect(sessionDurationSeconds).toBe(3600)
      expect(mockRpc).toHaveBeenCalledWith('finalize_live_session_attendance', {
        p_session_id: validSessionId,
      })
    })
  })

  describe('getLiveSessionAttendance', () => {
    it('calls get_live_session_attendance RPC and returns array', async () => {
      const rows = [
        {
          id: 'att-1',
          live_session_id: validSessionId,
          user_id: 'user-1',
          role: 'student',
          attendance_status: 'PRESENT',
          total_duration_seconds: 2800,
        },
      ]
      const mockRpc = vi.fn().mockResolvedValue({
        data: rows,
        error: null,
      })
      const mockClient = { rpc: mockRpc } as any

      const { data, error } = await getLiveSessionAttendance(mockClient, validSessionId)
      expect(error).toBeNull()
      expect(data).toEqual(rows)
      expect(mockRpc).toHaveBeenCalledWith('get_live_session_attendance', {
        p_session_id: validSessionId,
      })
    })
  })
})
