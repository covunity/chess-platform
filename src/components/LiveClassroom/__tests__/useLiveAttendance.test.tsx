import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, renderHook, act, waitFor } from '@testing-library/react'
import React, { StrictMode, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  useLiveAttendance,
  getTabConnectionId,
  resetTabConnectionIdForTest,
  ATTENDANCE_HEARTBEAT_INTERVAL_MS,
} from '../useLiveAttendance'

describe('useLiveAttendance Hook (Task 9.2)', () => {
  const validSessionId1 = '11111111-1111-1111-1111-111111111111'
  const validSessionId2 = '22222222-2222-2222-2222-222222222222'
  const validUserId = '33333333-3333-3333-3333-333333333333'
  const validIntervalId1 = '44444444-4444-4444-4444-444444444444'
  const validIntervalId2 = '55555555-5555-5555-5555-555555555555'

  let mockRpc: ReturnType<typeof vi.fn>
  let mockClient: SupabaseClient

  beforeEach(() => {
    vi.useFakeTimers()
    resetTabConnectionIdForTest(null)

    mockRpc = vi.fn().mockImplementation((fnName: string, args: any) => {
      if (fnName === 'record_live_session_join') {
        const intervalId =
          args.p_session_id === validSessionId2 ? validIntervalId2 : validIntervalId1
        return Promise.resolve({
          data: {
            success: true,
            interval_id: intervalId,
            session_id: args.p_session_id,
            user_id: validUserId,
            connection_id: args.p_connection_id,
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

  // 1. Attendance join is called with the correct live_session_id and connection_id
  it('1. calls record_live_session_join with correct live_session_id and connection_id', async () => {
    const { result } = renderHook(() =>
      useLiveAttendance({
        sessionId: validSessionId1,
        userId: validUserId,
        isConnected: true,
        supabaseClient: mockClient,
      })
    )

    await act(async () => {
      await Promise.resolve()
    })

    const expectedConnectionId = getTabConnectionId()
    expect(mockRpc).toHaveBeenCalledWith('record_live_session_join', {
      p_session_id: validSessionId1,
      p_connection_id: expectedConnectionId,
    })
    expect(result.current.intervalId).toBe(validIntervalId1)
    expect(result.current.isTracking).toBe(true)
    expect(result.current.connectionId).toBe(expectedConnectionId)
  })

  // 2. Heartbeat fires at the intended 30-second interval
  it('2. sends ping_live_session_attendance every 30 seconds', async () => {
    const { result } = renderHook(() =>
      useLiveAttendance({
        sessionId: validSessionId1,
        userId: validUserId,
        isConnected: true,
        supabaseClient: mockClient,
      })
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.intervalId).toBe(validIntervalId1)
    expect(mockRpc).not.toHaveBeenCalledWith(
      'ping_live_session_attendance',
      expect.anything()
    )

    // Advance by 30 seconds (first heartbeat)
    await act(async () => {
      vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
      await Promise.resolve()
    })

    expect(mockRpc).toHaveBeenCalledTimes(2) // 1 join + 1 ping
    expect(mockRpc).toHaveBeenLastCalledWith('ping_live_session_attendance', {
      p_interval_id: validIntervalId1,
    })

    // Advance by another 30 seconds (second heartbeat)
    await act(async () => {
      vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
      await Promise.resolve()
    })

    expect(mockRpc).toHaveBeenCalledTimes(3) // 1 join + 2 pings
  })

  // 3. Heartbeat does not start before a valid classroom connection
  it('3. does not join or ping before a valid classroom connection (isConnected: false)', async () => {
    let isConnected = false

    const { result, rerender } = renderHook(
      ({ connected }) =>
        useLiveAttendance({
          sessionId: validSessionId1,
          userId: validUserId,
          isConnected: connected,
          supabaseClient: mockClient,
        }),
      { initialProps: { connected: isConnected } }
    )

    await act(async () => {
      await Promise.resolve()
    })

    // Not connected yet: zero calls
    expect(mockRpc).not.toHaveBeenCalled()
    expect(result.current.isTracking).toBe(false)
    expect(result.current.intervalId).toBeNull()

    // 60 seconds pass while disconnected
    await act(async () => {
      vi.advanceTimersByTime(60_000)
      await Promise.resolve()
    })
    expect(mockRpc).not.toHaveBeenCalled()

    // Now classroom connection establishes
    rerender({ connected: true })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mockRpc).toHaveBeenCalledWith('record_live_session_join', expect.anything())
    expect(result.current.isTracking).toBe(true)

    // Heartbeat now fires at 30s
    await act(async () => {
      vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
      await Promise.resolve()
    })

    expect(mockRpc).toHaveBeenCalledWith('ping_live_session_attendance', {
      p_interval_id: validIntervalId1,
    })
  })

  // 4. Multiple renders/effect re-executions do not create duplicate active timers
  it('4. multiple renders do not create duplicate active intervals or duplicate timers', async () => {
    const { result, rerender } = renderHook(() =>
      useLiveAttendance({
        sessionId: validSessionId1,
        userId: validUserId,
        isConnected: true,
        supabaseClient: mockClient,
      })
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(mockRpc).toHaveBeenCalledTimes(1) // 1 join

    // Trigger multiple re-renders
    rerender()
    rerender()
    rerender()

    await act(async () => {
      await Promise.resolve()
    })

    // Still only 1 join call
    expect(mockRpc).toHaveBeenCalledTimes(1)

    // Advance 30s: exactly 1 ping fired, not multiple
    await act(async () => {
      vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
      await Promise.resolve()
    })

    const pingCalls = mockRpc.mock.calls.filter(
      (c) => c[0] === 'ping_live_session_attendance'
    )
    expect(pingCalls).toHaveLength(1)
  })

  // 5. Unmount / intentional leave stops the timer and attempts the leave RPC
  it('5a. intentional leave() stops timer and calls record_live_session_leave', async () => {
    const { result } = renderHook(() =>
      useLiveAttendance({
        sessionId: validSessionId1,
        userId: validUserId,
        isConnected: true,
        supabaseClient: mockClient,
      })
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.intervalId).toBe(validIntervalId1)

    // Call manual leave()
    await act(async () => {
      await result.current.leave()
    })

    expect(mockRpc).toHaveBeenCalledWith('record_live_session_leave', {
      p_interval_id: validIntervalId1,
    })
    expect(result.current.isTracking).toBe(false)
    expect(result.current.intervalId).toBeNull()

    // Advancing timers sends no further pings
    await act(async () => {
      vi.advanceTimersByTime(60_000)
      await Promise.resolve()
    })

    expect(mockRpc).not.toHaveBeenCalledWith(
      'ping_live_session_attendance',
      expect.anything()
    )
  })

  it('5b. unmount stops timer and attempts record_live_session_leave', async () => {
    const { unmount } = renderHook(() =>
      useLiveAttendance({
        sessionId: validSessionId1,
        userId: validUserId,
        isConnected: true,
        supabaseClient: mockClient,
      })
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(mockRpc).toHaveBeenCalledWith('record_live_session_join', expect.anything())

    // Unmount hook
    unmount()

    // Microtask queue executes cleanup leave
    await act(async () => {
      await Promise.resolve()
    })

    expect(mockRpc).toHaveBeenCalledWith('record_live_session_leave', {
      p_interval_id: validIntervalId1,
    })

    // Ensure timer does not fire post-unmount
    await act(async () => {
      vi.advanceTimersByTime(60_000)
      await Promise.resolve()
    })

    expect(mockRpc).not.toHaveBeenCalledWith(
      'ping_live_session_attendance',
      expect.anything()
    )
  })

  // 6. Temporary network disconnect/reconnect does not incorrectly finalize attendance or create duplicate active intervals
  it('6. temporary network disconnect does not call leave and reconnect resumes existing interval', async () => {
    const { result, rerender } = renderHook(
      ({ connected }) =>
        useLiveAttendance({
          sessionId: validSessionId1,
          userId: validUserId,
          isConnected: connected,
          supabaseClient: mockClient,
        }),
      { initialProps: { connected: true } }
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(mockRpc).toHaveBeenCalledTimes(1) // 1 join
    expect(result.current.intervalId).toBe(validIntervalId1)

    // Network drops: isConnected becomes false
    rerender({ connected: false })

    await act(async () => {
      await Promise.resolve()
    })

    // MUST NOT call record_live_session_leave on temporary network disconnect!
    expect(mockRpc).not.toHaveBeenCalledWith(
      'record_live_session_leave',
      expect.anything()
    )
    expect(result.current.isTracking).toBe(false)

    // While disconnected, timers are paused
    await act(async () => {
      vi.advanceTimersByTime(60_000)
      await Promise.resolve()
    })
    expect(mockRpc).not.toHaveBeenCalledWith(
      'ping_live_session_attendance',
      expect.anything()
    )

    // Network recovers: isConnected becomes true
    rerender({ connected: true })

    await act(async () => {
      await Promise.resolve()
    })

    // Reconnect sends immediate ping to verify/refresh existing interval
    expect(mockRpc).toHaveBeenCalledWith('ping_live_session_attendance', {
      p_interval_id: validIntervalId1,
    })
    // Did NOT call join again (no duplicate intervals)
    const joinCalls = mockRpc.mock.calls.filter(
      (c) => c[0] === 'record_live_session_join'
    )
    expect(joinCalls).toHaveLength(1)
    expect(result.current.intervalId).toBe(validIntervalId1)
    expect(result.current.isTracking).toBe(true)

    // Resumes periodic heartbeats
    await act(async () => {
      vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
      await Promise.resolve()
    })

    const pingCalls = mockRpc.mock.calls.filter(
      (c) => c[0] === 'ping_live_session_attendance'
    )
    expect(pingCalls.length).toBeGreaterThanOrEqual(2)
  })

  // 7. Switching sessions cleans up the previous session correctly
  it('7. switching sessions cleans up the previous session and joins the new session', async () => {
    const { result, rerender } = renderHook(
      ({ sessionId }) =>
        useLiveAttendance({
          sessionId,
          userId: validUserId,
          isConnected: true,
          supabaseClient: mockClient,
        }),
      { initialProps: { sessionId: validSessionId1 } }
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.intervalId).toBe(validIntervalId1)

    // Switch to session 2
    rerender({ sessionId: validSessionId2 })

    await act(async () => {
      await Promise.resolve()
    })

    // Left session 1 interval
    expect(mockRpc).toHaveBeenCalledWith('record_live_session_leave', {
      p_interval_id: validIntervalId1,
    })

    // Joined session 2
    expect(mockRpc).toHaveBeenCalledWith('record_live_session_join', {
      p_session_id: validSessionId2,
      p_connection_id: expect.any(String),
    })

    expect(result.current.intervalId).toBe(validIntervalId2)

    // Heartbeats now ping interval 2
    await act(async () => {
      vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
      await Promise.resolve()
    })

    expect(mockRpc).toHaveBeenCalledWith('ping_live_session_attendance', {
      p_interval_id: validIntervalId2,
    })
  })

  // 8. RPC failure is handled without crashing the classroom
  it('8. handles RPC errors gracefully without throwing unhandled exceptions', async () => {
    const failingClient = {
      rpc: vi.fn().mockRejectedValue(new Error('Network offline or database unavailable')),
    } as unknown as SupabaseClient

    const onError = vi.fn()

    const { result } = renderHook(() =>
      useLiveAttendance({
        sessionId: validSessionId1,
        userId: validUserId,
        isConnected: true,
        supabaseClient: failingClient,
        onError,
      })
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.intervalId).toBeNull()
    expect(result.current.isTracking).toBe(false)
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Network offline') })
    )

    // Calling leave when RPC throws does not throw
    await act(async () => {
      await expect(result.current.leave()).resolves.toBeUndefined()
    })
  })

  // 9. Missing user/session information does not cause invalid RPC calls
  it('9. does not invoke RPCs when session or user information is missing or invalid', async () => {
    // 9a: undefined sessionId
    const { result: res1 } = renderHook(() =>
      useLiveAttendance({
        sessionId: undefined,
        userId: validUserId,
        isConnected: true,
        supabaseClient: mockClient,
      })
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockRpc).not.toHaveBeenCalled()
    expect(res1.current.isTracking).toBe(false)

    // 9b: non-UUID sessionId
    const { result: res2 } = renderHook(() =>
      useLiveAttendance({
        sessionId: 'not-a-valid-uuid',
        userId: validUserId,
        isConnected: true,
        supabaseClient: mockClient,
      })
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockRpc).not.toHaveBeenCalled()
    expect(res2.current.isTracking).toBe(false)

    // 9c: undefined userId
    const { result: res3 } = renderHook(() =>
      useLiveAttendance({
        sessionId: validSessionId1,
        userId: undefined,
        isConnected: true,
        supabaseClient: mockClient,
      })
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockRpc).not.toHaveBeenCalled()
    expect(res3.current.isTracking).toBe(false)
  })

  // 10. React StrictMode does not create persistent duplicate intervals
  it('10. does not create duplicate intervals under React StrictMode double effect execution', async () => {
    function AttendanceConsumer() {
      const attendance = useLiveAttendance({
        sessionId: validSessionId1,
        userId: validUserId,
        isConnected: true,
        supabaseClient: mockClient,
      })
      return <div data-testid="status">{attendance.isTracking ? 'active' : 'idle'}</div>
    }

    const { unmount } = render(
      <StrictMode>
        <AttendanceConsumer />
      </StrictMode>
    )

    await act(async () => {
      await Promise.resolve()
    })

    // StrictMode double mount should only dispatch 1 join RPC call
    const joinCalls = mockRpc.mock.calls.filter(
      (c) => c[0] === 'record_live_session_join'
    )
    expect(joinCalls).toHaveLength(1)

    // In StrictMode mount, cleanup microtask was cancelled so no leave was called prematurely
    expect(mockRpc).not.toHaveBeenCalledWith(
      'record_live_session_leave',
      expect.anything()
    )

    // Heartbeats run normally with single interval
    await act(async () => {
      vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
      await Promise.resolve()
    })

    const pingCalls = mockRpc.mock.calls.filter(
      (c) => c[0] === 'ping_live_session_attendance'
    )
    expect(pingCalls).toHaveLength(1)

    // On final unmount, leave is called exactly once
    unmount()

    await act(async () => {
      await Promise.resolve()
    })

    const leaveCalls = mockRpc.mock.calls.filter(
      (c) => c[0] === 'record_live_session_leave'
    )
    expect(leaveCalls).toHaveLength(1)
  })

  // Connection ID persistence across tab lifecycle
  it('maintains the same connection_id during in-tab reconnection and generates new one on reset', () => {
    const conn1 = getTabConnectionId()
    const conn2 = getTabConnectionId()
    expect(conn1).toBe(conn2)
    expect(conn1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

    // Simulate page reload
    resetTabConnectionIdForTest(null)
    const conn3 = getTabConnectionId()
    expect(conn3).not.toBe(conn1)
  })

  describe('Race Conditions & Asynchronous Hardening (Task 9.2 Blockers A-D)', () => {
    function createDeferred<T>() {
      let resolve!: (value: T | PromiseLike<T>) => void
      let reject!: (reason?: any) => void
      const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    }

    // REGRESSION 1: Join request pending -> connection drops -> join resolves.
    // No heartbeat should run while disconnected.
    it('Regression 1: join request pending -> connection drops -> join resolves does not start heartbeat while disconnected', async () => {
      const joinDeferred = createDeferred<any>()

      mockRpc = vi.fn().mockImplementation((fnName: string, args: any) => {
        if (fnName === 'record_live_session_join') {
          return joinDeferred.promise
        }
        if (fnName === 'ping_live_session_attendance') {
          return Promise.resolve({ data: { success: true }, error: null })
        }
        if (fnName === 'record_live_session_leave') {
          return Promise.resolve({ data: { success: true }, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })
      mockClient = { rpc: mockRpc } as unknown as SupabaseClient

      const { result, rerender } = renderHook(
        ({ connected }) =>
          useLiveAttendance({
            sessionId: validSessionId1,
            userId: validUserId,
            isConnected: connected,
            supabaseClient: mockClient,
          }),
        { initialProps: { connected: true } }
      )

      await act(async () => {
        await Promise.resolve()
      })

      // Join is pending in flight
      expect(mockRpc).toHaveBeenCalledWith('record_live_session_join', expect.anything())
      expect(result.current.isTracking).toBe(false)

      // Connection drops BEFORE join resolves!
      rerender({ connected: false })

      await act(async () => {
        await Promise.resolve()
      })

      // Now the delayed join resolves
      await act(async () => {
        joinDeferred.resolve({
          data: {
            success: true,
            interval_id: validIntervalId1,
            session_id: validSessionId1,
            user_id: validUserId,
            connection_id: 'conn-1',
            role: 'student',
            is_late: false,
          },
          error: null,
        })
        await Promise.resolve()
      })

      // Interval is retained for reconnect, but MUST NOT track or heartbeat while disconnected
      expect(result.current.intervalId).toBe(validIntervalId1)
      expect(result.current.isTracking).toBe(false)

      // Advancing time sends zero pings because room is disconnected
      await act(async () => {
        vi.advanceTimersByTime(60_000)
        await Promise.resolve()
      })
      expect(mockRpc).not.toHaveBeenCalledWith(
        'ping_live_session_attendance',
        expect.anything()
      )

      // Network recovers: isConnected becomes true
      rerender({ connected: true })

      await act(async () => {
        await Promise.resolve()
      })

      // Reconnect validates existing interval with immediate ping and starts heartbeat
      expect(mockRpc).toHaveBeenCalledWith('ping_live_session_attendance', {
        p_interval_id: validIntervalId1,
      })
      expect(result.current.isTracking).toBe(true)

      // Heartbeat now fires on cadence
      await act(async () => {
        vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
        await Promise.resolve()
      })
      const pings = mockRpc.mock.calls.filter(
        (c) => c[0] === 'ping_live_session_attendance'
      )
      expect(pings.length).toBeGreaterThanOrEqual(2)
    })

    // REGRESSION 2: Join request pending -> session changes -> old join resolves.
    // Old attendance must not be adopted, and no stale timer may start.
    it('Regression 2: join request pending -> session changes -> old join resolves cleanly closes old interval without adopting it', async () => {
      const joinDeferred1 = createDeferred<any>()

      mockRpc = vi.fn().mockImplementation((fnName: string, args: any) => {
        if (fnName === 'record_live_session_join') {
          if (args.p_session_id === validSessionId1) {
            return joinDeferred1.promise
          }
          return Promise.resolve({
            data: {
              success: true,
              interval_id: validIntervalId2,
              session_id: validSessionId2,
              user_id: validUserId,
              connection_id: args.p_connection_id,
              role: 'student',
              is_late: false,
            },
            error: null,
          })
        }
        if (fnName === 'ping_live_session_attendance') {
          return Promise.resolve({ data: { success: true }, error: null })
        }
        if (fnName === 'record_live_session_leave') {
          return Promise.resolve({ data: { success: true }, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })
      mockClient = { rpc: mockRpc } as unknown as SupabaseClient

      const { result, rerender } = renderHook(
        ({ sessionId }) =>
          useLiveAttendance({
            sessionId,
            userId: validUserId,
            isConnected: true,
            supabaseClient: mockClient,
          }),
        { initialProps: { sessionId: validSessionId1 } }
      )

      await act(async () => {
        await Promise.resolve()
      })

      // Join 1 is pending
      expect(mockRpc).toHaveBeenCalledWith('record_live_session_join', {
        p_session_id: validSessionId1,
        p_connection_id: expect.any(String),
      })

      // Switch to session 2 while join 1 is still in flight!
      rerender({ sessionId: validSessionId2 })

      await act(async () => {
        await Promise.resolve()
      })

      // Session 2 is adopted
      expect(result.current.intervalId).toBe(validIntervalId2)
      expect(result.current.isTracking).toBe(true)

      // Now the delayed join 1 resolves with interval 1
      await act(async () => {
        joinDeferred1.resolve({
          data: {
            success: true,
            interval_id: validIntervalId1,
            session_id: validSessionId1,
            user_id: validUserId,
            connection_id: 'conn-1',
            role: 'student',
            is_late: false,
          },
          error: null,
        })
        await Promise.resolve()
      })

      // MUST NOT overwrite session 2's interval with session 1's interval
      expect(result.current.intervalId).toBe(validIntervalId2)

      // The abandoned interval 1 must have been closed via record_live_session_leave
      expect(mockRpc).toHaveBeenCalledWith('record_live_session_leave', {
        p_interval_id: validIntervalId1,
      })

      // Timers ping only session 2
      await act(async () => {
        vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
        await Promise.resolve()
      })

      expect(mockRpc).toHaveBeenCalledWith('ping_live_session_attendance', {
        p_interval_id: validIntervalId2,
      })
      expect(mockRpc).not.toHaveBeenCalledWith('ping_live_session_attendance', {
        p_interval_id: validIntervalId1,
      })
    })

    // REGRESSION 3: Reconnect ping pending -> session switches -> old ping rejects.
    // No timer may ping the old interval afterward.
    it('Regression 3: reconnect ping pending -> session switches -> old ping rejects does not cancel new session timer', async () => {
      const pingDeferred = createDeferred<any>()

      mockRpc = vi.fn().mockImplementation((fnName: string, args: any) => {
        if (fnName === 'record_live_session_join') {
          const id =
            args.p_session_id === validSessionId2 ? validIntervalId2 : validIntervalId1
          return Promise.resolve({
            data: {
              success: true,
              interval_id: id,
              session_id: args.p_session_id,
              user_id: validUserId,
              connection_id: args.p_connection_id,
              role: 'student',
              is_late: false,
            },
            error: null,
          })
        }
        if (fnName === 'ping_live_session_attendance') {
          if (args.p_interval_id === validIntervalId1) {
            return pingDeferred.promise
          }
          return Promise.resolve({ data: { success: true }, error: null })
        }
        if (fnName === 'record_live_session_leave') {
          return Promise.resolve({ data: { success: true }, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })
      mockClient = { rpc: mockRpc } as unknown as SupabaseClient

      const { result, rerender } = renderHook(
        ({ sessionId, connected }) =>
          useLiveAttendance({
            sessionId,
            userId: validUserId,
            isConnected: connected,
            supabaseClient: mockClient,
          }),
        { initialProps: { sessionId: validSessionId1, connected: true } }
      )

      await act(async () => {
        await Promise.resolve()
      })
      expect(result.current.intervalId).toBe(validIntervalId1)

      // Network drops and reconnects: triggers reconnect ping for interval 1
      rerender({ sessionId: validSessionId1, connected: false })
      await act(async () => {
        await Promise.resolve()
      })
      rerender({ sessionId: validSessionId1, connected: true })
      await act(async () => {
        await Promise.resolve()
      })

      // Reconnect ping for interval 1 is now in flight.
      // While it is pending, switch session to Session 2!
      rerender({ sessionId: validSessionId2, connected: true })
      await act(async () => {
        await Promise.resolve()
      })

      expect(result.current.intervalId).toBe(validIntervalId2)
      expect(result.current.isTracking).toBe(true)

      // Now the old reconnect ping for interval 1 rejects / fails
      await act(async () => {
        pingDeferred.resolve({ data: { success: false, reason: 'interval_closed' }, error: null })
        await Promise.resolve()
      })

      // New session 2 must STILL be tracking and active
      expect(result.current.intervalId).toBe(validIntervalId2)
      expect(result.current.isTracking).toBe(true)

      // Advancing timer pings interval 2 normally
      await act(async () => {
        vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
        await Promise.resolve()
      })

      expect(mockRpc).toHaveBeenCalledWith('ping_live_session_attendance', {
        p_interval_id: validIntervalId2,
      })
      // No ping for interval 1 after session switch
      const interval1Pings = mockRpc.mock.calls.filter(
        (c) =>
          c[0] === 'ping_live_session_attendance' &&
          c[1]?.p_interval_id === validIntervalId1
      )
      // Exactly 1 reconnect ping was sent when reconnected, none after
      expect(interval1Pings).toHaveLength(1)
    })

    // REGRESSION 4: userId changes with the same sessionId while a request is pending.
    // The old identity's interval must not be adopted.
    it('Regression 4: userId changes with same sessionId while join pending does not adopt old identity interval', async () => {
      const user1 = '44444444-1111-1111-1111-111111111111'
      const user2 = '55555555-2222-2222-2222-222222222222'
      const user1Interval = '66666666-1111-1111-1111-111111111111'
      const user2Interval = '77777777-2222-2222-2222-222222222222'

      const user1JoinDeferred = createDeferred<any>()

      mockRpc = vi.fn().mockImplementation((fnName: string, args: any) => {
        if (fnName === 'record_live_session_join') {
          // If called when user1 is active
          if (mockRpc.mock.calls.length === 1) {
            return user1JoinDeferred.promise
          }
          return Promise.resolve({
            data: {
              success: true,
              interval_id: user2Interval,
              session_id: validSessionId1,
              user_id: user2,
              connection_id: args.p_connection_id,
              role: 'student',
              is_late: false,
            },
            error: null,
          })
        }
        if (fnName === 'ping_live_session_attendance') {
          return Promise.resolve({ data: { success: true }, error: null })
        }
        if (fnName === 'record_live_session_leave') {
          return Promise.resolve({ data: { success: true }, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })
      mockClient = { rpc: mockRpc } as unknown as SupabaseClient

      const { result, rerender } = renderHook(
        ({ userId }) =>
          useLiveAttendance({
            sessionId: validSessionId1,
            userId,
            isConnected: true,
            supabaseClient: mockClient,
          }),
        { initialProps: { userId: user1 } }
      )

      await act(async () => {
        await Promise.resolve()
      })

      // User 1 join in flight
      expect(mockRpc).toHaveBeenCalledTimes(1)

      // Switch user identity to user2
      rerender({ userId: user2 })

      await act(async () => {
        await Promise.resolve()
      })

      // User 2 joined and adopted user2Interval
      expect(result.current.intervalId).toBe(user2Interval)

      // Now User 1's delayed join resolves
      await act(async () => {
        user1JoinDeferred.resolve({
          data: {
            success: true,
            interval_id: user1Interval,
            session_id: validSessionId1,
            user_id: user1,
            connection_id: 'conn-1',
            role: 'student',
            is_late: false,
          },
          error: null,
        })
        await Promise.resolve()
      })

      // MUST NOT adopt user1Interval
      expect(result.current.intervalId).toBe(user2Interval)

      // User 1's interval must be left cleanly
      expect(mockRpc).toHaveBeenCalledWith('record_live_session_leave', {
        p_interval_id: user1Interval,
      })
    })

    // REGRESSION 5: New session's heartbeat remains functional after stale callbacks resolve
    it('Regression 5: new session heartbeat remains functional and pings on cadence after stale callbacks resolve', async () => {
      const { result, rerender } = renderHook(
        ({ sessionId }) =>
          useLiveAttendance({
            sessionId,
            userId: validUserId,
            isConnected: true,
            supabaseClient: mockClient,
          }),
        { initialProps: { sessionId: validSessionId1 } }
      )

      await act(async () => {
        await Promise.resolve()
      })
      expect(result.current.intervalId).toBe(validIntervalId1)

      // Switch to session 2
      rerender({ sessionId: validSessionId2 })
      await act(async () => {
        await Promise.resolve()
      })

      expect(result.current.intervalId).toBe(validIntervalId2)
      expect(result.current.isTracking).toBe(true)

      // Verify cadence across multiple ticks
      await act(async () => {
        vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
        await Promise.resolve()
      })
      expect(mockRpc).toHaveBeenCalledWith('ping_live_session_attendance', {
        p_interval_id: validIntervalId2,
      })

      await act(async () => {
        vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
        await Promise.resolve()
      })
      const pingsSession2 = mockRpc.mock.calls.filter(
        (c) =>
          c[0] === 'ping_live_session_attendance' &&
          c[1]?.p_interval_id === validIntervalId2
      )
      expect(pingsSession2.length).toBe(2)
    })

    // REGRESSION 6: A stale timer callback cannot stop the new session's timer
    it('Regression 6: a stale timer callback cannot stop the new session timer and new session continues heartbeating', async () => {
      const ping1Deferred = createDeferred<any>()

      mockRpc = vi.fn().mockImplementation((fnName: string, args: any) => {
        if (fnName === 'record_live_session_join') {
          const id =
            args.p_session_id === validSessionId2 ? validIntervalId2 : validIntervalId1
          return Promise.resolve({
            data: {
              success: true,
              interval_id: id,
              session_id: args.p_session_id,
              user_id: validUserId,
              connection_id: args.p_connection_id,
              role: 'student',
              is_late: false,
            },
            error: null,
          })
        }
        if (fnName === 'ping_live_session_attendance') {
          if (args.p_interval_id === validIntervalId1) {
            return ping1Deferred.promise
          }
          return Promise.resolve({ data: { success: true }, error: null })
        }
        if (fnName === 'record_live_session_leave') {
          return Promise.resolve({ data: { success: true }, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })
      mockClient = { rpc: mockRpc } as unknown as SupabaseClient

      const { result, rerender } = renderHook(
        ({ sessionId }) =>
          useLiveAttendance({
            sessionId,
            userId: validUserId,
            isConnected: true,
            supabaseClient: mockClient,
          }),
        { initialProps: { sessionId: validSessionId1 } }
      )

      await act(async () => {
        await Promise.resolve()
      })
      expect(result.current.intervalId).toBe(validIntervalId1)

      // Advance by 30s to trigger session 1's ping callback
      await act(async () => {
        vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
        await Promise.resolve()
      })
      expect(mockRpc).toHaveBeenCalledWith('ping_live_session_attendance', {
        p_interval_id: validIntervalId1,
      })

      // While ping for interval 1 is in-flight, switch to Session 2!
      rerender({ sessionId: validSessionId2 })
      await act(async () => {
        await Promise.resolve()
      })
      expect(result.current.intervalId).toBe(validIntervalId2)
      expect(result.current.isTracking).toBe(true)

      // Now Session 1's stale ping resolves with success=false
      await act(async () => {
        ping1Deferred.resolve({ data: { success: false, reason: 'interval_closed' }, error: null })
        await Promise.resolve()
      })

      // Stale callback MUST NOT cancel Session 2's timer or stop tracking
      expect(result.current.intervalId).toBe(validIntervalId2)
      expect(result.current.isTracking).toBe(true)

      // Advance timers by 30s: Session 2 continues heartbeating on cadence!
      await act(async () => {
        vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
        await Promise.resolve()
      })
      expect(mockRpc).toHaveBeenCalledWith('ping_live_session_attendance', {
        p_interval_id: validIntervalId2,
      })

      // Advance another 30s: Session 2 pings again
      await act(async () => {
        vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
        await Promise.resolve()
      })
      const session2Pings = mockRpc.mock.calls.filter(
        (c) =>
          c[0] === 'ping_live_session_attendance' &&
          c[1]?.p_interval_id === validIntervalId2
      )
      expect(session2Pings.length).toBe(2)
    })

    // REGRESSION 7: Reconnect ping resolving success=false while disconnected defers join until reconnection
    it('Regression 7: reconnect ping resolving with success=false while disconnected does not trigger a join until reconnection', async () => {
      const reconnectPingDeferred = createDeferred<any>()

      mockRpc = vi.fn().mockImplementation((fnName: string, args: any) => {
        if (fnName === 'record_live_session_join') {
          return Promise.resolve({
            data: {
              success: true,
              interval_id:
                mockRpc.mock.calls.filter((c: any) => c[0] === 'record_live_session_join').length === 1
                  ? validIntervalId1
                  : validIntervalId2,
              session_id: args.p_session_id,
              user_id: validUserId,
              connection_id: args.p_connection_id,
              role: 'student',
              is_late: false,
            },
            error: null,
          })
        }
        if (fnName === 'ping_live_session_attendance') {
          return reconnectPingDeferred.promise
        }
        if (fnName === 'record_live_session_leave') {
          return Promise.resolve({ data: { success: true }, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })
      mockClient = { rpc: mockRpc } as unknown as SupabaseClient

      const { result, rerender } = renderHook(
        ({ connected }) =>
          useLiveAttendance({
            sessionId: validSessionId1,
            userId: validUserId,
            isConnected: connected,
            supabaseClient: mockClient,
          }),
        { initialProps: { connected: true } }
      )

      await act(async () => {
        await Promise.resolve()
      })
      expect(result.current.intervalId).toBe(validIntervalId1)
      expect(mockRpc.mock.calls.filter((c: any) => c[0] === 'record_live_session_join')).toHaveLength(1)

      // Network drops
      rerender({ connected: false })
      await act(async () => {
        await Promise.resolve()
      })

      // Network reconnects briefly: triggers reconnect ping
      rerender({ connected: true })
      await act(async () => {
        await Promise.resolve()
      })
      expect(mockRpc).toHaveBeenCalledWith('ping_live_session_attendance', {
        p_interval_id: validIntervalId1,
      })

      // Network drops AGAIN while reconnect ping is in-flight!
      rerender({ connected: false })
      await act(async () => {
        await Promise.resolve()
      })

      // Now reconnect ping resolves with success=false (server closed interval during downtime)
      await act(async () => {
        reconnectPingDeferred.resolve({ data: { success: false, reason: 'interval_closed' }, error: null })
        await Promise.resolve()
      })

      // MUST NOT call record_live_session_join while disconnected!
      expect(
        mockRpc.mock.calls.filter((c: any) => c[0] === 'record_live_session_join')
      ).toHaveLength(1)

      // UI state and interval state are cleared/consistent while waiting
      expect(result.current.intervalId).toBeNull()
      expect(result.current.isTracking).toBe(false)

      // Advancing time while disconnected does not issue join or ping RPCs
      await act(async () => {
        vi.advanceTimersByTime(60_000)
        await Promise.resolve()
      })
      expect(
        mockRpc.mock.calls.filter((c: any) => c[0] === 'record_live_session_join')
      ).toHaveLength(1)

      // Reconnection establishes: now re-join is triggered
      rerender({ connected: true })
      await act(async () => {
        await Promise.resolve()
      })

      // Join is now issued upon reconnection
      expect(
        mockRpc.mock.calls.filter((c: any) => c[0] === 'record_live_session_join')
      ).toHaveLength(2)
      expect(result.current.intervalId).toBe(validIntervalId2)
      expect(result.current.isTracking).toBe(true)
    })

    // REGRESSION 8: Old join's finally block cannot clear a newer in-flight join
    it('Regression 8: an old join finally block cannot clear a newer in-flight join', async () => {
      const validConnId1 = '88888888-8888-8888-8888-888888888888'
      const validConnId2 = '99999999-9999-9999-9999-999999999999'
      const join1Deferred = createDeferred<any>()
      const join2Deferred = createDeferred<any>()

      mockRpc = vi.fn().mockImplementation((fnName: string, args: any) => {
        if (fnName === 'record_live_session_join') {
          if (args.p_connection_id === validConnId1) {
            return join1Deferred.promise
          }
          if (args.p_connection_id === validConnId2) {
            return join2Deferred.promise
          }
        }
        if (fnName === 'ping_live_session_attendance') {
          return Promise.resolve({ data: { success: true }, error: null })
        }
        if (fnName === 'record_live_session_leave') {
          return Promise.resolve({ data: { success: true }, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })
      mockClient = { rpc: mockRpc } as unknown as SupabaseClient

      const { result, rerender } = renderHook(
        ({ connectionId }) =>
          useLiveAttendance({
            sessionId: validSessionId1,
            userId: validUserId,
            connectionId,
            isConnected: true,
            supabaseClient: mockClient,
          }),
        { initialProps: { connectionId: validConnId1 } }
      )

      await act(async () => {
        await Promise.resolve()
      })
      expect(mockRpc).toHaveBeenCalledWith('record_live_session_join', {
        p_session_id: validSessionId1,
        p_connection_id: validConnId1,
      })

      // Context changes while join 1 is still in-flight: connectionId switches to validConnId2
      rerender({ connectionId: validConnId2 })
      await act(async () => {
        await Promise.resolve()
      })
      expect(mockRpc).toHaveBeenCalledWith('record_live_session_join', {
        p_session_id: validSessionId1,
        p_connection_id: validConnId2,
      })
      expect(mockRpc.mock.calls.filter((c: any) => c[0] === 'record_live_session_join')).toHaveLength(2)

      // Now join 1 finishes (settles): its finally block runs!
      // In the buggy code, finally only checked sessionId & userId, which wiped out inFlightJoinRef
      await act(async () => {
        join1Deferred.resolve({
          data: {
            success: true,
            interval_id: validIntervalId1,
            session_id: validSessionId1,
            user_id: validUserId,
            connection_id: validConnId1,
            role: 'student',
            is_late: false,
          },
          error: null,
        })
        await Promise.resolve()
      })

      // Another re-render occurs while join 2 is still in-flight
      rerender({ connectionId: validConnId2 })
      await act(async () => {
        await Promise.resolve()
      })

      // MUST NOT have dispatched a duplicate 3rd join call because inFlightJoinRef still protected validConnId2
      expect(
        mockRpc.mock.calls.filter((c: any) => c[0] === 'record_live_session_join')
      ).toHaveLength(2)

      // Now join 2 resolves
      await act(async () => {
        join2Deferred.resolve({
          data: {
            success: true,
            interval_id: validIntervalId2,
            session_id: validSessionId1,
            user_id: validUserId,
            connection_id: validConnId2,
            role: 'student',
            is_late: false,
          },
          error: null,
        })
        await Promise.resolve()
      })

      expect(result.current.intervalId).toBe(validIntervalId2)
      expect(result.current.isTracking).toBe(true)
    })

    // REGRESSION 9: Pre-ping guard in stale timer callback executes and safely returns without cancelling the newer session timer
    it('Regression 9: pre-ping guard in stale timer callback executes and safely returns without cancelling the newer session timer', async () => {
      let capturedSession1Callback: (() => Promise<void>) | null = null
      const originalSetInterval = window.setInterval
      const setIntervalSpy = vi.spyOn(window, 'setInterval').mockImplementation(((cb: any, ms: any) => {
        if (!capturedSession1Callback && ms === ATTENDANCE_HEARTBEAT_INTERVAL_MS) {
          capturedSession1Callback = cb
        }
        return originalSetInterval(cb, ms)
      }) as any)

      mockRpc = vi.fn().mockImplementation((fnName: string, args: any) => {
        if (fnName === 'record_live_session_join') {
          return Promise.resolve({
            data: {
              success: true,
              interval_id:
                args.p_session_id === validSessionId2 ? validIntervalId2 : validIntervalId1,
              session_id: args.p_session_id,
              user_id: validUserId,
              connection_id: args.p_connection_id,
              role: 'student',
              is_late: false,
            },
            error: null,
          })
        }
        if (fnName === 'ping_live_session_attendance') {
          return Promise.resolve({ data: { success: true }, error: null })
        }
        if (fnName === 'record_live_session_leave') {
          return Promise.resolve({ data: { success: true }, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })
      mockClient = { rpc: mockRpc } as unknown as SupabaseClient

      const { result, rerender } = renderHook(
        ({ sessionId }) =>
          useLiveAttendance({
            sessionId,
            userId: validUserId,
            isConnected: true,
            supabaseClient: mockClient,
          }),
        { initialProps: { sessionId: validSessionId1 } }
      )

      await act(async () => {
        await Promise.resolve()
      })
      expect(result.current.intervalId).toBe(validIntervalId1)
      expect(capturedSession1Callback).toBeDefined()

      // Switch to session 2 (this increments generation and creates a newer timer for session 2)
      rerender({ sessionId: validSessionId2 })
      await act(async () => {
        await Promise.resolve()
      })
      expect(result.current.intervalId).toBe(validIntervalId2)

      // Genuinely execute the stale Session 1 timer callback!
      // Its pre-ping guard will detect that generation/session has changed, and return without modifying session 2's timer!
      await act(async () => {
        await capturedSession1Callback!()
      })

      // Ensure Session 1's callback did not ping
      const session1Pings = mockRpc.mock.calls.filter(
        (c: any) =>
          c[0] === 'ping_live_session_attendance' &&
          c[1]?.p_interval_id === validIntervalId1
      )
      expect(session1Pings).toHaveLength(0)

      // Advance 30s: Session 2 timer fires its own callback normally and pings on cadence
      await act(async () => {
        vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
        await Promise.resolve()
      })

      const session2Pings = mockRpc.mock.calls.filter(
        (c: any) =>
          c[0] === 'ping_live_session_attendance' &&
          c[1]?.p_interval_id === validIntervalId2
      )
      expect(session2Pings).toHaveLength(1)

      // Advance another 30s: Session 2 pings again
      await act(async () => {
        vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
        await Promise.resolve()
      })
      const session2PingsAfter = mockRpc.mock.calls.filter(
        (c: any) =>
          c[0] === 'ping_live_session_attendance' &&
          c[1]?.p_interval_id === validIntervalId2
      )
      expect(session2PingsAfter).toHaveLength(2)

      setIntervalSpy.mockRestore()
    })

    // REGRESSION 10: Stale join does not close active reused interval, but genuinely abandoned intervals are closed
    it('Regression 10: stale join does not close an interval reused and adopted by current context, while genuinely abandoned intervals are closed', async () => {
      const joinA1Deferred = createDeferred<any>()
      const joinBDeferred = createDeferred<any>()
      const joinA2Deferred = createDeferred<any>()

      let joinCallCount = 0
      mockRpc = vi.fn().mockImplementation((fnName: string, args: any) => {
        if (fnName === 'record_live_session_join') {
          joinCallCount++
          if (joinCallCount === 1) {
            // First join for Session A
            return joinA1Deferred.promise
          }
          if (joinCallCount === 2) {
            // Join for Session B
            return joinBDeferred.promise
          }
          if (joinCallCount === 3) {
            // Second join for Session A (reconnecting/re-entering)
            return joinA2Deferred.promise
          }
        }
        if (fnName === 'ping_live_session_attendance') {
          return Promise.resolve({ data: { success: true }, error: null })
        }
        if (fnName === 'record_live_session_leave') {
          return Promise.resolve({ data: { success: true }, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })
      mockClient = { rpc: mockRpc } as unknown as SupabaseClient

      const { result, rerender } = renderHook(
        ({ sessionId }) =>
          useLiveAttendance({
            sessionId,
            userId: validUserId,
            isConnected: true,
            supabaseClient: mockClient,
          }),
        { initialProps: { sessionId: validSessionId1 } }
      )

      await act(async () => {
        await Promise.resolve()
      })
      // Step 1: Session A join request 1 remains pending
      expect(mockRpc).toHaveBeenCalledWith('record_live_session_join', {
        p_session_id: validSessionId1,
        p_connection_id: expect.any(String),
      })
      expect(result.current.intervalId).toBeNull()

      // Step 2: Switch to Session B
      rerender({ sessionId: validSessionId2 })
      await act(async () => {
        await Promise.resolve()
      })
      expect(mockRpc).toHaveBeenCalledWith('record_live_session_join', {
        p_session_id: validSessionId2,
        p_connection_id: expect.any(String),
      })

      // Step 3: Switch back to Session A using the same user and connection ID
      rerender({ sessionId: validSessionId1 })
      await act(async () => {
        await Promise.resolve()
      })
      expect(joinCallCount).toBe(3)

      // Step 4: Allow Session A's newer join (joinA2) to resolve and become active
      // The backend reuses open interval validIntervalId1 for this session/user/connection
      await act(async () => {
        joinA2Deferred.resolve({
          data: {
            success: true,
            interval_id: validIntervalId1,
            session_id: validSessionId1,
            user_id: validUserId,
            connection_id: getTabConnectionId(),
            role: 'student',
            is_late: false,
          },
          error: null,
        })
        await Promise.resolve()
      })

      // Session A is now active with validIntervalId1
      expect(result.current.intervalId).toBe(validIntervalId1)
      expect(result.current.isTracking).toBe(true)

      // Step 5: Resolve the older Session A join (joinA1) afterward with the same interval ID
      await act(async () => {
        joinA1Deferred.resolve({
          data: {
            success: true,
            interval_id: validIntervalId1,
            session_id: validSessionId1,
            user_id: validUserId,
            connection_id: getTabConnectionId(),
            role: 'student',
            is_late: false,
          },
          error: null,
        })
        await Promise.resolve()
      })

      // ASSERT 1: The stale result does not close the interval adopted by the current context
      const leaveInterval1Calls = mockRpc.mock.calls.filter(
        (c: any) =>
          c[0] === 'record_live_session_leave' &&
          c[1]?.p_interval_id === validIntervalId1
      )
      expect(leaveInterval1Calls).toHaveLength(0)

      // ASSERT 2: The active interval remains correct and tracking remains true
      expect(result.current.intervalId).toBe(validIntervalId1)
      expect(result.current.isTracking).toBe(true)

      // ASSERT 3: Heartbeats continue for that interval on cadence
      await act(async () => {
        vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
        await Promise.resolve()
      })
      expect(mockRpc).toHaveBeenCalledWith('ping_live_session_attendance', {
        p_interval_id: validIntervalId1,
      })

      await act(async () => {
        vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
        await Promise.resolve()
      })
      const pingsInterval1 = mockRpc.mock.calls.filter(
        (c: any) =>
          c[0] === 'ping_live_session_attendance' &&
          c[1]?.p_interval_id === validIntervalId1
      )
      expect(pingsInterval1.length).toBeGreaterThanOrEqual(2)

      // ASSERT 4: Genuinely abandoned intervals are still closed
      // Resolve Session B's delayed join (joinB) for validIntervalId2
      await act(async () => {
        joinBDeferred.resolve({
          data: {
            success: true,
            interval_id: validIntervalId2,
            session_id: validSessionId2,
            user_id: validUserId,
            connection_id: getTabConnectionId(),
            role: 'student',
            is_late: false,
          },
          error: null,
        })
        await Promise.resolve()
      })

      // Because Session B was genuinely abandoned, recordLiveSessionLeave must be called for validIntervalId2
      expect(mockRpc).toHaveBeenCalledWith('record_live_session_leave', {
        p_interval_id: validIntervalId2,
      })
      // Meanwhile, validIntervalId1 was STILL never closed!
      expect(
        mockRpc.mock.calls.filter(
          (c: any) =>
            c[0] === 'record_live_session_leave' &&
            c[1]?.p_interval_id === validIntervalId1
        )
      ).toHaveLength(0)
    })

    // REGRESSION 11: Stale join settling while newer join is pending does not clear in-flight join ownership
    it('Regression 11: stale join settling does not clear newer in-flight join ownership across reconnect', async () => {
      const joinA1Deferred = createDeferred<any>()
      const joinBDeferred = createDeferred<any>()
      const joinA2Deferred = createDeferred<any>()

      let joinCallCount = 0
      mockRpc = vi.fn().mockImplementation((fnName: string, args: any) => {
        if (fnName === 'record_live_session_join') {
          joinCallCount++
          if (joinCallCount === 1) {
            return joinA1Deferred.promise
          }
          if (joinCallCount === 2) {
            return joinBDeferred.promise
          }
          if (joinCallCount === 3) {
            return joinA2Deferred.promise
          }
          return Promise.resolve({ data: null, error: null })
        }
        if (fnName === 'ping_live_session_attendance') {
          return Promise.resolve({ data: { success: true }, error: null })
        }
        if (fnName === 'record_live_session_leave') {
          return Promise.resolve({ data: { success: true }, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })
      mockClient = { rpc: mockRpc } as unknown as SupabaseClient

      // Step 1: Start deferred join A1
      const { result, rerender } = renderHook(
        ({ sessionId, isConnected }) =>
          useLiveAttendance({
            sessionId,
            userId: validUserId,
            isConnected,
            supabaseClient: mockClient,
          }),
        { initialProps: { sessionId: validSessionId1, isConnected: true } }
      )

      await act(async () => {
        await Promise.resolve()
      })
      expect(joinCallCount).toBe(1)
      expect(result.current.intervalId).toBeNull()

      // Step 2: Switch to B
      rerender({ sessionId: validSessionId2, isConnected: true })
      await act(async () => {
        await Promise.resolve()
      })
      expect(joinCallCount).toBe(2)

      // Step 3: Switch back to A with the same user and connection ID
      rerender({ sessionId: validSessionId1, isConnected: true })
      await act(async () => {
        await Promise.resolve()
      })
      expect(joinCallCount).toBe(3)

      // Step 4 & 5: Keep join A2 pending, and resolve A1 while A2 is still pending
      await act(async () => {
        joinA1Deferred.resolve({
          data: {
            success: true,
            interval_id: validIntervalId1,
            session_id: validSessionId1,
            user_id: validUserId,
            connection_id: getTabConnectionId(),
            role: 'student',
            is_late: false,
          },
          error: null,
        })
        await Promise.resolve()
      })

      // While A2 is still pending, A1's finally block has run.
      // Interval must not yet be adopted, and A1 must not have closed validIntervalId1
      expect(result.current.intervalId).toBeNull()
      expect(
        mockRpc.mock.calls.filter(
          (c: any) =>
            c[0] === 'record_live_session_leave' &&
            c[1]?.p_interval_id === validIntervalId1
        )
      ).toHaveLength(0)

      // Step 6: Trigger disconnect/reconnect while A2 remains pending
      rerender({ sessionId: validSessionId1, isConnected: false })
      await act(async () => {
        await Promise.resolve()
      })
      rerender({ sessionId: validSessionId1, isConnected: true })
      await act(async () => {
        await Promise.resolve()
      })

      // Step 7: Verify A1's finally block has not cleared A2's ownership and NO duplicate join RPC is issued!
      expect(joinCallCount).toBe(3)

      // Step 8: Resolve A2 and verify correct interval adoption and heartbeats
      await act(async () => {
        joinA2Deferred.resolve({
          data: {
            success: true,
            interval_id: validIntervalId1,
            session_id: validSessionId1,
            user_id: validUserId,
            connection_id: getTabConnectionId(),
            role: 'student',
            is_late: false,
          },
          error: null,
        })
        await Promise.resolve()
      })

      expect(result.current.intervalId).toBe(validIntervalId1)
      expect(result.current.isTracking).toBe(true)

      // Heartbeats continue on cadence
      await act(async () => {
        vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
        await Promise.resolve()
      })
      expect(mockRpc).toHaveBeenCalledWith('ping_live_session_attendance', {
        p_interval_id: validIntervalId1,
      })

      await act(async () => {
        vi.advanceTimersByTime(ATTENDANCE_HEARTBEAT_INTERVAL_MS)
        await Promise.resolve()
      })
      const pings = mockRpc.mock.calls.filter(
        (c: any) =>
          c[0] === 'ping_live_session_attendance' &&
          c[1]?.p_interval_id === validIntervalId1
      )
      expect(pings.length).toBeGreaterThanOrEqual(2)
    })
  })
})

