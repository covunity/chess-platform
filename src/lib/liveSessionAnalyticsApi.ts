/**
 * Live Session Operational & Chess Analytics API Layer
 * TASK 9.4: Operational & Chess Analytics
 *
 * Provides typed, reliable, read-only aggregation of live session operational metrics
 * and persisted chess games for teacher post-session reporting and diagnostics.
 *
 * Invariants:
 * - Read-only: Makes zero database writes or mutations.
 * - Server authoritative: Does not duplicate attendance duration calculations or override
 *   PostgreSQL multirange values.
 * - Strict authorization: Caller must be course creator (teacher), assigned staff (assistant),
 *   or platform admin. Unauthorized callers are rejected.
 * - Session isolation: Queries and aggregations are strictly bounded by sessionId.
 * - Explicit partial data handling: Never silently substitutes a partial attendance roster
 *   as the enrolled denominator for unfinalized sessions.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase as defaultSupabase } from './supabase'
import { isValidUuid, getLiveSessionAttendance } from './liveAttendanceApi'
import { getLiveGamesForSession } from './liveGameApi'
import { getLiveSession } from './liveSessionApi'
import { parseGamePgnForReplay } from '../components/LiveClassroom/Replay/replayPgnParser'
import type { LiveSession } from '../types/liveSession'
import type { LiveSessionAttendance } from '../types/liveAttendance'
import type { LiveGame } from '../types/liveGame'
import type {
  LiveSessionAnalytics,
  SessionOperationalMetrics,
  SessionChessAnalytics,
  SessionTimingMetrics,
  StudentAttendanceMetrics,
  AttendanceDurationMetrics,
  StaffAttendanceMetrics,
  ParticipantAttendanceSummary,
  ChessScopeMetrics,
  ChessResultMetrics,
  ChessMoveStatistics,
  BoardGameAnalytics,
  AttendanceCompleteness,
} from '../types/liveSessionAnalytics'

export { isValidUuid }

// ── 1. Pure Aggregation Logic ────────────────────────────────────────────────

/**
 * Computes operational attendance and timing metrics from raw session and attendance records.
 * Pure and non-mutating.
 *
 * @param session - Authoritative LiveSession record
 * @param attendanceRows - Persisted attendance summary rows from public.live_session_attendance
 * @param courseEnrolledCount - Optional total enrollments count for course from public.enrollments / public.courses
 * @param isEnrollmentCountAvailable - Whether the course enrollment count was successfully retrieved
 * @param hasCacheMismatch - Whether direct count and cached count conflicted (e.g. direct 0 vs cached > 0 on published course)
 */
