import { describe, it, expect, vi } from 'vitest'
import {
  computeSessionOperationalMetrics,
  computeSessionGameAnalytics,
  assertSessionAnalyticsAccess,
  getLiveSessionAnalytics,
  isValidUuid,
} from '../liveSessionAnalyticsApi'
import type { LiveSession } from '../../types/liveSession'
import type { LiveSessionAttendance } from '../../types/liveAttendance'
import type { LiveGame } from '../../types/liveGame'

describe('TASK 9.4 — Live Session Analytics API & Aggregation Layer (Hardened)', () => {
  const validSessionId = '11111111-1111-1111-1111-111111111111'
  const validCourseId = '22222222-2222-2222-2222-222222222222'
  const creatorId = '33333333-3333-3333-3333-333333333333'
  const assistantId = '44444444-4444-4444-4444-444444444444'
  const student1Id = '55555555-5555-5555-5555-555555555555'
  const student2Id = '66666666-6666-6666-6666-666666666666'
  const student3Id = '77777777-7777-7777-7777-777777777777'

  const baseSession: LiveSession = {
    id: validSessionId,
    courseId: validCourseId,
    lessonId: null,
    title: 'Advanced Endgame Tactics',
    description: 'Masterclass on Rook Endgames',
    scheduledStartAt: '2026-10-09T10:00:00.000Z',
    scheduledEndAt: '2026-10-09T11:30:00.000Z',
    timezone: 'Asia/Ho_Chi_Minh',
    status: 'ENDED',
    agenda: [],
    learningObjectives: [],
    preparationNotes: null,
    maxParticipants: 50,
    livekitRoomName: `live-course-${validCourseId}-session-${validSessionId}`,
    startedAt: '2026-10-09T10:00:00.000Z',
    endedAt: '2026-10-09T11:00:00.000Z', // 3600 seconds
    createdAt: '2026-10-09T09:00:00.000Z',
    updatedAt: '2026-10-09T11:00:00.000Z',
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. UUID Validation
  // ───────────────────────────────────────────────────────────────────────────
  describe('isValidUuid', () => {
    it('accepts canonical lowercase and uppercase UUIDs', () => {
      expect(isValidUuid('11111111-1111-1111-1111-111111111111')).toBe(true)
      expect(isValidUuid('ABCDEF01-2345-6789-ABCD-EF0123456789')).toBe(true)
    })

    it('rejects invalid or malformed strings and non-strings', () => {
      expect(isValidUuid('')).toBe(false)
      expect(isValidUuid('not-a-uuid')).toBe(false)
      expect(isValidUuid(null)).toBe(false)
      expect(isValidUuid(undefined)).toBe(false)
      expect(isValidUuid(12345)).toBe(false)
      expect(isValidUuid('11111111-1111-1111-1111-11111111111')).toBe(false)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Operational Metrics Calculation (computeSessionOperationalMetrics)
  // ───────────────────────────────────────────────────────────────────────────
  describe('computeSessionOperationalMetrics', () => {
    it('accurately aggregates attendance statuses (PRESENT, PARTIAL, ABSENT)', () => {
      const attendance: LiveSessionAttendance[] = [
        {
          id: 'att-1',
          live_session_id: validSessionId,
          user_id: student1Id,
          role: 'student',
          first_joined_at: '2026-10-09T10:01:00Z',
          last_left_at: '2026-10-09T10:55:00Z',
          total_duration_seconds: 3200,
          attendance_status: 'PRESENT',
          is_late: false,
          created_at: '2026-10-09T10:00:00Z',
          updated_at: '2026-10-09T11:00:00Z',
        },
        {
          id: 'att-2',
          live_session_id: validSessionId,
          user_id: student2Id,
          role: 'student',
          first_joined_at: '2026-10-09T10:15:00Z',
          last_left_at: '2026-10-09T10:45:00Z',
          total_duration_seconds: 1800,
          attendance_status: 'PARTIAL',
          is_late: true,
          created_at: '2026-10-09T10:00:00Z',
          updated_at: '2026-10-09T11:00:00Z',
        },
        {
          id: 'att-3',
          live_session_id: validSessionId,
          user_id: student3Id,
          role: 'student',
          first_joined_at: null,
          last_left_at: null,
          total_duration_seconds: 0,
          attendance_status: 'ABSENT',
          is_late: false,
          created_at: '2026-10-09T10:00:00Z',
          updated_at: '2026-10-09T11:00:00Z',
        },
      ]

      const metrics = computeSessionOperationalMetrics(baseSession, attendance)

      expect(metrics.studentAttendance.totalEnrolled).toBe(3)
      expect(metrics.studentAttendance.presentCount).toBe(1)
      expect(metrics.studentAttendance.partialCount).toBe(1)
      expect(metrics.studentAttendance.absentCount).toBe(1)
      expect(metrics.studentAttendance.attendedCount).toBe(2)
      expect(metrics.studentAttendance.joinedCount).toBe(2)
      expect(metrics.studentAttendance.notJoinedCount).toBe(0) // Finalized
      // 2 / 3 = 66.7%
      expect(metrics.studentAttendance.attendanceRatePct).toBe(66.7)
      expect(metrics.studentAttendance.lateCount).toBe(1)
      // 1 / 2 joined = 50.0%
      expect(metrics.studentAttendance.lateRatePct).toBe(50.0)
      expect(metrics.studentAttendance.completeness).toBe('FINALIZED')
    })

    // BLOCKER B REGRESSION: Late student with ABSENT status
    it('BLOCKER B: late student with ABSENT status has lateRatePct <= 100% and does not divide by 0', () => {
      const attendance: LiveSessionAttendance[] = [
        {
          id: 'att-late-absent',
          live_session_id: validSessionId,
          user_id: student1Id,
          role: 'student',
          first_joined_at: '2026-10-09T10:45:00Z', // Arrived late (minute 45 of 60)
          last_left_at: '2026-10-09T10:50:00Z', // Stayed 5 minutes (300s = 8.3% < 20% threshold)
          total_duration_seconds: 300,
          attendance_status: 'ABSENT', // Status is ABSENT
          is_late: true, // Marked late
          created_at: '2026-10-09T10:00:00Z',
          updated_at: '2026-10-09T11:00:00Z',
        },
      ]

      const metrics = computeSessionOperationalMetrics(baseSession, attendance)

      expect(metrics.studentAttendance.lateCount).toBe(1)
      expect(metrics.studentAttendance.attendedCount).toBe(0) // PRESENT + PARTIAL = 0
      expect(metrics.studentAttendance.joinedCount).toBe(1) // Recorded join = 1
      // Denominator is joinedCount: 1 late / 1 joined = 100% (NOT 1 / 0 or >100%)
      expect(metrics.studentAttendance.lateRatePct).toBe(100.0)
      expect(metrics.studentAttendance.lateRatePct!).toBeLessThanOrEqual(100.0)
    })

    // BLOCKER A & E: Unfinalized LIVE session with missing enrollment count
    it('BLOCKER A & E: LIVE session with missing enrollment count sets totalEnrolled=null and isPartialData=true', () => {
      const liveSession: LiveSession = {
        ...baseSession,
        status: 'LIVE',
        startedAt: new Date(Date.now() - 1800_000).toISOString(),
        endedAt: null,
      }

      const attendance: LiveSessionAttendance[] = [
        {
          id: 'att-live-1',
          live_session_id: validSessionId,
          user_id: student1Id,
          role: 'student',
          first_joined_at: new Date(Date.now() - 1700_000).toISOString(),
          last_left_at: null,
          total_duration_seconds: 1700,
          attendance_status: 'PRESENT',
          is_late: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]

      // Enrollment count is missing/failed (isEnrollmentCountAvailable = false)
      const metrics = computeSessionOperationalMetrics(liveSession, attendance, null, false)

      expect(metrics.studentAttendance.completeness).toBe('PROVISIONAL')
      expect(metrics.studentAttendance.totalEnrolled).toBeNull() // MUST NOT fall back to 1!
      expect(metrics.studentAttendance.notJoinedCount).toBeNull()
      expect(metrics.studentAttendance.attendanceRatePct).toBeNull()
      expect(metrics.studentAttendance.isPartialData).toBe(true)
      expect(metrics.isPartialData).toBe(true)
    })

    // BLOCKER E: Count semantics before vs after finalization
    it('BLOCKER E: distinguishes provisional counts during LIVE session from finalized counts', () => {
      const liveSession: LiveSession = {
        ...baseSession,
        status: 'LIVE',
        startedAt: new Date(Date.now() - 1800_000).toISOString(),
        endedAt: null,
      }

      // During LIVE session, only 2 students have joined out of 10 enrolled
      const liveAttendance: LiveSessionAttendance[] = [
        {
          id: 'att-1',
          live_session_id: validSessionId,
          user_id: student1Id,
          role: 'student',
          first_joined_at: new Date(Date.now() - 1700_000).toISOString(),
          last_left_at: null,
          total_duration_seconds: 1700,
          attendance_status: 'PRESENT',
          is_late: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'att-2',
          live_session_id: validSessionId,
          user_id: student2Id,
          role: 'student',
          first_joined_at: new Date(Date.now() - 600_000).toISOString(),
          last_left_at: null,
          total_duration_seconds: 600,
          attendance_status: 'PARTIAL',
          is_late: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]

      // Total enrolled in course is 10
      const provisionalMetrics = computeSessionOperationalMetrics(liveSession, liveAttendance, 10, true)

      expect(provisionalMetrics.studentAttendance.completeness).toBe('PROVISIONAL')
      expect(provisionalMetrics.studentAttendance.totalEnrolled).toBe(10)
      expect(provisionalMetrics.studentAttendance.attendedCount).toBe(2)
      expect(provisionalMetrics.studentAttendance.joinedCount).toBe(2)
      expect(provisionalMetrics.studentAttendance.absentCount).toBe(0) // Not yet finalized
      expect(provisionalMetrics.studentAttendance.notJoinedCount).toBe(8) // 10 - 2 = 8
      expect(provisionalMetrics.studentAttendance.attendanceRatePct).toBe(20.0) // 2 / 10 = 20%

      // AFTER FINALIZATION (ended session with materialized absent rows)
      const finalizedAttendance: LiveSessionAttendance[] = [
        ...liveAttendance,
        // 8 absent rows materialized by server
        ...Array.from({ length: 8 }, (_, i) => ({
          id: `att-absent-${i}`,
          live_session_id: validSessionId,
          user_id: `absent-student-${i}`,
          role: 'student' as const,
          first_joined_at: null,
          last_left_at: null,
          total_duration_seconds: 0,
          attendance_status: 'ABSENT' as const,
          is_late: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })),
      ]

      const finalizedMetrics = computeSessionOperationalMetrics(baseSession, finalizedAttendance, 10, true)

      expect(finalizedMetrics.studentAttendance.completeness).toBe('FINALIZED')
      expect(finalizedMetrics.studentAttendance.totalEnrolled).toBe(10)
      expect(finalizedMetrics.studentAttendance.presentCount).toBe(1)
      expect(finalizedMetrics.studentAttendance.partialCount).toBe(1)
      expect(finalizedMetrics.studentAttendance.absentCount).toBe(8)
      expect(finalizedMetrics.studentAttendance.attendedCount).toBe(2)
      expect(finalizedMetrics.studentAttendance.notJoinedCount).toBe(0) // All accounted for
      expect(finalizedMetrics.studentAttendance.attendanceRatePct).toBe(20.0)
    })

    it('documents and returns correct lifecycle state for DRAFT and CANCELLED sessions', () => {
      // 1. DRAFT session
      const draftSession: LiveSession = {
        ...baseSession,
        status: 'DRAFT',
        startedAt: null,
        endedAt: null,
      }
      const draftMetrics = computeSessionOperationalMetrics(draftSession, [], 10, true)
      expect(draftMetrics.studentAttendance.completeness).toBe('UNSTARTED')
      expect(draftMetrics.studentAttendance.totalEnrolled).toBe(10)
      expect(draftMetrics.studentAttendance.notJoinedCount).toBe(10)
      expect(draftMetrics.studentAttendance.attendanceRatePct).toBeNull()

      // 2. CANCELLED session
      const cancelledSession: LiveSession = {
        ...baseSession,
        status: 'CANCELLED',
        startedAt: null,
        endedAt: null,
      }
      const cancelledMetrics = computeSessionOperationalMetrics(cancelledSession, [], 10, true)
      expect(cancelledMetrics.studentAttendance.completeness).toBe('CANCELLED')
      expect(cancelledMetrics.studentAttendance.isPartialData).toBe(true)
      expect(cancelledMetrics.studentAttendance.attendanceRatePct).toBeNull()
    })

    // BLOCKER A REGRESSION: Finalized roster contains 3 students, course enrollment is 5
    it('BLOCKER A: finalized student roster of 3 is authoritative when current course enrollment is 5', () => {
      const finalizedAttendance: LiveSessionAttendance[] = [
        {
          id: 'att-fin-1',
          live_session_id: validSessionId,
          user_id: student1Id,
          role: 'student',
          first_joined_at: '2026-10-09T10:01:00Z',
          last_left_at: '2026-10-09T10:55:00Z',
          total_duration_seconds: 3200,
          attendance_status: 'PRESENT',
          is_late: false,
          created_at: '2026-10-09T10:00:00Z',
          updated_at: '2026-10-09T11:00:00Z',
        },
        {
          id: 'att-fin-2',
          live_session_id: validSessionId,
          user_id: student2Id,
          role: 'student',
          first_joined_at: '2026-10-09T10:15:00Z',
          last_left_at: '2026-10-09T10:45:00Z',
          total_duration_seconds: 1800,
          attendance_status: 'PARTIAL',
          is_late: true,
          created_at: '2026-10-09T10:00:00Z',
          updated_at: '2026-10-09T11:00:00Z',
        },
        {
          id: 'att-fin-3',
          live_session_id: validSessionId,
          user_id: student3Id,
          role: 'student',
          first_joined_at: null,
          last_left_at: null,
          total_duration_seconds: 0,
          attendance_status: 'ABSENT',
          is_late: false,
          created_at: '2026-10-09T10:00:00Z',
          updated_at: '2026-10-09T11:00:00Z',
        },
      ]

      // Current course enrollment count is 5 (e.g. 2 new students enrolled later)
      const metrics = computeSessionOperationalMetrics(baseSession, finalizedAttendance, 5, true)

      // Total enrolled must be 3 (authoritative finalized roster size), NOT inflated to 5!
      expect(metrics.studentAttendance.totalEnrolled).toBe(3)
      expect(metrics.studentAttendance.presentCount).toBe(1)
      expect(metrics.studentAttendance.partialCount).toBe(1)
      expect(metrics.studentAttendance.absentCount).toBe(1)
      expect(metrics.studentAttendance.attendedCount).toBe(2)
      // All 3 students are accounted for in the finalized roster
      expect(metrics.studentAttendance.notJoinedCount).toBe(0)
      // 2 / 3 = 66.7% (NOT 2 / 5 = 40.0%)
      expect(metrics.studentAttendance.attendanceRatePct).toBe(66.7)
      expect(metrics.studentAttendance.completeness).toBe('FINALIZED')
      expect(metrics.studentAttendance.isPartialData).toBe(false)
      expect(metrics.isPartialData).toBe(false)
    })

    it('BLOCKER A: exposes genuine roster-integrity mismatch if ENDED session has 0 roster rows but course has enrollments', () => {
      // ENDED session with empty attendance roster, but course has 5 enrollments
      const metrics = computeSessionOperationalMetrics(baseSession, [], 5, true)

      expect(metrics.studentAttendance.completeness).toBe('FINALIZED')
      expect(metrics.studentAttendance.totalEnrolled).toBe(5)
      expect(metrics.studentAttendance.presentCount).toBe(0)
      expect(metrics.studentAttendance.partialCount).toBe(0)
      expect(metrics.studentAttendance.absentCount).toBe(0)
      expect(metrics.studentAttendance.attendedCount).toBe(0)
      expect(metrics.studentAttendance.joinedCount).toBe(0)
      // Participants without rows cannot safely be classified as not joined:
      expect(metrics.studentAttendance.notJoinedCount).toBeNull()
      // Attendance cannot be inferred; do NOT silently treat as 0%:
      expect(metrics.studentAttendance.attendanceRatePct).toBeNull()
      expect(metrics.studentAttendance.lateCount).toBe(0)
      expect(metrics.studentAttendance.lateRatePct).toBeNull()
      expect(metrics.studentAttendance.isPartialData).toBe(true)
      expect(metrics.isPartialData).toBe(true)
    })

    // BLOCKER B REGRESSION: CANCELLED before start vs after start
    it('BLOCKER B: CANCELLED before start with no attendance rows sets attendanceRatePct=null and isPartialData=true', () => {
      const cancelledBeforeStart: LiveSession = {
        ...baseSession,
        status: 'CANCELLED',
        startedAt: null,
        endedAt: null,
      }

      // 1. Enrollment count available (10)
      const metricsAvailable = computeSessionOperationalMetrics(cancelledBeforeStart, [], 10, true)
      expect(cancelledBeforeStart.startedAt).toBeNull()
      expect(metricsAvailable.studentAttendance.completeness).toBe('CANCELLED')
      expect(metricsAvailable.studentAttendance.totalEnrolled).toBe(10)
      expect(metricsAvailable.studentAttendance.presentCount).toBe(0)
      expect(metricsAvailable.studentAttendance.partialCount).toBe(0)
      expect(metricsAvailable.studentAttendance.absentCount).toBe(0) // Learners without rows NOT classified as ABSENT!
      expect(metricsAvailable.studentAttendance.attendedCount).toBe(0)
      expect(metricsAvailable.studentAttendance.joinedCount).toBe(0)
      expect(metricsAvailable.studentAttendance.notJoinedCount).toBe(10)
      // Must be null/not applicable, NOT 0%
      expect(metricsAvailable.studentAttendance.attendanceRatePct).toBeNull()
      expect(metricsAvailable.studentAttendance.lateCount).toBe(0)
      expect(metricsAvailable.studentAttendance.lateRatePct).toBeNull()
      expect(metricsAvailable.studentAttendance.isPartialData).toBe(true)
      expect(metricsAvailable.isPartialData).toBe(true)

      // 2. Enrollment count unavailable
      const metricsUnavailable = computeSessionOperationalMetrics(cancelledBeforeStart, [], null, false)
      expect(metricsUnavailable.studentAttendance.completeness).toBe('CANCELLED')
      expect(metricsUnavailable.studentAttendance.totalEnrolled).toBeNull()
      expect(metricsUnavailable.studentAttendance.notJoinedCount).toBeNull()
      expect(metricsUnavailable.studentAttendance.attendanceRatePct).toBeNull()
      expect(metricsUnavailable.studentAttendance.isPartialData).toBe(true)
      expect(metricsUnavailable.isPartialData).toBe(true)
    })

    it('BLOCKER B: CANCELLED after start reports recorded attendance with isPartialData=true and unclassified non-attendees', () => {
      const cancelledAfterStart: LiveSession = {
        ...baseSession,
        status: 'CANCELLED',
        startedAt: '2026-10-09T10:00:00.000Z',
        endedAt: '2026-10-09T10:25:00.000Z', // Cancelled after 25 minutes
      }

      const partialAttendance: LiveSessionAttendance[] = [
        {
          id: 'att-c-1',
          live_session_id: validSessionId,
          user_id: student1Id,
          role: 'student',
          first_joined_at: '2026-10-09T10:02:00Z',
          last_left_at: '2026-10-09T10:25:00Z',
          total_duration_seconds: 1380,
          attendance_status: 'PRESENT',
          is_late: false,
          created_at: '2026-10-09T10:00:00Z',
          updated_at: '2026-10-09T10:25:00Z',
        },
        {
          id: 'att-c-2',
          live_session_id: validSessionId,
          user_id: student2Id,
          role: 'student',
          first_joined_at: '2026-10-09T10:12:00Z',
          last_left_at: '2026-10-09T10:25:00Z',
          total_duration_seconds: 780,
          attendance_status: 'PARTIAL',
          is_late: true,
          created_at: '2026-10-09T10:00:00Z',
          updated_at: '2026-10-09T10:25:00Z',
        },
      ]

      // Enrollment count available (10)
      const metrics = computeSessionOperationalMetrics(cancelledAfterStart, partialAttendance, 10, true)

      expect(metrics.studentAttendance.completeness).toBe('CANCELLED')
      expect(metrics.studentAttendance.totalEnrolled).toBe(10)
      expect(metrics.studentAttendance.presentCount).toBe(1)
      expect(metrics.studentAttendance.partialCount).toBe(1)
      expect(metrics.studentAttendance.absentCount).toBe(0) // 8 non-attendees NOT classified as ABSENT!
      expect(metrics.studentAttendance.attendedCount).toBe(2)
      expect(metrics.studentAttendance.joinedCount).toBe(2)
      expect(metrics.studentAttendance.notJoinedCount).toBe(8) // 10 - 2 = 8
      // Recorded rate is reported: 2 / 10 = 20.0%
      expect(metrics.studentAttendance.attendanceRatePct).toBe(20.0)
      expect(metrics.studentAttendance.lateCount).toBe(1)
      expect(metrics.studentAttendance.lateRatePct).toBe(50.0) // 1 / 2 = 50.0%
      // Must explicitly remain partial/unfinalized:
      expect(metrics.studentAttendance.isPartialData).toBe(true)
      expect(metrics.isPartialData).toBe(true)

      // When enrollment count is unavailable
      const metricsNoEnrolled = computeSessionOperationalMetrics(cancelledAfterStart, partialAttendance, null, false)
      expect(metricsNoEnrolled.studentAttendance.completeness).toBe('CANCELLED')
      expect(metricsNoEnrolled.studentAttendance.totalEnrolled).toBeNull() // Does not substitute 2 as enrolled!
      expect(metricsNoEnrolled.studentAttendance.notJoinedCount).toBeNull()
      expect(metricsNoEnrolled.studentAttendance.attendanceRatePct).toBeNull()
      expect(metricsNoEnrolled.studentAttendance.isPartialData).toBe(true)
      expect(metricsNoEnrolled.isPartialData).toBe(true)
    })

    it('TASK 9.4: marks isPartialData=true when hasCacheMismatch is passed as true', () => {
      const liveSession: LiveSession = {
        ...baseSession,
        status: 'LIVE',
        startedAt: new Date(Date.now() - 1800_000).toISOString(),
        endedAt: null,
      }
      const metrics = computeSessionOperationalMetrics(liveSession, [], 0, true, true)
      expect(metrics.studentAttendance.totalEnrolled).toBe(0)
      expect(metrics.studentAttendance.isPartialData).toBe(true)
      expect(metrics.isPartialData).toBe(true)
    })

    it('TASK 9.4 REGRESSION 1: ENDED complete roster + hasCacheMismatch=true preserves valid attendance rate and notJoinedCount', () => {
      const finalizedAttendance: LiveSessionAttendance[] = [
        {
          id: 'att-fin-1',
          live_session_id: validSessionId,
          user_id: student1Id,
          role: 'student',
          first_joined_at: '2026-10-09T10:05:00Z',
          last_left_at: '2026-10-09T10:55:00Z',
          total_duration_seconds: 3000,
          attendance_status: 'PRESENT',
          is_late: false,
          created_at: '2026-10-09T10:00:00Z',
          updated_at: '2026-10-09T11:00:00Z',
        },
        {
          id: 'att-fin-2',
          live_session_id: validSessionId,
          user_id: student2Id,
          role: 'student',
          first_joined_at: '2026-10-09T10:20:00Z',
          last_left_at: '2026-10-09T10:40:00Z',
          total_duration_seconds: 1200,
          attendance_status: 'PARTIAL',
          is_late: true,
          created_at: '2026-10-09T10:00:00Z',
          updated_at: '2026-10-09T11:00:00Z',
        },
        {
          id: 'att-fin-3',
          live_session_id: validSessionId,
          user_id: student3Id,
          role: 'student',
          first_joined_at: null,
          last_left_at: null,
          total_duration_seconds: 0,
          attendance_status: 'ABSENT',
          is_late: false,
          created_at: '2026-10-09T10:00:00Z',
          updated_at: '2026-10-09T11:00:00Z',
        },
      ]

      // Direct count 0, cached count 8 -> hasCacheMismatch = true
      const metrics = computeSessionOperationalMetrics(baseSession, finalizedAttendance, 0, true, true)

      // Total enrolled preserved as 3 (authoritative finalized roster size)
      expect(metrics.studentAttendance.totalEnrolled).toBe(3)
      expect(metrics.studentAttendance.presentCount).toBe(1)
      expect(metrics.studentAttendance.partialCount).toBe(1)
      expect(metrics.studentAttendance.absentCount).toBe(1)
      expect(metrics.studentAttendance.attendedCount).toBe(2)
      // All 3 students accounted for -> notJoinedCount is 0 (NOT null!)
      expect(metrics.studentAttendance.notJoinedCount).toBe(0)
      // Attendance rate preserved: 2 / 3 = 66.7% (NOT null!)
      expect(metrics.studentAttendance.attendanceRatePct).toBe(66.7)
      // Attendance roster is complete (isPartialData = false)
      expect(metrics.studentAttendance.isPartialData).toBe(false)
      expect(metrics.isPartialData).toBe(false)
      // Course cache mismatch is exposed independently
      expect(metrics.studentAttendance.hasCacheMismatch).toBe(true)
      expect(metrics.hasCacheMismatch).toBe(true)
    })

    it('TASK 9.4 REGRESSION 2: LIVE with attendance rows, direct count=0, and cached count>0 never uses studentRows.length as totalEnrolled', () => {
      const liveSession: LiveSession = {
        ...baseSession,
        status: 'LIVE',
        startedAt: new Date(Date.now() - 1800_000).toISOString(),
        endedAt: null,
      }

      const liveAttendance: LiveSessionAttendance[] = [
        {
          id: 'att-live-1',
          live_session_id: validSessionId,
          user_id: student1Id,
          role: 'student',
          first_joined_at: new Date(Date.now() - 1700_000).toISOString(),
          last_left_at: null,
          total_duration_seconds: 1700,
          attendance_status: 'PRESENT',
          is_late: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'att-live-2',
          live_session_id: validSessionId,
          user_id: student2Id,
          role: 'student',
          first_joined_at: new Date(Date.now() - 600_000).toISOString(),
          last_left_at: null,
          total_duration_seconds: 600,
          attendance_status: 'PARTIAL',
          is_late: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]

      // direct count 0, cached count 8 -> hasCacheMismatch = true
      const metrics = computeSessionOperationalMetrics(liveSession, liveAttendance, 0, true, true)

      // Must NEVER substitute partial attendance roster size (2) as totalEnrolled!
      expect(metrics.studentAttendance.totalEnrolled).not.toBe(liveAttendance.length)
      expect(metrics.studentAttendance.totalEnrolled).toBe(0)
      // Derived values that cannot safely be interpreted are suppressed:
      expect(metrics.studentAttendance.notJoinedCount).toBeNull()
      expect(metrics.studentAttendance.attendanceRatePct).toBeNull()
      // Marked as partial data and mismatch exposed:
      expect(metrics.studentAttendance.isPartialData).toBe(true)
      expect(metrics.studentAttendance.hasCacheMismatch).toBe(true)
      expect(metrics.studentAttendance.hasRosterConflict).toBe(true)
      expect(metrics.isPartialData).toBe(true)
      expect(metrics.hasCacheMismatch).toBe(true)
      expect(metrics.hasRosterConflict).toBe(true)
    })

    it('TASK 9.4 REGRESSION 3: CANCELLED with attendance rows and direct count=0 vs cached>0 has consistent denominator and partial-data semantics', () => {
      const cancelledSession: LiveSession = {
        ...baseSession,
        status: 'CANCELLED',
        startedAt: new Date(Date.now() - 1800_000).toISOString(),
        endedAt: new Date(Date.now() - 600_000).toISOString(),
      }

      const partialAttendance: LiveSessionAttendance[] = [
        {
          id: 'att-canc-1',
          live_session_id: validSessionId,
          user_id: student1Id,
          role: 'student',
          first_joined_at: new Date(Date.now() - 1700_000).toISOString(),
          last_left_at: new Date(Date.now() - 1000_000).toISOString(),
          total_duration_seconds: 700,
          attendance_status: 'PARTIAL',
          is_late: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]

      // direct count 0, cached count 8 -> hasCacheMismatch = true
      const metrics = computeSessionOperationalMetrics(cancelledSession, partialAttendance, 0, true, true)

      // Consistent denominator: retains trusted denominator 0, NEVER substitutes roster size (1)
      expect(metrics.studentAttendance.totalEnrolled).not.toBe(partialAttendance.length)
      expect(metrics.studentAttendance.totalEnrolled).toBe(0)
      expect(metrics.studentAttendance.notJoinedCount).toBeNull()
      expect(metrics.studentAttendance.attendanceRatePct).toBeNull()
      expect(metrics.studentAttendance.isPartialData).toBe(true)
      expect(metrics.studentAttendance.hasCacheMismatch).toBe(true)
      expect(metrics.studentAttendance.hasRosterConflict).toBe(true)
      expect(metrics.isPartialData).toBe(true)
      expect(metrics.hasCacheMismatch).toBe(true)
      expect(metrics.hasRosterConflict).toBe(true)
    })

    it('TASK 9.4 REGRESSION 4A: LIVE with enrollment count 0, cached count 0, but student rows exist (hasCacheMismatch=false); denominator never becomes studentRows.length', () => {
      const liveSession: LiveSession = {
        ...baseSession,
        status: 'LIVE',
        startedAt: new Date(Date.now() - 1800_000).toISOString(),
        endedAt: null,
      }

      const liveAttendance: LiveSessionAttendance[] = [
        {
          id: 'att-live-r4a',
          live_session_id: validSessionId,
          user_id: student1Id,
          role: 'student',
          first_joined_at: new Date(Date.now() - 1700_000).toISOString(),
          last_left_at: null,
          total_duration_seconds: 1700,
          attendance_status: 'PRESENT',
          is_late: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]

      // direct count 0, cached count 0 -> hasCacheMismatch = false
      const metrics = computeSessionOperationalMetrics(liveSession, liveAttendance, 0, true, false)

      // Retain trusted denominator 0, NEVER silently replace with studentRows.length (1)
      expect(metrics.studentAttendance.totalEnrolled).not.toBe(liveAttendance.length)
      expect(metrics.studentAttendance.totalEnrolled).toBe(0)
      // Mismatch is NOT a cache mismatch; it is a roster-count conflict
      expect(metrics.studentAttendance.hasCacheMismatch).toBe(false)
      expect(metrics.hasCacheMismatch).toBe(false)
      expect(metrics.studentAttendance.hasRosterConflict).toBe(true)
      expect(metrics.hasRosterConflict).toBe(true)
      // Unsafe derived metrics suppressed
      expect(metrics.studentAttendance.notJoinedCount).toBeNull()
      expect(metrics.studentAttendance.attendanceRatePct).toBeNull()
      expect(metrics.studentAttendance.isPartialData).toBe(true)
      expect(metrics.isPartialData).toBe(true)
    })

    it('TASK 9.4 REGRESSION 4B: CANCELLED with enrollment count 0, cached count 0, but student rows exist (hasCacheMismatch=false); denominator never becomes studentRows.length', () => {
      const cancelledSession: LiveSession = {
        ...baseSession,
        status: 'CANCELLED',
        startedAt: new Date(Date.now() - 1800_000).toISOString(),
        endedAt: new Date(Date.now() - 600_000).toISOString(),
      }

      const partialAttendance: LiveSessionAttendance[] = [
        {
          id: 'att-canc-r4b',
          live_session_id: validSessionId,
          user_id: student1Id,
          role: 'student',
          first_joined_at: new Date(Date.now() - 1700_000).toISOString(),
          last_left_at: new Date(Date.now() - 1000_000).toISOString(),
          total_duration_seconds: 700,
          attendance_status: 'PARTIAL',
          is_late: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]

      // direct count 0, cached count 0 -> hasCacheMismatch = false
      const metrics = computeSessionOperationalMetrics(cancelledSession, partialAttendance, 0, true, false)

      // Retain trusted denominator 0, NEVER silently replace with studentRows.length (1)
      expect(metrics.studentAttendance.totalEnrolled).not.toBe(partialAttendance.length)
      expect(metrics.studentAttendance.totalEnrolled).toBe(0)
      expect(metrics.studentAttendance.hasCacheMismatch).toBe(false)
      expect(metrics.hasCacheMismatch).toBe(false)
      expect(metrics.studentAttendance.hasRosterConflict).toBe(true)
      expect(metrics.hasRosterConflict).toBe(true)
      expect(metrics.studentAttendance.notJoinedCount).toBeNull()
      expect(metrics.studentAttendance.attendanceRatePct).toBeNull()
      expect(metrics.studentAttendance.isPartialData).toBe(true)
      expect(metrics.isPartialData).toBe(true)
    })

    it('TASK 9.4 REGRESSION 5A: LIVE with enrollment count 2 but 3 student rows; suppresses unsafe derived metrics and avoids >100% rate', () => {
      const liveSession: LiveSession = {
        ...baseSession,
        status: 'LIVE',
        startedAt: new Date(Date.now() - 1800_000).toISOString(),
        endedAt: null,
      }

      const threeStudents: LiveSessionAttendance[] = [
        {
          id: 'att-r5a-1',
          live_session_id: validSessionId,
          user_id: student1Id,
          role: 'student',
          first_joined_at: new Date(Date.now() - 1700_000).toISOString(),
          last_left_at: null,
          total_duration_seconds: 1700,
          attendance_status: 'PRESENT',
          is_late: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'att-r5a-2',
          live_session_id: validSessionId,
          user_id: student2Id,
          role: 'student',
          first_joined_at: new Date(Date.now() - 1200_000).toISOString(),
          last_left_at: null,
          total_duration_seconds: 1200,
          attendance_status: 'PRESENT',
          is_late: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'att-r5a-3',
          live_session_id: validSessionId,
          user_id: student3Id,
          role: 'student',
          first_joined_at: new Date(Date.now() - 600_000).toISOString(),
          last_left_at: null,
          total_duration_seconds: 600,
          attendance_status: 'PARTIAL',
          is_late: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]

      // Known enrollment count is 2, no cache mismatch
      const metrics = computeSessionOperationalMetrics(liveSession, threeStudents, 2, true, false)

      // Must not inflate totalEnrolled to 3
      expect(metrics.studentAttendance.totalEnrolled).toBe(2)
      expect(metrics.studentAttendance.hasCacheMismatch).toBe(false)
      expect(metrics.hasCacheMismatch).toBe(false)
      expect(metrics.studentAttendance.hasRosterConflict).toBe(true)
      expect(metrics.hasRosterConflict).toBe(true)
      // Must not report misleading rate (e.g. 3/2 = 150%) or infer notJoinedCount (2 - 3 = -1)
      expect(metrics.studentAttendance.attendanceRatePct).toBeNull()
      expect(metrics.studentAttendance.notJoinedCount).toBeNull()
      expect(metrics.studentAttendance.isPartialData).toBe(true)
      expect(metrics.isPartialData).toBe(true)
    })

    it('TASK 9.4 REGRESSION 5B: CANCELLED with enrollment count 2 but 3 student rows; retains denominator 2, marks conflict, and suppresses derived metrics', () => {
      const cancelledSession: LiveSession = {
        ...baseSession,
        status: 'CANCELLED',
        startedAt: new Date(Date.now() - 1800_000).toISOString(),
        endedAt: new Date(Date.now() - 600_000).toISOString(),
      }

      const threeStudents: LiveSessionAttendance[] = [
        {
          id: 'att-r5b-1',
          live_session_id: validSessionId,
          user_id: student1Id,
          role: 'student',
          first_joined_at: new Date(Date.now() - 1700_000).toISOString(),
          last_left_at: new Date(Date.now() - 1000_000).toISOString(),
          total_duration_seconds: 700,
          attendance_status: 'PRESENT',
          is_late: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'att-r5b-2',
          live_session_id: validSessionId,
          user_id: student2Id,
          role: 'student',
          first_joined_at: new Date(Date.now() - 1200_000).toISOString(),
          last_left_at: new Date(Date.now() - 800_000).toISOString(),
          total_duration_seconds: 400,
          attendance_status: 'PARTIAL',
          is_late: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'att-r5b-3',
          live_session_id: validSessionId,
          user_id: student3Id,
          role: 'student',
          first_joined_at: new Date(Date.now() - 900_000).toISOString(),
          last_left_at: new Date(Date.now() - 600_000).toISOString(),
          total_duration_seconds: 300,
          attendance_status: 'PARTIAL',
          is_late: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]

      // Known enrollment count is 2, no cache mismatch
      const metrics = computeSessionOperationalMetrics(cancelledSession, threeStudents, 2, true, false)

      // Retain trusted denominator 2, never inflate to 3
      expect(metrics.studentAttendance.totalEnrolled).toBe(2)
      expect(metrics.studentAttendance.hasCacheMismatch).toBe(false)
      expect(metrics.hasCacheMismatch).toBe(false)
      expect(metrics.studentAttendance.hasRosterConflict).toBe(true)
      expect(metrics.hasRosterConflict).toBe(true)
      expect(metrics.studentAttendance.attendanceRatePct).toBeNull()
      expect(metrics.studentAttendance.notJoinedCount).toBeNull()
      expect(metrics.studentAttendance.isPartialData).toBe(true)
      expect(metrics.isPartialData).toBe(true)
    })

    // BLOCKER B: isFinalizedRosterMissing diagnostics
    describe('BLOCKER B: isFinalizedRosterMissing diagnostics', () => {
      it('marks isFinalizedRosterMissing=true for ENDED session with positive enrollment and missing roster', () => {
        const metrics = computeSessionOperationalMetrics(baseSession, [], 10, true, false)
        expect(metrics.studentAttendance.completeness).toBe('FINALIZED')
        expect(metrics.studentAttendance.totalEnrolled).toBe(10)
        expect(metrics.studentAttendance.isFinalizedRosterMissing).toBe(true)
        expect(metrics.isFinalizedRosterMissing).toBe(true)
        expect(metrics.studentAttendance.isPartialData).toBe(true)
        expect(metrics.isPartialData).toBe(true)
        expect(metrics.studentAttendance.attendanceRatePct).toBeNull()
        expect(metrics.studentAttendance.notJoinedCount).toBeNull()
      })

      it('marks isFinalizedRosterMissing=true for ENDED session with unknown enrollment and missing roster', () => {
        const metrics = computeSessionOperationalMetrics(baseSession, [], null, false, false)
        expect(metrics.studentAttendance.completeness).toBe('FINALIZED')
        expect(metrics.studentAttendance.totalEnrolled).toBeNull()
        expect(metrics.studentAttendance.isFinalizedRosterMissing).toBe(true)
        expect(metrics.isFinalizedRosterMissing).toBe(true)
        expect(metrics.studentAttendance.isPartialData).toBe(true)
        expect(metrics.isPartialData).toBe(true)
        expect(metrics.studentAttendance.attendanceRatePct).toBeNull()
        expect(metrics.studentAttendance.notJoinedCount).toBeNull()
      })

      it('marks isFinalizedRosterMissing=false for legitimate finalized session with zero enrollment and empty roster', () => {
        const metrics = computeSessionOperationalMetrics(baseSession, [], 0, true, false)
        expect(metrics.studentAttendance.completeness).toBe('FINALIZED')
        expect(metrics.studentAttendance.totalEnrolled).toBe(0)
        expect(metrics.studentAttendance.isFinalizedRosterMissing).toBe(false)
        expect(metrics.isFinalizedRosterMissing).toBe(false)
        expect(metrics.studentAttendance.isPartialData).toBe(false)
        expect(metrics.isPartialData).toBe(false)
        expect(metrics.studentAttendance.hasCacheMismatch).toBe(false)
        expect(metrics.studentAttendance.hasRosterConflict).toBe(false)
        expect(metrics.studentAttendance.attendanceRatePct).toBeNull()
        expect(metrics.studentAttendance.notJoinedCount).toBe(0)
      })

      it('marks isFinalizedRosterMissing=false for complete finalized roster', () => {
        const finalizedAttendance: LiveSessionAttendance[] = [
          {
            id: 'att-1',
            live_session_id: validSessionId,
            user_id: student1Id,
            role: 'student',
            first_joined_at: '2026-10-09T10:01:00Z',
            last_left_at: '2026-10-09T10:55:00Z',
            total_duration_seconds: 3200,
            attendance_status: 'PRESENT',
            is_late: false,
            created_at: '2026-10-09T10:00:00Z',
            updated_at: '2026-10-09T11:00:00Z',
          },
          {
            id: 'att-2',
            live_session_id: validSessionId,
            user_id: student2Id,
            role: 'student',
            first_joined_at: null,
            last_left_at: null,
            total_duration_seconds: 0,
            attendance_status: 'ABSENT',
            is_late: false,
            created_at: '2026-10-09T10:00:00Z',
            updated_at: '2026-10-09T11:00:00Z',
          },
        ]

        const metrics = computeSessionOperationalMetrics(baseSession, finalizedAttendance, 2, true, false)
        expect(metrics.studentAttendance.completeness).toBe('FINALIZED')
        expect(metrics.studentAttendance.totalEnrolled).toBe(2)
        expect(metrics.studentAttendance.isFinalizedRosterMissing).toBe(false)
        expect(metrics.isFinalizedRosterMissing).toBe(false)
        expect(metrics.studentAttendance.isPartialData).toBe(false)
        expect(metrics.isPartialData).toBe(false)
      })

      it('distinguishes cache mismatch on complete roster (isFinalizedRosterMissing=false) vs empty roster (isFinalizedRosterMissing=true)', () => {
        const finalizedAttendance: LiveSessionAttendance[] = [
          {
            id: 'att-1',
            live_session_id: validSessionId,
            user_id: student1Id,
            role: 'student',
            first_joined_at: '2026-10-09T10:01:00Z',
            last_left_at: '2026-10-09T10:55:00Z',
            total_duration_seconds: 3200,
            attendance_status: 'PRESENT',
            is_late: false,
            created_at: '2026-10-09T10:00:00Z',
            updated_at: '2026-10-09T11:00:00Z',
          },
        ]
        // Case 1: Complete roster with cache mismatch
        const completeWithCacheMismatch = computeSessionOperationalMetrics(baseSession, finalizedAttendance, 0, true, true)
        expect(completeWithCacheMismatch.hasCacheMismatch).toBe(true)
        expect(completeWithCacheMismatch.isFinalizedRosterMissing).toBe(false)
        expect(completeWithCacheMismatch.studentAttendance.isFinalizedRosterMissing).toBe(false)

        // Case 2: Empty roster with cache mismatch
        const emptyWithCacheMismatch = computeSessionOperationalMetrics(baseSession, [], 0, true, true)
        expect(emptyWithCacheMismatch.hasCacheMismatch).toBe(true)
        expect(emptyWithCacheMismatch.isFinalizedRosterMissing).toBe(true)
        expect(emptyWithCacheMismatch.studentAttendance.isFinalizedRosterMissing).toBe(true)
      })

      it('distinguishes roster conflict and LIVE/CANCELLED states from isFinalizedRosterMissing', () => {
        // LIVE session
        const liveSession: LiveSession = {
          ...baseSession,
          status: 'LIVE',
          startedAt: new Date(Date.now() - 1800_000).toISOString(),
          endedAt: null,
        }
        const liveMetrics = computeSessionOperationalMetrics(liveSession, [], 5, true, false)
        expect(liveMetrics.studentAttendance.completeness).toBe('PROVISIONAL')
        expect(liveMetrics.isFinalizedRosterMissing).toBe(false)

        // CANCELLED session
        const cancelledSession: LiveSession = {
          ...baseSession,
          status: 'CANCELLED',
          startedAt: null,
          endedAt: null,
        }
        const cancelledMetrics = computeSessionOperationalMetrics(cancelledSession, [], 5, true, false)
        expect(cancelledMetrics.studentAttendance.completeness).toBe('CANCELLED')
        expect(cancelledMetrics.isFinalizedRosterMissing).toBe(false)
      })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Chess Game Analytics (computeSessionGameAnalytics)
  // ───────────────────────────────────────────────────────────────────────────
  describe('computeSessionGameAnalytics', () => {
    // BLOCKER C: Game Outcome Classification Invariants
    it('BLOCKER C: strictly classifies IN_PROGRESS, ABORTED, and missing results under unfinishedOrUnknown', () => {
      const testGames: LiveGame[] = [
        // 1. IN_PROGRESS with result '*'
        {
          id: 'g-in-prog-star',
          live_session_id: validSessionId,
          board_id: 'main',
          game_scope: 'MAIN',
          white_user_id: creatorId,
          black_user_id: student1Id,
          starting_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          final_fen: null,
          pgn: '1. e4 e5 *',
          result: '*',
          termination_reason: null,
          status: 'IN_PROGRESS',
          move_count: 2,
          started_at: '2026-10-09T10:00:00Z',
          ended_at: null,
          submitted_by: null,
          created_at: '2026-10-09T10:00:00Z',
          updated_at: '2026-10-09T10:00:00Z',
        },
        // 2. IN_PROGRESS with nominal result '1-0' (should NOT count as White win!)
        {
          id: 'g-in-prog-nominal',
          live_session_id: validSessionId,
          board_id: 'practice-1',
          game_scope: 'PRACTICE',
          white_user_id: student1Id,
          black_user_id: student2Id,
          starting_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          final_fen: null,
          pgn: '1. d4 1-0',
          result: '1-0',
          termination_reason: null,
          status: 'IN_PROGRESS',
          move_count: 1,
          started_at: '2026-10-09T10:05:00Z',
          ended_at: null,
          submitted_by: null,
          created_at: '2026-10-09T10:05:00Z',
          updated_at: '2026-10-09T10:05:00Z',
        },
        // 3. ABORTED with result '*'
        {
          id: 'g-aborted-star',
          live_session_id: validSessionId,
          board_id: 'practice-2',
          game_scope: 'PRACTICE',
          white_user_id: student2Id,
          black_user_id: student3Id,
          starting_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          final_fen: null,
          pgn: '1. e4 c5 *',
          result: '*',
          termination_reason: 'aborted',
          status: 'ABORTED',
          move_count: 2,
          started_at: '2026-10-09T10:10:00Z',
          ended_at: '2026-10-09T10:12:00Z',
          submitted_by: null,
          created_at: '2026-10-09T10:10:00Z',
          updated_at: '2026-10-09T10:12:00Z',
        },
        // 4. ABORTED with nominal result '0-1' (should NOT count as Black win!)
        {
          id: 'g-aborted-nominal',
          live_session_id: validSessionId,
          board_id: 'practice-3',
          game_scope: 'PRACTICE',
          white_user_id: student1Id,
          black_user_id: student3Id,
          starting_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          final_fen: null,
          pgn: '1. Nf3 Nf6 0-1',
          result: '0-1',
          termination_reason: 'aborted_player_left',
          status: 'ABORTED',
          move_count: 2,
          started_at: '2026-10-09T10:15:00Z',
          ended_at: '2026-10-09T10:16:00Z',
          submitted_by: null,
          created_at: '2026-10-09T10:15:00Z',
          updated_at: '2026-10-09T10:16:00Z',
        },
        // 5. COMPLETED with missing or unknown result '*'
        {
          id: 'g-completed-star',
          live_session_id: validSessionId,
          board_id: 'practice-4',
          game_scope: 'PRACTICE',
          white_user_id: student2Id,
          black_user_id: student1Id,
          starting_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          final_fen: null,
          pgn: '1. c4 e5 *',
          result: '*',
          termination_reason: 'unknown',
          status: 'COMPLETED',
          move_count: 2,
          started_at: '2026-10-09T10:20:00Z',
          ended_at: '2026-10-09T10:25:00Z',
          submitted_by: student2Id,
          created_at: '2026-10-09T10:20:00Z',
          updated_at: '2026-10-09T10:25:00Z',
        },
        // 6. COMPLETED valid White win
        {
          id: 'g-completed-white',
          live_session_id: validSessionId,
          board_id: 'main',
          game_scope: 'MAIN',
          white_user_id: creatorId,
          black_user_id: student1Id,
          starting_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          final_fen: null,
          pgn: '1. e4 e5 1-0',
          result: '1-0',
          termination_reason: 'checkmate',
          status: 'COMPLETED',
          move_count: 20,
          started_at: '2026-10-09T10:30:00Z',
          ended_at: '2026-10-09T10:45:00Z',
          submitted_by: creatorId,
          created_at: '2026-10-09T10:30:00Z',
          updated_at: '2026-10-09T10:45:00Z',
        },
        // 7. COMPLETED valid Black win
        {
          id: 'g-completed-black',
          live_session_id: validSessionId,
          board_id: 'practice-1',
          game_scope: 'PRACTICE',
          white_user_id: student1Id,
          black_user_id: student2Id,
          starting_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          final_fen: null,
          pgn: '1. d4 d5 0-1',
          result: '0-1',
          termination_reason: 'resignation',
          status: 'COMPLETED',
          move_count: 24,
          started_at: '2026-10-09T10:30:00Z',
          ended_at: '2026-10-09T10:48:00Z',
          submitted_by: student2Id,
          created_at: '2026-10-09T10:30:00Z',
          updated_at: '2026-10-09T10:48:00Z',
        },
        // 8. COMPLETED valid Draw
        {
          id: 'g-completed-draw',
          live_session_id: validSessionId,
          board_id: 'practice-2',
          game_scope: 'PRACTICE',
          white_user_id: student2Id,
          black_user_id: student3Id,
          starting_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          final_fen: null,
          pgn: '1. e4 c5 1/2-1/2',
          result: '1/2-1/2',
          termination_reason: 'draw_agreed',
          status: 'COMPLETED',
          move_count: 18,
          started_at: '2026-10-09T10:30:00Z',
          ended_at: '2026-10-09T10:50:00Z',
          submitted_by: student2Id,
          created_at: '2026-10-09T10:30:00Z',
          updated_at: '2026-10-09T10:50:00Z',
        },
      ]

      const chess = computeSessionGameAnalytics(validSessionId, testGames)

      expect(chess.totalGames).toBe(8)
      expect(chess.completedGames).toBe(4) // g-completed-star, white, black, draw
      expect(chess.unfinishedGames).toBe(2)
      expect(chess.abortedGames).toBe(2)

      // Verified result breakdown:
      expect(chess.resultBreakdown.whiteWins).toBe(1)
      expect(chess.resultBreakdown.blackWins).toBe(1)
      expect(chess.resultBreakdown.draws).toBe(1)
      // All 5 non-completed or unknown games are strictly in unfinishedOrUnknown:
      // g-in-prog-star, g-in-prog-nominal, g-aborted-star, g-aborted-nominal, g-completed-star
      expect(chess.resultBreakdown.unfinishedOrUnknown).toBe(5)

      // No double-counting, exact sum match:
      expect(
        chess.resultBreakdown.whiteWins +
        chess.resultBreakdown.blackWins +
        chess.resultBreakdown.draws +
        chess.resultBreakdown.unfinishedOrUnknown
      ).toBe(8)
    })

    // BLOCKER D: Move Count Unit Consistency (Plies) with odd and even counts
    it('BLOCKER D: PGN fallback matches persisted ply unit for both odd and even ply counts', () => {
      // Game with odd plies: 1. e4 e5 2. Nf3 (3 plies)
      const oddPlyGame: LiveGame = {
        id: 'g-odd-plies',
        live_session_id: validSessionId,
        board_id: 'practice-1',
        game_scope: 'PRACTICE',
        white_user_id: student1Id,
        black_user_id: student2Id,
        starting_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        final_fen: null,
        pgn: '1. e4 e5 2. Nf3 1-0', // Exactly 3 plies
        result: '1-0',
        termination_reason: 'resignation',
        status: 'COMPLETED',
        move_count: 0, // Fallback should count 3 plies
        started_at: '2026-10-09T10:00:00Z',
        ended_at: '2026-10-09T10:05:00Z',
        submitted_by: student1Id,
        created_at: '2026-10-09T10:00:00Z',
        updated_at: '2026-10-09T10:05:00Z',
      }

      // Game with even plies: 1. e4 e5 2. Nf3 Nc6 (4 plies)
      const evenPlyGame: LiveGame = {
        id: 'g-even-plies',
        live_session_id: validSessionId,
        board_id: 'practice-2',
        game_scope: 'PRACTICE',
        white_user_id: student2Id,
        black_user_id: student3Id,
        starting_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        final_fen: null,
        pgn: '1. e4 e5 2. Nf3 Nc6 0-1', // Exactly 4 plies
        result: '0-1',
        termination_reason: 'resignation',
        status: 'COMPLETED',
        move_count: 0, // Fallback should count 4 plies
        started_at: '2026-10-09T10:00:00Z',
        ended_at: '2026-10-09T10:06:00Z',
        submitted_by: student2Id,
        created_at: '2026-10-09T10:00:00Z',
        updated_at: '2026-10-09T10:06:00Z',
      }

      const chess = computeSessionGameAnalytics(validSessionId, [oddPlyGame, evenPlyGame])

      expect(chess.moveStats.sampleGameCount).toBe(2)
      // Total plies = 3 + 4 = 7
      expect(chess.moveStats.totalMoves).toBe(7)
      // Average plies = 3.5
      expect(chess.moveStats.averageMoves).toBe(3.5)
      expect(chess.moveStats.minMoves).toBe(3)
      expect(chess.moveStats.maxMoves).toBe(4)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Access Control & Authorization (assertSessionAnalyticsAccess)
  // ───────────────────────────────────────────────────────────────────────────
  describe('assertSessionAnalyticsAccess', () => {
    function makeAuthClient({
      userId,
      role = 'student',
      creatorId = 'other-creator',
      isAssistant = false,
    }: {
      userId?: string | null
      role?: string
      creatorId?: string
      isAssistant?: boolean
    }) {
      return {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: userId ? { id: userId } : null },
            error: userId ? null : new Error('No user'),
          }),
        },
        from: vi.fn((table: string) => {
          if (table === 'users') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { role },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table === 'courses') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { creator_id: creatorId },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table === 'live_session_staff') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: isAssistant ? { id: 'staff-1' } : null,
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      } as any
    }

    it('rejects unauthenticated caller', async () => {
      const client = makeAuthClient({ userId: null })
      const res = await assertSessionAnalyticsAccess(client, validSessionId, validCourseId)
      expect(res.authorized).toBe(false)
      expect(res.error?.message).toContain('unauthenticated')
    })

    it('authorizes course creator (teacher)', async () => {
      const client = makeAuthClient({ userId: creatorId, creatorId })
      const res = await assertSessionAnalyticsAccess(client, validSessionId, validCourseId)
      expect(res.authorized).toBe(true)
      expect(res.role).toBe('teacher')
    })

    it('authorizes assigned assistant', async () => {
      const client = makeAuthClient({ userId: assistantId, isAssistant: true })
      const res = await assertSessionAnalyticsAccess(client, validSessionId, validCourseId)
      expect(res.authorized).toBe(true)
      expect(res.role).toBe('assistant')
    })

    it('authorizes platform admin', async () => {
      const client = makeAuthClient({ userId: 'admin-1', role: 'admin' })
      const res = await assertSessionAnalyticsAccess(client, validSessionId, validCourseId)
      expect(res.authorized).toBe(true)
      expect(res.role).toBe('admin')
    })

    it('rejects enrolled student (forbidden for session-wide aggregates)', async () => {
      const client = makeAuthClient({ userId: student1Id, role: 'student', creatorId })
      const res = await assertSessionAnalyticsAccess(client, validSessionId, validCourseId)
      expect(res.authorized).toBe(false)
      expect(res.error?.message).toContain('forbidden')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 5. High-Level API (getLiveSessionAnalytics) & Enrollment Error Handling
  // ───────────────────────────────────────────────────────────────────────────
  describe('getLiveSessionAnalytics', () => {
    it('BLOCKER A: handles enrollment query errors gracefully and falls back to courses.enrollment_count', async () => {
      const mockSessionRow = {
        id: validSessionId,
        course_id: validCourseId,
        title: 'Masterclass',
        status: 'LIVE',
        scheduled_start_at: '2026-10-09T10:00:00Z',
        started_at: '2026-10-09T10:00:00Z',
        ended_at: null,
      }

      const client = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: creatorId } },
            error: null,
          }),
        },
        from: vi.fn((table: string) => {
          if (table === 'live_sessions') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockSessionRow, error: null }),
                }),
              }),
            }
          }
          if (table === 'users') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'creator' }, error: null }),
                }),
              }),
            }
          }
          if (table === 'courses') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  // Courses table returns creator_id, status, and cached enrollment_count: 12
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { creator_id: creatorId, status: 'published', enrollment_count: 12 },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table === 'live_session_staff') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === 'enrollments') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  // Direct enrollment count query errors (e.g. timeout or RLS limitation)
                  count: null,
                  data: null,
                  error: { message: 'permission denied for table enrollments' },
                }),
              }),
            }
          }
          return {}
        }),
        rpc: vi.fn((rpcName: string) => {
          if (rpcName === 'get_live_session_attendance') {
            return Promise.resolve({ data: [], error: null })
          }
          if (rpcName === 'get_live_session_games') {
            return Promise.resolve({ data: [], error: null })
          }
          return Promise.resolve({ data: null, error: null })
        }),
      } as any

      const { data, error } = await getLiveSessionAnalytics(client, validSessionId)

      expect(error).toBeNull()
      expect(data).not.toBeNull()
      // Should successfully use courses.enrollment_count (12) without failing
      expect(data?.operational.studentAttendance.totalEnrolled).toBe(12)
      expect(data?.operational.studentAttendance.isPartialData).toBe(false)
    })

    it('BLOCKER B: creator on draft course uses cached count when RLS hides enrollments returning count=0 without error', async () => {
      const mockSessionRow = {
        id: validSessionId,
        course_id: validCourseId,
        title: 'Masterclass',
        status: 'LIVE',
        scheduled_start_at: '2026-10-09T10:00:00Z',
        started_at: '2026-10-09T10:00:00Z',
        ended_at: null,
      }

      const client = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: creatorId } },
            error: null,
          }),
        },
        from: vi.fn((table: string) => {
          if (table === 'live_sessions') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockSessionRow, error: null }),
                }),
              }),
            }
          }
          if (table === 'users') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'creator' }, error: null }),
                }),
              }),
            }
          }
          if (table === 'courses') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  // Draft course where creator can read cached enrollment_count: 8
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { creator_id: creatorId, status: 'draft', enrollment_count: 8 },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table === 'live_session_staff') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === 'enrollments') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  // RLS hides non-user rows for draft course without error, returning count = 0
                  count: 0,
                  data: null,
                  error: null,
                }),
              }),
            }
          }
          return {}
        }),
        rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
      } as any

      const { data, error } = await getLiveSessionAnalytics(client, validSessionId)

      expect(error).toBeNull()
      expect(data).not.toBeNull()
      // Must NOT silently treat restricted count 0 as authoritative! Must use cached count (8).
      expect(data?.operational.studentAttendance.totalEnrolled).toBe(8)
      expect(data?.operational.studentAttendance.isPartialData).toBe(false)
    })

    it('BLOCKER B: assistant on draft course reports totalEnrolled=null and isPartialData=true when enrollments are hidden', async () => {
      const mockSessionRow = {
        id: validSessionId,
        course_id: validCourseId,
        title: 'Masterclass',
        status: 'LIVE',
        scheduled_start_at: '2026-10-09T10:00:00Z',
        started_at: '2026-10-09T10:00:00Z',
        ended_at: null,
      }

      const client = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: assistantId } },
            error: null,
          }),
        },
        from: vi.fn((table: string) => {
          if (table === 'live_sessions') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockSessionRow, error: null }),
                }),
              }),
            }
          }
          if (table === 'users') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'learner' }, error: null }),
                }),
              }),
            }
          }
          if (table === 'courses') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  // Assistant has no SELECT on draft course row -> returns null
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }
          }
          if (table === 'live_session_staff') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'staff-1' }, error: null }),
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === 'enrollments') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  // RLS hides non-user rows for draft course, returning count = 0 without error
                  count: 0,
                  data: null,
                  error: null,
                }),
              }),
            }
          }
          return {}
        }),
        rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
      } as any

      const { data, error } = await getLiveSessionAnalytics(client, validSessionId)

      expect(error).toBeNull()
      expect(data).not.toBeNull()
      // Never silently treat restricted 0 count as authoritative:
      expect(data?.operational.studentAttendance.totalEnrolled).toBeNull()
      expect(data?.operational.studentAttendance.isPartialData).toBe(true)
      expect(data?.isPartialData).toBe(true)
    })

    it('TASK 9.4: published course with direct count 0 and cached count 8 treats direct count as authoritative and marks isPartialData=true', async () => {
      const mockSessionRow = {
        id: validSessionId,
        course_id: validCourseId,
        title: 'Masterclass',
        status: 'LIVE',
        scheduled_start_at: '2026-10-09T10:00:00Z',
        started_at: '2026-10-09T10:00:00Z',
        ended_at: null,
      }

      const client = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: creatorId } },
            error: null,
          }),
        },
        from: vi.fn((table: string) => {
          if (table === 'live_sessions') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockSessionRow, error: null }),
                }),
              }),
            }
          }
          if (table === 'users') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'creator' }, error: null }),
                }),
              }),
            }
          }
          if (table === 'courses') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { creator_id: creatorId, status: 'published', enrollment_count: 8 },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table === 'live_session_staff') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === 'enrollments') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  count: 0,
                  data: null,
                  error: null,
                }),
              }),
            }
          }
          return {}
        }),
        rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
      } as any

      const { data, error } = await getLiveSessionAnalytics(client, validSessionId)

      expect(error).toBeNull()
      expect(data).not.toBeNull()
      // Successful direct count 0 is authoritative (not silently overridden by cached 8)
      expect(data?.operational.studentAttendance.totalEnrolled).toBe(0)
      // Conflicting cache mismatch is exposed explicitly via isPartialData = true
      expect(data?.operational.studentAttendance.isPartialData).toBe(true)
      expect(data?.isPartialData).toBe(true)
    })

    it('TASK 9.4: published course with direct count query failure falls back to cached count 8 and isPartialData=false', async () => {
      const mockSessionRow = {
        id: validSessionId,
        course_id: validCourseId,
        title: 'Masterclass',
        status: 'LIVE',
        scheduled_start_at: '2026-10-09T10:00:00Z',
        started_at: '2026-10-09T10:00:00Z',
        ended_at: null,
      }

      const client = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: creatorId } },
            error: null,
          }),
        },
        from: vi.fn((table: string) => {
          if (table === 'live_sessions') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockSessionRow, error: null }),
                }),
              }),
            }
          }
          if (table === 'users') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'creator' }, error: null }),
                }),
              }),
            }
          }
          if (table === 'courses') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { creator_id: creatorId, status: 'published', enrollment_count: 8 },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table === 'live_session_staff') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === 'enrollments') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  count: null,
                  data: null,
                  error: { message: 'query failed or timed out' },
                }),
              }),
            }
          }
          return {}
        }),
        rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
      } as any

      const { data, error } = await getLiveSessionAnalytics(client, validSessionId)

      expect(error).toBeNull()
      expect(data).not.toBeNull()
      // Falls back to cached count 8
      expect(data?.operational.studentAttendance.totalEnrolled).toBe(8)
      expect(data?.operational.studentAttendance.isPartialData).toBe(false)
      expect(data?.isPartialData).toBe(false)
    })

    it('TASK 9.4: admin on draft course uses authorized direct count bypassing RLS', async () => {
      const mockSessionRow = {
        id: validSessionId,
        course_id: validCourseId,
        title: 'Masterclass',
        status: 'LIVE',
        scheduled_start_at: '2026-10-09T10:00:00Z',
        started_at: '2026-10-09T10:00:00Z',
        ended_at: null,
      }

      const client = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'admin-1' } },
            error: null,
          }),
        },
        from: vi.fn((table: string) => {
          if (table === 'live_sessions') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockSessionRow, error: null }),
                }),
              }),
            }
          }
          if (table === 'users') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
                }),
              }),
            }
          }
          if (table === 'courses') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { creator_id: creatorId, status: 'draft', enrollment_count: 8 },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table === 'live_session_staff') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === 'enrollments') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  count: 4,
                  data: null,
                  error: null,
                }),
              }),
            }
          }
          return {}
        }),
        rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
      } as any

      const { data, error } = await getLiveSessionAnalytics(client, validSessionId)

      expect(error).toBeNull()
      expect(data).not.toBeNull()
      // Admin uses authorized direct count (4)
      expect(data?.operational.studentAttendance.totalEnrolled).toBe(4)
      expect(data?.operational.studentAttendance.isPartialData).toBe(false)
      expect(data?.isPartialData).toBe(false)
    })
  })
})
