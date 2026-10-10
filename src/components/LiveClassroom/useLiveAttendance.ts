import { useEffect, useState, useCallback, useRef } from 'react'
import { useMaybeRoomContext } from '@livekit/components-react'
import { ConnectionState, RoomEvent } from 'livekit-client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import {
  recordLiveSessionJoin,
  pingLiveSessionAttendance,
  recordLiveSessionLeave,
  isValidUuid,
} from '../../lib/liveAttendanceApi'
import type { JoinAttendanceResult } from '../../types/liveAttendance'

export const ATTENDANCE_HEARTBEAT_INTERVAL_MS = 30_000 // 30 seconds

let tabConnectionId: string | null = null

/**
 * Returns a persistent connection ID for the current browser page load / tab lifecycle.
 * A full page reload re-executes module initialization and generates a new UUID.
 * An in-tab reconnect, re-render, or component remount reuses the same connection ID.
 */
export function getTabConnectionId(): string {
  if (!tabConnectionId) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      tabConnectionId = crypto.randomUUID()
    } else {
      tabConnectionId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
      })
    }
  }
  return tabConnectionId
}

/**
 * Reset or set the tab connection ID. Primarily for test isolation.
 */
export function resetTabConnectionIdForTest(id?: string | null): string {
  tabConnectionId = id ?? null
  return id ?? getTabConnectionId()
}

export interface UseLiveAttendanceOptions {
  /** Target live session UUID */
  sessionId?: string | null
  /** Current participant user UUID */
  userId?: string | null
  /**
   * Explicit connection state override (useful in tests or headless runners).
   * When omitted, automatically inspects LiveKit Room context.
   */
  isConnected?: boolean
  /** Custom Supabase client instance (defaults to shared app client) */
  supabaseClient?: SupabaseClient
  /** Explicit connection UUID override */
  connectionId?: string
  /** Attendance heartbeat cadence in milliseconds (defaults to 30,000ms / 30s) */
  pingIntervalMs?: number
  /** Callback for non-fatal RPC warnings and failures */
  onError?: (error: Error) => void
}

export interface UseLiveAttendanceReturn {
  /** The active interval ID on the server, or null if inactive */
  intervalId: string | null
  /** Whether attendance is actively tracked with running heartbeats */
  isTracking: boolean
  /** Connection UUID used for this tab */
  connectionId: string
  /** Graceful leave handler to call when intentionally exiting the classroom */
  leave: () => Promise<void>
}

/**
 * Hook to automatically record attendance join, send periodic heartbeats (30s),
 * and record graceful leave when leaving a live session.
 * Hardened against race conditions, identity changes, and delayed responses.
 */
