import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { ConnectionState, RoomEvent } from 'livekit-client'
import type { SupabaseClient } from '@supabase/supabase-js'

const listeners: Record<string, ((...args: any[]) => void)[]> = {}

const mockRoom = {
  state: ConnectionState.Disconnected,
  on: vi.fn((event: string, cb: (...args: any[]) => void) => {
    listeners[event] = listeners[event] || []
    listeners[event].push(cb)
  }),
  off: vi.fn((event: string, cb: (...args: any[]) => void) => {
    if (listeners[event]) {
      listeners[event] = listeners[event].filter((fn) => fn !== cb)
    }
  }),
}

function emitRoomEvent(event: string, ...args: any[]) {
  if (listeners[event]) {
    for (const fn of listeners[event]) {
      fn(...args)
    }
  }
}

vi.mock('@livekit/components-react', () => ({
  useMaybeRoomContext: () => mockRoom,
  useRoomContext: () => mockRoom,
}))

import {
  useLiveAttendance,
  ATTENDANCE_HEARTBEAT_INTERVAL_MS,
  resetTabConnectionIdForTest,
} from '../useLiveAttendance'

describe('useLiveAttendance with LiveKit RoomContext Integration', () => {
  const validSessionId = '11111111-1111-1111-1111-111111111111'
  const validUserId = '22222222-2222-2222-2222-222222222222'
  const validIntervalId = '33333333-3333-3333-3333-333333333333'

  let mockRpc: ReturnType<typeof vi.fn>
  let mockClient: SupabaseClient

  beforeEach(() => {
    vi.useFakeTimers()
    resetTabConnectionIdForTest(null)
    for (const k in listeners) delete listeners[k]
    mockRoom.state = ConnectionState.Disconnected

    mockRpc = vi.fn().mockImplementation((fnName: string) => {
      if (fnName === 'record_live_session_join') {
        return Promise.resolve({
          data: {
            success: true,
            interval_id: validIntervalId,
            session_id: validSessionId,
            user_id: validUserId,
            connection_id: 'conn-1',
            role: 'student',
            is_late: false,
          },
          error: null,
        })
      }
      if (fnName === 'ping_live_session_attendance') {
        return Promise.resolve({
          data: { success: true },
          error: null,
        })
      }
      if (fnName === 'record_live_session_leave') {
        return Promise.resolve({
          data: { success: true },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    })

    mockClient = { rpc: mockRpc } as unknown as SupabaseClient
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('automatically triggers join when Room transitions to ConnectionState.Connected', async () => {
    mockRoom.state = ConnectionState.Connecting

    const { result } = renderHook(() =>
      useLiveAttendance({
        sessionId: validSessionId,
        userId: validUserId,
        supabaseClient: mockClient,
      })
    )

    await act(async () => {
      await Promise.resolve()
    })

    // Initially connecting: no join yet
    expect(mockRpc).not.toHaveBeenCalled()
    expect(result.current.isTracking).toBe(false)

    // Room connects!
    mockRoom.state = ConnectionState.Connected
    await act(async () => {
      emitRoomEvent(RoomEvent.ConnectionStateChanged, ConnectionState.Connected)
      await Promise.resolve()
    })

    // Join recorded
    expect(mockRpc).toHaveBeenCalledWith('record_live_session_join', expect.anything())
    expect(result.current.isTracking).toBe(true)
    expect(result.current.intervalId).toBe(validIntervalId)

    // 30s heartbeat fires
    await act(async () => {
      vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
      await Promise.resolve()
    })

    expect(mockRpc).toHaveBeenCalledWith('ping_live_session_attendance', {
      p_interval_id: validIntervalId,
    })

    // Network drops: Room transitions to Reconnecting
    mockRoom.state = ConnectionState.Reconnecting
    await act(async () => {
      emitRoomEvent(RoomEvent.ConnectionStateChanged, ConnectionState.Reconnecting)
      await Promise.resolve()
    })

    // No leave called on reconnecting
    expect(mockRpc).not.toHaveBeenCalledWith(
      'record_live_session_leave',
      expect.anything()
    )
    expect(result.current.isTracking).toBe(false)

    // Room recovers: Connected
    mockRoom.state = ConnectionState.Connected
    await act(async () => {
      emitRoomEvent(RoomEvent.ConnectionStateChanged, ConnectionState.Connected)
      await Promise.resolve()
    })

    // Resumes existing interval without duplicate join
    const joinCalls = mockRpc.mock.calls.filter(
      (c) => c[0] === 'record_live_session_join'
    )
    expect(joinCalls).toHaveLength(1)
    expect(result.current.isTracking).toBe(true)
    expect(result.current.intervalId).toBe(validIntervalId)
  })
})
