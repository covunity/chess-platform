/**
 * GuidedChessPlayer — Puzzle attempts API + best-attempts badge tests
 * (PRD-0004 Slice 9b, issue #201)
 *
 * Tests:
 * - recordPuzzleAttempt called on completion with correct wrong_attempts + duration_seconds
 * - getBestPuzzleAttempt called on mount in puzzle mode → shows best badge when result exists
 * - no badge when getBestPuzzleAttempt returns null (first-ever play)
 * - completion screen shows current run wrong_attempts
 * - if recordPuzzleAttempt fails, completion UI still renders (error is swallowed)
 */

import {
  render as rtlRender,
  screen,
  act,
  fireEvent,
} from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../i18n'
import GuidedChessPlayer from '../GuidedChessPlayer'

vi.mock('chessground')

// Mock puzzleAttemptApi so we can control return values in tests
vi.mock('../../../lib/puzzleAttemptApi', () => ({
  recordPuzzleAttempt: vi.fn().mockResolvedValue({ error: null }),
  getBestPuzzleAttempt: vi.fn().mockResolvedValue(null),
}))

import { recordPuzzleAttempt, getBestPuzzleAttempt } from '../../../lib/puzzleAttemptApi'

function render(ui: Parameters<typeof rtlRender>[0]) {
  return rtlRender(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
}

const OPPONENT_DELAY_MS = 600

// Simple linear puzzle (white learner): 1. e4 e5 2. Nf3
const LINEAR_PUZZLE_PGN = '1. e4 e5 2. Nf3'

interface PuzzleLesson {
  id: string
  title: string
  pgn_data: string
  board_perspective: 'white' | 'black'
  coach_note?: string | null
  puzzle_player_side?: 'white' | 'black' | null
  type?: 'chess' | 'video' | 'puzzle'
}

function makePuzzleLesson(overrides: Partial<PuzzleLesson> = {}): PuzzleLesson {
  return {
    id: 'puzzle-1',
    title: 'Test Puzzle',
    pgn_data: LINEAR_PUZZLE_PGN,
    board_perspective: 'white',
    puzzle_player_side: 'white',
    type: 'puzzle',
    ...overrides,
  }
}

// A supabase client stub (only needed as a prop for the component)
const stubClient = {} as never

/** Complete the linear puzzle: e4, wait for e5, Nf3 */
function completePuzzle() {
  const board = screen.getByTestId('guided-player-board')
  fireEvent.click(board.querySelector('[data-square="e2"]')!)
  fireEvent.click(board.querySelector('[data-square="e4"]')!)
  act(() => { vi.advanceTimersByTime(OPPONENT_DELAY_MS) })
  const b2 = screen.getByTestId('guided-player-board')
  fireEvent.click(b2.querySelector('[data-square="g1"]')!)
  fireEvent.click(b2.querySelector('[data-square="f3"]')!)
}

describe('GuidedChessPlayer — puzzle attempts (Slice 9b)', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('getBestPuzzleAttempt on mount', () => {
    // These tests do NOT use fake timers — they rely on real async resolution
    it('calls getBestPuzzleAttempt with the lesson_id when in puzzle mode', async () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
          supabaseClient={stubClient}
        />
      )
      // Flush promises
      await act(async () => {})
      expect(getBestPuzzleAttempt).toHaveBeenCalledWith(stubClient, 'puzzle-1')
    })

    it('does NOT call getBestPuzzleAttempt when not in puzzle mode', async () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="lesson"
          supabaseClient={stubClient}
        />
      )
      await act(async () => {})
      expect(getBestPuzzleAttempt).not.toHaveBeenCalled()
    })

    it('shows no best badge when getBestPuzzleAttempt returns null', async () => {
      vi.mocked(getBestPuzzleAttempt).mockResolvedValue(null)
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
          supabaseClient={stubClient}
        />
      )
      await act(async () => {})
      expect(screen.queryByTestId('puzzle-best-badge')).not.toBeInTheDocument()
    })

    it('shows best badge when getBestPuzzleAttempt returns a previous best', async () => {
      vi.mocked(getBestPuzzleAttempt).mockResolvedValue({ wrong_attempts: 2 })
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
          supabaseClient={stubClient}
        />
      )
      await act(async () => {})
      const badge = screen.getByTestId('puzzle-best-badge')
      expect(badge).toBeInTheDocument()
      // i18n key: guidedPlayer.puzzleBestBadge → "Lần tốt nhất: {count}"
      expect(badge).toHaveTextContent('2')
    })
  })

  describe('recordPuzzleAttempt on completion', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('calls recordPuzzleAttempt when puzzle is completed via main line', async () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
          supabaseClient={stubClient}
        />
      )
      completePuzzle()
      // Flush microtasks (promise resolution)
      await act(async () => { await Promise.resolve() })

      expect(recordPuzzleAttempt).toHaveBeenCalledTimes(1)
      const call = vi.mocked(recordPuzzleAttempt).mock.calls[0]
      expect(call[0]).toBe(stubClient)
      expect(call[1]).toMatchObject({
        lesson_id: 'puzzle-1',
        wrong_attempts: 0,
      })
      expect(typeof call[1].duration_seconds).toBe('number')
      expect(call[1].duration_seconds).toBeGreaterThanOrEqual(0)
    })

    it('tracks wrong_attempts correctly across multiple wrong moves', async () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
          supabaseClient={stubClient}
        />
      )
      const board = screen.getByTestId('guided-player-board')
      // 2 wrong moves at root position
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e3"]')!) // wrong
      act(() => { vi.advanceTimersByTime(1100) }) // clear wrong-move timer
      fireEvent.click(board.querySelector('[data-square="d2"]')!)
      fireEvent.click(board.querySelector('[data-square="d3"]')!) // wrong again
      act(() => { vi.advanceTimersByTime(1100) })

      // Now play correct moves to complete
      completePuzzle()
      await act(async () => { await Promise.resolve() })

      expect(recordPuzzleAttempt).toHaveBeenCalledTimes(1)
      const call = vi.mocked(recordPuzzleAttempt).mock.calls[0]
      expect(call[1].wrong_attempts).toBe(2)
    })

    it('completion UI still renders even if recordPuzzleAttempt fails', async () => {
      vi.mocked(recordPuzzleAttempt).mockResolvedValue({ error: new Error('network error') })
      const onComplete = vi.fn()
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
          supabaseClient={stubClient}
          onComplete={onComplete}
        />
      )
      completePuzzle()
      await act(async () => { await Promise.resolve() })

      expect(recordPuzzleAttempt).toHaveBeenCalledTimes(1)
      // onComplete should still have fired
      expect(onComplete).toHaveBeenCalledTimes(1)
    })
  })

  describe('completion screen', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('shows puzzle-completion-screen after solving a puzzle', async () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
          supabaseClient={stubClient}
        />
      )
      completePuzzle()
      await act(async () => { await Promise.resolve() })

      expect(screen.getByTestId('puzzle-completion-screen')).toBeInTheDocument()
    })

    it('shows current run wrong-attempt count on completion screen', async () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
          supabaseClient={stubClient}
        />
      )
      const board = screen.getByTestId('guided-player-board')
      // Make 1 wrong move
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e3"]')!) // wrong
      act(() => { vi.advanceTimersByTime(1100) })
      // Play correct moves to complete
      completePuzzle()
      await act(async () => { await Promise.resolve() })

      // Completion screen shows wrong-attempt count: 1
      const wrongEl = screen.getByTestId('puzzle-completion-wrong-attempts')
      expect(wrongEl).toHaveTextContent('1')
    })

    it('shows best line on completion screen when previous best exists', async () => {
      vi.mocked(getBestPuzzleAttempt).mockResolvedValue({ wrong_attempts: 3 })
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
          supabaseClient={stubClient}
        />
      )
      // Let getBestPuzzleAttempt resolve (but we're in fake timers, need to flush promises)
      await act(async () => { await Promise.resolve() })

      completePuzzle()
      await act(async () => { await Promise.resolve() })

      // Completion screen shows a "Best: N" line with the previous best
      const bestEl = screen.getByTestId('puzzle-completion-best')
      expect(bestEl).toHaveTextContent('3')
    })

    it('does NOT show puzzle-completion-screen in lesson mode after reaching end', async () => {
      const lesson = {
        id: 'l1',
        title: 'Regular Lesson',
        pgn_data: LINEAR_PUZZLE_PGN,
        board_perspective: 'white' as const,
        coach_note: null,
      }
      render(
        <GuidedChessPlayer
          lesson={lesson}
          lessonNumber={1}
          totalLessons={1}
          mode="lesson"
          supabaseClient={stubClient}
        />
      )
      completePuzzle()
      await act(async () => { await Promise.resolve() })
      expect(screen.queryByTestId('puzzle-completion-screen')).not.toBeInTheDocument()
    })
  })
})