export function computeSessionOperationalMetrics(
  session: LiveSession,
  attendanceRows: LiveSessionAttendance[] = [],
  courseEnrolledCount?: number | null,
  isEnrollmentCountAvailable: boolean = true,
  hasCacheMismatch: boolean = false
): SessionOperationalMetrics {
  // 1. Session Timing Metrics
  let durationSeconds: number | null = null
  if (session.startedAt && session.endedAt) {
    const startMs = new Date(session.startedAt).getTime()
    const endMs = new Date(session.endedAt).getTime()
    if (!isNaN(startMs) && !isNaN(endMs)) {
      durationSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000))
    }
  } else if (session.status === 'LIVE' && session.startedAt) {
    const startMs = new Date(session.startedAt).getTime()
    if (!isNaN(startMs)) {
      durationSeconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000))
    }
  }

  const timing: SessionTimingMetrics = {
    status: session.status,
    scheduledStartAt: session.scheduledStartAt,
    scheduledEndAt: session.scheduledEndAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationSeconds,
  }

  // 2. Filter students vs staff
  const studentRows = attendanceRows.filter((r) => r.role === 'student')
  const staffRows = attendanceRows.filter((r) => r.role === 'teacher' || r.role === 'assistant')

  // 3. Lifecycle Completeness
  let completeness: AttendanceCompleteness
  if (session.status === 'ENDED') {
    completeness = 'FINALIZED'
  } else if (session.status === 'LIVE') {
    completeness = 'PROVISIONAL'
  } else if (session.status === 'CANCELLED') {
    completeness = 'CANCELLED'
  } else {
    completeness = 'UNSTARTED'
  }

  // 4. Student Attendance Counts
  const presentCount = studentRows.filter((r) => r.attendance_status === 'PRESENT').length
  const partialCount = studentRows.filter((r) => r.attendance_status === 'PARTIAL').length
  const absentCount = studentRows.filter((r) => r.attendance_status === 'ABSENT').length
  const attendedCount = presentCount + partialCount

  // Total students with a recorded join (joined or positive duration)
  const joinedCount = studentRows.filter(
    (r) => r.first_joined_at !== null || (typeof r.total_duration_seconds === 'number' && r.total_duration_seconds > 0)
  ).length

  // Authoritative Enrolled Denominator and Partial Data Determination
  let totalEnrolled: number | null = null
  let isPartialData = false
  let isFinalizedRosterMissing = false
  let hasRosterConflict = false

  if (completeness === 'FINALIZED') {
    // For FINALIZED sessions, finalize_live_session_attendance materializes ABSENT rows
    // for all enrolled learners who never joined. The finalized student roster is authoritative.
    // Current course enrollments must not silently inflate a historical session denominator.
    if (studentRows.length > 0) {
      totalEnrolled = studentRows.length
      isPartialData = false
      isFinalizedRosterMissing = false
      hasRosterConflict = false
    } else {
      // Empty student roster for an ENDED session:
      // If course has known enrollees (> 0) or unresolved cache mismatch,
      // this is a genuine roster-integrity mismatch (attendance was unmaterialized or lost).
      // Expose it explicitly with isPartialData = true and isFinalizedRosterMissing = true.
      if (typeof courseEnrolledCount === 'number' && courseEnrolledCount > 0) {
        totalEnrolled = courseEnrolledCount
        isPartialData = true
        isFinalizedRosterMissing = true
        hasRosterConflict = false
      } else if (isEnrollmentCountAvailable && courseEnrolledCount === 0) {
        totalEnrolled = 0
        if (hasCacheMismatch) {
          isPartialData = true
          isFinalizedRosterMissing = true
        } else {
          isPartialData = false
          isFinalizedRosterMissing = false
        }
        hasRosterConflict = false
      } else {
        totalEnrolled = null
        isPartialData = true
        isFinalizedRosterMissing = true
        hasRosterConflict = false
      }
    }
  } else if (completeness === 'PROVISIONAL') {
    // For LIVE sessions, absent learners have NOT materialized in the database yet.
    if (isEnrollmentCountAvailable && typeof courseEnrolledCount === 'number') {
      // Retain trusted denominator, NEVER silently substitute studentRows.length
      totalEnrolled = courseEnrolledCount
      if (studentRows.length > courseEnrolledCount) {
        hasRosterConflict = true
        isPartialData = true
      } else {
        hasRosterConflict = false
        isPartialData = hasCacheMismatch
      }
    } else {
      // Enrollment query failed or is unavailable. Do NOT substitute partial attendance roster!
      totalEnrolled = null
      isPartialData = true
      hasRosterConflict = false
    }
  } else if (completeness === 'CANCELLED') {
    // CANCELLED session semantics:
    // Cancelled sessions are never finalized into an authoritative closed attendance roster.
    // Cancellation cannot look like a complete finalized roster: isPartialData is always true.
    isPartialData = true
    if (isEnrollmentCountAvailable && typeof courseEnrolledCount === 'number') {
      // Retain trusted denominator, NEVER silently substitute studentRows.length
      totalEnrolled = courseEnrolledCount
      if (studentRows.length > courseEnrolledCount) {
        hasRosterConflict = true
      } else {
        hasRosterConflict = false
      }
    } else {
      // Do not substitute partial attendance roster as total enrolled denominator
      totalEnrolled = null
      hasRosterConflict = false
    }
  } else {
    // UNSTARTED (DRAFT / SCHEDULED)
    if (isEnrollmentCountAvailable && typeof courseEnrolledCount === 'number') {
      totalEnrolled = courseEnrolledCount
      if (studentRows.length > courseEnrolledCount) {
        hasRosterConflict = true
        isPartialData = true
      } else {
        hasRosterConflict = false
        isPartialData = hasCacheMismatch
      }
    } else {
      totalEnrolled = null
      isPartialData = true
      hasRosterConflict = false
    }
  }

  // Not-yet-joined learners
  let notJoinedCount: number | null = null
  if (completeness === 'FINALIZED') {
    // For complete finalized rosters, all non-attending learners have materialized into absentCount (0).
    // For empty/missing finalized rosters (isFinalizedRosterMissing = true), participants without rows cannot safely
    // be classified as not joined, so notJoinedCount must be null.
    notJoinedCount = isFinalizedRosterMissing ? null : 0
  } else if (hasCacheMismatch || hasRosterConflict) {
    // During an unresolved cache conflict or roster conflict,
    // participants without rows cannot safely be classified as not joined
    notJoinedCount = null
  } else if (typeof totalEnrolled === 'number') {
    notJoinedCount = Math.max(0, totalEnrolled - joinedCount)
  } else {
    notJoinedCount = null
  }

  // Attendance Rate:
  // - UNSTARTED sessions: null (never started).
  // - CANCELLED before start (startedAt is null): null / not applicable (not 0%, session never started).
  // - CANCELLED after start (startedAt is set): recorded rate may be reported, or null if totalEnrolled is null / cache mismatch / roster conflict.
  // - FINALIZED with empty/missing roster (isFinalizedRosterMissing = true): null (attendance cannot be inferred; do NOT treat as 0%).
  // - PROVISIONAL / CANCELLED with cache mismatch or roster conflict: null (derived values suppressed during unresolved conflict).
  // - PROVISIONAL / FINALIZED: recorded rate if totalEnrolled > 0, else null.
  let attendanceRatePct: number | null = null
  const isCancelledBeforeStart = completeness === 'CANCELLED' && !session.startedAt
  const suppressDueToConflict =
    (completeness === 'PROVISIONAL' || completeness === 'CANCELLED') && (hasCacheMismatch || hasRosterConflict)
  if (
    completeness !== 'UNSTARTED' &&
    !isCancelledBeforeStart &&
    !isFinalizedRosterMissing &&
    !suppressDueToConflict &&
    !hasRosterConflict &&
    typeof totalEnrolled === 'number' &&
    totalEnrolled > 0
  ) {
    attendanceRatePct = Number(((attendedCount / totalEnrolled) * 100).toFixed(1))
  }

  // Late rate: Late arrivals among all students who joined
  // Denominator is joinedCount (never exceeds 100%)
  const lateCount = studentRows.filter((r) => Boolean(r.is_late)).length
  const lateRatePct = joinedCount > 0
    ? Number(((lateCount / joinedCount) * 100).toFixed(1))
    : null

  const studentAttendance: StudentAttendanceMetrics = {
    totalEnrolled,
    presentCount,
    partialCount,
    absentCount,
    attendedCount,
    joinedCount,
    notJoinedCount,
    attendanceRatePct,
    lateCount,
    lateRatePct,
    completeness,
    isPartialData,
    hasCacheMismatch,
    hasRosterConflict,
    isFinalizedRosterMissing,
  }

  // 5. Attendance Duration Aggregates (among students who attended with positive duration)
  const positiveDurations = studentRows
    .map((r) => r.total_duration_seconds)
    .filter((d) => typeof d === 'number' && d > 0)

  const totalDurationSeconds = studentRows.reduce(
    (acc, r) => acc + (typeof r.total_duration_seconds === 'number' ? r.total_duration_seconds : 0),
    0
  )

  const averageDurationSeconds = positiveDurations.length > 0
    ? Math.round(positiveDurations.reduce((a, b) => a + b, 0) / positiveDurations.length)
    : null

  const minDurationSeconds = positiveDurations.length > 0
    ? Math.min(...positiveDurations)
    : null

  const maxDurationSeconds = positiveDurations.length > 0
    ? Math.max(...positiveDurations)
    : null

  const durationStats: AttendanceDurationMetrics = {
    totalDurationSeconds,
    averageDurationSeconds,
    minDurationSeconds,
    maxDurationSeconds,
  }

  // 6. Staff Attendance
  const staffAttendance: StaffAttendanceMetrics = {
    totalStaff: staffRows.length,
    presentStaff: staffRows.filter((r) => r.attendance_status === 'PRESENT').length,
    absentStaff: staffRows.filter((r) => r.attendance_status === 'ABSENT').length,
    lateStaff: staffRows.filter((r) => Boolean(r.is_late)).length,
  }

  // 7. Student Roster
  const studentRoster: ParticipantAttendanceSummary[] = studentRows.map((r) => ({
    userId: r.user_id,
    userName: r.user_name || 'User',
    userEmail: r.user_email || '',
    role: r.role,
    attendanceStatus: r.attendance_status,
    totalDurationSeconds: r.total_duration_seconds,
    isLate: Boolean(r.is_late),
    firstJoinedAt: r.first_joined_at,
    lastLeftAt: r.last_left_at,
  }))

  return {
    sessionId: session.id,
    courseId: session.courseId,
    title: session.title,
    timing,
    studentAttendance,
    durationStats,
    staffAttendance,
    studentRoster,
    isPartialData,
    hasCacheMismatch,
    hasRosterConflict,
    isFinalizedRosterMissing,
  }
}

