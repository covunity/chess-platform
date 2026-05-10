import { render as rtlRender, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../i18n'
import GuidedChessPlayer from '../GuidedChessPlayer'

function render(ui: Parameters<typeof rtlRender>[0]) {
  return rtlRender(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
}

const OPPONENT_DELAY_MS = 600

const SAMPLE_PGN = '1. e4 e5 2. Nf3 Nc6 {Black develops the knight.} 3. Bb5'

const baseLesson = {
  id: 'l1',
  title: 'The Italian Opening',
  pgn_data: SAMPLE_PGN,
  board_perspective: 'white' as const,
  coach_note: null,
}

describe('GuidedChessPlayer', () => {
  describe('move counter', () => {
    it('shows "Move 1 of N" before any move is played', () => {
      // SAMPLE_PGN has 5 plies: e4 e5 Nf3 Nc6 Bb5
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      expect(screen.getByTestId('guided-player-move-counter')).toHaveTextContent(
        'Nước 1 / 5'
      )
    })

    it('shows side-to-move label "White" before any move (white moves first)', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      expect(screen.getByTestId('guided-player-side-to-move')).toHaveTextContent('Trắng')
    })

    it('shows perspective sub-label matching board_perspective', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      expect(screen.getByTestId('guided-player-perspective-label')).toHaveTextContent(
        /bạn cầm quân Trắng/i
      )
    })
  })

  describe('board', () => {
    it('renders an interactive chess board at the starting position', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      const board = screen.getByTestId('guided-player-board')
      // Starting position: white pawn on e2, black pawn on e7
      expect(board.querySelector('[data-square="e2"]')).toHaveTextContent('♙')
      expect(board.querySelector('[data-square="e7"]')).toHaveTextContent('♟')
    })
  })

  describe('correct move', () => {
    it('moves the piece on the board when learner clicks origin then destination of the expected move', async () => {
      const user = userEvent.setup()
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      const board = screen.getByTestId('guided-player-board')
      // Expected first move is e4 (e2 → e4)
      await user.click(board.querySelector('[data-square="e2"]')!)
      await user.click(board.querySelector('[data-square="e4"]')!)

      // Pawn now on e4, e2 empty
      expect(board.querySelector('[data-square="e2"]')).toHaveTextContent('')
      expect(board.querySelector('[data-square="e4"]')).toHaveTextContent('♙')
    })

    it('advances move counter and side-to-move after correct move', async () => {
      const user = userEvent.setup()
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="e2"]')!)
      await user.click(board.querySelector('[data-square="e4"]')!)

      expect(screen.getByTestId('guided-player-move-counter')).toHaveTextContent('Nước 2 / 5')
      expect(screen.getByTestId('guided-player-side-to-move')).toHaveTextContent('Đen')
    })

    it('does not advance when wrong destination is chosen', async () => {
      const user = userEvent.setup()
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      const board = screen.getByTestId('guided-player-board')
      // Try e2 → e3 (legal but not the expected move; expected is e4)
      await user.click(board.querySelector('[data-square="e2"]')!)
      await user.click(board.querySelector('[data-square="e3"]')!)

      expect(screen.getByTestId('guided-player-move-counter')).toHaveTextContent('Nước 1 / 5')
      // Pawn still on e2
      expect(board.querySelector('[data-square="e2"]')).toHaveTextContent('♙')
      expect(board.querySelector('[data-square="e3"]')).toHaveTextContent('')
    })

    it('marks origin and destination of last played move with data-last-move', async () => {
      const user = userEvent.setup()
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="e2"]')!)
      await user.click(board.querySelector('[data-square="e4"]')!)

      expect(board.querySelector('[data-square="e2"]')).toHaveAttribute('data-last-move', 'true')
      expect(board.querySelector('[data-square="e4"]')).toHaveAttribute('data-last-move', 'true')
    })
  })

  describe('coach note', () => {
    it('does not render coach note when lesson.coach_note is null', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      expect(screen.queryByTestId('guided-player-coach-note')).not.toBeInTheDocument()
    })

    it('renders coach note text when lesson.coach_note is set', () => {
      const lessonWithNote = {
        ...baseLesson,
        coach_note: 'Focus on king safety after move 6.',
      }
      render(
        <GuidedChessPlayer lesson={lessonWithNote} lessonNumber={1} totalLessons={5} />
      )
      expect(screen.getByTestId('guided-player-coach-note')).toHaveTextContent(
        'Focus on king safety after move 6.'
      )
    })
  })

  describe('keyboard bookmark', () => {
    it('fires onBookmark when "B" is pressed', () => {
      const onBookmark = vi.fn()
      render(
        <GuidedChessPlayer
          lesson={baseLesson}
          lessonNumber={1}
          totalLessons={5}
          onBookmark={onBookmark}
        />
      )
      fireEvent.keyDown(window, { key: 'b' })
      expect(onBookmark).toHaveBeenCalledTimes(1)
    })

    it('does not fire onBookmark when typing in an input', () => {
      const onBookmark = vi.fn()
      render(
        <div>
          <input data-testid="text-input" />
          <GuidedChessPlayer
            lesson={baseLesson}
            lessonNumber={1}
            totalLessons={5}
            onBookmark={onBookmark}
          />
        </div>
      )
      const input = screen.getByTestId('text-input')
      input.focus()
      fireEvent.keyDown(input, { key: 'b' })
      expect(onBookmark).not.toHaveBeenCalled()
    })
  })

  describe('auto-complete', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('calls onComplete after the final PGN move is played (opponent auto-play finishes)', () => {
      const onComplete = vi.fn()
      const shortLesson = {
        ...baseLesson,
        pgn_data: '1. e4 e5',
      }
      render(
        <GuidedChessPlayer
          lesson={shortLesson}
          lessonNumber={1}
          totalLessons={5}
          onComplete={onComplete}
        />
      )
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e4"]')!)
      expect(onComplete).not.toHaveBeenCalled()

      // Opponent auto-plays e5, completing the lesson.
      act(() => {
        vi.advanceTimersByTime(OPPONENT_DELAY_MS)
      })
      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('does not render the "Your turn" prompt once all moves are played', () => {
      const shortLesson = {
        ...baseLesson,
        pgn_data: '1. e4 e5',
      }
      render(
        <GuidedChessPlayer lesson={shortLesson} lessonNumber={1} totalLessons={5} />
      )
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e4"]')!)
      // Let opponent auto-play the final ply
      act(() => {
        vi.advanceTimersByTime(OPPONENT_DELAY_MS)
      })
      expect(screen.queryByTestId('your-turn-prompt')).not.toBeInTheDocument()
    })
  })

  describe('reset', () => {
    it('renders a reset button', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      expect(screen.getByTestId('guided-player-reset-btn')).toBeInTheDocument()
    })

    it('clicking reset opens a confirmation dialog instead of resetting immediately', async () => {
      const user = userEvent.setup()
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      const board = screen.getByTestId('guided-player-board')
      // Play a move
      await user.click(board.querySelector('[data-square="e2"]')!)
      await user.click(board.querySelector('[data-square="e4"]')!)

      await user.click(screen.getByTestId('guided-player-reset-btn'))

      expect(screen.getByTestId('guided-player-reset-dialog')).toBeInTheDocument()
      // Move was NOT yet undone
      expect(screen.getByTestId('guided-player-move-counter')).toHaveTextContent('Nước 2 / 5')
    })

    it('cancelling the dialog closes it without resetting', async () => {
      const user = userEvent.setup()
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="e2"]')!)
      await user.click(board.querySelector('[data-square="e4"]')!)

      await user.click(screen.getByTestId('guided-player-reset-btn'))
      await user.click(screen.getByTestId('guided-player-reset-cancel'))

      expect(screen.queryByTestId('guided-player-reset-dialog')).not.toBeInTheDocument()
      expect(screen.getByTestId('guided-player-move-counter')).toHaveTextContent('Nước 2 / 5')
    })

    it('confirming the dialog resets played plies and clears move log', async () => {
      const user = userEvent.setup()
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="e2"]')!)
      await user.click(board.querySelector('[data-square="e4"]')!)

      await user.click(screen.getByTestId('guided-player-reset-btn'))
      await user.click(screen.getByTestId('guided-player-reset-confirm'))

      expect(screen.queryByTestId('guided-player-reset-dialog')).not.toBeInTheDocument()
      expect(screen.getByTestId('guided-player-move-counter')).toHaveTextContent('Nước 1 / 5')
      const log = screen.getByTestId('guided-player-move-log')
      expect(log.querySelectorAll('[data-testid^="move-block-"]').length).toBe(0)
      // Pawn back on e2
      expect(
        screen.getByTestId('guided-player-board').querySelector('[data-square="e2"]')
      ).toHaveTextContent('♙')
    })
  })

  describe('forward-only navigation', () => {
    it('does not render any "previous move" / back button', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      expect(screen.queryByTestId('guided-player-prev-btn')).not.toBeInTheDocument()
    })
  })

  describe('flip board', () => {
    it('renders a flip board button', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      expect(screen.getByTestId('guided-player-flip-btn')).toBeInTheDocument()
    })

    it('clicking flip swaps the board perspective without losing played moves', async () => {
      const user = userEvent.setup()
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      const board = screen.getByTestId('guided-player-board')

      // Play e4
      await user.click(board.querySelector('[data-square="e2"]')!)
      await user.click(board.querySelector('[data-square="e4"]')!)

      const initialAria = board.getAttribute('aria-label')
      expect(initialAria).toMatch(/white perspective/i)

      await user.click(screen.getByTestId('guided-player-flip-btn'))

      // After flip, aria-label switches
      expect(screen.getByTestId('guided-player-board').getAttribute('aria-label')).toMatch(
        /black perspective/i
      )
      // Played move is preserved
      expect(screen.getByTestId('move-block-1')).toHaveTextContent('e4')
    })
  })

  describe('hint', () => {
    it('renders a hint button', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      expect(screen.getByTestId('guided-player-hint-btn')).toBeInTheDocument()
    })

    it('clicking hint marks origin and destination of expected move with data-hint', async () => {
      const user = userEvent.setup()
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      await user.click(screen.getByTestId('guided-player-hint-btn'))

      const board = screen.getByTestId('guided-player-board')
      // First expected move: e2 → e4
      expect(board.querySelector('[data-square="e2"]')).toHaveAttribute('data-hint', 'true')
      expect(board.querySelector('[data-square="e4"]')).toHaveAttribute('data-hint', 'true')
    })

    it('clears hint marker after the next square click', async () => {
      const user = userEvent.setup()
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      await user.click(screen.getByTestId('guided-player-hint-btn'))
      const board = screen.getByTestId('guided-player-board')
      expect(board.querySelector('[data-square="e2"]')).toHaveAttribute('data-hint', 'true')

      await user.click(board.querySelector('[data-square="e2"]')!)

      expect(board.querySelector('[data-square="e2"]')).not.toHaveAttribute('data-hint')
    })
  })

  describe('move log', () => {
    it('renders an empty move log before any move is played', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      const log = screen.getByTestId('guided-player-move-log')
      // No rendered move blocks yet
      expect(log.querySelectorAll('[data-testid^="move-block-"]').length).toBe(0)
    })

    it('renders the played move in the move log after a correct move', async () => {
      const user = userEvent.setup()
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="e2"]')!)
      await user.click(board.querySelector('[data-square="e4"]')!)

      const moveBlock = screen.getByTestId('move-block-1')
      expect(moveBlock).toHaveTextContent(/1\./)
      expect(moveBlock).toHaveTextContent('e4')
    })

    it('renders the annotation text for a played annotated move', () => {
      vi.useFakeTimers()
      // SAMPLE_PGN has annotation after move 4 ("Black develops the knight.")
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      const board = screen.getByTestId('guided-player-board')
      // Learner (white) plays e4
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e4"]')!)
      // Opponent auto-plays e5
      act(() => {
        vi.advanceTimersByTime(OPPONENT_DELAY_MS)
      })
      // Learner (white) plays Nf3
      fireEvent.click(screen.getByTestId('guided-player-board').querySelector('[data-square="g1"]')!)
      fireEvent.click(screen.getByTestId('guided-player-board').querySelector('[data-square="f3"]')!)
      // Opponent auto-plays Nc6 — annotation for move 2 should appear
      act(() => {
        vi.advanceTimersByTime(OPPONENT_DELAY_MS)
      })

      expect(screen.getByTestId('move-log-annotation-2')).toHaveTextContent(
        'Black develops the knight.'
      )
      vi.useRealTimers()
    })

    it('renders a "Your turn" prompt when there are still pending moves', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      expect(screen.getByTestId('your-turn-prompt')).toBeInTheDocument()
    })
  })

  describe('wrong move', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('marks origin square with data-wrong-move on a wrong destination', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e3"]')!)

      expect(board.querySelector('[data-square="e2"]')).toHaveAttribute('data-wrong-move', 'true')
    })

    it('clears the wrong-move marker after ~1000ms', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e3"]')!)

      expect(board.querySelector('[data-square="e2"]')).toHaveAttribute('data-wrong-move', 'true')

      act(() => {
        vi.advanceTimersByTime(1100)
      })

      expect(board.querySelector('[data-square="e2"]')).not.toHaveAttribute('data-wrong-move')
    })
  })

  describe('header', () => {
    it('renders the lesson eyebrow as "BÀI N / M"', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={2} totalLessons={5} />
      )
      expect(screen.getByTestId('guided-player-eyebrow')).toHaveTextContent(
        'BÀI 2 / 5'
      )
    })

    it('renders the lesson title', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={2} totalLessons={5} />
      )
      expect(screen.getByTestId('guided-player-title')).toHaveTextContent(
        'The Italian Opening'
      )
    })

    it('renders the helper instruction text', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={2} totalLessons={5} />
      )
      expect(screen.getByTestId('guided-player-helper')).toBeInTheDocument()
    })
  })

  describe('opponent auto-play', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('keeps existing behavior: when board_perspective is "white", learner plays move 1', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      const board = screen.getByTestId('guided-player-board')
      // No auto-play should fire — pawn still on e2 after the delay window.
      act(() => {
        vi.advanceTimersByTime(OPPONENT_DELAY_MS + 50)
      })
      expect(board.querySelector('[data-square="e2"]')).toHaveTextContent('♙')
      expect(board.querySelector('[data-square="e4"]')).toHaveTextContent('')
      expect(screen.getByTestId('guided-player-move-counter')).toHaveTextContent('Nước 1 / 5')
    })

    it('auto-plays white\'s first move after 600ms when board_perspective is "black"', () => {
      const blackLesson = { ...baseLesson, board_perspective: 'black' as const }
      render(
        <GuidedChessPlayer lesson={blackLesson} lessonNumber={1} totalLessons={5} />
      )
      const board = screen.getByTestId('guided-player-board')
      // Before delay: starting position
      expect(board.querySelector('[data-square="e2"]')).toHaveTextContent('♙')
      expect(board.querySelector('[data-square="e4"]')).toHaveTextContent('')

      act(() => {
        vi.advanceTimersByTime(OPPONENT_DELAY_MS)
      })

      // After delay: white pawn moved to e4
      expect(screen.getByTestId('guided-player-board').querySelector('[data-square="e2"]'))
        .toHaveTextContent('')
      expect(screen.getByTestId('guided-player-board').querySelector('[data-square="e4"]'))
        .toHaveTextContent('♙')
      expect(screen.getByTestId('guided-player-move-counter')).toHaveTextContent('Nước 2 / 5')
    })

    it('auto-plays opponent reply 600ms after the learner plays their move', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      const board = screen.getByTestId('guided-player-board')

      // Learner (white) plays e2 → e4
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e4"]')!)

      // Opponent has not replied yet
      expect(board.querySelector('[data-square="e7"]')).toHaveTextContent('♟')
      expect(board.querySelector('[data-square="e5"]')).toHaveTextContent('')

      act(() => {
        vi.advanceTimersByTime(OPPONENT_DELAY_MS)
      })

      // Black auto-played e5
      const updatedBoard = screen.getByTestId('guided-player-board')
      expect(updatedBoard.querySelector('[data-square="e7"]')).toHaveTextContent('')
      expect(updatedBoard.querySelector('[data-square="e5"]')).toHaveTextContent('♟')
      expect(screen.getByTestId('guided-player-move-counter')).toHaveTextContent('Nước 3 / 5')
    })

    it('ignores board clicks while waiting for the opponent', () => {
      const blackLesson = { ...baseLesson, board_perspective: 'black' as const }
      render(
        <GuidedChessPlayer lesson={blackLesson} lessonNumber={1} totalLessons={5} />
      )
      const board = screen.getByTestId('guided-player-board')

      // Click a black piece during the opponent delay — should be ignored.
      fireEvent.click(board.querySelector('[data-square="e7"]')!)
      fireEvent.click(board.querySelector('[data-square="e5"]')!)

      // Still at starting position before the opponent timer fires
      expect(board.querySelector('[data-square="e7"]')).toHaveTextContent('♟')
      expect(board.querySelector('[data-square="e5"]')).toHaveTextContent('')
      expect(screen.getByTestId('guided-player-move-counter')).toHaveTextContent('Nước 1 / 5')

      // Now the opponent auto-plays e4
      act(() => {
        vi.advanceTimersByTime(OPPONENT_DELAY_MS)
      })
      expect(screen.getByTestId('guided-player-move-counter')).toHaveTextContent('Nước 2 / 5')
    })

    it('renders annotation for an auto-played opponent ply in the move log', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      const board = screen.getByTestId('guided-player-board')

      // White (learner) plays e4
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e4"]')!)
      // Black auto-plays e5
      act(() => {
        vi.advanceTimersByTime(OPPONENT_DELAY_MS)
      })
      // White (learner) plays Nf3
      fireEvent.click(screen.getByTestId('guided-player-board').querySelector('[data-square="g1"]')!)
      fireEvent.click(screen.getByTestId('guided-player-board').querySelector('[data-square="f3"]')!)
      // Black auto-plays Nc6 — annotation for move 2 should appear immediately when this ply plays
      act(() => {
        vi.advanceTimersByTime(OPPONENT_DELAY_MS)
      })

      expect(screen.getByTestId('move-log-annotation-2')).toHaveTextContent(
        'Black develops the knight.'
      )
    })

    it('disables the hint button while it is the opponent\'s turn', () => {
      const blackLesson = { ...baseLesson, board_perspective: 'black' as const }
      render(
        <GuidedChessPlayer lesson={blackLesson} lessonNumber={1} totalLessons={5} />
      )
      // Opening is opponent's turn (white) — hint should be disabled
      expect(screen.getByTestId('guided-player-hint-btn')).toBeDisabled()

      // After opponent plays, learner's turn — hint should be enabled again
      act(() => {
        vi.advanceTimersByTime(OPPONENT_DELAY_MS)
      })
      expect(screen.getByTestId('guided-player-hint-btn')).not.toBeDisabled()
    })

    it('does not render "Your turn" prompt while awaiting the opponent', () => {
      const blackLesson = { ...baseLesson, board_perspective: 'black' as const }
      render(
        <GuidedChessPlayer lesson={blackLesson} lessonNumber={1} totalLessons={5} />
      )
      // Opening: opponent (white) is to move
      expect(screen.queryByTestId('your-turn-prompt')).not.toBeInTheDocument()

      // After white auto-plays, it becomes learner's turn → prompt re-appears
      act(() => {
        vi.advanceTimersByTime(OPPONENT_DELAY_MS)
      })
      expect(screen.getByTestId('your-turn-prompt')).toBeInTheDocument()
    })

    it('reset cancels the in-flight opponent timer', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />
      )
      const board = screen.getByTestId('guided-player-board')
      // Learner plays e4 → schedules opponent timer
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e4"]')!)
      expect(screen.getByTestId('guided-player-move-counter')).toHaveTextContent('Nước 2 / 5')

      // Open reset dialog and confirm before timer fires
      fireEvent.click(screen.getByTestId('guided-player-reset-btn'))
      fireEvent.click(screen.getByTestId('guided-player-reset-confirm'))

      // Advance timers — the cancelled opponent move must NOT play
      act(() => {
        vi.advanceTimersByTime(OPPONENT_DELAY_MS + 100)
      })

      // Back to fresh board, opponent did not play e5
      const resetBoard = screen.getByTestId('guided-player-board')
      expect(resetBoard.querySelector('[data-square="e7"]')).toHaveTextContent('♟')
      expect(resetBoard.querySelector('[data-square="e5"]')).toHaveTextContent('')
      expect(screen.getByTestId('guided-player-move-counter')).toHaveTextContent('Nước 1 / 5')
    })

    it('after reset on a black-perspective lesson, opening auto-move re-fires', () => {
      const blackLesson = { ...baseLesson, board_perspective: 'black' as const }
      render(
        <GuidedChessPlayer lesson={blackLesson} lessonNumber={1} totalLessons={5} />
      )
      // Let opening auto-play
      act(() => {
        vi.advanceTimersByTime(OPPONENT_DELAY_MS)
      })
      expect(screen.getByTestId('guided-player-move-counter')).toHaveTextContent('Nước 2 / 5')

      // Reset
      fireEvent.click(screen.getByTestId('guided-player-reset-btn'))
      fireEvent.click(screen.getByTestId('guided-player-reset-confirm'))
      expect(screen.getByTestId('guided-player-move-counter')).toHaveTextContent('Nước 1 / 5')

      // Opening auto-move re-fires after reset
      act(() => {
        vi.advanceTimersByTime(OPPONENT_DELAY_MS)
      })
      expect(screen.getByTestId('guided-player-move-counter')).toHaveTextContent('Nước 2 / 5')
    })

    it('unmounting during the opponent delay does not throw or warn', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const blackLesson = { ...baseLesson, board_perspective: 'black' as const }
      const { unmount } = render(
        <GuidedChessPlayer lesson={blackLesson} lessonNumber={1} totalLessons={5} />
      )
      // Don't fire the timer — unmount first
      unmount()
      act(() => {
        vi.advanceTimersByTime(OPPONENT_DELAY_MS + 100)
      })
      expect(errorSpy).not.toHaveBeenCalled()
      errorSpy.mockRestore()
    })

    it('fires onComplete when the final ply is auto-played by the opponent', () => {
      const onComplete = vi.fn()
      const shortLesson = {
        ...baseLesson,
        pgn_data: '1. e4 e5',
      }
      render(
        <GuidedChessPlayer
          lesson={shortLesson}
          lessonNumber={1}
          totalLessons={5}
          onComplete={onComplete}
        />
      )
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e4"]')!)
      expect(onComplete).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(OPPONENT_DELAY_MS)
      })

      expect(onComplete).toHaveBeenCalledTimes(1)
    })
  })
})
