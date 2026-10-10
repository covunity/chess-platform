/**
 * Live Session Layer — Type Definitions
 *
 * Course -> Chapters -> Lessons (Content)
 *        -> Live Sessions (Teaching Occurrences)
 *
 * Each scheduled live session represents one occurrence with its own
 * LiveKit room identity, agenda, learning objectives, and status lifecycle.
 */

export type LiveSessionStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'LIVE'
  | 'ENDED'
  | 'CANCELLED'

export interface LiveSessionAgendaItem {
  title: string
  duration_minutes: number
}

/** Frontend model matching Part 16 specification */
export interface LiveSession {
  id: string
  courseId: string
  lessonId: string | null
  title: string
  description: string | null
  scheduledStartAt: string
  scheduledEndAt: string | null
  timezone: string
  status: LiveSessionStatus
  agenda: LiveSessionAgendaItem[]
  learningObjectives: string[]
  preparationNotes: string | null
  maxParticipants: number | null
  livekitRoomName: string
  startedAt: string | null
  endedAt: string | null
  createdAt: string
  updatedAt: string
  // Optional joined relations
  lessonTitle?: string | null
  courseTitle?: string | null
}

/** PostgreSQL row representation in public.live_sessions */
export interface LiveSessionRow {
  id: string
  course_id: string
  lesson_id: string | null
  title: string
  description: string | null
  scheduled_start_at: string
  scheduled_end_at: string | null
  timezone: string
  status: LiveSessionStatus
  agenda: LiveSessionAgendaItem[]
  learning_objectives: string[]
  preparation_notes: string | null
  max_participants: number | null
  livekit_room_name: string
  started_at: string | null
  ended_at: string | null
  created_at: string
  updated_at: string
  // Joined relation fields if requested
  lessons?: { id: string; title: string } | null
  courses?: { id: string; title: string; creator_id: string } | null
}

export interface CreateLiveSessionInput {
  courseId: string
  lessonId?: string | null
  title: string
  description?: string | null
  scheduledStartAt: string
  scheduledEndAt?: string | null
  timezone?: string
  status?: 'DRAFT' | 'SCHEDULED'
  agenda?: LiveSessionAgendaItem[]
  learningObjectives?: string[]
  preparationNotes?: string | null
  maxParticipants?: number | null
}

export interface UpdateLiveSessionInput {
  lessonId?: string | null
  title?: string
  description?: string | null
  scheduledStartAt?: string
  scheduledEndAt?: string | null
  timezone?: string
  agenda?: LiveSessionAgendaItem[]
  learningObjectives?: string[]
  preparationNotes?: string | null
  maxParticipants?: number | null
}

/** Helper to map PostgreSQL LiveSessionRow to camelCase LiveSession */
export function mapLiveSessionRow(row: LiveSessionRow): LiveSession {
  return {
    id: row.id,
    courseId: row.course_id,
    lessonId: row.lesson_id,
    title: row.title,
    description: row.description,
    scheduledStartAt: row.scheduled_start_at,
    scheduledEndAt: row.scheduled_end_at,
    timezone: row.timezone || 'Asia/Ho_Chi_Minh',
    status: row.status,
    agenda: Array.isArray(row.agenda) ? row.agenda : [],
    learningObjectives: Array.isArray(row.learning_objectives) ? row.learning_objectives : [],
    preparationNotes: row.preparation_notes,
    maxParticipants: row.max_participants,
    livekitRoomName: row.livekit_room_name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lessonTitle: row.lessons?.title || null,
    courseTitle: row.courses?.title || null,
  }
}

export interface LiveSessionStaff {
  id: string
  liveSessionId: string
  userId: string
  role: 'assistant'
  createdAt: string
  userName?: string
  userEmail?: string
}

export interface LiveSessionStaffRow {
  id: string
  live_session_id: string
  user_id: string
  role: 'assistant'
  created_at: string
  user_name?: string
  user_email?: string
}

export function mapLiveSessionStaffRow(row: LiveSessionStaffRow): LiveSessionStaff {
  return {
    id: row.id,
    liveSessionId: row.live_session_id,
    userId: row.user_id,
    role: row.role,
    createdAt: row.created_at,
    userName: row.user_name,
    userEmail: row.user_email,
  }
}