/**
 * Computes chess game analytics from persisted LiveGame records.
 * Pure and non-mutating.
 *
 * @param sessionId - Expected live session ID (used for isolation check)
 * @param games - Persisted games for the session
 */
export function computeSessionGameAnalytics(
  sessionId: string,
  games: LiveGame[] = []
): SessionChessAnalytics {
  // Ensure games are strictly isolated to the requested session
  const sessionGames = games.filter((g) => g.live_session_id === sessionId)

  const totalGames = sessionGames.length
  const completedGames = sessionGames.filter((g) => g.status === 'COMPLETED').length
  const unfinishedGames = sessionGames.filter((g) => g.status === 'IN_PROGRESS').length
  const abortedGames = sessionGames.filter((g) => g.status === 'ABORTED').length

  // Scope breakdown
  const scopeBreakdown: ChessScopeMetrics = {
    total: totalGames,
    main: sessionGames.filter((g) => g.game_scope === 'MAIN').length,
    practice: sessionGames.filter((g) => g.game_scope === 'PRACTICE').length,
  }

  // Result breakdown:
  // Invariant (Migration 110): A win/draw outcome is valid ONLY for COMPLETED games.
  // Unfinished (IN_PROGRESS), aborted (ABORTED), or unrecorded results are strictly
  // classified under unfinishedOrUnknown.
  const whiteWins = sessionGames.filter((g) => g.status === 'COMPLETED' && g.result === '1-0').length
  const blackWins = sessionGames.filter((g) => g.status === 'COMPLETED' && g.result === '0-1').length
  const draws = sessionGames.filter((g) => g.status === 'COMPLETED' && g.result === '1/2-1/2').length
  const unfinishedOrUnknown = sessionGames.filter(
    (g) => g.status !== 'COMPLETED' || !['1-0', '0-1', '1/2-1/2'].includes(g.result)
  ).length

  const resultBreakdown: ChessResultMetrics = {
    whiteWins,
    blackWins,
    draws,
    unfinishedOrUnknown,
  }

  // Move-count statistics helper
  // Unit semantics: In Task 8 persistence, move_count represents plies (half-moves),
  // recorded as chess.history().length. The PGN fallback matches this by using
  // parsed.moves.length (ply count).
  function extractMoveStats(gameList: LiveGame[]): ChessMoveStatistics {
    const validMoveCounts: number[] = []

    for (const g of gameList) {
      // Move count statistics are computed over completed games with valid move counts
      if (g.status !== 'COMPLETED') continue

      if (typeof g.move_count === 'number' && g.move_count > 0) {
        validMoveCounts.push(g.move_count)
      } else if (g.pgn && g.pgn.trim().length > 0) {
        // Safe fallback for completed games with move_count === 0 but valid PGN
        // Uses parsed.moves.length (ply count) to match persisted move_count unit
        try {
          const parsed = parseGamePgnForReplay(g.pgn, g.starting_fen)
          if (parsed.valid && parsed.moves.length > 0) {
            validMoveCounts.push(parsed.moves.length)
          }
        } catch {
          // Malformed PGN is safely ignored without throwing
        }
      }
    }

    const totalMoves = validMoveCounts.reduce((acc, m) => acc + m, 0)
    const sampleGameCount = validMoveCounts.length

    return {
      totalMoves,
      averageMoves: sampleGameCount > 0 ? Number((totalMoves / sampleGameCount).toFixed(1)) : null,
      minMoves: sampleGameCount > 0 ? Math.min(...validMoveCounts) : null,
      maxMoves: sampleGameCount > 0 ? Math.max(...validMoveCounts) : null,
      sampleGameCount,
    }
  }

  const overallMoveStats = extractMoveStats(sessionGames)

  // Group by board_id
  const boardMap = new Map<string, LiveGame[]>()
  for (const g of sessionGames) {
    const list = boardMap.get(g.board_id) ?? []
    list.push(g)
    boardMap.set(g.board_id, list)
  }

  const byBoard: BoardGameAnalytics[] = Array.from(boardMap.entries())
    .map(([boardId, boardGames]) => {
      const scope = boardGames[0]?.game_scope ?? (boardId === 'main' ? 'MAIN' : 'PRACTICE')
      return {
        boardId,
        gameScope: scope,
        totalGames: boardGames.length,
        completedGames: boardGames.filter((g) => g.status === 'COMPLETED').length,
        whiteWins: boardGames.filter((g) => g.status === 'COMPLETED' && g.result === '1-0').length,
        blackWins: boardGames.filter((g) => g.status === 'COMPLETED' && g.result === '0-1').length,
        draws: boardGames.filter((g) => g.status === 'COMPLETED' && g.result === '1/2-1/2').length,
        unfinishedOrUnknown: boardGames.filter(
          (g) => g.status !== 'COMPLETED' || !['1-0', '0-1', '1/2-1/2'].includes(g.result)
        ).length,
        moveStats: extractMoveStats(boardGames),
      }
    })
    .sort((a, b) => {
      if (a.boardId === 'main') return -1
      if (b.boardId === 'main') return 1
      return a.boardId.localeCompare(b.boardId)
    })

  return {
    sessionId,
    totalGames,
    completedGames,
    unfinishedGames,
    abortedGames,
    scopeBreakdown,
    resultBreakdown,
    moveStats: overallMoveStats,
    byBoard,
  }
}

