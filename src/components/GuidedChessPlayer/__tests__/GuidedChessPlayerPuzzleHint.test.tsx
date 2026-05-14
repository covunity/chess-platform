/**
 * GuidedChessPlayer — Puzzle hint escalation + "Xem đáp án" (PRD-0004 Slice 9c, issue #202)
 *
 * Tests for:
 * - Progressive hint levels driven by wrongAttemptsAt counter
 * - "Xem đáp án" button visibility and click behaviour
 * - onComplete propagates gaveUp flag
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

function render(ui: Parameters<typeof rtlRender>[0]) {
  return rtlRender(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
}

const OPPONENT_DELAY_MS = 600

// 1. e4 e5 2. Nf3 — three plies; white learner
// Main move from root: e4 (e2→e4). Wrong move: e2→e3 (not in tree).
const LINEAR_PUZZLE_PGN = '1. e4 e5 2. Nf3'

function makePuzzleLesson(pgn = LINEAR_PUZZLE_PGN) {
  return {
    id: 'puzzle-hint-test',
    title: 'Hint Test Puzzle',
    pgn_data: pgn,
    board_perspective: 'white' as const,
    puzzle_player_side: 'white' as const,
    type: 'puzzle' as const,
  }
}

/** Click e2, then a wrong square (e3) to trigger a wrong attempt at root. */
function wrongAttempt(board: HTMLElement) {
  fireEvent.click(board.querySelector('[data-square="e2"]')!)
  fireEvent.click(board.querySelector('[data-square="e3"]')!)
}

// ── Hint level escalation ─────────────────────────────────────────────────────

describe('GuidedChessPlayer — puzzle hint escalation (Slice 9c)', () => {
  describe('hintLevel 0: first wrong attempt — no hint autoshape', () => {
    it('e2 (main origin) has no data-autoshape after 1st wrong attempt', () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
        />
      )
      const board = screen.getByTestId('guided-player-board')
      wrongAttempt(board)
      // One wrong attempt → no hint yet
      expect(board.querySelector('[data-square="e2"]')).not.toHaveAttribute('data-autoshape')
    })

    it('e4 (main dest) has no data-autoshape-dest after 1st wrong attempt', () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
        />
      )
      const board = screen.getByTestId('guided-player-board')
      wrongAttempt(board)
      expect(board.querySelector('[data-square="e4"]')).not.toHaveAttribute('data-autoshape-dest')
    })
  })

  describe('hintLevel 1: second wrong attempt — origin square highlighted', () => {
    it('e2 (origin of main move) gets data-autoshape after 2nd wrong attempt', () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
        />
      )
      const board = screen.getByTestId('guided-player-board')
      wrongAttempt(board)
      wrongAttempt(board)
      // Two wrong attempts → hint level 1: origin circle
      expect(board.querySelector('[data-square="e2"]')).toHaveAttribute('data-autoshape', 'true')
    })

    it('e4 (dest) has no data-autoshape-dest at hint level 1 (arrow not yet shown)', () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
        />
      )
      const board = screen.getByTestId('guided-player-board')
      wrongAttempt(board)
      wrongAttempt(board)
      expect(board.querySelector('[data-square="e4"]')).not.toHaveAttribute('data-autoshape-dest')
    })
  })

  describe('hintLevel 2: third wrong attempt — faint arrow from origin to dest', () => {
    it('e2 (origin) still has data-autoshape at hint level 2', () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
        />
      )
      const board = screen.getByTestId('guided-player-board')
      wrongAttempt(board)
      wrongAttempt(board)
      wrongAttempt(board)
      expect(board.querySelector('[data-square="e2"]')).toHaveAttribute('data-autoshape', 'true')
    })

    it('e4 (dest of main move) gets data-autoshape-dest after 3rd wrong attempt (arrow drawn)', () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
        />
      )
      const board = screen.getByTestId('guided-player-board')
      wrongAttempt(board)
      wrongAttempt(board)
      wrongAttempt(board)
      // Three wrong attempts → hint level 2: origin circle + arrow
      expect(board.querySelector('[data-square="e4"]')).toHaveAttribute('data-autoshape-dest', 'true')
    })
  })

  describe('hint clears when learner advances to a new node', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('no hint on new node after correct move (g1 has no data-autoshape)', () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
        />
      )
      const board = screen.getByTestId('guided-player-board')
      // Build up hint level 1 at root
      wrongAttempt(board)
      wrongAttempt(board)
      expect(board.querySelector('[data-square="e2"]')).toHaveAttribute('data-autoshape', 'true')

      // Play correct move e4 — advance past hinted node
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e4"]')!)

      // Opponent auto-plays e5
      act(() => { vi.advanceTimersByTime(OPPONENT_DELAY_MS + 50) })

      // Now at the e5 node; next move is 2. Nf3 (from g1 to f3)
      // No wrong attempts at this new node → no autoshape on g1
      const updatedBoard = screen.getByTestId('guided-player-board')
      expect(updatedBoard.querySelector('[data-square="g1"]')).not.toHaveAttribute('data-autoshape')
    })
  })
})

