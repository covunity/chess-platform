import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  LiveSessionAttendance,
  RecordLiveSessionJoinParams,
  JoinAttendanceResult,
} from '../types/liveAttendance'

/**
 * Validates that an argument is a non-empty string UUID.
 */
export function isValidUuid(id: unknown): id is string {
  if (typeof id !== 'string') return false
  const trimmed = id.trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
}

/**
 * Record a user joining a live session.
 * Server atomically creates or reuses an attendance interval and updates the summary row.
 */
export async function recordLiveSessionJoin(
  client: SupabaseClient,
  params: RecordLiveSessionJoinParams
): Promise<{ data: JoinAttendanceResult | null; error: Error | null }> {
  if (!params || !isValidUuid(params.sessionId)) {
    return { data: null, error: new Error('sessionId must be a valid UUID') }
  }

  if (!isValidUuid(params.connectionId)) {
    return { data: null, error: new Error('connectionId must be a valid UUID') }
  }

  try {
    const { data, error } = await client.rpc('record_live_session_join', {
      p_session_id: params.sessionId,
      p_connection_id: params.connectionId,
    })

    if (error) {
      return { data: null, error: new Error(error.message) }
    }

    if (!data || !data.interval_id) {
      return { data: null, error: new Error('Failed to record session join') }
    }

    const result: JoinAttendanceResult = {
      intervalId: data.interval_id,
      sessionId: data.session_id,
      userId: data.user_id,
      connectionId: data.connection_id,
      role: data.role,
      isLate: Boolean(data.is_late),
    }

    return { data: result, error: null }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) }
  }
}

/**
 * Send a periodic attendance heartbeat to keep the interval active.
 * Heartbeat target cadence is ~30s; timeout threshold is 90s.
 */
export async function pingLiveSessionAttendance(
  client: SupabaseClient,
  intervalId: string
): Promise<{ success: boolean; error: Error | null }> {
  if (!isValidUuid(intervalId)) {
    return { success: false, error: new Error('intervalId must be a valid UUID') }
  }

  try {
    const { data, error } = await client.rpc('ping_live_session_attendance', {
      p_interval_id: intervalId,
    })

    if (error) {
      return { success: false, error: new Error(error.message) }
    }

    return { success: Boolean(data?.success), error: null }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err : new Error(String(err)) }
  }
}

/**
 * Record a user leaving the session gracefully.
 * Server records left_at = now() on the interval.
 */
export async function recordLiveSessionLeave(
  client: SupabaseClient,
  intervalId: string
): Promise<{ success: boolean; error: Error | null }> {
  if (!isValidUuid(intervalId)) {
    return { success: false, error: new Error('intervalId must be a valid UUID') }
  }

  try {
    const { data, error } = await client.rpc('record_live_session_leave', {
      p_interval_id: intervalId,
    })

    if (error) {
      return { success: false, error: new Error(error.message) }
    }

    return { success: Boolean(data?.success), error: null }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err : new Error(String(err)) }
  }
}

/**
 * Finalize attendance for a session.
 * Clamps open intervals, materializes ABSENT rows for non-attending enrollees,
 * and calculates multirange cumulative durations and statuses.
 */
export async function finalizeLiveSessionAttendance(
  client: SupabaseClient,
  sessionId: string
): Promise<{ success: boolean; sessionDurationSeconds?: number; error: Error | null }> {
  if (!isValidUuid(sessionId)) {
    return { success: false, error: new Error('sessionId must be a valid UUID') }
  }

  try {
    const { data, error } = await client.rpc('finalize_live_session_attendance', {
      p_session_id: sessionId,
    })

    if (error) {
      return { success: false, error: new Error(error.message) }
    }

    return {
      success: Boolean(data?.success),
      sessionDurationSeconds: data?.session_duration_seconds,
      error: null,
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err : new Error(String(err)) }
  }
}

/**
 * Retrieve attendance roster for a session.
 * Course creator, assistant, and admin receive the full roster.
 * Students receive only their own row.
 */
export async function getLiveSessionAttendance(
  client: SupabaseClient,
  sessionId: string
): Promise<{ data: LiveSessionAttendance[] | null; error: Error | null }> {
  if (!isValidUuid(sessionId)) {
    return { data: null, error: new Error('sessionId must be a valid UUID') }
  }

  try {
    const { data, error } = await client.rpc('get_live_session_attendance', {
      p_session_id: sessionId,
    })

    if (error) {
      return { data: null, error: new Error(error.message) }
    }

    return { data: (data ?? []) as LiveSessionAttendance[], error: null }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) }
  }
}
