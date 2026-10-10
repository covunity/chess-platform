import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../i18n'
import LiveClassroomView from '../LiveClassroomView'
import type { LiveGame } from '../../../types/liveGame'
import type { LiveSessionAnalytics } from '../../../types/liveSessionAnalytics'

// Mock useAuth
const mockUser = { id: 'teacher-1', email: 'teacher@test.com' }
const mockProfile = { id: 'teacher-1', role: 'creator', name: 'Teacher 1' }
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    profile: mockProfile,
    loading: false,
  }),
}))

const sessionId = 'session-live-101'

// Mock coursesApi
vi.mock('../../../lib/coursesApi', () => ({
  checkLiveClassroomAccess: vi.fn().mockResolvedValue({
    access: {
      is_course_room: true,
      is_session: true,
      session_id: 'session-live-101',
      course_id: 'course-101',
      course_title: 'Grandmaster Chess',
      live_schedule: '',
      allowed: true,
      role: 'teacher',
      is_creator: true,
      teacher_id: 'teacher-1',
    },
    error: null,
  }),
}))

// Mock liveSessionApi
vi.mock('../../../lib/liveSessionApi', () => ({
  endLiveSession: vi.fn().mockResolvedValue({ success: true, error: null }),
}))

// Mock LiveKit React components
vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-livekit-room">{children}</div>
  ),
  RoomAudioRenderer: () => null,
  useDataChannel: vi.fn(),
  useRoomContext: () => ({
    localParticipant: {
      identity: 'teacher-1',
      isMicrophoneEnabled: false,
      isCameraEnabled: false,
      publishData: vi.fn(),
      setMicrophoneEnabled: vi.fn(),
      setCameraEnabled: vi.fn(),
    },
    on: vi.fn(),
    off: vi.fn(),
  }),
  useMaybeRoomContext: () => ({
    state: 'connected',
    localParticipant: { identity: 'teacher-1' },
    on: vi.fn(),
    off: vi.fn(),
  }),
  useParticipants: () => [{ identity: 'teacher-1', name: 'Teacher 1' }],
  useTracks: () => [],
  useLocalParticipant: () => ({
    isMicrophoneEnabled: false,
    isCameraEnabled: false,
    localParticipant: { identity: 'teacher-1' },
  }),
}))

// Mock ChessgroundView for replay
vi.mock('../../ChessBoard/ChessgroundView', () => ({
  default: () => <div data-testid="chessground-view" />,
}))

// Mock analytics and liveGame APIs
let realtimeCallback: ((payload: any) => void) | null = null

const mockChannel = {
  on: vi.fn((_event: string, _filter: any, cb: (payload: any) => void) => {
    realtimeCallback = cb
    return mockChannel
  }),
  subscribe: vi.fn((cb?: (status: string) => void) => {
    if (cb) cb('SUBSCRIBED')
    return mockChannel
  }),
}

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: { creator_id: 'teacher-1' }, error: null }),
        }),
      }),
    }),
    functions: {
      invoke: vi.fn().mockResolvedValue({
        data: {
          token: 'mock-token',
          serverUrl: 'wss://mock.livekit.cloud',
          role: 'teacher',
          identity: 'teacher-1',
          session_id: 'session-live-101',
        },
        error: null,
      }),
    },
    channel: vi.fn(() => mockChannel),
    removeChannel: vi.fn(),
  },
}))

vi.mock('../../../lib/liveSessionAnalyticsApi', () => ({
  getLiveSessionAnalytics: vi.fn(),
}))

vi.mock('../../../lib/liveGameApi', () => ({
  getLiveGamesForSession: vi.fn(),
}))

import * as analyticsApi from '../../../lib/liveSessionAnalyticsApi'
import * as liveGameApi from '../../../lib/liveGameApi'

