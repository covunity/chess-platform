import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase as defaultSupabase } from './supabase'
import {
  type LiveSession,
  type LiveSessionRow,
  type LiveSessionStatus,
  type LiveSessionStaff,
  type LiveSessionStaffRow,
  type CreateLiveSessionInput,
  type UpdateLiveSessionInput,
  mapLiveSessionRow,
  mapLiveSessionStaffRow,
} from '../types/liveSession'

/**
 * Generate a canonical LiveKit room name for a live session.
 * Pattern: live-course-{courseId}-session-{sessionId}
 */
export function generateSessionRoomName(courseId: string, sessionId: string): string {
  return `live-course-${courseId}-session-${sessionId}`
}

/**
 * List live sessions for a course, ordered chronologically by scheduled_start_at.
 * For public students, RLS ensures only non-draft sessions of published/enrolled courses are returned.
 */
export async function listLiveSessions(
  client: SupabaseClient = defaultSupabase,
  courseId: string
): Promise<{ sessions: LiveSession[]; error: Error | null }> {
  try {
    const { data, error } = await client
      .from('live_sessions')
      .select(`
        *,
        lessons:lesson_id ( id, title ),
        courses:course_id ( id, title, creator_id )
      `)
      .eq('course_id', courseId)
      .order('scheduled_start_at', { ascending: true })

    if (error) throw error

    const sessions = (data as unknown as LiveSessionRow[] || []).map(mapLiveSessionRow)
    return { sessions, error: null }
  } catch (err: unknown) {
    return { sessions: [], error: err as Error }
  }
}

/**
 * Get a single live session by ID.
 */
export async function getLiveSession(
  client: SupabaseClient = defaultSupabase,
  sessionId: string
): Promise<{ session: LiveSession | null; error: Error | null }> {
  try {
    const { data, error } = await client
      .from('live_sessions')
      .select(`
        *,
        lessons:lesson_id ( id, title ),
        courses:course_id ( id, title, creator_id )
      `)
      .eq('id', sessionId)
      .maybeSingle()

    if (error) throw error
    if (!data) return { session: null, error: null }

    return { session: mapLiveSessionRow(data as unknown as LiveSessionRow), error: null }
  } catch (err: unknown) {
    return { session: null, error: err as Error }
  }
}

/**
 * Create a new scheduled live session.
 * Generates an authoritative session ID and unique LiveKit room name.
 * Only DRAFT or SCHEDULED sessions can be created.
 */
export async function createLiveSession(
  client: SupabaseClient = defaultSupabase,
  input: CreateLiveSessionInput
): Promise<{ session: LiveSession | null; error: Error | null }> {
  try {
    if (!input.title || !input.title.trim()) {
      throw new Error('Session title is required')
    }
    if (!input.scheduledStartAt) {
      throw new Error('Scheduled start time is required')
    }
    if (input.scheduledEndAt && new Date(input.scheduledEndAt) <= new Date(input.scheduledStartAt)) {
      throw new Error('Scheduled end time must be after start time')
    }
    if (input.maxParticipants !== undefined && input.maxParticipants !== null && input.maxParticipants <= 0) {
      throw new Error('Max participants must be greater than 0')
    }
    if (input.status && input.status !== 'DRAFT' && input.status !== 'SCHEDULED') {
      throw new Error(`Cannot create session in status '${input.status}'. New sessions can only be created as DRAFT or SCHEDULED.`)
    }

    const sessionId = crypto.randomUUID()
    const livekitRoomName = generateSessionRoomName(input.courseId, sessionId)

    const insertPayload = {
      id: sessionId,
      course_id: input.courseId,
      lesson_id: input.lessonId || null,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      scheduled_start_at: input.scheduledStartAt,
      scheduled_end_at: input.scheduledEndAt || null,
      timezone: input.timezone || 'Asia/Ho_Chi_Minh',
      status: input.status || 'SCHEDULED',
      agenda: input.agenda || [],
      learning_objectives: input.learningObjectives || [],
      preparation_notes: input.preparationNotes?.trim() || null,
      max_participants: input.maxParticipants || null,
      livekit_room_name: livekitRoomName,
    }

    const { data, error } = await client
      .from('live_sessions')
      .insert(insertPayload)
      .select(`
        *,
        lessons:lesson_id ( id, title ),
        courses:course_id ( id, title, creator_id )
      `)
      .single()

    if (error) throw error

    return { session: mapLiveSessionRow(data as unknown as LiveSessionRow), error: null }
  } catch (err: unknown) {
    return { session: null, error: err as Error }
  }
}

