/**
 * GuidedChessPlayer — Puzzle mode tests (PRD-0004 Slice 9a, issue #196)
 *
 * Tests for mode='puzzle' behavior:
 * - opponent auto-play if puzzle starts on opponent's side
 * - wrong move: snap-back + red square + increment wrongAttemptsAt
 * - mistake node: animate + banner for 1500ms + revert (no wrongAttempts increment)
 * - correct/main-line: accept + advance + opponent auto-play
 * - onComplete fires at any leaf
 */

import {
  render as rtlRender,
  screen,
  act,
  fireEvent,
  waitFor,
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

// PGN where Black is the learner's side (board_perspective = black)
// White plays e4 first (opponent), then black plays e5 (learner)
const BLACK_SIDE_PGN = '1. e4 e5'

// Puzzle PGN with a mistake variation:
// 1. e4   (main line / learner move)
// The move d4 is annotated as purpose='mistake' with note
const MISTAKE_PGN =
  '1. e4 {[gambitly:v1]{"p":"correct"}} (1. d4 {[gambitly:v1]{"p":"mistake","n":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"That leads to the Queen’s Gambit!"}]}]}}}) 1...e5'

// Puzzle PGN with a correct variation and main line
// 1. e4 or 1. d4 both marked as correct
const CORRECT_VARIATION_PGN =
  '1. e4 {[gambitly:v1]{"p":"correct"}} (1. d4 {[gambitly:v1]{"p":"correct"}} 1...d5) 1...e5'

// Simple linear puzzle (white learner)
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

describe('GuidedChessPlayer — puzzle mode (Slice 9a)', () => {
  describe('basic puzzle rendering', () => {
    it('renders guided-player-root in puzzle mode', () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
        />
      )
      expect(screen.getByTestId('guided-player-root')).toBeInTheDocument()
    })

    it('shows your-turn prompt when learner side matches first move', () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
        />
      )
      // White to move, learner is white — should show your turn
      expect(screen.getByTestId('your-turn-prompt')).toBeInTheDocument()
    })
  })

  describe('opponent auto-play when puzzle starts on opponent side', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('auto-plays opponent first move when puzzle_player_side is black', () => {
      const blackLesson = makePuzzleLesson({
        pgn_data: BLACK_SIDE_PGN,
        board_perspective: 'black',
        puzzle_player_side: 'black',
      })
      render(
        <GuidedChessPlayer
          lesson={blackLesson}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
        />
      )
      // Before timer: e2 pawn still there
      const board = screen.getByTestId('guided-player-board')
      expect(board.querySelector('[data-square="e2"]')).toHaveTextContent('♙')
      expect(board.querySelector('[data-square="e4"]')).toHaveTextContent('')

      // After OPPONENT_DELAY: white auto-plays e4
      act(() => {
        vi.advanceTimersByTime(OPPONENT_DELAY_MS)
      })

      const updatedBoard = screen.getByTestId('guided-player-board')
      expect(updatedBoard.querySelector('[data-square="e2"]')).toHaveTextContent('')
      expect(updatedBoard.querySelector('[data-square="e4"]')).toHaveTextContent('♙')
    })

    it('does not auto-play when puzzle_player_side is white and white moves first', () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
        />
      )
      act(() => {
        vi.advanceTimersByTime(OPPONENT_DELAY_MS + 50)
      })
      // e2 pawn should still be on e2
      const board = screen.getByTestId('guided-player-board')
      expect(board.querySelector('[data-square="e2"]')).toHaveTextContent('♙')
    })
  })

  describe('wrong move in puzzle mode', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('marks origin square with data-wrong-move on no-match wrong move', () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
        />
      )
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      // e3 is not the expected move (e4 is)
      fireEvent.click(board.querySelector('[data-square="e3"]')!)
      expect(board.querySelector('[data-square="e2"]')).toHaveAttribute(
        'data-wrong-move',
        'true'
      )
    })

    it('does not advance board position on no-match wrong move', () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
        />
      )
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e3"]')!)
      // Pawn still on e2
      expect(board.querySelector('[data-square="e2"]')).toHaveTextContent('♙')
    })

    it('clears wrong-move marker after 1000ms', () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
        />
      )
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e3"]')!)
      expect(board.querySelector('[data-square="e2"]')).toHaveAttribute(
        'data-wrong-move',
        'true'
      )
      act(() => {
        vi.advanceTimersByTime(1100)
      })
      expect(board.querySelector('[data-square="e2"]')).not.toHaveAttribute(
        'data-wrong-move'
      )
    })
  })

  describe('mistake node in puzzle mode', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('shows puzzle-mistake-banner when mistake move is played', () => {
      const lesson = makePuzzleLesson({ pgn_data: MISTAKE_PGN })
      render(
        <GuidedChessPlayer
          lesson={lesson}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
        />
      )
      const board = screen.getByTestId('guided-player-board')
      // Play d4 (the mistake move)
      fireEvent.click(board.querySelector('[data-square="d2"]')!)
      fireEvent.click(board.querySelector('[data-square="d4"]')!)

      expect(screen.getByTestId('puzzle-mistake-banner')).toBeInTheDocument()
    })

    it('mistake banner shows node note text', () => {
      const lesson = makePuzzleLesson({ pgn_data: MISTAKE_PGN })
      render(
        <GuidedChessPlayer
          lesson={lesson}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
        />
      )
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="d2"]')!)
      fireEvent.click(board.querySelector('[data-square="d4"]')!)

      expect(screen.getByTestId('puzzle-mistake-banner')).toHaveTextContent(
        "That leads to the Queen’s Gambit!"
      )
    })

    it('mistake banner disappears after 1500ms and reverts to parent', () => {
      const lesson = makePuzzleLesson({ pgn_data: MISTAKE_PGN })
      render(
        <GuidedChessPlayer
          lesson={lesson}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
        />
      )
      const board = screen.getByTestId('guided-player-board')
      // Play d4 (mistake)
      fireEvent.click(board.querySelector('[data-square="d2"]')!)
      fireEvent.click(board.querySelector('[data-square="d4"]')!)
      expect(screen.getByTestId('puzzle-mistake-banner')).toBeInTheDocument()

      // Advance past 1500ms
      act(() => {
        vi.advanceTimersByTime(1600)
      })

      // Banner gone
      expect(screen.queryByTestId('puzzle-mistake-banner')).not.toBeInTheDocument()
      // Board reverted — d4 should be empty, d2 should have pawn
      const updatedBoard = screen.getByTestId('guided-player-board')
      expect(updatedBoard.querySelector('[data-square="d4"]')).toHaveTextContent('')
      expect(updatedBoard.querySelector('[data-square="d2"]')).toHaveTextContent('♙')
    })

    it('does not mark wrong-move square for mistake node (different feedback path)', () => {
      const lesson = makePuzzleLesson({ pgn_data: MISTAKE_PGN })
      render(
        <GuidedChessPlayer
          lesson={lesson}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
        />
      )
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="d2"]')!)
      fireEvent.click(board.querySelector('[data-square="d4"]')!)

      // Should not show wrong-move marker (mistake has its own feedback)
      expect(board.querySelector('[data-square="d2"]')).not.toHaveAttribute(
        'data-wrong-move'
      )
    })
  })

  describe('correct move in puzzle mode', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('accepts correct move and advances position', () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
        />
      )
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e4"]')!)

      // e4 should now have the pawn
      expect(board.querySelector('[data-square="e4"]')).toHaveTextContent('♙')
      expect(board.querySelector('[data-square="e2"]')).toHaveTextContent('')
    })

    it('auto-plays opponent move after correct learner move', () => {
      render(
        <GuidedChessPlayer
          lesson={makePuzzleLesson()}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
        />
      )
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e4"]')!)

      // Before delay: e5 still empty
      expect(board.querySelector('[data-square="e5"]')).toHaveTextContent('')

      act(() => {
        vi.advanceTimersByTime(OPPONENT_DELAY_MS)
      })

      const updatedBoard = screen.getByTestId('guided-player-board')
      expect(updatedBoard.querySelector('[data-square="e5"]')).toHaveTextContent('♟')
    })

    it('onComplete fires when leaf reached via main line', () => {
      const onComplete = vi.fn()
      // LINEAR_PUZZLE_PGN: 1. e4 e5 2. Nf3 (3 plies, learner is white)
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
      // Play e4
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e4"]')!)
      // e5 auto-plays
      act(() => { vi.advanceTimersByTime(OPPONENT_DELAY_MS) })
      // Play Nf3
      const b2 = screen.getByTestId('guided-player-board')
      fireEvent.click(b2.querySelector('[data-square="g1"]')!)
      fireEvent.click(b2.querySelector('[data-square="f3"]')!)

      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('onComplete fires when leaf reached via correct variation', () => {
      const onComplete = vi.fn()
      // CORRECT_VARIATION_PGN: 1. e4 or 1. d4 both correct
      const lesson = makePuzzleLesson({ pgn_data: CORRECT_VARIATION_PGN })
      render(
        <GuidedChessPlayer
          lesson={lesson}
          lessonNumber={1}
          totalLessons={1}
          mode="puzzle"
          onComplete={onComplete}
        />
      )
      const board = screen.getByTestId('guided-player-board')
      // Play d4 (correct variation)
      fireEvent.click(board.querySelector('[data-square="d2"]')!)
      fireEvent.click(board.querySelector('[data-square="d4"]')!)
      // d5 auto-plays
      act(() => { vi.advanceTimersByTime(OPPONENT_DELAY_MS) })

      // Leaf reached
      expect(onComplete).toHaveBeenCalledTimes(1)
    })
  })

  describe('mode prop default (lesson mode)', () => {
    it('existing lesson mode still works when mode prop is absent', () => {
      const lesson = {
        id: 'l1',
        title: 'Regular Lesson',
        pgn_data: '1. e4 e5',
        board_perspective: 'white' as const,
        coach_note: null,
      }
      render(
        <GuidedChessPlayer lesson={lesson} lessonNumber={1} totalLessons={1} />
      )
      expect(screen.getByTestId('guided-player-root')).toBeInTheDocument()
    })

    it('in lesson mode, playing wrong move does NOT show puzzle-mistake-banner', () => {
      const lesson = {
        id: 'l1',
        title: 'Regular Lesson',
        pgn_data: MISTAKE_PGN,
        board_perspective: 'white' as const,
        coach_note: null,
      }
      render(
        <GuidedChessPlayer lesson={lesson} lessonNumber={1} totalLessons={1} />
      )
      const board = screen.getByTestId('guided-player-board')
      // In lesson mode, d4 is an allowed variation
      // But even if mistake — in lesson mode no banner
      fireEvent.click(board.querySelector('[data-square="d2"]')!)
      fireEvent.click(board.querySelector('[data-square="d4"]')!)

      expect(screen.queryByTestId('puzzle-mistake-banner')).not.toBeInTheDocument()
    })
  })
})