// ── "Xem đáp án" button visibility ───────────────────────────────────────────

describe('GuidedChessPlayer — "Xem đáp án" button', () => {
  it('button is not present before any wrong attempt', () => {
    render(
      <GuidedChessPlayer
        lesson={makePuzzleLesson()}
        lessonNumber={1}
        totalLessons={1}
        mode="puzzle"
      />
    )
    expect(screen.queryByTestId('puzzle-show-answer-btn')).not.toBeInTheDocument()
  })

  it('button is not present after 1st wrong attempt', () => {
    render(
      <GuidedChessPlayer
        lesson={makePuzzleLesson()}
        lessonNumber={1}
        totalLessons={1}
        mode="puzzle"
      />
    )
    const board = screen.getByTestId('guided-player-board')
    wrongAttempt(board)
    expect(screen.queryByTestId('puzzle-show-answer-btn')).not.toBeInTheDocument()
  })

  it('button is not present after 2nd wrong attempt', () => {
    render(
      <GuidedChessPlayer
        lesson={makePuzzleLesson()}
        lessonNumber={1}
        totalLessons={1}
        mode="puzzle"
      />
    )
    const board = screen.getByTestId('guided-player-board')
    wrongAttempt(board)
    wrongAttempt(board)
    expect(screen.queryByTestId('puzzle-show-answer-btn')).not.toBeInTheDocument()
  })

  it('button appears after 3rd wrong attempt', () => {
    render(
      <GuidedChessPlayer
        lesson={makePuzzleLesson()}
        lessonNumber={1}
        totalLessons={1}
        mode="puzzle"
      />
    )
    const board = screen.getByTestId('guided-player-board')
    wrongAttempt(board)
    wrongAttempt(board)
    wrongAttempt(board)
    expect(screen.getByTestId('puzzle-show-answer-btn')).toBeInTheDocument()
  })

  it('button is not present in non-puzzle (lesson) mode', () => {
    const lesson = {
      id: 'l1',
      title: 'Lesson',
      pgn_data: LINEAR_PUZZLE_PGN,
      board_perspective: 'white' as const,
    }
    render(
      <GuidedChessPlayer lesson={lesson} lessonNumber={1} totalLessons={1} />
    )
    const board = screen.getByTestId('guided-player-board')
    // Wrong moves in lesson mode (different code path — snap-back but no wrong-attempt counter)
    fireEvent.click(board.querySelector('[data-square="e2"]')!)
    fireEvent.click(board.querySelector('[data-square="e3"]')!)
    fireEvent.click(board.querySelector('[data-square="e2"]')!)
    fireEvent.click(board.querySelector('[data-square="e3"]')!)
    fireEvent.click(board.querySelector('[data-square="e2"]')!)
    fireEvent.click(board.querySelector('[data-square="e3"]')!)
    expect(screen.queryByTestId('puzzle-show-answer-btn')).not.toBeInTheDocument()
  })
})

// ── "Xem đáp án" click behaviour ─────────────────────────────────────────────

