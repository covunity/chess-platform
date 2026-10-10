/**
 * Type definitions and metric specifications for Live Session Operational & Chess Analytics.
 * TASK 9.4: Operational & Chess Analytics
 *
 * This layer provides read-only aggregation types for post-session reporting and diagnostics.
 * All duration and attendance statuses originate from authoritative server calculations in
 * migration 112 (range_agg multiranges, finalize_live_session_attendance).
 */

import type { LiveSessionStatus } from './liveSession'
import type { AttendanceRole, AttendanceStatus } from './liveAttendance'
import type { LiveGameScope } from './liveGame'

// ── 1. Operational & Attendance Metrics ──────────────────────────────────────

/**
 * Authoritative session lifecycle timing metrics.
 *
 * Lifecycle Applicability:
 * - DRAFT / SCHEDULED: startedAt, endedAt, durationSeconds are null.
 * - LIVE: startedAt is populated; endedAt is null; durationSeconds is elapsed time up to now.
 * - ENDED: startedAt and endedAt are populated; durationSeconds is (endedAt - startedAt).
 * - CANCELLED: startedAt / endedAt may be populated if cancelled mid-session, else null.
 */
export interface SessionTimingMetrics {
  status: LiveSessionStatus
  scheduledStartAt: string
  scheduledEndAt: string | null
  startedAt: string | null
  endedAt: string | null

  /**
   * Authoritative session duration in seconds.
   * - ENDED: (endedAt - startedAt) in seconds.
   * - LIVE: (now - startedAt) in seconds.
   * - Unstarted: null.
   * Missing / invalid data: Returns null if session never started. Clamped to >= 0.
   */
  durationSeconds: number | null
}

/**
 * Lifecycle attendance completeness status.
 *
 * - UNSTARTED: DRAFT or SCHEDULED session before start; no attendance has occurred.
 * - PROVISIONAL: LIVE or unfinalized session where non-attending learners have not yet
 *   materialized as ABSENT rows in the database.
 * - FINALIZED: ENDED session where finalize_live_session_attendance has materialized ABSENT
 *   rows for all non-attending enrollees and merged multirange intervals.
 * - CANCELLED: Cancelled session.
 */
/**
 * Lifecycle attendance completeness status.
 *
 * - UNSTARTED: DRAFT or SCHEDULED session before start; no attendance has occurred.
 * - PROVISIONAL: LIVE or unfinalized session where non-attending learners have not yet
 *   materialized as ABSENT rows in the database.
 * - FINALIZED: ENDED session where finalize_live_session_attendance has materialized ABSENT
 *   rows for all non-attending enrollees and merged multirange intervals.
 * - CANCELLED: Cancelled session. Any recorded attendance remains partial and unfinalized.
 */
export type AttendanceCompleteness =
  | 'UNSTARTED'
  | 'PROVISIONAL'
  | 'FINALIZED'
  | 'CANCELLED'