// ── 2. Data Access & Authorization Guard ────────────────────────────────────

/**
 * Validates that the current authenticated user has authority to inspect session analytics.
 * Permitted roles:
 * - Course creator (teacher)
 * - Assigned session assistant
 * - Platform admin
 *
 * Rejects:
 * - Unauthenticated callers
 * - Enrolled students (must not see aggregate session operational analytics)
 * - Unrelated users
 */
export async function assertSessionAnalyticsAccess(
  client: SupabaseClient,
  sessionId: string,
  courseId: string
): Promise<{ authorized: boolean; role?: 'teacher' | 'assistant' | 'admin'; error: Error | null }> {
  try {
    const { data: { user }, error: authErr } = await client.auth.getUser()
    if (authErr || !user) {
      return { authorized: false, error: new Error('unauthenticated') }
    }

    // 1. Check if user is platform admin
    const { data: userProfile } = await client
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    if (userProfile?.role === 'admin') {
      return { authorized: true, role: 'admin', error: null }
    }

    // 2. Check if user is course creator (teacher)
    const { data: courseRow } = await client
      .from('courses')
      .select('creator_id')
      .eq('id', courseId)
      .maybeSingle()

    if (courseRow?.creator_id === user.id) {
      return { authorized: true, role: 'teacher', error: null }
    }

    // 3. Check if user is assigned assistant
    const { data: staffRow } = await client
      .from('live_session_staff')
      .select('id')
      .eq('live_session_id', sessionId)
      .eq('user_id', user.id)
      .eq('role', 'assistant')
      .maybeSingle()

    if (staffRow) {
      return { authorized: true, role: 'assistant', error: null }
    }

    // Caller is not teacher, assistant, or admin
    return {
      authorized: false,
      error: new Error('forbidden: caller is not authorized to inspect session analytics'),
    }
  } catch (err) {
    return {
      authorized: false,
      error: err instanceof Error ? err : new Error(String(err)),
    }
  }
}

