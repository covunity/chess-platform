import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import LiveSessionAnalyticsPage from '../LiveSessionAnalyticsPage'
import * as analyticsApi from '../../lib/liveSessionAnalyticsApi'

vi.mock('../../lib/liveSessionAnalyticsApi', async () => {
  const actual = await vi.importActual('../../lib/liveSessionAnalyticsApi')
  return {
    ...actual,
    getLiveSessionAnalytics: vi.fn(),
  }
})

describe('LiveSessionAnalyticsPage', () => {
  const validSessionId = '00000000-0000-4000-8000-000000000001'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders page layout with back button and embeds LiveSessionAnalyticsView for sessionId param', async () => {
    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
      data: {
        operational: {
          sessionId: validSessionId,
          courseId: 'c-1',
          title: 'Masterclass Page Test',
          timing: {
            status: 'ENDED',
            scheduledStartAt: '2026-10-10T10:00:00Z',
            scheduledEndAt: '2026-10-10T11:00:00Z',
            startedAt: '2026-10-10T10:00:00Z',
            endedAt: '2026-10-10T11:00:00Z',
            durationSeconds: 3600,
          },
          studentAttendance: {
            totalEnrolled: 5,
            presentCount: 5,
            partialCount: 0,
            absentCount: 0,
            attendedCount: 5,
            joinedCount: 5,
            notJoinedCount: 0,
            attendanceRatePct: 100,
            lateCount: 0,
            lateRatePct: 0,
            completeness: 'FINALIZED',
            isPartialData: false,
            hasCacheMismatch: false,
            hasRosterConflict: false,
          },
          durationStats: {
            totalDurationSeconds: 18000,
            averageDurationSeconds: 3600,
            minDurationSeconds: 3600,
            maxDurationSeconds: 3600,
          },
          staffAttendance: {
            totalStaff: 1,
            presentStaff: 1,
            absentStaff: 0,
            lateStaff: 0,
          },
          studentRoster: [],
          isPartialData: false,
          hasCacheMismatch: false,
          hasRosterConflict: false,
        },
        chess: {
          sessionId: validSessionId,
          totalGames: 0,
          completedGames: 0,
          unfinishedGames: 0,
          abortedGames: 0,
          scopeBreakdown: { total: 0, main: 0, practice: 0 },
          resultBreakdown: { whiteWins: 0, blackWins: 0, draws: 0, unfinishedOrUnknown: 0 },
          moveStats: { totalPlies: 0, averagePlies: null, maxPlies: null },
          byBoard: [],
        },
        isPartialData: false,
        hasCacheMismatch: false,
        hasRosterConflict: false,
      },
      error: null,
    })

    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[`/live/session/${validSessionId}/analytics`]}>
          <Routes>
            <Route path="/live/session/:sessionId/analytics" element={<LiveSessionAnalyticsPage />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    )

    expect(screen.getByRole('button', { name: /quay lại/i })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByTestId('live-session-analytics-view')).toBeInTheDocument()
    })

    expect(screen.getByText('Masterclass Page Test')).toBeInTheDocument()
  })
})