/**
 * Aggregated attendance counts and rates for student participants.
 *
 * Metric Definitions & Populations:
 * - totalEnrolled:
 *   * Definition: Total eligible learner population.
 *   * Denominator for attendanceRatePct.
 *   * Population:
 *     - For FINALIZED sessions: the finalized student attendance roster is authoritative
 *       (totalEnrolled = studentRows.length) because finalize_live_session_attendance
 *       materializes ABSENT rows for all non-attending enrollees. Current course enrollments
 *       never inflate a historical session denominator.
 *     - For PROVISIONAL (LIVE) sessions: course enrollment count from public.enrollments / public.courses.
 *       If enrollment count query fails or is unavailable during a LIVE session, totalEnrolled is null
 *       and isPartialData is true (we DO NOT substitute a partial attendance roster as the enrolled total).
 *     - For CANCELLED sessions: course enrollment count if available, else null (isPartialData is always true).
 *     - For UNSTARTED sessions: course enrollment count if available, else null.
 * - presentCount:
 *   * Students with attendance_status === 'PRESENT' (server-calculated duration >= 70% of session).
 * - partialCount:
 *   * Students with attendance_status === 'PARTIAL' (server-calculated duration >= 20% and < 70%).
 * - absentCount:
 *   * Students with attendance_status === 'ABSENT'.
 *   * For FINALIZED sessions: includes all enrolled students who never joined plus those with < 20% duration.
 *   * For LIVE and CANCELLED sessions: only includes students who actually have an attendance record
 *     with ABSENT status (e.g. joined but stayed < 20% duration). Non-attending learners without
 *     authoritative rows are NOT classified as ABSENT.
 * - attendedCount:
 *   * presentCount + partialCount.
 * - joinedCount:
 *   * Total students with a recorded join (first_joined_at !== null or total_duration_seconds > 0).
 *   * Denominator for lateRatePct.
 * - notJoinedCount:
 *   * Enrolled learners who have not joined the session.
 *   * Formula:
 *     - For FINALIZED sessions: 0 when roster is complete (all enrollees materialized into absentCount).
 *       Null when roster is missing/empty while course has enrollees (cannot safely classify non-attendees as not joined).
 *     - For PROVISIONAL (LIVE) and CANCELLED sessions: Math.max(0, totalEnrolled - joinedCount) if totalEnrolled is known, else null.
 *     - For UNSTARTED sessions: totalEnrolled if known, else null.
 * - attendanceRatePct:
 *   * (attendedCount / totalEnrolled) * 100.
 *   * Null if totalEnrolled is null or 0, or if session is UNSTARTED or CANCELLED before start.
 *   * Null for FINALIZED sessions if attendance roster is missing (attendance cannot be inferred; never silently treated as 0%).
 * - lateCount:
 *   * Students with is_late === true (authoritative first join > session started_at + 10m).
 * - lateRatePct:
 *   * (lateCount / joinedCount) * 100.
 *   * Measures late arrivals among all students who actually joined (joinedCount).
 *   * Because every late student has a recorded join, this rate can NEVER exceed 100%,
 *     even if a late-arriving student stayed < 20% of duration and received ABSENT status.
 *   * Null if joinedCount === 0.
 * - completeness:
 *   * AttendanceCompleteness lifecycle stage indicator.
 * - isPartialData:
 *   * True if data is partial or unfinalized:
 *     - LIVE/PROVISIONAL sessions: true if enrollment count is unavailable.
 *     - CANCELLED sessions: always true (cancellation cannot look like a complete finalized roster).
 *     - UNSTARTED sessions: true if enrollment count is unavailable.
 *     - FINALIZED sessions: false for complete rosters; true if a genuine roster-integrity mismatch occurs
 *       (e.g. empty roster with positive course enrollments).
 *
 * RLS Enrollment Visibility Contract:
 * - On published courses, public.enrollments count is readable by all authenticated callers (admin, creator, assistant).
 * - On unpublished courses ('draft', 'archived'), public.enrollments rows for other learners are hidden by RLS
 *   without an error (returning count=0 or count=1 for caller).
 *   * Course creators (teachers) can read courses.enrollment_count (cached by trigger trg_refresh_course_enrollment_count).
 *   * Platform admins bypass RLS and read exact enrollments directly.
 *   * Staff assistants cannot read unpublished courses or other enrollments; for assistants on unpublished courses,
 *     enrollment count is reported as unavailable (null) with isPartialData=true.
 */
export interface StudentAttendanceMetrics {
  totalEnrolled: number | null
  presentCount: number
  partialCount: number
  absentCount: number
  attendedCount: number
  joinedCount: number
  notJoinedCount: number | null
  attendanceRatePct: number | null
  lateCount: number
  lateRatePct: number | null
  completeness: AttendanceCompleteness
  isPartialData: boolean
  hasCacheMismatch: boolean
  hasRosterConflict: boolean
  isFinalizedRosterMissing?: boolean
}

/**
 * Attendance duration metrics across attended students with valid duration data.
 *
 * Metric Definitions & Populations:
 * - totalDurationSeconds: Sum of total_duration_seconds across all students.
 * - averageDurationSeconds:
 *   * Mean attended duration in seconds.
 *   * Denominator: Count of students who actually attended with positive duration (> 0).
 *   * Missing data: Returns null if no students attended with duration > 0.
 * - minDurationSeconds:
 *   * Shortest non-zero duration in seconds among attended students.
 *   * Missing data: Returns null if no students attended.
 * - maxDurationSeconds:
 *   * Longest duration in seconds among attended students.
 *   * Missing data: Returns null if no students attended.
 */
export interface AttendanceDurationMetrics {
  totalDurationSeconds: number
  averageDurationSeconds: number | null
  minDurationSeconds: number | null
  maxDurationSeconds: number | null
}

/**
 * Attendance metrics for staff participants (course creator / teacher and assigned assistants).
 */
export interface StaffAttendanceMetrics {
  totalStaff: number
  presentStaff: number
  absentStaff: number
  lateStaff: number
}