/**
 * Update an existing live session.
 * Server-owned lifecycle fields (status, livekit_room_name, started_at, ended_at)
 * CANNOT be modified via updateLiveSession().
 */
export async function updateLiveSession(
  client: SupabaseClient = defaultSupabase,
  sessionId: string,
  input: UpdateLiveSessionInput,
  currentStatus?: LiveSessionStatus
): Promise<{ session: LiveSession | null; error: Error | null }> {
  try {
    if (currentStatus === 'ENDED' || currentStatus === 'CANCELLED') {
      throw new Error(`Cannot modify session in ${currentStatus} status. Session is read-only.`)
    }
    if (currentStatus === 'LIVE') {
      if (input.lessonId !== undefined) {
        throw new Error('Cannot change lesson while session is in LIVE status')
      }
      if (input.scheduledStartAt !== undefined) {
        throw new Error('Cannot change scheduled start time while session is in LIVE status')
      }
      if (input.scheduledEndAt !== undefined) {
        throw new Error('Cannot change scheduled end time while session is in LIVE status')
      }
    }

    if (input.title !== undefined && !input.title.trim()) {
      throw new Error('Session title cannot be empty')
    }
    if (input.scheduledStartAt && input.scheduledEndAt) {
      if (new Date(input.scheduledEndAt) <= new Date(input.scheduledStartAt)) {
        throw new Error('Scheduled end time must be after start time')
      }
    }
    if (input.maxParticipants !== undefined && input.maxParticipants !== null && input.maxParticipants <= 0) {
      throw new Error('Max participants must be greater than 0')
    }

    const updatePayload: Record<string, unknown> = {}
    if (input.title !== undefined) updatePayload.title = input.title.trim()
    if (input.description !== undefined) updatePayload.description = input.description?.trim() || null
    if (input.lessonId !== undefined) updatePayload.lesson_id = input.lessonId || null
    if (input.scheduledStartAt !== undefined) updatePayload.scheduled_start_at = input.scheduledStartAt
    if (input.scheduledEndAt !== undefined) updatePayload.scheduled_end_at = input.scheduledEndAt
    if (input.timezone !== undefined) updatePayload.timezone = input.timezone
    if (input.agenda !== undefined) updatePayload.agenda = input.agenda
    if (input.learningObjectives !== undefined) updatePayload.learning_objectives = input.learningObjectives
    if (input.preparationNotes !== undefined) updatePayload.preparation_notes = input.preparationNotes?.trim() || null
    if (input.maxParticipants !== undefined) updatePayload.max_participants = input.maxParticipants

    const { data, error } = await client
      .from('live_sessions')
      .update(updatePayload)
      .eq('id', sessionId)
      .select(`
        *,
        lessons:lesson_id ( id, title ),
        courses:course_id ( id, title, creator_id )
      `)
      .single()

    if (error) throw error

    return { session: mapLiveSessionRow(data as unknown as LiveSessionRow), error: null }
  } catch (err: unknown) {
    return { session: null, error: err as Error }
  }
}

/**
 * Delete a live session.
 * Business rule: Only DRAFT sessions can be deleted.
 * For SCHEDULED sessions, use cancelLiveSession().
 * LIVE, ENDED, and CANCELLED sessions cannot be deleted.
 */
export async function deleteLiveSession(
  client: SupabaseClient = defaultSupabase,
  sessionId: string,
  currentStatus?: LiveSessionStatus
): Promise<{ success: boolean; error: Error | null }> {
  try {
    let sessionStatus = currentStatus
    if (!sessionStatus) {
      const { data: sessionData, error: fetchError } = await client
        .from('live_sessions')
        .select('status')
        .eq('id', sessionId)
        .maybeSingle()

      if (fetchError) throw fetchError
      if (!sessionData) {
        throw new Error('Session not found')
      }
      sessionStatus = sessionData.status
    }

    if (sessionStatus !== 'DRAFT') {
      throw new Error(
        `Cannot delete session in ${sessionStatus} status. Only DRAFT sessions can be deleted. Use cancelLiveSession() for SCHEDULED sessions.`
      )
    }

    const { error } = await client
      .from('live_sessions')
      .delete()
      .eq('id', sessionId)

    if (error) throw error
    return { success: true, error: null }
  } catch (err: unknown) {
    return { success: false, error: err as Error }
  }
}