export function useLiveAttendance(options: UseLiveAttendanceOptions): UseLiveAttendanceReturn {
  const {
    sessionId,
    userId,
    isConnected: explicitIsConnected,
    supabaseClient,
    connectionId: explicitConnectionId,
    pingIntervalMs = ATTENDANCE_HEARTBEAT_INTERVAL_MS,
    onError,
  } = options

  const client = supabaseClient || supabase
  const effectiveConnectionId = explicitConnectionId || getTabConnectionId()

  const maybeRoom = useMaybeRoomContext()
  const [roomState, setRoomState] = useState<ConnectionState | string>(
    maybeRoom?.state ?? ConnectionState.Disconnected
  )

  useEffect(() => {
    if (!maybeRoom) return
    setRoomState(maybeRoom.state)

    const handleStateChange = (state: ConnectionState) => {
      setRoomState(state)
    }

    if (typeof maybeRoom.on === 'function') {
      maybeRoom.on(RoomEvent.ConnectionStateChanged, handleStateChange)
      return () => {
        maybeRoom.off?.(RoomEvent.ConnectionStateChanged, handleStateChange)
      }
    }
  }, [maybeRoom])

  const isConnected =
    typeof explicitIsConnected === 'boolean'
      ? explicitIsConnected
      : roomState === ConnectionState.Connected || roomState === 'connected'

  const [intervalId, setIntervalId] = useState<string | null>(null)
  const [isTracking, setIsTracking] = useState<boolean>(false)

  // Track latest synchronous connection state for in-flight callbacks (BLOCKER A)
  const isConnectedRef = useRef<boolean>(isConnected)
  isConnectedRef.current = isConnected

  // Lifecycle guards and generation counter (BLOCKER B, C)
  const generationRef = useRef<number>(0)
  const isMountedRef = useRef<boolean>(true)
  const activeIntervalIdRef = useRef<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const activeUserIdRef = useRef<string | null>(null)
  /**
   * Tab connection ID is stable across the tab lifecycle. If an explicit
   * connectionId is passed and changes while mounted, it is handled explicitly
   * as a lifecycle context change: the previous interval is gracefully left,
   * generation is incremented, and a new join is initiated.
   */
  const activeConnectionIdRef = useRef<string | null>(null)

  interface HeartbeatTimerRecord {
    token: number
    intervalHandle: ReturnType<typeof setInterval>
  }
  const timerCounterRef = useRef<number>(0)
  const heartbeatTimerRef = useRef<HeartbeatTimerRecord | null>(null)

  // Deduplication for in-flight join: keyed on (sessionId, userId, connectionId) with exact requestId ownership
  const joinRequestCounterRef = useRef<number>(0)
  const inFlightJoinRef = useRef<{
    requestId: number
    sessionId: string
    userId: string
    connectionId: string
    promise: Promise<JoinAttendanceResult | null>
  } | null>(null)

  const pendingLeaveTaskRef = useRef<{
    intervalId: string
    cancelled: boolean
  } | null>(null)

  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const stopHeartbeat = useCallback((expectedToken?: number) => {
    if (!heartbeatTimerRef.current) return
    if (expectedToken !== undefined && heartbeatTimerRef.current.token !== expectedToken) {
      // Stale timer callback: does not own current timer, do not clear
      return
    }
    clearInterval(heartbeatTimerRef.current.intervalHandle)
    heartbeatTimerRef.current = null
  }, [])

  const startHeartbeat = useCallback(
    (
      targetIntervalId: string,
      targetSessionId: string,
      targetUserId: string,
      targetGeneration: number
    ) => {
      stopHeartbeat()

      const token = ++timerCounterRef.current
      const intervalHandle = setInterval(async () => {
        // Pre-ping guard: verify timer belongs to current generation, session, user, interval, connection, and timer token
        if (
          !isMountedRef.current ||
          generationRef.current !== targetGeneration ||
          activeSessionIdRef.current !== targetSessionId ||
          activeUserIdRef.current !== targetUserId ||
          activeIntervalIdRef.current !== targetIntervalId ||
          !isConnectedRef.current ||
          heartbeatTimerRef.current?.token !== token
        ) {
          // Clear this timer's own handle so stale timer stops repeating
          clearInterval(intervalHandle)
          // Only the timer that still owns heartbeatTimerRef may clear it
          if (heartbeatTimerRef.current?.token === token) {
            heartbeatTimerRef.current = null
          }
          return
        }

        try {
          const { success, error } = await pingLiveSessionAttendance(client, targetIntervalId)

          // Post-ping guard: ensure session, user, interval, generation, or timer token did not change during network call
          if (
            !isMountedRef.current ||
            generationRef.current !== targetGeneration ||
            activeSessionIdRef.current !== targetSessionId ||
            activeUserIdRef.current !== targetUserId ||
            activeIntervalIdRef.current !== targetIntervalId ||
            heartbeatTimerRef.current?.token !== token
          ) {
            // Stale ping response: do not modify current session state or stop newer timers
            return
          }

          if (error) {
            console.warn('Attendance heartbeat ping error:', error)
            onErrorRef.current?.(error)
          } else if (!success) {
            if (import.meta.env.DEV) {
              console.warn(
                'Attendance heartbeat ping unsuccessful for interval:',
                targetIntervalId
              )
            }
            // Server reported interval closed or session ended for this specific interval
            stopHeartbeat(token)
            setIsTracking(false)
          }
        } catch (err) {
          if (
            !isMountedRef.current ||
            generationRef.current !== targetGeneration ||
            activeSessionIdRef.current !== targetSessionId ||
            activeUserIdRef.current !== targetUserId ||
            activeIntervalIdRef.current !== targetIntervalId ||
            heartbeatTimerRef.current?.token !== token
          ) {
            return
          }
          const error = err instanceof Error ? err : new Error(String(err))
          console.warn('Attendance heartbeat ping threw error:', error)
          onErrorRef.current?.(error)
        }
      }, pingIntervalMs)

      heartbeatTimerRef.current = {
        token,
        intervalHandle,
      }
    },
    [client, pingIntervalMs, stopHeartbeat]
  )

  const leave = useCallback(async () => {
    stopHeartbeat()
    generationRef.current++
    inFlightJoinRef.current = null

    if (pendingLeaveTaskRef.current) {
      pendingLeaveTaskRef.current.cancelled = true
      pendingLeaveTaskRef.current = null
    }

    const intervalToLeave = activeIntervalIdRef.current
    activeIntervalIdRef.current = null
    activeSessionIdRef.current = null
    activeUserIdRef.current = null
    activeConnectionIdRef.current = null
    setIntervalId(null)
    setIsTracking(false)

    if (intervalToLeave && isValidUuid(intervalToLeave)) {
      try {
        await recordLiveSessionLeave(client, intervalToLeave)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        console.warn('Failed to record live session leave:', error)
        onErrorRef.current?.(error)
      }
    }
  }, [client, stopHeartbeat])

  // Browser pagehide listener: best-effort leave on tab close
  useEffect(() => {
    const handlePageHide = () => {
      const currentInterval = activeIntervalIdRef.current
      if (currentInterval && isValidUuid(currentInterval)) {
        recordLiveSessionLeave(client, currentInterval).catch(() => {})
      }
    }

    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [client])

  // Main lifecycle effect
  useEffect(() => {
    isMountedRef.current = true

    // If a microtask leave was queued by StrictMode cleanup in this frame, cancel it
    if (pendingLeaveTaskRef.current) {
      pendingLeaveTaskRef.current.cancelled = true
      pendingLeaveTaskRef.current = null
    }

    const isValidSession = Boolean(sessionId && isValidUuid(sessionId))
    const isValidUser = Boolean(userId && isValidUuid(userId))

    // BLOCKER B & C: Check for session switch, identity change, or explicit connectionId change
    const sessionChanged =
      activeSessionIdRef.current !== null && activeSessionIdRef.current !== sessionId
    const userChanged =
      activeUserIdRef.current !== null && activeUserIdRef.current !== userId
    const connectionChanged =
      activeConnectionIdRef.current !== null &&
      activeConnectionIdRef.current !== effectiveConnectionId

    if (sessionChanged || userChanged || connectionChanged) {
      stopHeartbeat()
      generationRef.current++
      inFlightJoinRef.current = null

      const prevIntervalId = activeIntervalIdRef.current
      activeIntervalIdRef.current = null
      setIntervalId(null)
      setIsTracking(false)

      if (prevIntervalId && isValidUuid(prevIntervalId)) {
        recordLiveSessionLeave(client, prevIntervalId).catch((err) => {
          console.warn('Failed to leave previous live session interval on switch:', err)
        })
      }

      activeSessionIdRef.current = null
      activeUserIdRef.current = null
      activeConnectionIdRef.current = null
    }

    // Inactive conditions: invalid session or invalid user
    if (!isValidSession || !isValidUser) {
      stopHeartbeat()
      generationRef.current++
      inFlightJoinRef.current = null

      const toLeave = activeIntervalIdRef.current
      activeIntervalIdRef.current = null
      activeSessionIdRef.current = null
      activeUserIdRef.current = null
      activeConnectionIdRef.current = null
      setIntervalId(null)
      setIsTracking(false)

      if (toLeave && isValidUuid(toLeave)) {
        recordLiveSessionLeave(client, toLeave).catch((err) => {
          console.warn('Failed to leave interval on invalid session/user:', err)
        })
      }
      return
    }

    const targetSessionId = sessionId!
    const targetUserId = userId!
    activeSessionIdRef.current = targetSessionId
    activeUserIdRef.current = targetUserId
    activeConnectionIdRef.current = effectiveConnectionId

    // Disconnected room state: pause heartbeats, but retain interval for in-tab reconnect
    if (!isConnected) {
      stopHeartbeat()
      setIsTracking(false)
      return
    }

    // Connected state with existing interval (reconnect or re-render)
    const currentGeneration = generationRef.current

    if (activeIntervalIdRef.current) {
      const existingIntervalId = activeIntervalIdRef.current
      setIntervalId(existingIntervalId)

      // Send immediate heartbeat check to refresh last_seen_at and confirm server-side validity
      pingLiveSessionAttendance(client, existingIntervalId)
        .then((pingRes) => {
          if (
            !isMountedRef.current ||
            generationRef.current !== currentGeneration ||
            activeSessionIdRef.current !== targetSessionId ||
            activeUserIdRef.current !== targetUserId ||
            activeConnectionIdRef.current !== effectiveConnectionId ||
            activeIntervalIdRef.current !== existingIntervalId
          ) {
            return
          }

          if (pingRes.success) {
            if (isConnectedRef.current) {
              setIsTracking(true)
              startHeartbeat(
                existingIntervalId,
                targetSessionId,
                targetUserId,
                currentGeneration
              )
            } else {
              setIsTracking(false)
              stopHeartbeat()
            }
          } else {
            // Server reported interval closed during prolonged disconnect or session ended.
            activeIntervalIdRef.current = null
            setIntervalId(null)
            setIsTracking(false)
            stopHeartbeat()

            // Do not call performJoin if disconnected. Defer rejoining until reconnected.
            if (isConnectedRef.current) {
              performJoin(
                targetSessionId,
                targetUserId,
                effectiveConnectionId,
                currentGeneration
              )
            }
          }
        })
        .catch(() => {
          if (
            !isMountedRef.current ||
            generationRef.current !== currentGeneration ||
            activeSessionIdRef.current !== targetSessionId ||
            activeUserIdRef.current !== targetUserId ||
            activeConnectionIdRef.current !== effectiveConnectionId ||
            activeIntervalIdRef.current !== existingIntervalId
          ) {
            return
          }

          if (isConnectedRef.current) {
            setIsTracking(true)
            startHeartbeat(
              existingIntervalId,
              targetSessionId,
              targetUserId,
              currentGeneration
            )
          } else {
            setIsTracking(false)
            stopHeartbeat()
          }
        })
      return
    }

    performJoin(
      targetSessionId,
      targetUserId,
      effectiveConnectionId,
      currentGeneration
    )

    function performJoin(
      targetSession: string,
      targetUser: string,
      targetConnection: string,
      targetGen: number
    ) {
      let joinPromise: Promise<JoinAttendanceResult | null>
      if (
        inFlightJoinRef.current &&
        inFlightJoinRef.current.sessionId === targetSession &&
        inFlightJoinRef.current.userId === targetUser &&
        inFlightJoinRef.current.connectionId === targetConnection
      ) {
        joinPromise = inFlightJoinRef.current.promise
      } else {
        const currentRequestId = ++joinRequestCounterRef.current
        joinPromise = (async () => {
          try {
            const { data, error } = await recordLiveSessionJoin(client, {
              sessionId: targetSession,
              connectionId: targetConnection,
            })
            if (error) {
              console.warn('recordLiveSessionJoin returned error:', error)
              onErrorRef.current?.(error)
              return null
            }
            return data
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err))
            console.warn('recordLiveSessionJoin threw error:', error)
            onErrorRef.current?.(error)
            return null
          } finally {
            if (
              inFlightJoinRef.current &&
              inFlightJoinRef.current.requestId === currentRequestId
            ) {
              inFlightJoinRef.current = null
            }
          }
        })()

        inFlightJoinRef.current = {
          requestId: currentRequestId,
          sessionId: targetSession,
          userId: targetUser,
          connectionId: targetConnection,
          promise: joinPromise,
        }
      }

      joinPromise.then((data) => {
        // Check if generation, session, user, connection, or mount status changed while join was pending
        const isStale =
          !isMountedRef.current ||
          generationRef.current !== targetGen ||
          activeSessionIdRef.current !== targetSession ||
          activeUserIdRef.current !== targetUser ||
          activeConnectionIdRef.current !== targetConnection

        if (isStale) {
          if (data?.intervalId) {
            // Check whether this interval is currently adopted or relevant to the active context:
            const isCurrentContext =
              isMountedRef.current &&
              activeSessionIdRef.current === targetSession &&
              activeUserIdRef.current === targetUser &&
              activeConnectionIdRef.current === targetConnection

            // 1. If this interval is currently active in the current context, do not close it
            if (activeIntervalIdRef.current === data.intervalId) {
              return
            }

            // 2. If a newer join for the same context is still in flight, it owns the pending request
            // and may receive or reuse this open interval; do not close it behind the in-flight join's back,
            // and do not let this stale response disrupt the newer pending request.
            const isMatchingJoinInFlight =
              isCurrentContext &&
              inFlightJoinRef.current !== null &&
              inFlightJoinRef.current.sessionId === targetSession &&
              inFlightJoinRef.current.userId === targetUser &&
              inFlightJoinRef.current.connectionId === targetConnection

            if (isMatchingJoinInFlight) {
              return
            }

            // 3. Genuinely abandoned interval created for previous context: leave it so it is not orphaned
            recordLiveSessionLeave(client, data.intervalId).catch((err) => {
              console.warn('Failed to leave orphaned interval after context change:', err)
            })
          }
          return
        }

        if (data?.intervalId) {
          activeIntervalIdRef.current = data.intervalId
          setIntervalId(data.intervalId)

          // BLOCKER A: Check if connection dropped while join was in flight
          if (isConnectedRef.current) {
            setIsTracking(true)
            startHeartbeat(
              data.intervalId,
              targetSession,
              targetUser,
              targetGen
            )
          } else {
            // Retain interval without tracking until reconnect
            setIsTracking(false)
            stopHeartbeat()
          }
        }
      })
    }

    return () => {
      isMountedRef.current = false
      stopHeartbeat()

      const intervalToLeave = activeIntervalIdRef.current
      const cleanupGen = generationRef.current

      if (intervalToLeave && isValidUuid(intervalToLeave)) {
        const leaveTask = {
          intervalId: intervalToLeave,
          cancelled: false,
        }
        pendingLeaveTaskRef.current = leaveTask

        queueMicrotask(async () => {
          if (leaveTask.cancelled) return
          if (!isMountedRef.current || generationRef.current !== cleanupGen) {
            activeIntervalIdRef.current = null
            try {
              await recordLiveSessionLeave(client, leaveTask.intervalId)
            } catch (err) {
              console.warn('Failed to record live session leave on cleanup:', err)
            }
          }
        })
      }
    }
  }, [
    sessionId,
    userId,
    isConnected,
    client,
    effectiveConnectionId,
    startHeartbeat,
    stopHeartbeat,
  ])

  return {
    intervalId,
    isTracking,
    connectionId: effectiveConnectionId,
    leave,
  }
}