/**
 * Individual participant attendance summary for roster display.
 */
export interface ParticipantAttendanceSummary {
  userId: string
  userName: string
  userEmail: string
  role: AttendanceRole
  attendanceStatus: AttendanceStatus
  totalDurationSeconds: number
  isLate: boolean
  firstJoinedAt: string | null
  lastLeftAt: string | null
}

/**
 * Complete operational metrics for a live session.
 */
export interface SessionOperationalMetrics {
  sessionId: string
  courseId: string
  title: string
  timing: SessionTimingMetrics
  studentAttendance: StudentAttendanceMetrics
  durationStats: AttendanceDurationMetrics
  staffAttendance: StaffAttendanceMetrics
  studentRoster: ParticipantAttendanceSummary[]
  isPartialData: boolean
  hasCacheMismatch: boolean
  hasRosterConflict: boolean
  isFinalizedRosterMissing?: boolean
}

// ── 2. Chess Game Analytics ──────────────────────────────────────────────────

/**
 * Persisted chess game counts grouped by game scope.
 */
export interface ChessScopeMetrics {
  total: number
  main: number
  practice: number
}

/**
 * Game outcome distribution based on authoritative persisted `status` and `result` columns.
 *
 * Game Outcome Invariants (Migration 110):
 * - A game outcome is ONLY counted as a White win, Black win, or Draw if the game is COMPLETED!
 * - Unfinished games (IN_PROGRESS), aborted games (ABORTED), or games with unknown results ('*')
 *   are strictly classified under unfinishedOrUnknown.
 * - whiteWins + blackWins + draws + unfinishedOrUnknown === totalGames (no game is dropped or double-counted).
 */
export interface ChessResultMetrics {
  /** Completed games won by White (status === 'COMPLETED' && result === '1-0') */
  whiteWins: number
  /** Completed games won by Black (status === 'COMPLETED' && result === '0-1') */
  blackWins: number
  /** Completed games drawn (status === 'COMPLETED' && result === '1/2-1/2') */
  draws: number
  /** Unfinished (IN_PROGRESS), aborted (ABORTED), or unrecorded/missing results ('*') */
  unfinishedOrUnknown: number
}

/**
 * Move-count statistics for persisted chess games.
 *
 * Move Unit Semantics:
 * - Persisted `move_count` in `public.live_games` represents total PLIES (individual half-moves),
 *   matching `chess.history().length` from client game persistence.
 * - PGN fallback counts parsed plies (`parsed.moves.length`) to maintain strict unit consistency.
 *
 * Definitions:
 * - totalMoves: Sum of plies across completed games with valid move data.
 * - averageMoves: Mean ply count for completed games with move_count > 0.
 *   Denominator: sampleGameCount (completed games with move_count > 0).
 *   Missing data: Returns null if sampleGameCount === 0.
 * - minMoves: Minimum plies in a completed game with move_count > 0 (null if none).
 * - maxMoves: Maximum plies in a completed game with move_count > 0 (null if none).
 * - sampleGameCount: Count of games included in move statistics calculation.
 */
export interface ChessMoveStatistics {
  totalMoves: number
  averageMoves: number | null
  minMoves: number | null
  maxMoves: number | null
  sampleGameCount: number
}

/**
 * Chess game analytics aggregated per board (e.g., 'main' or practice board ID).
 */
export interface BoardGameAnalytics {
  boardId: string
  gameScope: LiveGameScope
  totalGames: number
  completedGames: number
  whiteWins: number
  blackWins: number
  draws: number
  unfinishedOrUnknown: number
  moveStats: ChessMoveStatistics
}

/**
 * Complete chess game analytics for a live session.
 */
export interface SessionChessAnalytics {
  sessionId: string
  totalGames: number
  completedGames: number
  unfinishedGames: number
  abortedGames: number
  scopeBreakdown: ChessScopeMetrics
  resultBreakdown: ChessResultMetrics
  moveStats: ChessMoveStatistics
  byBoard: BoardGameAnalytics[]
}

// ── 3. Combined Session Analytics ───────────────────────────────────────────

/**
 * Comprehensive read-only session analytics payload.
 */
export interface LiveSessionAnalytics {
  operational: SessionOperationalMetrics
  chess: SessionChessAnalytics
  isPartialData: boolean
  hasCacheMismatch: boolean
  hasRosterConflict: boolean
  isFinalizedRosterMissing?: boolean
}
