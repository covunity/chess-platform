import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../../i18n'
import LiveSessionAnalyticsView from '../LiveSessionAnalyticsView'
import LiveSessionAnalyticsModal from '../LiveSessionAnalyticsModal'
import * as analyticsApi from '../../../../lib/liveSessionAnalyticsApi'
import type { LiveSessionAnalytics } from '../../../../types/liveSessionAnalytics'

// Mock the API layer
vi.mock('../../../../lib/liveSessionAnalyticsApi', async () => {
  const actual = await vi.importActual('../../../../lib/liveSessionAnalyticsApi')
  return {
    ...actual,
    getLiveSessionAnalytics: vi.fn(),
  }
})

describe('TASK 9.5 — Live Session Analytics UI (LiveSessionAnalyticsView)', () => {
  const validSessionId = '00000000-0000-4000-8000-000000000001'

  const mockCompleteAnalytics: LiveSessionAnalytics = {
    operational: {
      sessionId: validSessionId,
      courseId: 'course-1',
      title: 'Grandmaster Masterclass 101',
      timing: {
        status: 'ENDED',
        scheduledStartAt: '2026-10-10T10:00:00Z',
        scheduledEndAt: '2026-10-10T11:00:00Z',
        startedAt: '2026-10-10T10:02:00Z',
        endedAt: '2026-10-10T11:05:00Z',
        durationSeconds: 3780, // 1h 3m
      },
      studentAttendance: {
        totalEnrolled: 10,
        presentCount: 6,
        partialCount: 2,
        absentCount: 2,
        attendedCount: 8,
        joinedCount: 8,
        notJoinedCount: 2,
        attendanceRatePct: 80.0,
        lateCount: 1,
        lateRatePct: 12.5,
        completeness: 'FINALIZED',
        isPartialData: false,
        hasCacheMismatch: false,
        hasRosterConflict: false,
      },
      durationStats: {
        totalDurationSeconds: 24000,
        averageDurationSeconds: 3000,
        minDurationSeconds: 1200,
        maxDurationSeconds: 3700,
      },
      staffAttendance: {
        totalStaff: 2,
        presentStaff: 2,
        absentStaff: 0,
        lateStaff: 0,
      },
      studentRoster: [
        {
          userId: 'u-alice',
          userName: 'Alice Smith',
          userEmail: 'alice@example.com',
          role: 'student',
          attendanceStatus: 'PRESENT',
          totalDurationSeconds: 3600,
          isLate: false,
          firstJoinedAt: '2026-10-10T10:02:00Z',
          lastLeftAt: '2026-10-10T11:02:00Z',
        },
        {
          userId: 'u-bob',
          userName: 'Bob Jones',
          userEmail: 'bob@example.com',
          role: 'student',
          attendanceStatus: 'PARTIAL',
          totalDurationSeconds: 1500,
          isLate: true,
          firstJoinedAt: '2026-10-10T10:20:00Z',
          lastLeftAt: '2026-10-10T10:45:00Z',
        },
        {
          userId: 'u-charlie',
          userName: 'Charlie Brown',
          userEmail: 'charlie@example.com',
          role: 'student',
          attendanceStatus: 'ABSENT',
          totalDurationSeconds: 0,
          isLate: false,
          firstJoinedAt: null,
          lastLeftAt: null,
        },
      ],
      isPartialData: false,
      hasCacheMismatch: false,
      hasRosterConflict: false,
    },
    chess: {
      sessionId: validSessionId,
      totalGames: 5,
      completedGames: 4,
      unfinishedGames: 1,
      abortedGames: 0,
      scopeBreakdown: {
        total: 5,
        main: 1,
        practice: 4,
      },
      resultBreakdown: {
        whiteWins: 2,
        blackWins: 1,
        draws: 1,
        unfinishedOrUnknown: 1,
      },
      moveStats: {
        totalMoves: 160,
        averageMoves: 32,
        minMoves: 10,
        maxMoves: 54,
        sampleGameCount: 4,
      },
      byBoard: [
        {
          boardId: 'main',
          gameScope: 'MAIN',
          totalGames: 1,
          completedGames: 1,
          whiteWins: 1,
          blackWins: 0,
          draws: 0,
          unfinishedOrUnknown: 0,
          moveStats: {
            totalMoves: 30,
            averageMoves: 30,
            minMoves: 30,
            maxMoves: 30,
            sampleGameCount: 1,
          },
        },
        {
          boardId: 'practice-1',
          gameScope: 'PRACTICE',
          totalGames: 4,
          completedGames: 3,
          whiteWins: 1,
          blackWins: 1,
          draws: 1,
          unfinishedOrUnknown: 1,
          moveStats: {
            totalMoves: 130,
            averageMoves: 43.3,
            minMoves: 10,
            maxMoves: 54,
            sampleGameCount: 3,
          },
        },
      ],
    },
    isPartialData: false,
    hasCacheMismatch: false,
    hasRosterConflict: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── 1. Successful Rendering: Operational & Chess Metrics ───────────────────
  it('renders operational and chess analytics successfully with all sections', async () => {
    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
      data: mockCompleteAnalytics,
      error: null,
    })

    render(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsView sessionId={validSessionId} />
      </I18nextProvider>
    )

    // Wait for data load
    await waitFor(() => {
      expect(screen.getByTestId('live-session-analytics-view')).toBeInTheDocument()
    })

    // Header & Status
    expect(screen.getByText('Grandmaster Masterclass 101')).toBeInTheDocument()
    expect(screen.getByText('ĐÃ KẾT THÚC')).toBeInTheDocument()

    // Operational KPI Cards
    expect(screen.getByTestId('metric-total-enrolled')).toHaveTextContent('10')
    expect(screen.getByTestId('metric-attended-count')).toHaveTextContent('8')
    expect(screen.getByTestId('metric-attendance-rate')).toHaveTextContent('80%')
    expect(screen.getByTestId('metric-not-joined-count')).toHaveTextContent('2')
    expect(screen.getByTestId('metric-absent-count')).toHaveTextContent('2')
    expect(screen.getByTestId('metric-late-count')).toHaveTextContent('1')

    // Duration & Staff cards
    expect(screen.getByTestId('duration-stats-card')).toBeInTheDocument()
    expect(screen.getByTestId('staff-stats-card')).toHaveTextContent('Tổng 2 nhân sự')

    // Roster Table
    const rosterTable = screen.getByTestId('roster-table')
    expect(rosterTable).toHaveTextContent('Alice Smith')
    expect(rosterTable).toHaveTextContent('Bob Jones')
    expect(rosterTable).toHaveTextContent('Charlie Brown')

    // Switch to Chess Tab
    fireEvent.click(screen.getByTestId('tab-chess'))

    expect(screen.getByTestId('chess-metric-total-games')).toHaveTextContent('5')
    expect(screen.getByTestId('chess-metric-completed-games')).toHaveTextContent('4')
    expect(screen.getByTestId('chess-metric-unfinished-games')).toHaveTextContent('1')
    expect(screen.getByTestId('chess-scope-card')).toHaveTextContent('1') // main
    expect(screen.getByTestId('chess-scope-card')).toHaveTextContent('4') // practice
    expect(screen.getByTestId('chess-outcome-card')).toHaveTextContent('2') // white
    expect(screen.getByTestId('chess-outcome-card')).toHaveTextContent('1') // black
    expect(screen.getByTestId('chess-move-stats-card')).toHaveTextContent('160') // total plies

    // Boards Table
    const boardsTable = screen.getByTestId('boards-table')
    expect(boardsTable).toHaveTextContent('Bàn chính (Main)')
    expect(boardsTable).toHaveTextContent('Bàn luyện tập practice-1')
  })

  // ── 2. Null & Unavailable Metrics: Never displays as 0 or implies 0 ────────
  it('renders null metrics as N/A and does not format missing data as 0 or 0%', async () => {
    const nullAnalytics: LiveSessionAnalytics = {
      ...mockCompleteAnalytics,
      operational: {
        ...mockCompleteAnalytics.operational,
        studentAttendance: {
          ...mockCompleteAnalytics.operational.studentAttendance,
          totalEnrolled: null,
          attendanceRatePct: null,
          notJoinedCount: null,
          lateRatePct: null,
        },
        durationStats: {
          totalDurationSeconds: 0,
          averageDurationSeconds: null,
          minDurationSeconds: null,
          maxDurationSeconds: null,
        },
      },
      chess: {
        ...mockCompleteAnalytics.chess,
        moveStats: {
          totalMoves: 0,
          averageMoves: null,
          minMoves: null,
          maxMoves: null,
          sampleGameCount: 0,
        },
      },
    }

    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
      data: nullAnalytics,
      error: null,
    })

    render(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsView sessionId={validSessionId} />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('metric-total-enrolled')).toHaveTextContent('N/A')
    })

    expect(screen.getByTestId('metric-attendance-rate')).toHaveTextContent('N/A')
    expect(screen.getByTestId('metric-not-joined-count')).toHaveTextContent('N/A')
    expect(screen.getByTestId('metric-attendance-rate')).not.toHaveTextContent('0%')

    // Switch to chess tab
    fireEvent.click(screen.getByTestId('tab-chess'))
    expect(screen.getByTestId('chess-move-stats-card')).toHaveTextContent('N/A')
  })

  // ── 3. Diagnostic Conditions: Cache Mismatch vs Roster Conflict ────────────
  it('renders Course Cache Mismatch diagnostic banner when hasCacheMismatch=true', async () => {
    const mismatchAnalytics: LiveSessionAnalytics = {
      ...mockCompleteAnalytics,
      isPartialData: true,
      hasCacheMismatch: true,
      hasRosterConflict: false,
      operational: {
        ...mockCompleteAnalytics.operational,
        isPartialData: true,
        hasCacheMismatch: true,
        hasRosterConflict: false,
      },
    }

    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
      data: mismatchAnalytics,
      error: null,
    })

    render(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsView sessionId={validSessionId} />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('cache-mismatch-banner')).toBeInTheDocument()
    })

    expect(screen.getByTestId('cache-mismatch-banner')).toHaveTextContent(/Course Cache Mismatch/i)
    expect(screen.queryByTestId('roster-conflict-banner')).not.toBeInTheDocument()
  })

  it('renders Roster Conflict diagnostic banner when hasRosterConflict=true', async () => {
    const conflictAnalytics: LiveSessionAnalytics = {
      ...mockCompleteAnalytics,
      isPartialData: true,
      hasCacheMismatch: false,
      hasRosterConflict: true,
      operational: {
        ...mockCompleteAnalytics.operational,
        isPartialData: true,
        hasCacheMismatch: false,
        hasRosterConflict: true,
      },
    }

    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
      data: conflictAnalytics,
      error: null,
    })

    render(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsView sessionId={validSessionId} />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('roster-conflict-banner')).toBeInTheDocument()
    })

    expect(screen.getByTestId('roster-conflict-banner')).toHaveTextContent(/Roster Conflict/i)
    expect(screen.queryByTestId('cache-mismatch-banner')).not.toBeInTheDocument()
  })

  // ── 4. Lifecycle States: LIVE, SCHEDULED, DRAFT, CANCELLED ─────────────────
  it('renders LIVE session with pulsing badge and partial data notice', async () => {
    const liveAnalytics: LiveSessionAnalytics = {
      ...mockCompleteAnalytics,
      isPartialData: true,
      operational: {
        ...mockCompleteAnalytics.operational,
        isPartialData: true,
        timing: {
          ...mockCompleteAnalytics.operational.timing,
          status: 'LIVE',
          endedAt: null,
        },
      },
    }

    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
      data: liveAnalytics,
      error: null,
    })

    render(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsView sessionId={validSessionId} />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('ĐANG DIỄN RA')).toBeInTheDocument()
    })

    expect(screen.getByTestId('partial-data-banner')).toHaveTextContent(/Buổi học đang diễn ra/i)
  })

  it('renders SCHEDULED session with unstarted banner', async () => {
    const scheduledAnalytics: LiveSessionAnalytics = {
      ...mockCompleteAnalytics,
      operational: {
        ...mockCompleteAnalytics.operational,
        timing: {
          ...mockCompleteAnalytics.operational.timing,
          status: 'SCHEDULED',
          startedAt: null,
          endedAt: null,
          durationSeconds: null,
        },
      },
    }

    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
      data: scheduledAnalytics,
      error: null,
    })

    render(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsView sessionId={validSessionId} />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('SẮP DIỄN RA')).toBeInTheDocument()
    })

    expect(screen.getByTestId('unstarted-session-banner')).toBeInTheDocument()
  })

  it('renders CANCELLED session with cancellation indicator', async () => {
    const cancelledAnalytics: LiveSessionAnalytics = {
      ...mockCompleteAnalytics,
      isPartialData: true,
      operational: {
        ...mockCompleteAnalytics.operational,
        isPartialData: true,
        timing: {
          ...mockCompleteAnalytics.operational.timing,
          status: 'CANCELLED',
        },
      },
    }

    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
      data: cancelledAnalytics,
      error: null,
    })

    render(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsView sessionId={validSessionId} />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('ĐÃ HỦY')).toBeInTheDocument()
    })

    expect(screen.getByTestId('partial-data-banner')).toHaveTextContent(/Buổi học đã bị hủy/i)
  })

  // ── 5. Empty States: Empty Roster & Empty Chess History ────────────────────
  it('renders empty roster and empty chess history gracefully', async () => {
    const emptyAnalytics: LiveSessionAnalytics = {
      ...mockCompleteAnalytics,
      operational: {
        ...mockCompleteAnalytics.operational,
        studentRoster: [],
      },
      chess: {
        ...mockCompleteAnalytics.chess,
        totalGames: 0,
        completedGames: 0,
        byBoard: [],
      },
    }

    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
      data: emptyAnalytics,
      error: null,
    })

    render(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsView sessionId={validSessionId} />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('roster-empty-state')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('tab-chess'))
    expect(screen.getByTestId('chess-empty-state')).toBeInTheDocument()
  })

  // ── 6. Roster Filtering ────────────────────────────────────────────────────
  it('filters students by search input', async () => {
    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
      data: mockCompleteAnalytics,
      error: null,
    })

    render(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsView sessionId={validSessionId} />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('roster-table')).toBeInTheDocument()
    })

    const searchInput = screen.getByTestId('roster-search-input')
    fireEvent.change(searchInput, { target: { value: 'alice' } })

    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument()
    expect(screen.queryByText('Charlie Brown')).not.toBeInTheDocument()

    // Non-matching search
    fireEvent.change(searchInput, { target: { value: 'nonexistent-user' } })
    expect(screen.getByTestId('roster-empty-state')).toHaveTextContent(/Không tìm thấy học viên nào/i)
  })

  // ── 7. Request Lifecycle: Error & Retry Flow ───────────────────────────────
  it('renders error state and retries successfully upon clicking retry button', async () => {
    vi.mocked(analyticsApi.getLiveSessionAnalytics)
      .mockResolvedValueOnce({
        data: null,
        error: new Error('Network timeout fetching session analytics'),
      })
      .mockResolvedValueOnce({
        data: mockCompleteAnalytics,
        error: null,
      })

    render(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsView sessionId={validSessionId} />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('analytics-error')).toBeInTheDocument()
    })

    expect(screen.getByText(/Network timeout fetching session analytics/i)).toBeInTheDocument()

    // Click retry
    fireEvent.click(screen.getByTestId('analytics-retry-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('live-session-analytics-view')).toBeInTheDocument()
    })

    expect(screen.getByText('Grandmaster Masterclass 101')).toBeInTheDocument()
  })

  // ── 8. Authorization Guard: Forbidden Caller ───────────────────────────────
  it('renders unauthorized view and hides confidential metrics when API rejects with forbidden', async () => {
    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
      data: null,
      error: new Error('forbidden: caller is not authorized to inspect session analytics'),
    })

    render(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsView sessionId={validSessionId} />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('analytics-unauthorized')).toBeInTheDocument()
    })

    expect(screen.getByText(/Không có quyền truy cập \(403 Forbidden\)/i)).toBeInTheDocument()
    // Confidential metrics must not be present
    expect(screen.queryByTestId('metric-total-enrolled')).not.toBeInTheDocument()
    expect(screen.queryByTestId('roster-table')).not.toBeInTheDocument()
  })

  // ── 9. Session-Switch Race Condition Protection ────────────────────────────
  it('guards against session-switch races: stale response does not overwrite current session', async () => {
    let resolveFirst: (value: any) => void = () => {}
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve
    })

    const secondSessionId = '00000000-0000-4000-8000-000000000002'
    const secondAnalytics: LiveSessionAnalytics = {
      ...mockCompleteAnalytics,
      operational: {
        ...mockCompleteAnalytics.operational,
        sessionId: secondSessionId,
        title: 'New Session 2 Title',
      },
    }

    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockImplementation(async (_client, id) => {
      if (id === validSessionId) {
        return firstPromise as any
      }
      return { data: secondAnalytics, error: null }
    })

    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsView sessionId={validSessionId} />
      </I18nextProvider>
    )

    // Quickly switch to session 2
    rerender(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsView sessionId={secondSessionId} />
      </I18nextProvider>
    )

    // Second session resolves immediately
    await waitFor(() => {
      expect(screen.getByText('New Session 2 Title')).toBeInTheDocument()
    })

    // First session resolves late
    resolveFirst({
      data: {
        ...mockCompleteAnalytics,
        operational: { ...mockCompleteAnalytics.operational, title: 'Old Stale Title' },
      },
      error: null,
    })

    // Assert that the old stale title NEVER overwrites session 2!
    expect(screen.queryByText('Old Stale Title')).not.toBeInTheDocument()
    expect(screen.getByText('New Session 2 Title')).toBeInTheDocument()
  })

  // ── 10. Replay Integration Callback ────────────────────────────────────────
  it('triggers onOpenReplay callback when clicking replay on board', async () => {
    const handleOpenReplay = vi.fn()
    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
      data: mockCompleteAnalytics,
      error: null,
    })

    render(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsView sessionId={validSessionId} onOpenReplay={handleOpenReplay} />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('tab-chess')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('tab-chess'))

    const replayBtn = screen.getByTestId('replay-board-btn-main')
    fireEvent.click(replayBtn)

    expect(handleOpenReplay).toHaveBeenCalledWith('main')
  })

  // ── 11. Modal Dialog Wrapper ───────────────────────────────────────────────
  it('LiveSessionAnalyticsModal opens, renders dialog, and closes on Escape', async () => {
    const handleClose = vi.fn()
    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
      data: mockCompleteAnalytics,
      error: null,
    })

    render(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsModal
          sessionId={validSessionId}
          isOpen={true}
          onClose={handleClose}
        />
      </I18nextProvider>
    )

    expect(screen.getByTestId('live-session-analytics-modal')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('live-session-analytics-view')).toBeInTheDocument()
    })

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('LiveSessionAnalyticsModal is hidden and ignores Escape when isSuspended=true', async () => {
    const handleClose = vi.fn()
    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
      data: mockCompleteAnalytics,
      error: null,
    })

    render(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsModal
          sessionId={validSessionId}
          isOpen={true}
          isSuspended={true}
          onClose={handleClose}
        />
      </I18nextProvider>
    )

    const modal = screen.getByTestId('live-session-analytics-modal')
    expect(modal).toHaveClass('hidden')
    expect(modal).toHaveClass('pointer-events-none')
    expect(modal).toHaveAttribute('aria-hidden', 'true')

    // Press Escape while suspended
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(handleClose).not.toHaveBeenCalled()
  })

  // ── 12. Blocker B: Finalized Roster Missing Diagnostics & Labeling ─────────
  it('renders finalized-roster-missing-banner when an ENDED session has positive enrollment but missing roster', async () => {
    const missingRosterAnalytics: LiveSessionAnalytics = {
      ...mockCompleteAnalytics,
      isPartialData: true,
      hasCacheMismatch: false,
      hasRosterConflict: false,
      isFinalizedRosterMissing: true,
      operational: {
        ...mockCompleteAnalytics.operational,
        isPartialData: true,
        hasCacheMismatch: false,
        hasRosterConflict: false,
        isFinalizedRosterMissing: true,
        studentAttendance: {
          ...mockCompleteAnalytics.operational.studentAttendance,
          totalEnrolled: 5,
          attendedCount: 0,
          attendanceRatePct: null,
          notJoinedCount: null,
          completeness: 'FINALIZED',
          isPartialData: true,
          hasCacheMismatch: false,
          hasRosterConflict: false,
          isFinalizedRosterMissing: true,
        },
        studentRoster: [],
      },
    }

    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
      data: missingRosterAnalytics,
      error: null,
    })

    render(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsView sessionId={validSessionId} />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('finalized-roster-missing-banner')).toBeInTheDocument()
    })

    // Dedicated banner is shown; generic banners are suppressed
    expect(screen.getByTestId('finalized-roster-missing-banner')).toHaveTextContent(/Thiếu danh sách điểm danh sau khi kết thúc/i)
    expect(screen.queryByTestId('partial-data-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cache-mismatch-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('roster-conflict-banner')).not.toBeInTheDocument()

    // Metric labeling indicates enrollment fallback due to missing roster
    const enrolledCard = screen.getByTestId('metric-total-enrolled')
    expect(enrolledCard).toHaveTextContent('Theo sĩ số khóa học (thiếu chốt sổ)')
  })

  it('does NOT render finalized-roster-missing-banner for legitimate finalized session with 0 enrollment and 0 roster rows', async () => {
    const zeroEnrolledAnalytics: LiveSessionAnalytics = {
      ...mockCompleteAnalytics,
      isPartialData: false,
      hasCacheMismatch: false,
      hasRosterConflict: false,
      isFinalizedRosterMissing: false,
      operational: {
        ...mockCompleteAnalytics.operational,
        isPartialData: false,
        hasCacheMismatch: false,
        hasRosterConflict: false,
        isFinalizedRosterMissing: false,
        studentAttendance: {
          ...mockCompleteAnalytics.operational.studentAttendance,
          totalEnrolled: 0,
          attendedCount: 0,
          presentCount: 0,
          partialCount: 0,
          absentCount: 0,
          joinedCount: 0,
          notJoinedCount: 0,
          attendanceRatePct: null,
          completeness: 'FINALIZED',
          isPartialData: false,
          hasCacheMismatch: false,
          hasRosterConflict: false,
          isFinalizedRosterMissing: false,
        },
        studentRoster: [],
      },
    }

    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
      data: zeroEnrolledAnalytics,
      error: null,
    })

    render(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsView sessionId={validSessionId} />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('metric-total-enrolled')).toBeInTheDocument()
    })

    // Neither banner should appear for legitimate zero-enrolled finalized session
    expect(screen.queryByTestId('finalized-roster-missing-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('partial-data-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cache-mismatch-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('roster-conflict-banner')).not.toBeInTheDocument()

    // Sublabel reflects zero enrollment / empty roster
    const enrolledCard = screen.getByTestId('metric-total-enrolled')
    expect(enrolledCard).toHaveTextContent('Không có học viên ghi danh')
  })

  it('complete finalized roster does NOT render finalized-roster-missing-banner and displays historical roster sublabel', async () => {
    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
      data: mockCompleteAnalytics,
      error: null,
    })

    render(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsView sessionId={validSessionId} />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('metric-total-enrolled')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('finalized-roster-missing-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('partial-data-banner')).not.toBeInTheDocument()

    const enrolledCard = screen.getByTestId('metric-total-enrolled')
    expect(enrolledCard).toHaveTextContent('Theo danh sách chốt sổ')
    const rateCard = screen.getByTestId('metric-attendance-rate')
    expect(rateCard).toHaveTextContent('Theo hồ sơ chốt sổ')
  })

  it('FINALIZED with positive enrollment (5), empty studentRoster, and missing-roster flag false does NOT render "Không có học viên ghi danh"', async () => {
    const positiveEnrollmentEmptyRoster: LiveSessionAnalytics = {
      ...mockCompleteAnalytics,
      isFinalizedRosterMissing: false,
      operational: {
        ...mockCompleteAnalytics.operational,
        isFinalizedRosterMissing: false,
        studentAttendance: {
          ...mockCompleteAnalytics.operational.studentAttendance,
          totalEnrolled: 5,
          attendedCount: 0,
          presentCount: 0,
          partialCount: 0,
          absentCount: 0,
          joinedCount: 0,
          notJoinedCount: null,
          attendanceRatePct: null,
          completeness: 'FINALIZED',
          isPartialData: true,
          hasCacheMismatch: false,
          hasRosterConflict: false,
          isFinalizedRosterMissing: false,
        },
        studentRoster: [],
      },
    }

    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
      data: positiveEnrollmentEmptyRoster,
      error: null,
    })

    render(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsView sessionId={validSessionId} />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('metric-total-enrolled')).toBeInTheDocument()
    })

    const enrolledCard = screen.getByTestId('metric-total-enrolled')
    // Must NOT infer zero enrollment from an empty roster alone
    expect(enrolledCard).not.toHaveTextContent('Không có học viên ghi danh')
    expect(enrolledCard).toHaveTextContent('5')
    expect(enrolledCard).toHaveTextContent('Theo sĩ số khóa học')
  })

  it('FINALIZED with positive enrollment (5), empty studentRoster, and missing-roster flag undefined does NOT render "Không có học viên ghi danh"', async () => {
    const positiveEnrollmentMissingFlagUnavailable: LiveSessionAnalytics = {
      ...mockCompleteAnalytics,
      isFinalizedRosterMissing: undefined,
      operational: {
        ...mockCompleteAnalytics.operational,
        isFinalizedRosterMissing: undefined,
        studentAttendance: {
          ...mockCompleteAnalytics.operational.studentAttendance,
          totalEnrolled: 5,
          attendedCount: 0,
          presentCount: 0,
          partialCount: 0,
          absentCount: 0,
          joinedCount: 0,
          notJoinedCount: null,
          attendanceRatePct: null,
          completeness: 'FINALIZED',
          isPartialData: true,
          hasCacheMismatch: false,
          hasRosterConflict: false,
          isFinalizedRosterMissing: undefined,
        },
        studentRoster: [],
      },
    }

    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
      data: positiveEnrollmentMissingFlagUnavailable,
      error: null,
    })

    render(
      <I18nextProvider i18n={i18n}>
        <LiveSessionAnalyticsView sessionId={validSessionId} />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('metric-total-enrolled')).toBeInTheDocument()
    })

    const enrolledCard = screen.getByTestId('metric-total-enrolled')
    expect(enrolledCard).not.toHaveTextContent('Không có học viên ghi danh')
    expect(enrolledCard).toHaveTextContent('5')
    expect(enrolledCard).toHaveTextContent('Theo sĩ số khóa học')
  })
})