/**
 * Start a live session (Server-controlled transition to LIVE via RPC).
 */
export async function startLiveSession(
  client: SupabaseClient = defaultSupabase,
  sessionId: string
): Promise<{ success: boolean; data?: Record<string, unknown>; error: Error | null }> {
  try {
    const { data, error } = await client.rpc('start_live_session', {
      p_session_id: sessionId,
    })

    if (error) throw error
    return { success: true, data: data as Record<string, unknown>, error: null }
  } catch (err: unknown) {
    return { success: false, error: err as Error }
  }
}

/**
 * End a live session (Server-controlled transition to ENDED via RPC).
 */
export async function endLiveSession(
  client: SupabaseClient = defaultSupabase,
  sessionId: string
): Promise<{ success: boolean; data?: Record<string, unknown>; error: Error | null }> {
  try {
    const { data, error } = await client.rpc('end_live_session', {
      p_session_id: sessionId,
    })

    if (error) throw error
    return { success: true, data: data as Record<string, unknown>, error: null }
  } catch (err: unknown) {
    return { success: false, error: err as Error }
  }
}

/**
 * Cancel a live session (Server-controlled transition to CANCELLED via RPC).
 */
export async function cancelLiveSession(
  client: SupabaseClient = defaultSupabase,
  sessionId: string
): Promise<{ success: boolean; data?: Record<string, unknown>; error: Error | null }> {
  try {
    const { data, error } = await client.rpc('cancel_live_session', {
      p_session_id: sessionId,
    })

    if (error) throw error
    return { success: true, data: data as Record<string, unknown>, error: null }
  } catch (err: unknown) {
    return { success: false, error: err as Error }
  }
}

/**
 * List staff (assistants) assigned to a live session.
 */
export async function listLiveSessionStaff(
  client: SupabaseClient = defaultSupabase,
  sessionId: string
): Promise<{ staff: LiveSessionStaff[]; error: Error | null }> {
  try {
    const { data, error } = await client.rpc('get_live_session_staff', {
      p_session_id: sessionId,
    })

    if (error) throw error
    const staff = (data as unknown as LiveSessionStaffRow[] || []).map(mapLiveSessionStaffRow)
    return { staff, error: null }
  } catch (err: unknown) {
    return { staff: [], error: err as Error }
  }
}

/**
 * Add an assistant to a live session.
 */
export async function addLiveSessionAssistant(
  client: SupabaseClient = defaultSupabase,
  sessionId: string,
  userId: string
): Promise<{ success: boolean; data?: Record<string, unknown>; error: Error | null }> {
  try {
    const { data, error } = await client.rpc('add_live_session_assistant', {
      p_session_id: sessionId,
      p_user_id: userId,
    })

    if (error) throw error
    return { success: true, data: data as Record<string, unknown>, error: null }
  } catch (err: unknown) {
    return { success: false, error: err as Error }
  }
}

/**
 * Remove an assistant from a live session.
 */
export async function removeLiveSessionAssistant(
  client: SupabaseClient = defaultSupabase,
  sessionId: string,
  userId: string
): Promise<{ success: boolean; error: Error | null }> {
  try {
    const { error } = await client.rpc('remove_live_session_assistant', {
      p_session_id: sessionId,
      p_user_id: userId,
    })

    if (error) throw error
    return { success: true, error: null }
  } catch (err: unknown) {
    return { success: false, error: err as Error }
  }
}

/**
 * Lookup user by email/name/ID for assistant assignment.
 */
export async function lookupUserForAssistant(
  client: SupabaseClient = defaultSupabase,
  query: string
): Promise<{ users: { id: string; name: string; email: string }[]; error: Error | null }> {
  try {
    const { data, error } = await client.rpc('lookup_user_for_assistant', {
      p_query: query,
    })

    if (error) throw error
    return { users: (data || []) as { id: string; name: string; email: string }[], error: null }
  } catch (err: unknown) {
    return { users: [], error: err as Error }
  }
}