describe('TASK 9.5 — LiveClassroomView Terminated Analytics & Replay Board Integration', () => {
  const mockAnalytics: LiveSessionAnalytics = {
    operational: {
      sessionId,
      courseId: 'course-101',
      title: 'Grandmaster Chess',
      timing: {
        status: 'ENDED',
        scheduledStartAt: '2026-10-10T10:00:00Z',
        scheduledEndAt: '2026-10-10T11:00:00Z',
        startedAt: '2026-10-10T10:02:00Z',
        endedAt: '2026-10-10T11:05:00Z',
        durationSeconds: 3780,
      },
      studentAttendance: {
        totalEnrolled: 6,
        presentCount: 4,
        partialCount: 1,
        absentCount: 1,
        attendedCount: 5,
        joinedCount: 5,
        notJoinedCount: 1,
        attendanceRatePct: 83.3,
        lateCount: 0,
        lateRatePct: 0,
        completeness: 'FINALIZED',
        isPartialData: false,
        hasCacheMismatch: false,
        hasRosterConflict: false,
        isFinalizedRosterMissing: false,
      },
      durationStats: {
        totalDurationSeconds: 15000,
        averageDurationSeconds: 3000,
        minDurationSeconds: 2000,
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
      isFinalizedRosterMissing: false,
    },
    chess: {
      sessionId,
      totalGames: 2,
      completedGames: 2,
      unfinishedGames: 0,
      abortedGames: 0,
      scopeBreakdown: { total: 2, main: 1, practice: 1 },
      resultBreakdown: { whiteWins: 1, blackWins: 1, draws: 0, unfinishedOrUnknown: 0 },
      moveStats: { totalMoves: 60, averageMoves: 30, minMoves: 20, maxMoves: 40, sampleGameCount: 2 },
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
          moveStats: { totalMoves: 20, averageMoves: 20, minMoves: 20, maxMoves: 20, sampleGameCount: 1 },
        },
        {
          boardId: 'practice-board-9',
          gameScope: 'PRACTICE',
          totalGames: 1,
          completedGames: 1,
          whiteWins: 0,
          blackWins: 1,
          draws: 0,
          unfinishedOrUnknown: 0,
          moveStats: { totalMoves: 40, averageMoves: 40, minMoves: 40, maxMoves: 40, sampleGameCount: 1 },
        },
      ],
    },
    isPartialData: false,
    hasCacheMismatch: false,
    hasRosterConflict: false,
    isFinalizedRosterMissing: false,
  }

  const samplePracticeGame: LiveGame = {
    id: 'game-practice-9',
    live_session_id: sessionId,
    board_id: 'practice-board-9',
    game_scope: 'PRACTICE',
    white_user_id: 'user-w',
    black_user_id: 'user-b',
    starting_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    final_fen: null,
    pgn: '1. e4 e5 2. Nf3 Nc6',
    result: '0-1',
    termination_reason: null,
    status: 'COMPLETED',
    move_count: 4,
    started_at: '2026-10-10T10:05:00Z',
    ended_at: '2026-10-10T10:20:00Z',
    submitted_by: 'user-w',
    created_at: '2026-10-10T10:05:00Z',
    updated_at: '2026-10-10T10:20:00Z',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    realtimeCallback = null
    vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
      data: mockAnalytics,
      error: null,
    })
    vi.mocked(liveGameApi.getLiveGamesForSession).mockResolvedValue({
      games: [samplePracticeGame],
      error: null,
    })
  })

  it('BLOCKER A: preserves board selection from analytics into replay and suspends analytics on terminated screen', async () => {
    render(
      <MemoryRouter>
        <I18nextProvider i18n={i18n}>
          <LiveClassroomView roomId="room-101" preferredRole="teacher" />
        </I18nextProvider>
      </MemoryRouter>
    )

    // Wait for room to connect
    await waitFor(() => {
      expect(screen.getByTestId('mock-livekit-room')).toBeInTheDocument()
    })

    // Simulate session termination event via realtime
    expect(realtimeCallback).not.toBeNull()
    act(() => {
      realtimeCallback!({
        new: { id: sessionId, status: 'ENDED' },
      })
    })

    // Terminated screen renders
    await waitFor(() => {
      expect(screen.getByTestId('session-ended-screen')).toBeInTheDocument()
    })

    // Báo cáo buổi học button is available for authorized teacher
    const analyticsBtn = screen.getByTestId('open-session-analytics-btn')
    expect(analyticsBtn).toBeInTheDocument()

    // 1. Open analytics modal
    fireEvent.click(analyticsBtn)
    await waitFor(() => {
      expect(screen.getByTestId('live-session-analytics-modal')).toBeInTheDocument()
    })

    // 2. Switch to chess tab
    fireEvent.click(screen.getByTestId('tab-chess'))
    await waitFor(() => {
      expect(screen.getByTestId('replay-board-btn-practice-board-9')).toBeInTheDocument()
    })

    // 3. Click replay for board practice-board-9
    fireEvent.click(screen.getByTestId('replay-board-btn-practice-board-9'))

    // 4. Verify replay modal opens with practice-board-9
    await waitFor(() => {
      expect(screen.getByTestId('session-game-replay-modal')).toBeInTheDocument()
    })
    expect(screen.getByTestId('replay-active-game-badges')).toHaveAttribute(
      'data-board-id',
      'practice-board-9'
    )

    // 5. Verify analytics modal is suspended and does NOT compete with replay
    const analyticsModal = screen.getByTestId('live-session-analytics-modal')
    expect(analyticsModal).toHaveClass('hidden')
    expect(analyticsModal).toHaveClass('pointer-events-none')
    expect(analyticsModal).toHaveAttribute('aria-hidden', 'true')

    // 6. Verify replay controls are interactable
    const flipBtn = screen.getByTestId('replay-flip-btn')
    expect(flipBtn).toBeInTheDocument()
    fireEvent.click(flipBtn)

    // 7. Close replay
    fireEvent.click(screen.getByTestId('replay-close-btn'))

    // 8. Replay closes
    expect(screen.queryByTestId('session-game-replay-modal')).not.toBeInTheDocument()

    // 9. Analytics modal is un-suspended and remains open
    expect(analyticsModal).not.toHaveClass('hidden')
    expect(analyticsModal).not.toHaveClass('pointer-events-none')
    expect(analyticsModal).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByTestId('live-session-analytics-view')).toBeInTheDocument()
  })
})