// ── 3. High-level Read-Only API ─────────────────────────────────────────────

/**
 * Retrieve complete operational and chess analytics for a live session.
 *
 * Read-only: Does not modify any database tables or state.
 * Authorized for course creator, assigned staff, and platform admins.
 */
export async function getLiveSessionAnalytics(
  client: SupabaseClient = defaultSupabase,
  sessionId: string
): Promise<{ data: LiveSessionAnalytics | null; error: Error | null }> {
  if (!isValidUuid(sessionId)) {
    return { data: null, error: new Error('sessionId must be a valid UUID') }
  }

  try {
    // 1. Fetch Session Details
    const { session, error: sessionErr } = await getLiveSession(client, sessionId)
    if (sessionErr) {
      return { data: null, error: sessionErr }
    }
    if (!session) {
      return { data: null, error: new Error('session_not_found') }
    }

    // 2. Authoritative Access Guard
    const access = await assertSessionAnalyticsAccess(client, sessionId, session.courseId)
    if (!access.authorized) {
      return { data: null, error: access.error }
    }

    // 3. Parallel fetch of attendance roster, persisted games, course enrollments, and course metadata
    const [attendanceRes, gamesRes, enrollmentsRes, courseRes] = await Promise.all([
      getLiveSessionAttendance(client, sessionId),
      getLiveGamesForSession(client, sessionId),
      client
        .from('enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('course_id', session.courseId),
      client
        .from('courses')
        .select('status, enrollment_count')
        .eq('id', session.courseId)
        .maybeSingle(),
    ])

    if (attendanceRes.error) {
      return { data: null, error: attendanceRes.error }
    }
    if (gamesRes.error) {
      return { data: null, error: gamesRes.error }
    }

    // Authoritative Course Enrollment Count under RLS
    let courseEnrolledCount: number | null = null
    let isEnrollmentCountAvailable = false
    let hasCacheMismatch = false

    const isCoursePublished = courseRes.data?.status === 'published'
    const cachedEnrollmentCount = courseRes.data?.enrollment_count

    if (access.role === 'admin') {
      // Platform admin bypasses RLS on enrollments
      if (!enrollmentsRes.error && typeof enrollmentsRes.count === 'number') {
        courseEnrolledCount = enrollmentsRes.count
        isEnrollmentCountAvailable = true
        if (enrollmentsRes.count === 0 && typeof cachedEnrollmentCount === 'number' && cachedEnrollmentCount > 0) {
          hasCacheMismatch = true
        }
      } else if (typeof cachedEnrollmentCount === 'number') {
        courseEnrolledCount = cachedEnrollmentCount
        isEnrollmentCountAvailable = true
      }
    } else if (isCoursePublished) {
      // For published courses, RLS policy "Anyone can view published course enrollments count" is active.
      // A successful direct count query is authoritative.
      if (!enrollmentsRes.error && typeof enrollmentsRes.count === 'number') {
        courseEnrolledCount = enrollmentsRes.count
        isEnrollmentCountAvailable = true
        // If direct count is 0 but cached count is positive, conflicting values cannot be reconciled safely;
        // do not silently use cache while reporting complete data. Mark analytics partial to expose the mismatch.
        if (enrollmentsRes.count === 0 && typeof cachedEnrollmentCount === 'number' && cachedEnrollmentCount > 0) {
          hasCacheMismatch = true
        }
      } else if (typeof cachedEnrollmentCount === 'number') {
        // Fall back to courses.enrollment_count when direct count fails
        courseEnrolledCount = cachedEnrollmentCount
        isEnrollmentCountAvailable = true
      }
    } else {
      // Restricted / Unpublished course (e.g. 'draft', 'archived'):
      // RLS on enrollments hides all other users' rows without an error, returning count=0 (or 1)!
      // Direct count on enrollments cannot be trusted as authoritative.
      if (typeof cachedEnrollmentCount === 'number') {
        // Course creator (teacher) can read courses.enrollment_count maintained by trigger
        courseEnrolledCount = cachedEnrollmentCount
        isEnrollmentCountAvailable = true
      } else {
        // Assistant cannot read unpublished course row, and direct enrollment count is hidden by RLS.
        // Report count as unavailable and mark data partial; never silently treat restricted 0 as authoritative.
        courseEnrolledCount = null
        isEnrollmentCountAvailable = false
      }
    }

    // 4. Compute Operational & Chess Analytics
    const operational = computeSessionOperationalMetrics(
      session,
      attendanceRes.data ?? [],
      courseEnrolledCount,
      isEnrollmentCountAvailable,
      hasCacheMismatch
    )

    const chess = computeSessionGameAnalytics(
      sessionId,
      gamesRes.games ?? []
    )

    return {
      data: {
        operational,
        chess,
        isPartialData: operational.isPartialData,
        hasCacheMismatch: operational.hasCacheMismatch,
        hasRosterConflict: operational.hasRosterConflict,
        isFinalizedRosterMissing: operational.isFinalizedRosterMissing,
      },
      error: null,
    }
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    }
  }
}
