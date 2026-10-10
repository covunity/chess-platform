import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import SessionGameReplay from '../Replay/SessionGameReplay'
import SessionGameReplayModal from '../Replay/SessionGameReplayModal'
import type { LiveGame } from '../../../types/liveGame'
import * as liveGameApi from '../../../lib/liveGameApi'

// Mock ChessgroundView to avoid canvas/DOM errors and inspect props
vi.mock('../../ChessBoard/ChessgroundView', () => ({
  default: ({
    fen,
    orientation,
    lastMove,
    viewOnly,
    ariaLabel,
  }: {
    fen: string
    orientation?: string
    lastMove?: [string, string] | null
    viewOnly?: boolean
    ariaLabel?: string
  }) => (
    <div
      data-testid="chessground-view"
      data-fen={fen}
      data-orientation={orientation}
      data-lastmove={lastMove ? JSON.stringify(lastMove) : ''}
      data-viewonly={String(viewOnly)}
      aria-label={ariaLabel}
    />
  ),
}))

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue || key,
    i18n: { language: 'vi' },
  }),
}))

describe('TASK 9.3 — Session Chess Game Replay UI', () => {
  let mockSupabase: SupabaseClient
  const sessionId = 'session-1234-abcd'

  const sampleGame1: LiveGame = {
    id: 'game-1',
    live_session_id: sessionId,
    board_id: 'main',
    game_scope: 'MAIN',
    white_user_id: 'teacher-uuid',
    black_user_id: 'student-uuid',
    starting_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    final_fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
    pgn: '1. e4 e5 2. Nf3 Nc6 1-0',
    result: '1-0',
    termination_reason: 'checkmate',
    status: 'COMPLETED',
    move_count: 4,
    started_at: '2026-10-09T10:00:00Z',
    ended_at: '2026-10-09T10:15:00Z',
    submitted_by: 'teacher-uuid',
    created_at: '2026-10-09T10:00:00Z',
    updated_at: '2026-10-09T10:15:00Z',
  }

  const sampleGame2: LiveGame = {
    id: 'game-2',
    live_session_id: sessionId,
    board_id: 'practice-1',
    game_scope: 'PRACTICE',
    white_user_id: 'alice-uuid',
    black_user_id: 'bob-uuid',
    starting_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    final_fen: null,
    pgn: '1. d4 d5 2. c4 e6 0-1',
    result: '0-1',
    termination_reason: 'resignation',
    status: 'COMPLETED',
    move_count: 4,
    started_at: '2026-10-09T10:05:00Z',
    ended_at: '2026-10-09T10:20:00Z',
    submitted_by: 'alice-uuid',
    created_at: '2026-10-09T10:05:00Z',
    updated_at: '2026-10-09T10:20:00Z',
  }

  beforeEach(() => {
    mockSupabase = {
      rpc: vi.fn(),
      from: vi.fn(),
    } as unknown as SupabaseClient
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  // ── 1. SESSION GAME LIST ──────────────────────────────────────────────────
  describe('1. Session game list (loading, empty, success, error)', () => {
    it('shows loading state while fetching session games', () => {
      // Mock pending promise
      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockImplementation(
        () => new Promise(() => {})
      )

      render(<SessionGameReplay sessionId={sessionId} supabaseClient={mockSupabase} />)

      // Switch to games tab to inspect games list loading indicator
      fireEvent.click(screen.getByTestId('replay-tab-games'))

      expect(screen.getByTestId('replay-games-loading')).toBeInTheDocument()
      expect(screen.getByText('Đang tải danh sách ván đấu...')).toBeInTheDocument()
    })

    it('shows empty state when no games exist for the session', async () => {
      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockResolvedValueOnce({
        games: [],
        error: null,
      })

      render(<SessionGameReplay sessionId={sessionId} supabaseClient={mockSupabase} />)

      await waitFor(() => {
        expect(screen.queryByTestId('replay-games-loading')).not.toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('replay-tab-games'))

      expect(screen.getByTestId('replay-games-empty')).toBeInTheDocument()
      expect(screen.getByText('Chưa có ván đấu nào')).toBeInTheDocument()
    })

    it('shows error state when fetching games fails and allows retry', async () => {
      const getGamesSpy = vi
        .spyOn(liveGameApi, 'getLiveGamesForSession')
        .mockResolvedValueOnce({
          games: [],
          error: new Error('Network connection timeout'),
        })
        .mockResolvedValueOnce({
          games: [sampleGame1],
          error: null,
        })

      render(<SessionGameReplay sessionId={sessionId} supabaseClient={mockSupabase} />)

      await waitFor(() => {
        expect(screen.queryByTestId('replay-games-loading')).not.toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('replay-tab-games'))

      expect(screen.getByTestId('replay-games-error')).toBeInTheDocument()
      expect(screen.getByText('Network connection timeout')).toBeInTheDocument()

      // Click retry button
      const retryBtn = screen.getByRole('button', { name: /thử lại/i })
      fireEvent.click(retryBtn)

      await waitFor(() => {
        expect(screen.getByTestId('replay-game-card-game-1')).toBeInTheDocument()
      })

      expect(getGamesSpy).toHaveBeenCalledTimes(2)
    })

    it('displays persisted games with available metadata (players, result, scope, completion time)', async () => {
      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockResolvedValueOnce({
        games: [sampleGame1, sampleGame2],
        error: null,
      })

      render(<SessionGameReplay sessionId={sessionId} supabaseClient={mockSupabase} />)

      await waitFor(() => {
        expect(screen.getByTestId('session-game-replay')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('replay-tab-games'))

      // Verify Game 1 card
      const card1 = screen.getByTestId('replay-game-card-game-1')
      expect(card1).toBeInTheDocument()
      expect(card1).toHaveTextContent('Bàn chính')
      expect(card1).toHaveTextContent('1-0 (Trắng thắng)')
      expect(card1).toHaveTextContent('teacher-')
      expect(card1).toHaveTextContent('student-')
      expect(card1).toHaveTextContent('4 nước')

      // Verify Game 2 card
      const card2 = screen.getByTestId('replay-game-card-game-2')
      expect(card2).toBeInTheDocument()
      expect(card2).toHaveTextContent('Bàn đấu #practice-1')
      expect(card2).toHaveTextContent('0-1 (Đen thắng)')
      expect(card2).toHaveTextContent('alice-uu')
      expect(card2).toHaveTextContent('bob-uuid')
    })

    it('filters strictly to the requested session ID and does not load unrelated sessions', async () => {
      const getGamesSpy = vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockResolvedValueOnce({
        games: [sampleGame1],
        error: null,
      })

      render(<SessionGameReplay sessionId="target-session-999" supabaseClient={mockSupabase} />)

      await waitFor(() => {
        expect(getGamesSpy).toHaveBeenCalledWith(mockSupabase, 'target-session-999')
      })
    })
  })

  // ── 2. READ-ONLY REPLAY VIEWER & MOVE NAVIGATION ──────────────────────────
  describe('2. Read-only replay viewer and move navigation', () => {
    it('loads the persisted PGN, displays moves and keeps board position synchronized', async () => {
      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockResolvedValueOnce({
        games: [sampleGame1],
        error: null,
      })

      render(<SessionGameReplay sessionId={sessionId} supabaseClient={mockSupabase} />)

      await waitFor(() => {
        expect(screen.getByTestId('replay-move-0')).toBeInTheDocument()
      })

      const board = screen.getByTestId('chessground-view')
      expect(board).toHaveAttribute('data-viewonly', 'true')
      expect(board).toHaveAttribute('data-fen', sampleGame1.starting_fen)
      expect(screen.getByTestId('replay-step-indicator')).toHaveTextContent('0 / 4')

      // Moves tab shows 1. e4 e5 and 2. Nf3 Nc6
      expect(screen.getByTestId('replay-move-0')).toHaveTextContent('e4')
      expect(screen.getByTestId('replay-move-1')).toHaveTextContent('e5')
      expect(screen.getByTestId('replay-move-2')).toHaveTextContent(/f3/)
      expect(screen.getByTestId('replay-move-3')).toHaveTextContent(/c6/)

      // Navigate forward: Next move (1. e4)
      fireEvent.click(screen.getByTestId('replay-next-btn'))
      expect(screen.getByTestId('replay-step-indicator')).toHaveTextContent('1 / 4')
      expect(board.getAttribute('data-fen')).toContain('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')
      expect(board.getAttribute('data-lastmove')).toBe(JSON.stringify(['e2', 'e4']))
      expect(screen.getByTestId('replay-move-0')).toHaveAttribute('aria-current', 'step')

      // Navigate forward: Next move (1... e5)
      fireEvent.click(screen.getByTestId('replay-next-btn'))
      expect(screen.getByTestId('replay-step-indicator')).toHaveTextContent('2 / 4')
      expect(board.getAttribute('data-lastmove')).toBe(JSON.stringify(['e7', 'e5']))
      expect(screen.getByTestId('replay-move-1')).toHaveAttribute('aria-current', 'step')

      // Navigate backward: Previous move
      fireEvent.click(screen.getByTestId('replay-prev-btn'))
      expect(screen.getByTestId('replay-step-indicator')).toHaveTextContent('1 / 4')
      expect(board.getAttribute('data-lastmove')).toBe(JSON.stringify(['e2', 'e4']))

      // Navigate to Last move
      fireEvent.click(screen.getByTestId('replay-last-btn'))
      expect(screen.getByTestId('replay-step-indicator')).toHaveTextContent('4 / 4')
      expect(board.getAttribute('data-fen')).toContain('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3')
      expect(screen.getByTestId('replay-next-btn')).toBeDisabled()
      expect(screen.getByTestId('replay-last-btn')).toBeDisabled()

      // Navigate to First move
      fireEvent.click(screen.getByTestId('replay-first-btn'))
      expect(screen.getByTestId('replay-step-indicator')).toHaveTextContent('0 / 4')
      expect(board).toHaveAttribute('data-fen', sampleGame1.starting_fen)
      expect(board).toHaveAttribute('data-lastmove', '')
      expect(screen.getByTestId('replay-first-btn')).toBeDisabled()
      expect(screen.getByTestId('replay-prev-btn')).toBeDisabled()
    })

    it('jumps directly to specific move when clicked in move list', async () => {
      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockResolvedValueOnce({
        games: [sampleGame1],
        error: null,
      })

      render(<SessionGameReplay sessionId={sessionId} supabaseClient={mockSupabase} />)

      await waitFor(() => {
        expect(screen.getByTestId('replay-move-0')).toBeInTheDocument()
      })

      // Click on move 2... Nc6 (index 3, step 4)
      fireEvent.click(screen.getByTestId('replay-move-3'))
      expect(screen.getByTestId('replay-step-indicator')).toHaveTextContent('4 / 4')

      // Click on move 2. Nf3 (index 2, step 3)
      fireEvent.click(screen.getByTestId('replay-move-2'))
      expect(screen.getByTestId('replay-step-indicator')).toHaveTextContent('3 / 4')
      expect(screen.getByTestId('chessground-view').getAttribute('data-lastmove')).toBe(
        JSON.stringify(['g1', 'f3'])
      )
    })

    it('toggles board perspective with flip button', async () => {
      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockResolvedValueOnce({
        games: [sampleGame1],
        error: null,
      })

      render(<SessionGameReplay sessionId={sessionId} supabaseClient={mockSupabase} />)

      await waitFor(() => {
        expect(screen.getByTestId('session-game-replay')).toBeInTheDocument()
      })

      const board = screen.getByTestId('chessground-view')
      expect(board).toHaveAttribute('data-orientation', 'white')

      // Click flip button
      fireEvent.click(screen.getByTestId('replay-flip-btn'))
      expect(board).toHaveAttribute('data-orientation', 'black')

      // Flip back
      fireEvent.click(screen.getByTestId('replay-flip-btn'))
      expect(board).toHaveAttribute('data-orientation', 'white')
    })

    it('displays read-only indicator badge clearly', async () => {
      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockResolvedValueOnce({
        games: [sampleGame1],
        error: null,
      })

      render(<SessionGameReplay sessionId={sessionId} supabaseClient={mockSupabase} />)

      await waitFor(() => {
        expect(screen.getByTestId('replay-mode-badge')).toBeInTheDocument()
      })
      expect(screen.getByTestId('replay-mode-badge')).toHaveTextContent('Chỉ xem (Read-only)')
    })
  })

  // ── 3. PLAYBACK BEHAVIOR & TIMERS ─────────────────────────────────────────
  describe('3. Playback behavior, timer management, and stale prevention', () => {
    it('plays moves sequentially and pauses automatically at the end', async () => {
      vi.useFakeTimers()

      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockResolvedValueOnce({
        games: [sampleGame1],
        error: null,
      })

      render(<SessionGameReplay sessionId={sessionId} supabaseClient={mockSupabase} />)

      // Resolve initial fetch
      await act(async () => {
        await Promise.resolve()
      })

      expect(screen.getByTestId('replay-step-indicator')).toHaveTextContent('0 / 4')
      const playBtn = screen.getByTestId('replay-play-pause-btn')
      expect(playBtn).toHaveTextContent('Phát')

      // Click Play
      act(() => {
        fireEvent.click(playBtn)
      })

      expect(screen.getByTestId('replay-play-pause-btn')).toHaveTextContent('Dừng')

      // Advance by 1 second -> step 1
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(screen.getByTestId('replay-step-indicator')).toHaveTextContent('1 / 4')

      // Advance by 1 second -> step 2
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(screen.getByTestId('replay-step-indicator')).toHaveTextContent('2 / 4')

      // Click Pause
      act(() => {
        fireEvent.click(screen.getByTestId('replay-play-pause-btn'))
      })
      expect(screen.getByTestId('replay-play-pause-btn')).toHaveTextContent('Phát')

      // Verify timer is stopped
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(screen.getByTestId('replay-step-indicator')).toHaveTextContent('2 / 4')

      // Resume play until the end
      act(() => {
        fireEvent.click(screen.getByTestId('replay-play-pause-btn'))
      })
      act(() => {
        vi.advanceTimersByTime(2000)
      })

      // Reached step 4 (end) -> should automatically pause
      expect(screen.getByTestId('replay-step-indicator')).toHaveTextContent('4 / 4')
      expect(screen.getByTestId('replay-play-pause-btn')).toHaveTextContent('Phát')
    })

    it('cancels playback timer when game selection changes', async () => {
      vi.useFakeTimers()

      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockResolvedValueOnce({
        games: [sampleGame1, sampleGame2],
        error: null,
      })

      render(<SessionGameReplay sessionId={sessionId} supabaseClient={mockSupabase} />)

      await act(async () => {
        await Promise.resolve()
      })

      // Start playing Game 1
      act(() => {
        fireEvent.click(screen.getByTestId('replay-play-pause-btn'))
        vi.advanceTimersByTime(1000)
      })
      expect(screen.getByTestId('replay-step-indicator')).toHaveTextContent('1 / 4')

      // Switch to games tab and select Game 2
      act(() => {
        fireEvent.click(screen.getByTestId('replay-tab-games'))
      })
      act(() => {
        fireEvent.click(screen.getByTestId('replay-game-card-game-2'))
      })

      // Playback must be stopped and step reset to 0 for Game 2
      expect(screen.getByTestId('replay-step-indicator')).toHaveTextContent('0 / 4')
      expect(screen.getByTestId('replay-play-pause-btn')).toHaveTextContent('Phát')

      // Advancing timer should not increment step
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(screen.getByTestId('replay-step-indicator')).toHaveTextContent('0 / 4')
    })

    it('cancels playback timer when component unmounts', async () => {
      vi.useFakeTimers()

      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockResolvedValueOnce({
        games: [sampleGame1],
        error: null,
      })

      const { unmount } = render(
        <SessionGameReplay sessionId={sessionId} supabaseClient={mockSupabase} />
      )

      await act(async () => {
        await Promise.resolve()
      })

      // Start playback
      act(() => {
        fireEvent.click(screen.getByTestId('replay-play-pause-btn'))
      })

      // Unmount while playing
      unmount()

      // Advancing timers should not throw any unhandled state updates
      expect(() => {
        act(() => {
          vi.advanceTimersByTime(3000)
        })
      }).not.toThrow()
    })
  })

  // ── 4. ERROR STATES: MALFORMED & EMPTY PGN ────────────────────────────────
  describe('4. Error states for malformed or empty PGN', () => {
    it('handles empty PGN gracefully without crashing', async () => {
      const emptyPgnGame: LiveGame = {
        ...sampleGame1,
        id: 'game-empty',
        pgn: '',
        move_count: 0,
      }

      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockResolvedValueOnce({
        games: [emptyPgnGame],
        error: null,
      })

      render(<SessionGameReplay sessionId={sessionId} supabaseClient={mockSupabase} />)

      await waitFor(() => {
        expect(screen.getByTestId('replay-pgn-error')).toBeInTheDocument()
      })

      expect(screen.getByTestId('replay-pgn-error')).toHaveTextContent(
        'Biên bản ván đấu trống — không có nước đi nào để phát lại.'
      )
      expect(screen.getByTestId('replay-play-pause-btn')).toBeDisabled()
      expect(screen.getByTestId('replay-next-btn')).toBeDisabled()
    })

    it('handles malformed / corrupted PGN data with helpful error message', async () => {
      const malformedGame: LiveGame = {
        ...sampleGame1,
        id: 'game-malformed',
        pgn: '1. ??? totally invalid chess pgn syntax 999',
      }

      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockResolvedValueOnce({
        games: [malformedGame],
        error: null,
      })

      render(<SessionGameReplay sessionId={sessionId} supabaseClient={mockSupabase} />)

      await waitFor(() => {
        expect(screen.getByTestId('replay-pgn-error')).toBeInTheDocument()
      })

      expect(screen.getByTestId('replay-pgn-error')).toHaveTextContent(
        'Biên bản ván đấu không hợp lệ'
      )
      expect(screen.getByTestId('replay-play-pause-btn')).toBeDisabled()
    })
  })

  // ── 5. ACCESS & DATA INTEGRITY ────────────────────────────────────────────
  describe('5. Access control and read-only data integrity', () => {
    it('does not mutate or write back to live_games during replay', async () => {
      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockResolvedValueOnce({
        games: [sampleGame1],
        error: null,
      })

      const finalizeSpy = vi.spyOn(liveGameApi, 'finalizeLiveGame')
      const startSpy = vi.spyOn(liveGameApi, 'recordLiveGameStart')

      render(<SessionGameReplay sessionId={sessionId} supabaseClient={mockSupabase} />)

      await waitFor(() => {
        expect(screen.getByTestId('replay-move-0')).toBeInTheDocument()
      })

      // Perform extensive navigation
      fireEvent.click(screen.getByTestId('replay-next-btn'))
      fireEvent.click(screen.getByTestId('replay-next-btn'))
      fireEvent.click(screen.getByTestId('replay-last-btn'))
      fireEvent.click(screen.getByTestId('replay-first-btn'))

      // Verify zero mutation calls were made
      expect(finalizeSpy).not.toHaveBeenCalled()
      expect(startSpy).not.toHaveBeenCalled()
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })

    it('respects access authorization errors from get_live_session_games', async () => {
      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockResolvedValueOnce({
        games: [],
        error: new Error('not_authorized_for_session_games'),
      })

      render(<SessionGameReplay sessionId={sessionId} supabaseClient={mockSupabase} />)

      await waitFor(() => {
        expect(screen.queryByTestId('replay-games-loading')).not.toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('replay-tab-games'))

      expect(screen.getByTestId('replay-games-error')).toBeInTheDocument()
      expect(screen.getByText('not_authorized_for_session_games')).toBeInTheDocument()
    })
  })

  // ── 6. MODAL & STALE TIMER PROTECTION ─────────────────────────────────────
  describe('6. Stale timer callbacks and Modal dialog', () => {
    it('stale timer callback cannot modify step or board of a newly selected game', async () => {
      vi.useFakeTimers()

      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockResolvedValueOnce({
        games: [sampleGame1, sampleGame2],
        error: null,
      })

      render(<SessionGameReplay sessionId={sessionId} supabaseClient={mockSupabase} />)

      await act(async () => {
        await Promise.resolve()
      })

      // Start play on Game 1
      act(() => {
        fireEvent.click(screen.getByTestId('replay-play-pause-btn'))
      })

      // Switch to Game 2
      act(() => {
        fireEvent.click(screen.getByTestId('replay-tab-games'))
      })
      act(() => {
        fireEvent.click(screen.getByTestId('replay-game-card-game-2'))
      })

      // Ensure Game 2 is at step 0
      expect(screen.getByTestId('replay-step-indicator')).toHaveTextContent('0 / 4')

      // Advance timers significantly — Game 1 timer callback must NOT advance Game 2
      act(() => {
        vi.advanceTimersByTime(5000)
      })

      expect(screen.getByTestId('replay-step-indicator')).toHaveTextContent('0 / 4')
      expect(screen.getByTestId('replay-play-pause-btn')).toHaveTextContent('Phát')
    })

    it('SessionGameReplayModal renders when isOpen=true and closes on Escape and close button', async () => {
      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockResolvedValueOnce({
        games: [sampleGame1],
        error: null,
      })

      const onClose = vi.fn()
      const { rerender } = render(
        <SessionGameReplayModal
          sessionId={sessionId}
          isOpen={false}
          onClose={onClose}
          supabaseClient={mockSupabase}
        />
      )

      expect(screen.queryByTestId('session-game-replay-modal')).not.toBeInTheDocument()

      await act(async () => {
        rerender(
          <SessionGameReplayModal
            sessionId={sessionId}
            isOpen={true}
            onClose={onClose}
            supabaseClient={mockSupabase}
          />
        )
      })

      await waitFor(() => {
        expect(screen.getByTestId('session-game-replay-modal')).toBeInTheDocument()
      })

      // Press Escape key
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)

      // Click close button inside header
      const closeBtn = screen.getByTestId('replay-close-btn')
      fireEvent.click(closeBtn)
      expect(onClose).toHaveBeenCalledTimes(2)
    })
  })

  // ── 7. SESSION FETCH RACE CONDITION & REQUEST OWNERSHIP ───────────────────
  describe('7. Session fetch race condition protection & request ownership', () => {
    it('A. Out-of-order responses: request A resolving after request B cannot overwrite session B state', async () => {
      let resolveA!: (value: { games: LiveGame[]; error: null }) => void
      const promiseA = new Promise<{ games: LiveGame[]; error: null }>((resolve) => {
        resolveA = resolve
      })

      let resolveB!: (value: { games: LiveGame[]; error: null }) => void
      const promiseB = new Promise<{ games: LiveGame[]; error: null }>((resolve) => {
        resolveB = resolve
      })

      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockImplementation((_client, sId) => {
        if (sId === 'session-A') return promiseA
        if (sId === 'session-B') return promiseB
        return Promise.resolve({ games: [], error: null })
      })

      const gameA: LiveGame = {
        ...sampleGame1,
        id: 'game-A1',
        live_session_id: 'session-A',
        board_id: 'main-A',
      }

      const gameB: LiveGame = {
        ...sampleGame2,
        id: 'game-B1',
        live_session_id: 'session-B',
        board_id: 'practice-B',
      }

      // 1. Render session A and keep request A pending
      const { rerender } = render(
        <SessionGameReplay sessionId="session-A" supabaseClient={mockSupabase} />
      )

      fireEvent.click(screen.getByTestId('replay-tab-games'))
      expect(screen.getByTestId('replay-games-loading')).toBeInTheDocument()

      // 2. Rerender with session B and keep request B pending
      rerender(
        <SessionGameReplay sessionId="session-B" supabaseClient={mockSupabase} />
      )

      expect(screen.getByTestId('replay-games-loading')).toBeInTheDocument()
      expect(screen.queryByTestId('replay-game-card-game-A1')).not.toBeInTheDocument()
      expect(screen.queryByTestId('replay-game-card-game-B1')).not.toBeInTheDocument()

      // 3. Resolve B and verify only B games are displayed
      await act(async () => {
        resolveB({ games: [gameB], error: null })
      })

      expect(screen.queryByTestId('replay-games-loading')).not.toBeInTheDocument()
      expect(screen.getByTestId('replay-game-card-game-B1')).toBeInTheDocument()
      expect(screen.queryByTestId('replay-game-card-game-A1')).not.toBeInTheDocument()
      expect(screen.getByTestId('replay-game-card-game-B1')).toHaveAttribute('aria-selected', 'true')

      // 4. Resolve A afterward and verify B games remain displayed
      await act(async () => {
        resolveA({ games: [gameA], error: null })
      })

      expect(screen.getByTestId('replay-game-card-game-B1')).toBeInTheDocument()
      expect(screen.queryByTestId('replay-game-card-game-A1')).not.toBeInTheDocument()

      // 5. Confirm A cannot replace B's selected game, error state, or loading state
      expect(screen.getByTestId('replay-game-card-game-B1')).toHaveAttribute('aria-selected', 'true')
      expect(screen.queryByTestId('replay-games-loading')).not.toBeInTheDocument()
      expect(screen.queryByTestId('replay-games-error')).not.toBeInTheDocument()
    })

    it("B. Immediate session switch: A's board, metadata, and move list are immediately cleared when switching to B", async () => {
      let resolveB!: (value: { games: LiveGame[]; error: null }) => void
      const promiseB = new Promise<{ games: LiveGame[]; error: null }>((resolve) => {
        resolveB = resolve
      })

      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockImplementation((_client, sId) => {
        if (sId === 'session-A') {
          return Promise.resolve({ games: [sampleGame1], error: null })
        }
        if (sId === 'session-B') {
          return promiseB
        }
        return Promise.resolve({ games: [], error: null })
      })

      // 1. Load A successfully
      const { rerender } = render(
        <SessionGameReplay sessionId="session-A" supabaseClient={mockSupabase} />
      )

      await waitFor(() => {
        expect(screen.getByTestId('replay-move-pair-1')).toBeInTheDocument()
      })

      // Confirm A's metadata, moves, and board are shown
      expect(screen.getByText(/teacher-/)).toBeInTheDocument()
      expect(screen.getByText(/student-/)).toBeInTheDocument()
      expect(screen.getByText(/1-0/)).toBeInTheDocument()
      expect(screen.getByTestId('replay-move-0')).toBeInTheDocument()

      // 2. Rerender with B while B is pending
      rerender(
        <SessionGameReplay sessionId="session-B" supabaseClient={mockSupabase} />
      )

      // 3. Verify A's board, metadata, and move list are no longer shown as content for session B
      expect(screen.queryByText(/teacher-/)).not.toBeInTheDocument()
      expect(screen.queryByText(/student-/)).not.toBeInTheDocument()
      expect(screen.queryByText(/1-0/)).not.toBeInTheDocument()
      expect(screen.queryByTestId('replay-move-0')).not.toBeInTheDocument()
      expect(screen.queryByTestId('replay-move-pair-1')).not.toBeInTheDocument()
      expect(screen.getByText('Chưa có nước đi nào để hiển thị')).toBeInTheDocument()

      // Board has reverted to starting FEN without A's moves
      const board = screen.getByTestId('chessground-view')
      expect(board).toHaveAttribute('data-lastmove', '')
      expect(board).toHaveAttribute('data-fen', sampleGame1.starting_fen)

      // In games tab, loading is active and no session A games are shown
      fireEvent.click(screen.getByTestId('replay-tab-games'))
      expect(screen.getByTestId('replay-games-loading')).toBeInTheDocument()
      expect(screen.queryByTestId(`replay-game-card-${sampleGame1.id}`)).not.toBeInTheDocument()

      // Clean up pending B promise
      await act(async () => {
        resolveB({ games: [], error: null })
      })
    })

    it('C. Authorization error on B: B error state remains authoritative when pending A request resolves', async () => {
      let resolveA2!: (value: { games: LiveGame[]; error: null }) => void
      const promiseA2 = new Promise<{ games: LiveGame[]; error: null }>((resolve) => {
        resolveA2 = resolve
      })

      let resolveBAuthError!: (value: { games: LiveGame[]; error: Error }) => void
      const promiseBAuthError = new Promise<{ games: LiveGame[]; error: Error }>((resolve) => {
        resolveBAuthError = resolve
      })

      let callCountA = 0
      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockImplementation((_client, sId) => {
        if (sId === 'session-A') {
          callCountA++
          if (callCountA === 1) {
            return Promise.resolve({ games: [sampleGame1], error: null })
          }
          return promiseA2
        }
        if (sId === 'session-B') {
          return promiseBAuthError
        }
        return Promise.resolve({ games: [], error: null })
      })

      // 1. Start with valid A data
      const { rerender } = render(
        <SessionGameReplay sessionId="session-A" supabaseClient={mockSupabase} />
      )

      await waitFor(() => {
        expect(screen.getByTestId('replay-move-pair-1')).toBeInTheDocument()
      })

      // Switch to games tab to verify A game is present
      fireEvent.click(screen.getByTestId('replay-tab-games'))
      expect(screen.getByTestId(`replay-game-card-${sampleGame1.id}`)).toBeInTheDocument()

      // Start an in-flight reload request on session A
      fireEvent.click(screen.getByTitle('Tải lại danh sách'))

      // 2. Switch to B, whose request returns an authorization error
      rerender(
        <SessionGameReplay sessionId="session-B" supabaseClient={mockSupabase} />
      )

      await act(async () => {
        resolveBAuthError({
          games: [],
          error: new Error('403 Forbidden: You do not have permission to view games in session B'),
        })
      })

      // Verify B's error state is displayed
      expect(screen.getByTestId('replay-games-error')).toBeInTheDocument()
      expect(
        screen.getByText('403 Forbidden: You do not have permission to view games in session B')
      ).toBeInTheDocument()
      expect(screen.queryByTestId(`replay-game-card-${sampleGame1.id}`)).not.toBeInTheDocument()

      // 3. Resolve any pending A request afterward
      await act(async () => {
        resolveA2({ games: [sampleGame1], error: null })
      })

      // 4. Verify B's error state remains and no A games are displayed
      expect(screen.getByTestId('replay-games-error')).toBeInTheDocument()
      expect(
        screen.getByText('403 Forbidden: You do not have permission to view games in session B')
      ).toBeInTheDocument()
      expect(screen.queryByTestId(`replay-game-card-${sampleGame1.id}`)).not.toBeInTheDocument()
      expect(screen.queryByTestId('replay-move-pair-1')).not.toBeInTheDocument()
    })

    it('D. Retry ownership: resolving older request after newer request does not overwrite newer result', async () => {
      let resolveOlder!: (value: { games: LiveGame[]; error: null }) => void
      const promiseOlder = new Promise<{ games: LiveGame[]; error: null }>((resolve) => {
        resolveOlder = resolve
      })

      let resolveNewer!: (value: { games: LiveGame[]; error: null }) => void
      const promiseNewer = new Promise<{ games: LiveGame[]; error: null }>((resolve) => {
        resolveNewer = resolve
      })

      let requestIndex = 0
      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockImplementation(() => {
        requestIndex++
        if (requestIndex === 1) {
          return promiseOlder
        }
        return promiseNewer
      })

      // 1. Start Request 1 for session
      render(<SessionGameReplay sessionId={sessionId} supabaseClient={mockSupabase} />)

      // Switch to games tab
      fireEvent.click(screen.getByTestId('replay-tab-games'))
      expect(screen.getByTestId('replay-games-loading')).toBeInTheDocument()

      // 2. Start Request 2 (retry / reload) for the same session while Request 1 is still pending
      fireEvent.click(screen.getByTitle('Tải lại danh sách'))

      // 3. Resolve the newer request first with sampleGame2
      await act(async () => {
        resolveNewer({ games: [sampleGame2], error: null })
      })

      // Verify newer request result is displayed
      expect(screen.queryByTestId('replay-games-loading')).not.toBeInTheDocument()
      expect(screen.getByTestId(`replay-game-card-${sampleGame2.id}`)).toBeInTheDocument()
      expect(screen.queryByTestId(`replay-game-card-${sampleGame1.id}`)).not.toBeInTheDocument()
      expect(screen.getByTestId(`replay-game-card-${sampleGame2.id}`)).toHaveAttribute(
        'aria-selected',
        'true'
      )

      // 4. Resolve the older request afterward with sampleGame1
      await act(async () => {
        resolveOlder({ games: [sampleGame1], error: null })
      })

      // 5. Verify the newer result remains authoritative
      expect(screen.getByTestId(`replay-game-card-${sampleGame2.id}`)).toBeInTheDocument()
      expect(screen.queryByTestId(`replay-game-card-${sampleGame1.id}`)).not.toBeInTheDocument()
      expect(screen.getByTestId(`replay-game-card-${sampleGame2.id}`)).toHaveAttribute(
        'aria-selected',
        'true'
      )
    })

    it('E. Playback stops on a committed session change and timer is cancelled', async () => {
      vi.useFakeTimers()

      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockImplementation((_client, sId) => {
        if (sId === 'session-A') {
          return Promise.resolve({ games: [sampleGame1], error: null })
        }
        if (sId === 'session-B') {
          return Promise.resolve({ games: [sampleGame2], error: null })
        }
        return Promise.resolve({ games: [], error: null })
      })

      const { rerender } = render(
        <SessionGameReplay sessionId="session-A" supabaseClient={mockSupabase} />
      )

      await act(async () => {
        await Promise.resolve()
      })

      // Start playback on session A
      act(() => {
        fireEvent.click(screen.getByTestId('replay-play-pause-btn'))
      })

      expect(screen.getByTestId('replay-play-pause-btn')).toHaveTextContent('Dừng')

      // Switch to session B
      await act(async () => {
        rerender(<SessionGameReplay sessionId="session-B" supabaseClient={mockSupabase} />)
        await Promise.resolve()
      })

      // Playback stops on committed session change
      expect(screen.getByTestId('replay-play-pause-btn')).toHaveTextContent('Phát')

      // Advance timers significantly — session A timer callback must not run or advance anything
      act(() => {
        vi.advanceTimersByTime(5000)
      })

      expect(screen.getByTestId('replay-step-indicator')).toHaveTextContent('0 / 4')
      expect(screen.getByTestId('replay-play-pause-btn')).toHaveTextContent('Phát')
    })

    it('F. initialBoardId auto-selects the game for that board and applies board filter', async () => {
      const practiceGame: LiveGame = {
        ...sampleGame2,
        id: 'game-practice-board-1',
        board_id: 'practice-board-1',
        game_scope: 'PRACTICE',
      }
      vi.spyOn(liveGameApi, 'getLiveGamesForSession').mockResolvedValue({
        games: [sampleGame1, practiceGame],
        error: null,
      })

      render(
        <SessionGameReplay
          sessionId={sessionId}
          supabaseClient={mockSupabase}
          initialBoardId="practice-board-1"
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('replay-active-game-badges')).toHaveAttribute(
          'data-board-id',
          'practice-board-1'
        )
      })

      // Switch to games tab and verify board filter badge is displayed
      fireEvent.click(screen.getByTestId('replay-tab-games'))
      expect(screen.getByTestId('replay-board-filter-badge')).toBeInTheDocument()
      expect(screen.getByTestId('active-board-filter-id')).toHaveTextContent('practice-board-1')
      expect(screen.getByTestId('replay-game-card-game-practice-board-1')).toBeInTheDocument()
      expect(screen.queryByTestId(`replay-game-card-${sampleGame1.id}`)).not.toBeInTheDocument()

      // Clear filter and verify all games shown
      fireEvent.click(screen.getByTestId('clear-board-filter-btn'))
      expect(screen.queryByTestId('replay-board-filter-badge')).not.toBeInTheDocument()
      expect(screen.getByTestId(`replay-game-card-${sampleGame1.id}`)).toBeInTheDocument()
      expect(screen.getByTestId('replay-game-card-game-practice-board-1')).toBeInTheDocument()
    })
  })
})