describe('GuidedChessPlayer — "Xem đáp án" click', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('playing out main line reaches leaf (knight on f3)', () => {
    render(
      <GuidedChessPlayer
        lesson={makePuzzleLesson()}
        lessonNumber={1}
        totalLessons={1}
        mode="puzzle"
      />
    )
    const board = screen.getByTestId('guided-player-board')
    // 3 wrong attempts
    wrongAttempt(board)
    wrongAttempt(board)
    wrongAttempt(board)

    // Click show-answer
    fireEvent.click(screen.getByTestId('puzzle-show-answer-btn'))

    // Allow all 3 steps to animate (e4, e5, Nf3)
    act(() => { vi.advanceTimersByTime(3 * OPPONENT_DELAY_MS + 50) })

    // Board should show white knight on f3
    const updatedBoard = screen.getByTestId('guided-player-board')
    expect(updatedBoard.querySelector('[data-square="f3"]')).toHaveTextContent('♘')
  })

  it('onComplete called with gaveUp=true after show-answer', () => {
    const onComplete = vi.fn()
    render(
      <GuidedChessPlayer
        lesson={makePuzzleLesson()}
        lessonNumber={1}
        totalLessons={1}
        mode="puzzle"
        onComplete={onComplete}
      />
    )
    const board = screen.getByTestId('guided-player-board')
    wrongAttempt(board)
    wrongAttempt(board)
    wrongAttempt(board)

    fireEvent.click(screen.getByTestId('puzzle-show-answer-btn'))
    act(() => { vi.advanceTimersByTime(3 * OPPONENT_DELAY_MS + 50) })

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith(true)
  })

  it('onComplete called with gaveUp=false when solved without giving up', () => {
    const onComplete = vi.fn()
    render(
      <GuidedChessPlayer
        lesson={makePuzzleLesson()}
        lessonNumber={1}
        totalLessons={1}
        mode="puzzle"
        onComplete={onComplete}
      />
    )
    const board = screen.getByTestId('guided-player-board')
    // Play e4 (correct)
    fireEvent.click(board.querySelector('[data-square="e2"]')!)
    fireEvent.click(board.querySelector('[data-square="e4"]')!)
    // Opponent plays e5
    act(() => { vi.advanceTimersByTime(OPPONENT_DELAY_MS) })
    // Play Nf3 (correct)
    const b2 = screen.getByTestId('guided-player-board')
    fireEvent.click(b2.querySelector('[data-square="g1"]')!)
    fireEvent.click(b2.querySelector('[data-square="f3"]')!)

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith(false)
  })

  it('show-answer button disappears after being clicked', () => {
    render(
      <GuidedChessPlayer
        lesson={makePuzzleLesson()}
        lessonNumber={1}
        totalLessons={1}
        mode="puzzle"
      />
    )
    const board = screen.getByTestId('guided-player-board')
    wrongAttempt(board)
    wrongAttempt(board)
    wrongAttempt(board)

    expect(screen.getByTestId('puzzle-show-answer-btn')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('puzzle-show-answer-btn'))
    expect(screen.queryByTestId('puzzle-show-answer-btn')).not.toBeInTheDocument()
  })

  it('gave-up complete message shown after show-answer', () => {
    render(
      <GuidedChessPlayer
        lesson={makePuzzleLesson()}
        lessonNumber={1}
        totalLessons={1}
        mode="puzzle"
      />
    )
    const board = screen.getByTestId('guided-player-board')
    wrongAttempt(board)
    wrongAttempt(board)
    wrongAttempt(board)

    fireEvent.click(screen.getByTestId('puzzle-show-answer-btn'))
    act(() => { vi.advanceTimersByTime(3 * OPPONENT_DELAY_MS + 50) })

    expect(screen.getByTestId('puzzle-gave-up-complete')).toBeInTheDocument()
  })
})

// ── Non-puzzle regression ─────────────────────────────────────────────────────

describe('GuidedChessPlayer — hint system is puzzle-mode only', () => {
  it('no autoshape added in lesson mode even after multiple wrong moves', () => {
    const lesson = {
      id: 'l1',
      title: 'Lesson',
      pgn_data: LINEAR_PUZZLE_PGN,
      board_perspective: 'white' as const,
    }
    render(
      <GuidedChessPlayer lesson={lesson} lessonNumber={1} totalLessons={1} />
    )
    const board = screen.getByTestId('guided-player-board')
    // 3 wrong clicks in lesson mode
    fireEvent.click(board.querySelector('[data-square="e2"]')!)
    fireEvent.click(board.querySelector('[data-square="e3"]')!)
    fireEvent.click(board.querySelector('[data-square="e2"]')!)
    fireEvent.click(board.querySelector('[data-square="e3"]')!)
    fireEvent.click(board.querySelector('[data-square="e2"]')!)
    fireEvent.click(board.querySelector('[data-square="e3"]')!)
    // No autoshape in lesson mode
    expect(board.querySelector('[data-square="e2"]')).not.toHaveAttribute('data-autoshape')
  })
})
