import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../i18n'
import SessionModal from '../SessionModal'
import LiveSessionsPanel from '../LiveSessionsPanel'
import { type LiveSession } from '../../../types/liveSession'
import * as liveSessionApi from '../../../lib/liveSessionApi'

vi.mock('../../../lib/supabase', () => ({
  supabase: {},
}))

vi.mock('../../../lib/liveSessionApi', async () => {
  const actual = await vi.importActual('../../../lib/liveSessionApi')
  return {
    ...actual,
    listLiveSessions: vi.fn(),
    createLiveSession: vi.fn(),
    updateLiveSession: vi.fn(),
    deleteLiveSession: vi.fn(),
    startLiveSession: vi.fn(),
    endLiveSession: vi.fn(),
    cancelLiveSession: vi.fn(),
  }
})

vi.mock('../../../lib/liveSessionAnalyticsApi', () => ({
  getLiveSessionAnalytics: vi.fn(),
}))

vi.mock('../../../lib/liveGameApi', () => ({
  getLiveGamesForSession: vi.fn(),
}))

import * as analyticsApi from '../../../lib/liveSessionAnalyticsApi'
import * as liveGameApi from '../../../lib/liveGameApi'

describe('TASK 3B — Live Session UI Lifecycle & Action-Driven Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('SessionModal', () => {
    const mockChapters = [
      {
        id: 'ch-1',
        title: 'Chương 1',
        course_id: 'c-1',
        position: 1,
        created_at: '2026-10-04T00:00:00Z',
        lessons: [{ id: 'les-1', title: 'Bài 1: Khai cuộc', course_id: 'c-1', chapter_id: 'ch-1', position: 1 }],
      },
    ]

    it('CREATE: only allows selecting SCHEDULED or DRAFT; does NOT expose LIVE/ENDED/CANCELLED', () => {
      render(
        <I18nextProvider i18n={i18n}>
          <SessionModal
            courseId="c-1"
            chapters={mockChapters}
            onClose={vi.fn()}
            onSave={vi.fn()}
          />
        </I18nextProvider>
      )

      const statusSelect = screen.getByRole('combobox', { name: /trạng thái khởi tạo/i })
      expect(statusSelect).toBeInTheDocument()

      const options = Array.from(statusSelect.querySelectorAll('option')).map((o) => o.value)
      expect(options).toEqual(['SCHEDULED', 'DRAFT'])
      expect(options).not.toContain('LIVE')
      expect(options).not.toContain('ENDED')
      expect(options).not.toContain('CANCELLED')
    })

    it('CREATE: submitting passes status to onSave', async () => {
      const mockSave = vi.fn().mockResolvedValue(undefined)
      const mockClose = vi.fn()

      render(
        <I18nextProvider i18n={i18n}>
          <SessionModal
            courseId="c-1"
            chapters={mockChapters}
            onClose={mockClose}
            onSave={mockSave}
          />
        </I18nextProvider>
      )

      const submitBtn = screen.getByRole('button', { name: /tạo buổi học/i })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(mockSave).toHaveBeenCalledTimes(1)
        const payload = mockSave.mock.calls[0][0]
        expect(payload.status).toBe('SCHEDULED')
        expect(payload.title).toContain('Buổi 1')
      })
    })

    it('EDIT: displays status as read-only badge and NEVER submits status in updateInput', async () => {
      const scheduledSession: LiveSession = {
        id: 'sess-edit-1',
        courseId: 'c-1',
        lessonId: null,
        title: 'Buổi học mẫu',
        description: 'Mô tả',
        scheduledStartAt: '2026-10-15T19:30:00.000Z',
        scheduledEndAt: '2026-10-15T21:00:00.000Z',
        timezone: 'Asia/Ho_Chi_Minh',
        status: 'SCHEDULED',
        agenda: [],
        learningObjectives: [],
        preparationNotes: null,
        maxParticipants: 20,
        livekitRoomName: 'room-1',
        startedAt: null,
        endedAt: null,
        createdAt: '2026-10-04T00:00:00Z',
        updatedAt: '2026-10-04T00:00:00Z',
      }

      const mockSave = vi.fn().mockResolvedValue(undefined)
      const mockClose = vi.fn()

      render(
        <I18nextProvider i18n={i18n}>
          <SessionModal
            courseId="c-1"
            chapters={mockChapters}
            sessionToEdit={scheduledSession}
            onClose={mockClose}
            onSave={mockSave}
          />
        </I18nextProvider>
      )

      // Verify no status combobox/select exists in edit mode
      expect(screen.queryByRole('combobox', { name: /trạng thái/i })).not.toBeInTheDocument()
      // Status badge is rendered
      expect(screen.getByText(/SẮP DIỄN RA/i)).toBeInTheDocument()

      const saveBtn = screen.getByRole('button', { name: /lưu thay đổi/i })
      fireEvent.click(saveBtn)

      await waitFor(() => {
        expect(mockSave).toHaveBeenCalledTimes(1)
        const updatePayload = mockSave.mock.calls[0][0]
        expect(updatePayload).not.toHaveProperty('status')
        expect(updatePayload.title).toBe('Buổi học mẫu')
      })
    })

    it('EDIT: for ENDED session, renders read-only view mode without Save button', () => {
      const endedSession: LiveSession = {
        id: 'sess-ended-1',
        courseId: 'c-1',
        lessonId: null,
        title: 'Buổi đã kết thúc',
        description: 'Đã xong',
        scheduledStartAt: '2026-10-01T19:30:00.000Z',
        scheduledEndAt: '2026-10-01T21:00:00.000Z',
        timezone: 'Asia/Ho_Chi_Minh',
        status: 'ENDED',
        agenda: [],
        learningObjectives: [],
        preparationNotes: null,
        maxParticipants: null,
        livekitRoomName: 'room-ended',
        startedAt: '2026-10-01T19:30:00.000Z',
        endedAt: '2026-10-01T21:00:00.000Z',
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T21:00:00Z',
      }

      render(
        <I18nextProvider i18n={i18n}>
          <SessionModal
            courseId="c-1"
            chapters={mockChapters}
            sessionToEdit={endedSession}
            onClose={vi.fn()}
            onSave={vi.fn()}
          />
        </I18nextProvider>
      )

      expect(screen.getByText('Thông tin buổi học')).toBeInTheDocument()
      expect(screen.getByText(/ĐÃ KẾT THÚC/i)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /lưu thay đổi/i })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /đóng/i })).toBeInTheDocument()
    })

    it('EDIT: for LIVE session, disables start/end/lesson fields and omits them in update payload', async () => {
      const liveSession: LiveSession = {
        id: 'sess-live-1',
        courseId: 'c-1',
        lessonId: 'les-1',
        title: 'Buổi đang live',
        description: 'Đang diễn ra',
        scheduledStartAt: '2026-10-04T19:30:00.000Z',
        scheduledEndAt: '2026-10-04T21:00:00.000Z',
        timezone: 'Asia/Ho_Chi_Minh',
        status: 'LIVE',
        agenda: [],
        learningObjectives: [],
        preparationNotes: null,
        maxParticipants: 30,
        livekitRoomName: 'room-live-1',
        startedAt: '2026-10-04T19:30:00.000Z',
        endedAt: null,
        createdAt: '2026-10-04T00:00:00Z',
        updatedAt: '2026-10-04T00:00:00Z',
      }

      const mockSave = vi.fn().mockResolvedValue(undefined)
      const mockClose = vi.fn()

      render(
        <I18nextProvider i18n={i18n}>
          <SessionModal
            courseId="c-1"
            chapters={mockChapters}
            sessionToEdit={liveSession}
            onClose={mockClose}
            onSave={mockSave}
          />
        </I18nextProvider>
      )

      expect(screen.getByText(/ĐANG DIỄN RA \(LIVE\)/i)).toBeInTheDocument()

      // Inputs for start, end, and lesson must be disabled
      const datetimeInputs = document.querySelectorAll('input[type="datetime-local"]')
      expect(datetimeInputs.length).toBe(2)
      expect(datetimeInputs[0]).toBeDisabled()
      expect(datetimeInputs[1]).toBeDisabled()

      const lessonSelect = screen.getByRole('combobox')
      expect(lessonSelect).toBeDisabled()

      // Title input is enabled and editable
      const titleInput = screen.getByDisplayValue('Buổi đang live')
      expect(titleInput).toBeEnabled()
      fireEvent.change(titleInput, { target: { value: 'Buổi đang live (Cập nhật)' } })

      const saveBtn = screen.getByRole('button', { name: /lưu thay đổi/i })
      fireEvent.click(saveBtn)

      await waitFor(() => {
        expect(mockSave).toHaveBeenCalledTimes(1)
        const updatePayload = mockSave.mock.calls[0][0]
        expect(updatePayload.title).toBe('Buổi đang live (Cập nhật)')
        // Immutable fields must NOT be in the updatePayload
        expect(updatePayload).not.toHaveProperty('scheduledStartAt')
        expect(updatePayload).not.toHaveProperty('scheduledEndAt')
        expect(updatePayload).not.toHaveProperty('lessonId')
        expect(updatePayload).not.toHaveProperty('courseId')
        expect(updatePayload).not.toHaveProperty('status')
      })
    })
  })

  describe('LiveSessionsPanel Action Mappings', () => {
    const baseSession: LiveSession = {
      id: 'sess-test',
      courseId: 'c-1',
      lessonId: null,
      title: 'Session Title',
      description: null,
      scheduledStartAt: '2026-10-15T19:30:00.000Z',
      scheduledEndAt: '2026-10-15T21:00:00.000Z',
      timezone: 'Asia/Ho_Chi_Minh',
      status: 'SCHEDULED',
      agenda: [],
      learningObjectives: [],
      preparationNotes: null,
      maxParticipants: null,
      livekitRoomName: 'room-test',
      startedAt: null,
      endedAt: null,
      createdAt: '2026-10-04T00:00:00Z',
      updatedAt: '2026-10-04T00:00:00Z',
    }

    it('SCHEDULED session: renders Start, Cancel, and Edit buttons; does NOT render Delete or End', async () => {
      const scheduledSession = { ...baseSession, id: 'sched-1', status: 'SCHEDULED' as const }
      vi.mocked(liveSessionApi.listLiveSessions).mockResolvedValue({
        sessions: [scheduledSession],
        error: null,
      })

      render(
        <I18nextProvider i18n={i18n}>
          <LiveSessionsPanel courseId="c-1" chapters={[]} />
        </I18nextProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('session-card-sched-1')).toBeInTheDocument()
      })

      const card = screen.getByTestId('session-card-sched-1')
      expect(card.querySelector('button[title="Hủy buổi học"]')).toBeInTheDocument()
      expect(card.querySelector('button[title="Chỉnh sửa buổi học"]')).toBeInTheDocument()
      expect(card).toHaveTextContent(/bắt đầu/i)
      expect(card).not.toHaveTextContent(/kết thúc/i)
      expect(card.querySelector('button[title="Xóa buổi học nháp"]')).not.toBeInTheDocument()
      expect(card.querySelector('button[title="Xóa buổi học"]')).not.toBeInTheDocument()
    })

    it('SCHEDULED session: clicking Start calls startLiveSession RPC', async () => {
      const scheduledSession = { ...baseSession, id: 'sched-2', status: 'SCHEDULED' as const }
      vi.mocked(liveSessionApi.listLiveSessions).mockResolvedValue({
        sessions: [scheduledSession],
        error: null,
      })
      vi.mocked(liveSessionApi.startLiveSession).mockResolvedValue({
        success: true,
        data: { status: 'LIVE' },
        error: null,
      })
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      vi.spyOn(window, 'open').mockImplementation(() => null)

      render(
        <I18nextProvider i18n={i18n}>
          <LiveSessionsPanel courseId="c-1" chapters={[]} />
        </I18nextProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('session-card-sched-2')).toBeInTheDocument()
      })

      const startBtn = screen.getByRole('button', { name: /bắt đầu/i })
      fireEvent.click(startBtn)

      await waitFor(() => {
        expect(liveSessionApi.startLiveSession).toHaveBeenCalledWith(undefined, 'sched-2')
      })
    })

    it('SCHEDULED session: clicking Cancel calls cancelLiveSession RPC', async () => {
      const scheduledSession = { ...baseSession, id: 'sched-3', status: 'SCHEDULED' as const }
      vi.mocked(liveSessionApi.listLiveSessions).mockResolvedValue({
        sessions: [scheduledSession],
        error: null,
      })
      vi.mocked(liveSessionApi.cancelLiveSession).mockResolvedValue({
        success: true,
        data: { status: 'CANCELLED' },
        error: null,
      })
      vi.spyOn(window, 'confirm').mockReturnValue(true)

      render(
        <I18nextProvider i18n={i18n}>
          <LiveSessionsPanel courseId="c-1" chapters={[]} />
        </I18nextProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('session-card-sched-3')).toBeInTheDocument()
      })

      const cancelBtn = screen.getByTitle('Hủy buổi học')
      fireEvent.click(cancelBtn)

      await waitFor(() => {
        expect(liveSessionApi.cancelLiveSession).toHaveBeenCalledWith(undefined, 'sched-3')
      })
    })

    it('LIVE session: renders Enter and End buttons; does NOT render Edit, Delete, Start, or Cancel', async () => {
      const liveSession = { ...baseSession, id: 'live-1', status: 'LIVE' as const }
      vi.mocked(liveSessionApi.listLiveSessions).mockResolvedValue({
        sessions: [liveSession],
        error: null,
      })
      vi.mocked(liveSessionApi.endLiveSession).mockResolvedValue({
        success: true,
        data: { status: 'ENDED' },
        error: null,
      })
      vi.spyOn(window, 'confirm').mockReturnValue(true)

      render(
        <I18nextProvider i18n={i18n}>
          <LiveSessionsPanel courseId="c-1" chapters={[]} />
        </I18nextProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('session-card-live-1')).toBeInTheDocument()
      })

      const card = screen.getByTestId('session-card-live-1')
      expect(card).toHaveTextContent(/vào lớp/i)
      expect(within(card).getByRole('button', { name: /^kết thúc$/i })).toBeInTheDocument()
      expect(within(card).queryByRole('button', { name: /bắt đầu/i })).not.toBeInTheDocument()
      expect(card.querySelector('button[title="Chỉnh sửa buổi học"]')).not.toBeInTheDocument()
      expect(card.querySelector('button[title="Hủy buổi học"]')).not.toBeInTheDocument()
      expect(card.querySelector('button[title="Xóa buổi học nháp"]')).not.toBeInTheDocument()

      const endBtn = within(card).getByRole('button', { name: /^kết thúc$/i })
      fireEvent.click(endBtn)

      await waitFor(() => {
        expect(liveSessionApi.endLiveSession).toHaveBeenCalledWith(undefined, 'live-1')
      })
    })

    it('DRAFT session: renders Edit and Delete buttons; does NOT render Start, End, or Cancel', async () => {
      const draftSession = { ...baseSession, id: 'draft-1', status: 'DRAFT' as const }
      vi.mocked(liveSessionApi.listLiveSessions).mockResolvedValue({
        sessions: [draftSession],
        error: null,
      })
      vi.mocked(liveSessionApi.deleteLiveSession).mockResolvedValue({
        success: true,
        error: null,
      })

      render(
        <I18nextProvider i18n={i18n}>
          <LiveSessionsPanel courseId="c-1" chapters={[]} />
        </I18nextProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('session-card-draft-1')).toBeInTheDocument()
      })

      const card = screen.getByTestId('session-card-draft-1')
      expect(card.querySelector('button[title="Chỉnh sửa buổi học"]')).toBeInTheDocument()
      expect(card.querySelector('button[title="Xóa buổi học nháp"]')).toBeInTheDocument()
      expect(within(card).queryByRole('button', { name: /bắt đầu/i })).not.toBeInTheDocument()
      expect(within(card).queryByRole('button', { name: /^kết thúc$/i })).not.toBeInTheDocument()
      expect(card.querySelector('button[title="Hủy buổi học"]')).not.toBeInTheDocument()

      // Click delete opens confirm modal
      const deleteBtn = screen.getByTitle('Xóa buổi học nháp')
      fireEvent.click(deleteBtn)

      expect(screen.getByText('Xác nhận xóa buổi học')).toBeInTheDocument()

      // Confirm delete in modal calls deleteLiveSession
      const confirmDeleteBtn = screen.getByRole('button', { name: 'Xóa buổi học' })
      fireEvent.click(confirmDeleteBtn)

      await waitFor(() => {
        expect(liveSessionApi.deleteLiveSession).toHaveBeenCalledWith(undefined, 'draft-1', 'DRAFT')
      })
    })

    it('ENDED session: renders View button only; no lifecycle mutation buttons', async () => {
      const endedSession = { ...baseSession, id: 'ended-1', status: 'ENDED' as const }
      vi.mocked(liveSessionApi.listLiveSessions).mockResolvedValue({
        sessions: [endedSession],
        error: null,
      })

      render(
        <I18nextProvider i18n={i18n}>
          <LiveSessionsPanel courseId="c-1" chapters={[]} />
        </I18nextProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('session-card-ended-1')).toBeInTheDocument()
      })

      const card = screen.getByTestId('session-card-ended-1')
      expect(card.querySelector('button[title="Xem chi tiết buổi học"]')).toBeInTheDocument()
      expect(within(card).queryByRole('button', { name: /bắt đầu/i })).not.toBeInTheDocument()
      expect(within(card).queryByRole('button', { name: /^kết thúc$/i })).not.toBeInTheDocument()
      expect(card.querySelector('button[title="Chỉnh sửa buổi học"]')).not.toBeInTheDocument()
      expect(card.querySelector('button[title="Hủy buổi học"]')).not.toBeInTheDocument()
      expect(card.querySelector('button[title="Xóa buổi học nháp"]')).not.toBeInTheDocument()
    })

    it('CANCELLED session: renders View button only; no lifecycle mutation buttons', async () => {
      const cancelledSession = { ...baseSession, id: 'canc-1', status: 'CANCELLED' as const }
      vi.mocked(liveSessionApi.listLiveSessions).mockResolvedValue({
        sessions: [cancelledSession],
        error: null,
      })

      render(
        <I18nextProvider i18n={i18n}>
          <LiveSessionsPanel courseId="c-1" chapters={[]} />
        </I18nextProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('session-card-canc-1')).toBeInTheDocument()
      })

      const card = screen.getByTestId('session-card-canc-1')
      expect(card.querySelector('button[title="Xem chi tiết buổi học"]')).toBeInTheDocument()
      expect(within(card).queryByRole('button', { name: /bắt đầu/i })).not.toBeInTheDocument()
      expect(within(card).queryByRole('button', { name: /^kết thúc$/i })).not.toBeInTheDocument()
      expect(card.querySelector('button[title="Chỉnh sửa buổi học"]')).not.toBeInTheDocument()
      expect(card.querySelector('button[title="Hủy buổi học"]')).not.toBeInTheDocument()
      expect(card.querySelector('button[title="Xóa buổi học nháp"]')).not.toBeInTheDocument()
    })

    it('clicking Analytics button opens LiveSessionAnalyticsModal', async () => {
      const endedSession = { ...baseSession, id: 'ended-analytics-1', status: 'ENDED' as const }
      vi.mocked(liveSessionApi.listLiveSessions).mockResolvedValue({
        sessions: [endedSession],
        error: null,
      })

      render(
        <I18nextProvider i18n={i18n}>
          <LiveSessionsPanel courseId="c-1" chapters={[]} />
        </I18nextProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('session-analytics-btn-ended-analytics-1')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('session-analytics-btn-ended-analytics-1'))

      await waitFor(() => {
        expect(screen.getByTestId('live-session-analytics-modal')).toBeInTheDocument()
      })
    })

    it('BLOCKER A: preserves chosen board ID end-to-end to replay UI, suspends analytics dialog, and restores analytics on replay close', async () => {
      const endedSession = { ...baseSession, id: 'ended-analytics-1', status: 'ENDED' as const }
      vi.mocked(liveSessionApi.listLiveSessions).mockResolvedValue({
        sessions: [endedSession],
        error: null,
      })

      const mockAnalytics = {
        operational: {
          sessionId: 'ended-analytics-1',
          courseId: 'c-1',
          title: 'Test Session',
          timing: {
            status: 'ENDED' as const,
            scheduledStartAt: '2026-10-10T10:00:00Z',
            scheduledEndAt: '2026-10-10T11:00:00Z',
            startedAt: '2026-10-10T10:02:00Z',
            endedAt: '2026-10-10T11:05:00Z',
            durationSeconds: 3780,
          },
          studentAttendance: {
            totalEnrolled: 5,
            presentCount: 3,
            partialCount: 1,
            absentCount: 1,
            attendedCount: 4,
            joinedCount: 4,
            notJoinedCount: 1,
            attendanceRatePct: 80,
            lateCount: 0,
            lateRatePct: 0,
            completeness: 'FINALIZED' as const,
            isPartialData: false,
            hasCacheMismatch: false,
            hasRosterConflict: false,
            isFinalizedRosterMissing: false,
          },
          durationStats: {
            totalDurationSeconds: 12000,
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
          sessionId: 'ended-analytics-1',
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
              gameScope: 'MAIN' as const,
              totalGames: 1,
              completedGames: 1,
              whiteWins: 1,
              blackWins: 0,
              draws: 0,
              unfinishedOrUnknown: 0,
              moveStats: { totalMoves: 20, averageMoves: 20, minMoves: 20, maxMoves: 20, sampleGameCount: 1 },
            },
            {
              boardId: 'practice-1',
              gameScope: 'PRACTICE' as const,
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
      vi.mocked(analyticsApi.getLiveSessionAnalytics).mockResolvedValue({
        data: mockAnalytics,
        error: null,
      })

      const samplePracticeGame = {
        id: 'game-practice-1',
        live_session_id: 'ended-analytics-1',
        board_id: 'practice-1',
        game_scope: 'PRACTICE' as const,
        white_user_id: 'u-w',
        black_user_id: 'u-b',
        starting_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        final_fen: null,
        pgn: '1. e4 e5 2. Nf3 Nc6',
        result: '0-1' as const,
        termination_reason: null,
        status: 'COMPLETED' as const,
        move_count: 4,
        started_at: '2026-10-10T10:05:00Z',
        ended_at: '2026-10-10T10:20:00Z',
        submitted_by: 'u-w',
        created_at: '2026-10-10T10:05:00Z',
        updated_at: '2026-10-10T10:20:00Z',
      }
      vi.mocked(liveGameApi.getLiveGamesForSession).mockResolvedValue({
        games: [samplePracticeGame],
        error: null,
      })

      render(
        <I18nextProvider i18n={i18n}>
          <LiveSessionsPanel courseId="c-1" chapters={[]} />
        </I18nextProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('session-analytics-btn-ended-analytics-1')).toBeInTheDocument()
      })

      // 1. Open analytics modal
      fireEvent.click(screen.getByTestId('session-analytics-btn-ended-analytics-1'))
      await waitFor(() => {
        expect(screen.getByTestId('live-session-analytics-modal')).toBeInTheDocument()
      })

      // 2. Switch to chess tab
      fireEvent.click(screen.getByTestId('tab-chess'))
      await waitFor(() => {
        expect(screen.getByTestId('replay-board-btn-practice-1')).toBeInTheDocument()
      })

      // 3. Click "Xem lại" on board practice-1
      fireEvent.click(screen.getByTestId('replay-board-btn-practice-1'))

      // 4. Verify replay modal is opened with board practice-1
      await waitFor(() => {
        expect(screen.getByTestId('session-game-replay-modal')).toBeInTheDocument()
      })
      expect(screen.getByTestId('replay-active-game-badges')).toHaveAttribute('data-board-id', 'practice-1')

      // 5. Verify analytics modal is suspended and does NOT compete with replay dialog
      const analyticsModal = screen.getByTestId('live-session-analytics-modal')
      expect(analyticsModal).toHaveClass('hidden')
      expect(analyticsModal).toHaveClass('pointer-events-none')
      expect(analyticsModal).toHaveAttribute('aria-hidden', 'true')

      // 6. Verify replay is fully interactable
      const flipBtn = screen.getByTestId('replay-flip-btn')
      expect(flipBtn).toBeInTheDocument()
      fireEvent.click(flipBtn)

      // 7. Close replay modal
      fireEvent.click(screen.getByTestId('replay-close-btn'))

      // 8. Replay modal is unmounted / closed
      expect(screen.queryByTestId('session-game-replay-modal')).not.toBeInTheDocument()

      // 9. Analytics modal is un-suspended and remains open for user
      expect(analyticsModal).not.toHaveClass('hidden')
      expect(analyticsModal).not.toHaveClass('pointer-events-none')
      expect(analyticsModal).toHaveAttribute('aria-modal', 'true')
      expect(screen.getByTestId('live-session-analytics-view')).toBeInTheDocument()
    })
  })

  describe('TASK 5.2 — SessionModal Timezone Change Semantics', () => {
    const scheduledSession: LiveSession = {
      id: 'sess-tz-1',
      courseId: 'c-1',
      lessonId: null,
      title: 'Timezone Invariant Session',
      description: null,
      scheduledStartAt: '2026-10-15T12:30:00.000Z',
      scheduledEndAt: '2026-10-15T14:00:00.000Z',
      timezone: 'Asia/Ho_Chi_Minh',
      status: 'SCHEDULED',
      agenda: [],
      learningObjectives: [],
      preparationNotes: null,
      maxParticipants: null,
      livekitRoomName: 'room-tz-test',
      startedAt: null,
      endedAt: null,
      createdAt: '2026-10-04T00:00:00Z',
      updatedAt: '2026-10-04T00:00:00Z',
    }

    it('EDIT: Changing timezone preserves underlying UTC instant and re-projects datetime-local inputs', async () => {
      const mockSave = vi.fn().mockResolvedValue(undefined)

      render(
        <I18nextProvider i18n={i18n}>
          <SessionModal
            courseId="c-1"
            chapters={[]}
            sessionToEdit={scheduledSession}
            onClose={vi.fn()}
            onSave={mockSave}
          />
        </I18nextProvider>
      )

      const datetimeInputs = document.querySelectorAll('input[type="datetime-local"]')
      const startInput = datetimeInputs[0] as HTMLInputElement
      const endInput = datetimeInputs[1] as HTMLInputElement

      // Initially in Asia/Ho_Chi_Minh: 12:30 UTC -> 19:30, 14:00 UTC -> 21:00
      expect(startInput.value).toBe('2026-10-15T19:30')
      expect(endInput.value).toBe('2026-10-15T21:00')

      // Creator switches timezone to America/New_York
      const tzInput = screen.getByDisplayValue('Asia/Ho_Chi_Minh')
      fireEvent.change(tzInput, { target: { value: 'America/New_York' } })

      // Wall-clock datetime-local inputs re-project to America/New_York (EDT, UTC-4):
      // 12:30 UTC -> 08:30 EDT, 14:00 UTC -> 10:00 EDT
      expect(startInput.value).toBe('2026-10-15T08:30')
      expect(endInput.value).toBe('2026-10-15T10:00')

      // Save without touching datetime inputs
      const saveBtn = screen.getByRole('button', { name: /lưu thay đổi/i })
      fireEvent.click(saveBtn)

      await waitFor(() => {
        expect(mockSave).toHaveBeenCalledTimes(1)
        const payload = mockSave.mock.calls[0][0]
        // Authoritative UTC instants must be preserved exactly
        expect(payload.scheduledStartAt).toBe('2026-10-15T12:30:00.000Z')
        expect(payload.scheduledEndAt).toBe('2026-10-15T14:00:00.000Z')
        expect(payload.timezone).toBe('America/New_York')
      })
    })

    it('EDIT: Manually modifying wall-clock time after timezone change updates UTC instant', async () => {
      const mockSave = vi.fn().mockResolvedValue(undefined)

      render(
        <I18nextProvider i18n={i18n}>
          <SessionModal
            courseId="c-1"
            chapters={[]}
            sessionToEdit={scheduledSession}
            onClose={vi.fn()}
            onSave={mockSave}
          />
        </I18nextProvider>
      )

      const tzInput = screen.getByDisplayValue('Asia/Ho_Chi_Minh')
      fireEvent.change(tzInput, { target: { value: 'America/New_York' } })

      const datetimeInputs = document.querySelectorAll('input[type="datetime-local"]')
      const startInput = datetimeInputs[0] as HTMLInputElement

      // Explicit user edit: change from 08:30 to 09:30 New York time
      fireEvent.change(startInput, { target: { value: '2026-10-15T09:30' } })

      const saveBtn = screen.getByRole('button', { name: /lưu thay đổi/i })
      fireEvent.click(saveBtn)

      await waitFor(() => {
        expect(mockSave).toHaveBeenCalledTimes(1)
        const payload = mockSave.mock.calls[0][0]
        // 09:30 EDT = 13:30 UTC
        expect(payload.scheduledStartAt).toBe('2026-10-15T13:30:00.000Z')
        expect(payload.timezone).toBe('America/New_York')
      })
    })

    it('CREATE: Changing timezone in a new session interprets wall-clock input in chosen timezone', async () => {
      const mockSave = vi.fn().mockResolvedValue(undefined)

      render(
        <I18nextProvider i18n={i18n}>
          <SessionModal
            courseId="c-1"
            chapters={[]}
            onClose={vi.fn()}
            onSave={mockSave}
          />
        </I18nextProvider>
      )

      const datetimeInputs = document.querySelectorAll('input[type="datetime-local"]')
      const startInput = datetimeInputs[0] as HTMLInputElement
      const endInput = datetimeInputs[1] as HTMLInputElement

      // Explicitly set 2026-10-15T19:30 wall clock
      fireEvent.change(startInput, { target: { value: '2026-10-15T19:30' } })
      fireEvent.change(endInput, { target: { value: '2026-10-15T21:00' } })

      // Change timezone to America/New_York
      const tzInput = screen.getByDisplayValue('Asia/Ho_Chi_Minh')
      fireEvent.change(tzInput, { target: { value: 'America/New_York' } })

      const submitBtn = screen.getByRole('button', { name: /tạo buổi học/i })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(mockSave).toHaveBeenCalledTimes(1)
        const payload = mockSave.mock.calls[0][0]
        // In new session, wall-clock 19:30 EDT = 23:30 UTC
        expect(payload.scheduledStartAt).toBe('2026-10-15T23:30:00.000Z')
        expect(payload.scheduledEndAt).toBe('2026-10-16T01:00:00.000Z')
        expect(payload.timezone).toBe('America/New_York')
      })
    })
  })
})
