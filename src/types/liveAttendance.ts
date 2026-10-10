/**
 * Type definitions for persistent Live Session Attendance
 * TASK 9.1: Attendance Data Layer & Heartbeat Lifecycle
 */

export type AttendanceRole = 'teacher' | 'assistant' | 'student'

export type AttendanceStatus = 'PRESENT' | 'PARTIAL' | 'ABSENT'

export interface LiveSessionAttendance {
  id: string
  live_session_id: string
  user_id: string
  role: AttendanceRole
  first_joined_at: string | null
  last_left_at: string | null
  total_duration_seconds: number
  attendance_status: AttendanceStatus
  is_late: boolean
  created_at: string
  updated_at: string
  user_name?: string
  user_email?: string
}

export interface LiveSessionAttendanceInterval {
  id: string
  live_session_id: string
  user_id: string
  connection_id: string
  joined_at: string
  last_seen_at: string
  left_at: string | null
  created_at: string
}

export interface RecordLiveSessionJoinParams {
  sessionId: string
  connectionId: string
}

export interface JoinAttendanceResult {
  intervalId: string
  sessionId: string
  userId: string
  connectionId: string
  role: AttendanceRole
  isLate: boolean
}
