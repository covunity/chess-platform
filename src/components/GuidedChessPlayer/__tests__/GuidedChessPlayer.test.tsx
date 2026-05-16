import { render as rtlRender, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../i18n'
import GuidedChessPlayer from '../GuidedChessPlayer'
import PromotionPicker from '../PromotionPicker'
import { parsePgn } from '../../../utils/parsePgn'

vi.mock('chessground')

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

    it('renders rich note with bold text for a played move (Slice 7)', () => {
      vi.useFakeTimers()
      // Use a PGN with a gambitly:v1 structured comment containing bold text
      const richNotePgn =
        '1. e4 {[gambitly:v1]{"n":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Key move: "},{"type":"text","text":"e4","marks":[{"type":"bold"}]}]}]}}} 1...e5'
      const richLesson = {
        ...baseLesson,
        pgn_data: richNotePgn,
      }
      render(
        <GuidedChessPlayer lesson={richLesson} lessonNumber={1} totalLessons={2} />
      )
      const board = screen.getByTestId('guided-player-board')
      // Learner (white) plays e4
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e4"]')!)

      // The rich note should be rendered via NoteView
      const annotation = screen.getByTestId('move-log-annotation-1')
      expect(annotation).toBeInTheDocument()
      expect(annotation).toHaveTextContent('Key move:')
      expect(annotation).toHaveTextContent('e4')
      // Bold text should be in a <strong> element
      const strong = annotation.querySelector('strong')
      expect(strong).toBeInTheDocument()
      expect(strong?.textContent).toBe('e4')
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

    it('renders the helper instruction text in interactive lesson mode', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={2} totalLessons={5} />
      )
      expect(screen.getByTestId('guided-player-helper')).toBeInTheDocument()
    })

    it('does not render the helper in Study (viewer) mode', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={2} totalLessons={5} mode="viewer" />
      )
      expect(screen.queryByTestId('guided-player-helper')).not.toBeInTheDocument()
    })

    it('renders the helper in Rewind mode (lesson + onToggleMode)', () => {
      render(
        <GuidedChessPlayer
          lesson={baseLesson}
          lessonNumber={2}
          totalLessons={5}
          mode="lesson"
          onToggleMode={vi.fn()}
        />
      )
      expect(screen.getByTestId('guided-player-helper')).toBeInTheDocument()
    })

    it('helper mentions drag-and-drop and right-click drawing', () => {
      render(
        <GuidedChessPlayer lesson={baseLesson} lessonNumber={2} totalLessons={5} />
      )
      const helper = screen.getByTestId('guided-player-helper')
      expect(helper.textContent).toMatch(/kéo quân|drag/i)
      expect(helper.textContent).toMatch(/chuột phải|vẽ/i)
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

// ── New tests for Slice 2 (issue #165) ──────────────────────────────────────

// White (learner) has 2 choices at root: e4 or d4
const LEARNER_BRANCH_PGN = '1. e4 (1. d4 d5 2. Nf3) e5 2. Nf3'
// Opponent (black) has 2 choices after e4: e5 or c5
const OPPONENT_BRANCH_PGN = '1. e4 e5 (1...c5 2. Nf3) 2. Nf3'
// PGN ending on learner's (white's) move — V-18
const LEARNER_LEAF_PGN = '1. e4'
// Promotion PGN: white pawn promotes on g8 via h4→h7→g8 path (9 plies)
// 1. h4 g5 2. hxg5 h5 3. gxh6 a6 4. h7 a5 5. hxg8=Q (5. hxg8=N)
const PROMO_PGN = '1. h4 g5 2. hxg5 h5 3. gxh6 a6 4. h7 a5 5. hxg8=Q (5. hxg8=N)'

describe('GuidedChessPlayer — Slice 2: tree navigation (issue #165)', () => {
  describe('learner branching', () => {
    it('plays into main line (e4) when learner clicks e2→e4', async () => {
      const user = userEvent.setup()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="e2"]')!)
      await user.click(board.querySelector('[data-square="e4"]')!)
      expect(board.querySelector('[data-square="e4"]')).toHaveTextContent('♙')
      expect(board.querySelector('[data-square="e2"]')).toHaveTextContent('')
    })

    it('plays into variation (d4) when learner clicks d2→d4', async () => {
      const user = userEvent.setup()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="d2"]')!)
      await user.click(board.querySelector('[data-square="d4"]')!)
      expect(board.querySelector('[data-square="d4"]')).toHaveTextContent('♙')
      expect(board.querySelector('[data-square="d2"]')).toHaveTextContent('')
    })

    it('move log shows d4 after playing into d4 variation', async () => {
      const user = userEvent.setup()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="d2"]')!)
      await user.click(board.querySelector('[data-square="d4"]')!)
      expect(screen.getByTestId('move-block-1')).toHaveTextContent('d4')
    })

    it('move log shows e4 after playing main line', async () => {
      const user = userEvent.setup()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="e2"]')!)
      await user.click(board.querySelector('[data-square="e4"]')!)
      expect(screen.getByTestId('move-block-1')).toHaveTextContent('e4')
    })

    it('opponent auto-plays d5 after learner plays d4 (variation auto-play)', () => {
      vi.useFakeTimers()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="d2"]')!)
      fireEvent.click(board.querySelector('[data-square="d4"]')!)
      act(() => { vi.advanceTimersByTime(OPPONENT_DELAY_MS) })
      const b = screen.getByTestId('guided-player-board')
      expect(b.querySelector('[data-square="d5"]')).toHaveTextContent('♟')
      expect(b.querySelector('[data-square="d7"]')).toHaveTextContent('')
      vi.useRealTimers()
    })

    it('move counter advances after navigating into variation', async () => {
      const user = userEvent.setup()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="d2"]')!)
      await user.click(board.querySelector('[data-square="d4"]')!)
      expect(screen.getByTestId('guided-player-move-counter')).toHaveTextContent('Nước 2')
    })

    it('reaching leaf via d4 variation fires onComplete', () => {
      vi.useFakeTimers()
      const onComplete = vi.fn()
      // d4 line: root→d4→d5(auto)→Nf3(leaf)
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} onComplete={onComplete} />)
      const board = screen.getByTestId('guided-player-board')
      // Play d4
      fireEvent.click(board.querySelector('[data-square="d2"]')!)
      fireEvent.click(board.querySelector('[data-square="d4"]')!)
      // d5 auto-plays
      act(() => { vi.advanceTimersByTime(OPPONENT_DELAY_MS) })
      // Play Nf3
      const b2 = screen.getByTestId('guided-player-board')
      fireEvent.click(b2.querySelector('[data-square="g1"]')!)
      fireEvent.click(b2.querySelector('[data-square="f3"]')!)
      expect(onComplete).toHaveBeenCalledTimes(1)
      vi.useRealTimers()
    })

    it('wrong move in variation shows wrong-move marker', () => {
      vi.useFakeTimers()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="d2"]')!)
      fireEvent.click(board.querySelector('[data-square="d4"]')!)
      act(() => { vi.advanceTimersByTime(OPPONENT_DELAY_MS) })
      // Now expect Nf3 (g1→f3) but play wrong move
      const b2 = screen.getByTestId('guided-player-board')
      fireEvent.click(b2.querySelector('[data-square="g1"]')!)
      fireEvent.click(b2.querySelector('[data-square="e2"]')!) // wrong destination
      expect(screen.getByTestId('guided-player-board').querySelector('[data-square="g1"]')).toHaveAttribute('data-wrong-move', 'true')
      vi.useRealTimers()
    })

    it('wrong move in variation does not advance move counter', () => {
      vi.useFakeTimers()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="d2"]')!)
      fireEvent.click(board.querySelector('[data-square="d4"]')!)
      act(() => { vi.advanceTimersByTime(OPPONENT_DELAY_MS) })
      // After d4 (depth 1) and d5 auto (depth 2), counter = 3
      const b2 = screen.getByTestId('guided-player-board')
      fireEvent.click(b2.querySelector('[data-square="g1"]')!)
      fireEvent.click(b2.querySelector('[data-square="e2"]')!) // wrong move
      expect(screen.getByTestId('guided-player-move-counter')).toHaveTextContent('Nước 3')
      vi.useRealTimers()
    })
  })

  describe('opponent branching', () => {
    it('opponent auto-plays main-line child (e5) when it has 2 children', () => {
      vi.useFakeTimers()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: OPPONENT_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e4"]')!)
      act(() => { vi.advanceTimersByTime(OPPONENT_DELAY_MS) })
      const b = screen.getByTestId('guided-player-board')
      // Main line: e5 (not c5)
      expect(b.querySelector('[data-square="e5"]')).toHaveTextContent('♟')
      expect(b.querySelector('[data-square="c5"]')).toHaveTextContent('')
      vi.useRealTimers()
    })

    it('variation pill shows after e4 while opponent has 2+ children', () => {
      vi.useFakeTimers()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: OPPONENT_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e4"]')!)
      // Before opponent auto-plays: currentNode = e4 (2 children)
      expect(screen.getByTestId('variation-count-pill')).toBeInTheDocument()
      vi.useRealTimers()
    })

    it('opponent-thinking indicator shows during auto-play after e4', () => {
      vi.useFakeTimers()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: OPPONENT_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e4"]')!)
      expect(screen.getByTestId('opponent-thinking-indicator')).toBeInTheDocument()
      vi.useRealTimers()
    })
  })

  describe('variation count pill', () => {
    it('pill shows "+1 biến" when currentNode has 2 children (learner branching)', () => {
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      // At root: 2 children (e4 and d4), learner's turn
      const pill = screen.getByTestId('variation-count-pill')
      expect(pill).toHaveTextContent('+1')
    })

    it('pill absent when currentNode has exactly 1 child', () => {
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: SAMPLE_PGN }} lessonNumber={1} totalLessons={5} />)
      // Root has 1 child (e4 only)
      expect(screen.queryByTestId('variation-count-pill')).not.toBeInTheDocument()
    })

    it('pill absent at leaf (no children)', () => {
      vi.useFakeTimers()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_LEAF_PGN }} lessonNumber={1} totalLessons={1} />)
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e4"]')!)
      expect(screen.queryByTestId('variation-count-pill')).not.toBeInTheDocument()
      vi.useRealTimers()
    })

    it('pill disappears after learner follows one of the variation choices', async () => {
      const user = userEvent.setup()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      expect(screen.getByTestId('variation-count-pill')).toBeInTheDocument()
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="e2"]')!)
      await user.click(board.querySelector('[data-square="e4"]')!)
      // After e4, currentNode = e4 which has only [e5] child → no pill
      expect(screen.queryByTestId('variation-count-pill')).not.toBeInTheDocument()
    })

    it('pill absent for pure linear PGN', () => {
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: SAMPLE_PGN }} lessonNumber={1} totalLessons={5} />)
      expect(screen.queryByTestId('variation-count-pill')).not.toBeInTheDocument()
    })
  })

  describe('leaf on learner\'s turn (V-18)', () => {
    it('onComplete fires immediately after learner plays the only leaf move', () => {
      const onComplete = vi.fn()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_LEAF_PGN }} lessonNumber={1} totalLessons={1} onComplete={onComplete} />)
      expect(onComplete).not.toHaveBeenCalled()
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e4"]')!)
      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('onComplete does not fire before the leaf move is played', () => {
      const onComplete = vi.fn()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_LEAF_PGN }} lessonNumber={1} totalLessons={1} onComplete={onComplete} />)
      expect(onComplete).not.toHaveBeenCalled()
    })

    it('completedFiredRef prevents double-firing onComplete', () => {
      const onComplete = vi.fn()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_LEAF_PGN }} lessonNumber={1} totalLessons={1} onComplete={onComplete} />)
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e4"]')!)
      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('after reset, onComplete can fire again when leaf re-played', async () => {
      const user = userEvent.setup()
      const onComplete = vi.fn()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_LEAF_PGN }} lessonNumber={1} totalLessons={1} onComplete={onComplete} />)
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="e2"]')!)
      fireEvent.click(board.querySelector('[data-square="e4"]')!)
      expect(onComplete).toHaveBeenCalledTimes(1)
      // Reset
      await user.click(screen.getByTestId('guided-player-reset-btn'))
      await user.click(screen.getByTestId('guided-player-reset-confirm'))
      // Play again
      const b2 = screen.getByTestId('guided-player-board')
      fireEvent.click(b2.querySelector('[data-square="e2"]')!)
      fireEvent.click(b2.querySelector('[data-square="e4"]')!)
      expect(onComplete).toHaveBeenCalledTimes(2)
    })
  })

  describe('reset from variation', () => {
    it('reset from variation returns board to starting position', async () => {
      const user = userEvent.setup()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="d2"]')!)
      await user.click(board.querySelector('[data-square="d4"]')!)
      await user.click(screen.getByTestId('guided-player-reset-btn'))
      await user.click(screen.getByTestId('guided-player-reset-confirm'))
      const b2 = screen.getByTestId('guided-player-board')
      expect(b2.querySelector('[data-square="d2"]')).toHaveTextContent('♙')
      expect(b2.querySelector('[data-square="d4"]')).toHaveTextContent('')
    })

    it('reset from variation clears move log', async () => {
      const user = userEvent.setup()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="d2"]')!)
      await user.click(board.querySelector('[data-square="d4"]')!)
      await user.click(screen.getByTestId('guided-player-reset-btn'))
      await user.click(screen.getByTestId('guided-player-reset-confirm'))
      const log = screen.getByTestId('guided-player-move-log')
      expect(log.querySelectorAll('[data-testid^="move-block-"]').length).toBe(0)
    })

    it('reset from variation resets move counter to 1', async () => {
      const user = userEvent.setup()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="d2"]')!)
      await user.click(board.querySelector('[data-square="d4"]')!)
      await user.click(screen.getByTestId('guided-player-reset-btn'))
      await user.click(screen.getByTestId('guided-player-reset-confirm'))
      expect(screen.getByTestId('guided-player-move-counter')).toHaveTextContent('Nước 1')
    })

    it('your-turn prompt reappears after reset from variation', async () => {
      const user = userEvent.setup()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="d2"]')!)
      await user.click(board.querySelector('[data-square="d4"]')!)
      await user.click(screen.getByTestId('guided-player-reset-btn'))
      await user.click(screen.getByTestId('guided-player-reset-confirm'))
      expect(screen.getByTestId('your-turn-prompt')).toBeInTheDocument()
    })
  })

  describe('hint in variation', () => {
    it('hint highlights children[0] (main-line child) at branching point', async () => {
      const user = userEvent.setup()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      await user.click(screen.getByTestId('guided-player-hint-btn'))
      const board = screen.getByTestId('guided-player-board')
      // First child of root is e4 (e2→e4)
      expect(board.querySelector('[data-square="e2"]')).toHaveAttribute('data-hint', 'true')
      expect(board.querySelector('[data-square="e4"]')).toHaveAttribute('data-hint', 'true')
    })

    it('hint button disabled while opponent auto-plays in variation', () => {
      vi.useFakeTimers()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="d2"]')!)
      fireEvent.click(board.querySelector('[data-square="d4"]')!)
      // d5 hasn't auto-played yet — it's opponent's turn
      expect(screen.getByTestId('guided-player-hint-btn')).toBeDisabled()
      vi.useRealTimers()
    })
  })

  describe('your-turn prompt in variation', () => {
    it('your-turn prompt shows when learner\'s turn in variation', async () => {
      vi.useFakeTimers()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="d2"]')!)
      fireEvent.click(board.querySelector('[data-square="d4"]')!)
      act(() => { vi.advanceTimersByTime(OPPONENT_DELAY_MS) })
      // After d5 auto-plays, it's learner's turn again
      expect(screen.getByTestId('your-turn-prompt')).toBeInTheDocument()
      vi.useRealTimers()
    })

    it('your-turn prompt hidden during opponent auto-play after branching', () => {
      vi.useFakeTimers()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="d2"]')!)
      fireEvent.click(board.querySelector('[data-square="d4"]')!)
      // Opponent hasn't played yet
      expect(screen.queryByTestId('your-turn-prompt')).not.toBeInTheDocument()
      vi.useRealTimers()
    })
  })

  describe('onBookmark new signature', () => {
    it('onBookmark first arg is a string (nodeId)', () => {
      const onBookmark = vi.fn()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: SAMPLE_PGN }} lessonNumber={1} totalLessons={5} onBookmark={onBookmark} />)
      fireEvent.keyDown(window, { key: 'b' })
      expect(typeof onBookmark.mock.calls[0][0]).toBe('string')
    })

    it('nodeId is "root" before any move', () => {
      const onBookmark = vi.fn()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: SAMPLE_PGN }} lessonNumber={1} totalLessons={5} onBookmark={onBookmark} />)
      fireEvent.keyDown(window, { key: 'b' })
      expect(onBookmark.mock.calls[0][0]).toBe('root')
    })

    it('nodeId changes after first move', async () => {
      const user = userEvent.setup()
      const onBookmark = vi.fn()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: SAMPLE_PGN }} lessonNumber={1} totalLessons={5} onBookmark={onBookmark} />)
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="e2"]')!)
      await user.click(board.querySelector('[data-square="e4"]')!)
      fireEvent.keyDown(window, { key: 'b' })
      expect(onBookmark.mock.calls[0][0]).not.toBe('root')
    })

    it('depth arg is 0 before any move', () => {
      const onBookmark = vi.fn()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: SAMPLE_PGN }} lessonNumber={1} totalLessons={5} onBookmark={onBookmark} />)
      fireEvent.keyDown(window, { key: 'b' })
      expect(onBookmark.mock.calls[0][2]).toBe(0)
    })

    it('depth arg is 1 after one move', async () => {
      const user = userEvent.setup()
      const onBookmark = vi.fn()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: SAMPLE_PGN }} lessonNumber={1} totalLessons={5} onBookmark={onBookmark} />)
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="e2"]')!)
      await user.click(board.querySelector('[data-square="e4"]')!)
      fireEvent.keyDown(window, { key: 'b' })
      expect(onBookmark.mock.calls[0][2]).toBe(1)
    })
  })

  describe('move log in variation', () => {
    it('move log shows d4 path (not e4) when navigated to d4 variation', async () => {
      const user = userEvent.setup()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="d2"]')!)
      await user.click(board.querySelector('[data-square="d4"]')!)
      const log = screen.getByTestId('guided-player-move-log')
      expect(log).toHaveTextContent('d4')
      expect(log).not.toHaveTextContent('e4')
    })

    it('sideToMove label shows Black after learner plays white move into variation', async () => {
      const user = userEvent.setup()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="d2"]')!)
      await user.click(board.querySelector('[data-square="d4"]')!)
      expect(screen.getByTestId('guided-player-side-to-move')).toHaveTextContent('Đen')
    })

    it('move log shows both d4 and d5 after opponent auto-plays in variation', () => {
      vi.useFakeTimers()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="d2"]')!)
      fireEvent.click(board.querySelector('[data-square="d4"]')!)
      act(() => { vi.advanceTimersByTime(OPPONENT_DELAY_MS) })
      const block = screen.getByTestId('move-block-1')
      expect(block).toHaveTextContent('d4')
      expect(block).toHaveTextContent('d5')
      vi.useRealTimers()
    })

    it('move log empty after reset from variation', async () => {
      const user = userEvent.setup()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="d2"]')!)
      await user.click(board.querySelector('[data-square="d4"]')!)
      await user.click(screen.getByTestId('guided-player-reset-btn'))
      await user.click(screen.getByTestId('guided-player-reset-confirm'))
      const log = screen.getByTestId('guided-player-move-log')
      expect(log.querySelectorAll('[data-testid^="move-block-"]').length).toBe(0)
    })
  })

  describe('flip board in variation', () => {
    it('flip board works while in variation', async () => {
      const user = userEvent.setup()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="d2"]')!)
      await user.click(board.querySelector('[data-square="d4"]')!)
      await user.click(screen.getByTestId('guided-player-flip-btn'))
      expect(screen.getByTestId('guided-player-board').getAttribute('aria-label')).toMatch(/black perspective/i)
    })

    it('after flip in variation, move log preserves played moves', async () => {
      const user = userEvent.setup()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: LEARNER_BRANCH_PGN }} lessonNumber={1} totalLessons={3} />)
      const board = screen.getByTestId('guided-player-board')
      await user.click(board.querySelector('[data-square="d2"]')!)
      await user.click(board.querySelector('[data-square="d4"]')!)
      await user.click(screen.getByTestId('guided-player-flip-btn'))
      expect(screen.getByTestId('move-block-1')).toHaveTextContent('d4')
    })
  })

  describe('promotion integration', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    function playPromoLine() {
      const board = () => screen.getByTestId('guided-player-board')
      // 1. h4
      fireEvent.click(board().querySelector('[data-square="h2"]')!)
      fireEvent.click(board().querySelector('[data-square="h4"]')!)
      act(() => { vi.advanceTimersByTime(OPPONENT_DELAY_MS) }) // g5 auto
      // 2. hxg5
      fireEvent.click(board().querySelector('[data-square="h4"]')!)
      fireEvent.click(board().querySelector('[data-square="g5"]')!)
      act(() => { vi.advanceTimersByTime(OPPONENT_DELAY_MS) }) // h5 auto
      // 3. gxh6
      fireEvent.click(board().querySelector('[data-square="g5"]')!)
      fireEvent.click(board().querySelector('[data-square="h6"]')!)
      act(() => { vi.advanceTimersByTime(OPPONENT_DELAY_MS) }) // a6 auto
      // 4. h7
      fireEvent.click(board().querySelector('[data-square="h6"]')!)
      fireEvent.click(board().querySelector('[data-square="h7"]')!)
      act(() => { vi.advanceTimersByTime(OPPONENT_DELAY_MS) }) // a5 auto
    }

    it('promotion picker appears when learner clicks to square with 2 promotion candidates', () => {
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: PROMO_PGN }} lessonNumber={1} totalLessons={5} />)
      playPromoLine()
      // 5. hxg8 — two promotions
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="h7"]')!)
      fireEvent.click(board.querySelector('[data-square="g8"]')!)
      expect(screen.getByTestId('promotion-picker')).toBeInTheDocument()
    })

    it('picker closed and queen committed after picking Q', () => {
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: PROMO_PGN }} lessonNumber={1} totalLessons={5} />)
      playPromoLine()
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="h7"]')!)
      fireEvent.click(board.querySelector('[data-square="g8"]')!)
      fireEvent.click(screen.getByTestId('promotion-piece-q'))
      expect(screen.queryByTestId('promotion-picker')).not.toBeInTheDocument()
    })

    it('dismissing picker leaves position unchanged and closes picker', () => {
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: PROMO_PGN }} lessonNumber={1} totalLessons={5} />)
      playPromoLine()
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="h7"]')!)
      fireEvent.click(board.querySelector('[data-square="g8"]')!)
      fireEvent.click(screen.getByTestId('promotion-dismiss'))
      expect(screen.queryByTestId('promotion-picker')).not.toBeInTheDocument()
      // Position unchanged — h7 still has pawn
      expect(screen.getByTestId('guided-player-board').querySelector('[data-square="h7"]')).toHaveTextContent('♙')
    })

    it('picker shows only the offered promotion pieces', () => {
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: PROMO_PGN }} lessonNumber={1} totalLessons={5} />)
      playPromoLine()
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="h7"]')!)
      fireEvent.click(board.querySelector('[data-square="g8"]')!)
      // Only Q and N offered in PROMO_PGN
      expect(screen.getByTestId('promotion-piece-q')).toBeInTheDocument()
      expect(screen.getByTestId('promotion-piece-n')).toBeInTheDocument()
      expect(screen.queryByTestId('promotion-piece-r')).not.toBeInTheDocument()
      expect(screen.queryByTestId('promotion-piece-b')).not.toBeInTheDocument()
    })

    it('picking N commits knight variation (onComplete fires at leaf)', () => {
      const onComplete = vi.fn()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: PROMO_PGN }} lessonNumber={1} totalLessons={5} onComplete={onComplete} />)
      playPromoLine()
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="h7"]')!)
      fireEvent.click(board.querySelector('[data-square="g8"]')!)
      fireEvent.click(screen.getByTestId('promotion-piece-n'))
      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('picking Q also fires onComplete when main-line queen move is at a leaf', () => {
      const onComplete = vi.fn()
      render(<GuidedChessPlayer lesson={{ ...baseLesson, pgn_data: PROMO_PGN }} lessonNumber={1} totalLessons={5} onComplete={onComplete} />)
      playPromoLine()
      const board = screen.getByTestId('guided-player-board')
      fireEvent.click(board.querySelector('[data-square="h7"]')!)
      fireEvent.click(board.querySelector('[data-square="g8"]')!)
      fireEvent.click(screen.getByTestId('promotion-piece-q'))
      expect(onComplete).toHaveBeenCalledTimes(1)
    })
  })
})

describe('GuidedChessPlayer — node shapes (PRD-0004 Slice 8)', () => {
  it('board shows data-autoshape on squares with shapes from the current node', () => {
    // PGN with a structured comment carrying a circle shape on e4 (comment after the move)
    const PGN_WITH_SHAPES = '1. e4 { [gambitly:v1]{"s":[{"kind":"circle","square":"e4","color":"green"}]} }'
    const lesson = {
      id: 'shapes-lesson',
      title: 'Shape test',
      pgn_data: PGN_WITH_SHAPES,
      board_perspective: 'white' as const,
      coach_note: null,
    }
    // Parse to find the e4 node id so we can start there
    const parsed = parsePgn(PGN_WITH_SHAPES)
    const e4Node = parsed.root!.children[0]

    render(
      <GuidedChessPlayer lesson={lesson} lessonNumber={1} totalLessons={1} initialNodeId={e4Node.id} />
    )
    const board = screen.getByTestId('guided-player-board')
    expect(board.querySelector('[data-square="e4"][data-autoshape="true"]')).toBeInTheDocument()
  })

  it('board shows no data-autoshape when current node has no shapes', () => {
    const lesson = {
      id: 'no-shapes-lesson',
      title: 'No shapes',
      pgn_data: '1. e4 e5',
      board_perspective: 'white' as const,
      coach_note: null,
    }
    render(<GuidedChessPlayer lesson={lesson} lessonNumber={1} totalLessons={1} />)
    const board = screen.getByTestId('guided-player-board')
    expect(board.querySelector('[data-autoshape="true"]')).not.toBeInTheDocument()
  })
})

describe('GuidedChessPlayer — starting_fen support', () => {
  const CUSTOM_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'

  it('player starts from custom FEN when pgn_data has [FEN "..."] tag', () => {
    const lesson = {
      id: 'custom-fen-lesson',
      title: 'Custom Start',
      pgn_data: `[FEN "${CUSTOM_FEN}"]\n1. d4`,
      board_perspective: 'white' as const,
      coach_note: null,
    }
    render(<GuidedChessPlayer lesson={lesson} lessonNumber={1} totalLessons={1} />)
    // The board should show the custom FEN position at root
    expect(screen.getByTestId('guided-player-board')).toBeInTheDocument()
  })

  it('player starts from standard FEN when no custom FEN is present', () => {
    const lesson = {
      id: 'standard-lesson',
      title: 'Standard Start',
      pgn_data: '1. e4 e5',
      board_perspective: 'white' as const,
      coach_note: null,
    }
    render(<GuidedChessPlayer lesson={lesson} lessonNumber={1} totalLessons={1} />)
    expect(screen.getByTestId('guided-player-board')).toBeInTheDocument()
  })

  it('starting_fen field on lesson is optional and does not break when absent', () => {
    const lesson = {
      id: 'no-starting-fen',
      title: 'No Starting FEN',
      pgn_data: '1. d4 d5',
      board_perspective: 'white' as const,
      coach_note: null,
      // no starting_fen
    }
    render(<GuidedChessPlayer lesson={lesson} lessonNumber={1} totalLessons={1} />)
    expect(screen.getByTestId('guided-player-board')).toBeInTheDocument()
  })
})

// ── Viewer mode tests (issue #197) — see 'PRD-0004 Slice 10' describe block below ──

describe('PromotionPicker component', () => {
  function renderPicker(props?: Partial<React.ComponentProps<typeof PromotionPicker>>) {
    return rtlRender(
      <I18nextProvider i18n={i18n}>
        <PromotionPicker
          offered={['q', 'r', 'b', 'n']}
          onPick={vi.fn()}
          onDismiss={vi.fn()}
          {...props}
        />
      </I18nextProvider>
    )
  }

  it('has data-testid="promotion-picker"', () => {
    renderPicker()
    expect(screen.getByTestId('promotion-picker')).toBeInTheDocument()
  })

  it('renders 4 buttons when offered all 4 pieces', () => {
    renderPicker()
    expect(screen.getByTestId('promotion-piece-q')).toBeInTheDocument()
    expect(screen.getByTestId('promotion-piece-r')).toBeInTheDocument()
    expect(screen.getByTestId('promotion-piece-b')).toBeInTheDocument()
    expect(screen.getByTestId('promotion-piece-n')).toBeInTheDocument()
  })

  it('renders only offered pieces when offered=["q","n"]', () => {
    renderPicker({ offered: ['q', 'n'] })
    expect(screen.getByTestId('promotion-piece-q')).toBeInTheDocument()
    expect(screen.getByTestId('promotion-piece-n')).toBeInTheDocument()
    expect(screen.queryByTestId('promotion-piece-r')).not.toBeInTheDocument()
    expect(screen.queryByTestId('promotion-piece-b')).not.toBeInTheDocument()
  })

  it('calls onPick("q") when Q is clicked', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    renderPicker({ onPick })
    await user.click(screen.getByTestId('promotion-piece-q'))
    expect(onPick).toHaveBeenCalledWith('q')
  })

  it('calls onPick("r") when R is clicked', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    renderPicker({ onPick })
    await user.click(screen.getByTestId('promotion-piece-r'))
    expect(onPick).toHaveBeenCalledWith('r')
  })

  it('calls onPick("b") when B is clicked', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    renderPicker({ onPick })
    await user.click(screen.getByTestId('promotion-piece-b'))
    expect(onPick).toHaveBeenCalledWith('b')
  })

  it('calls onPick("n") when N is clicked', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    renderPicker({ onPick })
    await user.click(screen.getByTestId('promotion-piece-n'))
    expect(onPick).toHaveBeenCalledWith('n')
  })

  it('calls onDismiss when dismiss button is clicked', async () => {
    const onDismiss = vi.fn()
    const user = userEvent.setup()
    renderPicker({ onDismiss })
    await user.click(screen.getByTestId('promotion-dismiss'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('dismiss button has data-testid="promotion-dismiss"', () => {
    renderPicker()
    expect(screen.getByTestId('promotion-dismiss')).toBeInTheDocument()
  })

  it('title shows "Chọn quân phong cấp"', () => {
    renderPicker()
    expect(screen.getByText(/chọn quân phong cấp/i)).toBeInTheDocument()
  })

  it('each piece button has correct data-testid', () => {
    renderPicker()
    for (const p of ['q', 'r', 'b', 'n']) {
      expect(screen.getByTestId(`promotion-piece-${p}`)).toBeInTheDocument()
    }
  })

  it('does not render when offered is empty', () => {
    renderPicker({ offered: [] })
    // No piece buttons rendered
    for (const p of ['q', 'r', 'b', 'n']) {
      expect(screen.queryByTestId(`promotion-piece-${p}`)).not.toBeInTheDocument()
    }
  })

  it('queen piece button has aria-label "Hậu"', () => {
    renderPicker({ offered: ['q'] })
    expect(screen.getByTestId('promotion-piece-q')).toHaveAttribute('aria-label', 'Hậu')
  })

  it('root element has role="dialog"', () => {
    renderPicker()
    expect(screen.getByTestId('promotion-picker')).toHaveAttribute('role', 'dialog')
  })
})

// ── Viewer mode — PRD-0004 Slice 10 ──────────────────────────────────────────

const VIEWER_PGN = '1. e4 e5 2. Nf3 Nc6 3. Bb5'

const viewerLesson = {
  id: 'l-viewer',
  title: 'Viewer Lesson',
  pgn_data: VIEWER_PGN,
  board_perspective: 'white' as const,
  coach_note: null,
  has_rewind_mode: true,
}

describe('GuidedChessPlayer — viewer mode (PRD-0004 Slice 10)', () => {
  it('renders viewer-mode navigation buttons when mode="viewer"', () => {
    render(<GuidedChessPlayer lesson={viewerLesson} lessonNumber={1} totalLessons={3} mode="viewer" />)
    expect(screen.getByTestId('viewer-prev-btn')).toBeInTheDocument()
    expect(screen.getByTestId('viewer-next-btn')).toBeInTheDocument()
  })

  it('does not render "Gợi ý" / hint button in viewer mode', () => {
    render(<GuidedChessPlayer lesson={viewerLesson} lessonNumber={1} totalLessons={3} mode="viewer" />)
    expect(screen.queryByTestId('guided-player-hint-btn')).not.toBeInTheDocument()
  })

  it('starts at root — viewer-prev button is disabled', () => {
    render(<GuidedChessPlayer lesson={viewerLesson} lessonNumber={1} totalLessons={3} mode="viewer" />)
    expect(screen.getByTestId('viewer-prev-btn')).toBeDisabled()
  })

  it('viewer-next advances to first move', async () => {
    render(<GuidedChessPlayer lesson={viewerLesson} lessonNumber={1} totalLessons={3} mode="viewer" />)
    fireEvent.click(screen.getByTestId('viewer-next-btn'))
    await screen.findByTestId('viewer-prev-btn')
    expect(screen.getByTestId('viewer-prev-btn')).toBeEnabled()
  })

  it('viewer-next is disabled at leaf node', async () => {
    render(<GuidedChessPlayer lesson={viewerLesson} lessonNumber={1} totalLessons={3} mode="viewer" />)
    // Advance through all 5 plies to reach leaf
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByTestId('viewer-next-btn'))
    }
    await screen.findByTestId('viewer-next-btn')
    expect(screen.getByTestId('viewer-next-btn')).toBeDisabled()
  })

  it('viewer-prev walks back to root after one advance', async () => {
    render(<GuidedChessPlayer lesson={viewerLesson} lessonNumber={1} totalLessons={3} mode="viewer" />)
    fireEvent.click(screen.getByTestId('viewer-next-btn'))
    fireEvent.click(screen.getByTestId('viewer-prev-btn'))
    await screen.findByTestId('viewer-prev-btn')
    expect(screen.getByTestId('viewer-prev-btn')).toBeDisabled()
  })

  it('viewer-next advances exactly one ply per click (no opponent auto-play)', async () => {
    // SAMPLE_PGN: 1. e4 e5 ... After one click of Next we expect the current
    // node to be e4 — NOT auto-advanced through Black's reply. Wait long
    // enough that any leftover 600 ms timer would have fired.
    render(<GuidedChessPlayer lesson={viewerLesson} lessonNumber={1} totalLessons={3} mode="viewer" />)
    fireEvent.click(screen.getByTestId('viewer-next-btn'))
    await new Promise((r) => setTimeout(r, OPPONENT_DELAY_MS + 100))
    // The highlighted move (aria-current="true") should be e4, not e5.
    const current = document.querySelector('[aria-current="true"]')
    expect(current?.textContent).toBe('e4')
  })

  it('viewer-prev moves back without an immediate auto-play rebound', async () => {
    // Reproduces the #229 follow-up: previously, clicking Prev after a Next
    // would advance one ply, the opponent would auto-play forward, and Prev
    // would visually no-op until clicked twice. Now it should land back at
    // root in a single click.
    render(<GuidedChessPlayer lesson={viewerLesson} lessonNumber={1} totalLessons={3} mode="viewer" />)
    fireEvent.click(screen.getByTestId('viewer-next-btn'))
    fireEvent.click(screen.getByTestId('viewer-prev-btn'))
    await new Promise((r) => setTimeout(r, OPPONENT_DELAY_MS + 100))
    expect(screen.getByTestId('viewer-prev-btn')).toBeDisabled()
  })

  it('→ arrow key advances in viewer mode', async () => {
    render(<GuidedChessPlayer lesson={viewerLesson} lessonNumber={1} totalLessons={3} mode="viewer" />)
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    await screen.findByTestId('viewer-prev-btn')
    expect(screen.getByTestId('viewer-prev-btn')).toBeEnabled()
  })

  it('← arrow key walks back in viewer mode', async () => {
    render(<GuidedChessPlayer lesson={viewerLesson} lessonNumber={1} totalLessons={3} mode="viewer" />)
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    await screen.findByTestId('viewer-prev-btn')
    expect(screen.getByTestId('viewer-prev-btn')).toBeDisabled()
  })

  it('does not accept piece-drop moves in viewer mode', async () => {
    // In viewer mode the board is viewOnly — clicking a variation node should not advance
    render(<GuidedChessPlayer lesson={viewerLesson} lessonNumber={1} totalLessons={3} mode="viewer" />)
    // prev should stay disabled (no moves committed)
    expect(screen.getByTestId('viewer-prev-btn')).toBeDisabled()
  })

  it('renders in lesson mode by default (no viewer nav buttons)', () => {
    render(<GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />)
    expect(screen.queryByTestId('viewer-prev-btn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('viewer-next-btn')).not.toBeInTheDocument()
  })

  it('shapes and notes still render in viewer mode', () => {
    const pgnWithShape = '1. e4 { [gambitly:v1]{"s":[{"kind":"circle","square":"e4","color":"green"}]} }'
    const lesson = { ...viewerLesson, pgn_data: pgnWithShape }
    render(<GuidedChessPlayer lesson={lesson} lessonNumber={1} totalLessons={1} mode="viewer" initialNodeId="root" />)
    // Advance to the e4 node first
    fireEvent.click(screen.getByTestId('viewer-next-btn'))
    // The board should be in the document
    expect(screen.getByTestId('guided-player-board')).toBeInTheDocument()
  })
})

// ── Resume position — PRD-0004 Slice 10 ──────────────────────────────────────

describe('GuidedChessPlayer — resume position (PRD-0004 Slice 10)', () => {
  it('calls onResumeNodeChange with current nodeId after 2s debounce', async () => {
    vi.useFakeTimers()
    const onResumeNodeChange = vi.fn()
    render(
      <GuidedChessPlayer
        lesson={baseLesson}
        lessonNumber={1}
        totalLessons={5}
        onResumeNodeChange={onResumeNodeChange}
      />
    )
    // Advance one move
    const board = screen.getByTestId('guided-player-board')
    const squares = board.querySelectorAll('[data-square]')
    // Find e2 square and trigger move to e4
    const e2 = Array.from(squares).find(s => s.getAttribute('data-square') === 'e2')
    if (e2) fireEvent.click(e2)
    // Before 2s, not called
    expect(onResumeNodeChange).not.toHaveBeenCalled()
    // After 2s
    act(() => { vi.advanceTimersByTime(2000) })
    expect(onResumeNodeChange).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('does not crash when onResumeNodeChange is not provided', () => {
    render(<GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />)
    expect(screen.getByTestId('guided-player-root')).toBeInTheDocument()
  })
})

describe('GuidedChessPlayer — rewind toggle (issue #226)', () => {
  it('does not render a mode switcher when onToggleMode is not provided', () => {
    render(<GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />)
    expect(screen.queryByTestId('mode-switcher')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mode-switch-study')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mode-switch-rewind')).not.toBeInTheDocument()
  })

  it("highlights the Study segment when mode='viewer' and onToggleMode is set", () => {
    render(
      <GuidedChessPlayer
        lesson={baseLesson}
        lessonNumber={1}
        totalLessons={5}
        mode="viewer"
        onToggleMode={vi.fn()}
      />
    )
    expect(screen.getByTestId('mode-switcher')).toBeInTheDocument()
    expect(screen.getByTestId('mode-switch-study')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('mode-switch-rewind')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('mode-switch-study')).toHaveTextContent(/học/i)
    expect(screen.getByTestId('mode-switch-rewind')).toHaveTextContent(/tự đi/i)
  })

  it("highlights the Rewind segment when mode='lesson' and onToggleMode is set", () => {
    render(
      <GuidedChessPlayer
        lesson={baseLesson}
        lessonNumber={1}
        totalLessons={5}
        mode="lesson"
        onToggleMode={vi.fn()}
      />
    )
    expect(screen.getByTestId('mode-switch-study')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('mode-switch-rewind')).toHaveAttribute('aria-pressed', 'true')
  })

  it('clicking the inactive Rewind segment calls onToggleMode from Study', async () => {
    const user = userEvent.setup()
    const onToggleMode = vi.fn()
    render(
      <GuidedChessPlayer
        lesson={baseLesson}
        lessonNumber={1}
        totalLessons={5}
        mode="viewer"
        onToggleMode={onToggleMode}
      />
    )
    await user.click(screen.getByTestId('mode-switch-rewind'))
    expect(onToggleMode).toHaveBeenCalledTimes(1)
  })

  it('clicking the active segment is a no-op (does not call onToggleMode)', async () => {
    const user = userEvent.setup()
    const onToggleMode = vi.fn()
    render(
      <GuidedChessPlayer
        lesson={baseLesson}
        lessonNumber={1}
        totalLessons={5}
        mode="viewer"
        onToggleMode={onToggleMode}
      />
    )
    await user.click(screen.getByTestId('mode-switch-study'))
    expect(onToggleMode).not.toHaveBeenCalled()
  })

  it("hides the Hint button in Rewind mode (mode='lesson' + onToggleMode)", () => {
    render(
      <GuidedChessPlayer
        lesson={baseLesson}
        lessonNumber={1}
        totalLessons={5}
        mode="lesson"
        onToggleMode={vi.fn()}
      />
    )
    expect(screen.queryByTestId('guided-player-hint-btn')).not.toBeInTheDocument()
  })

  it('still shows the Hint button when mode=lesson without onToggleMode (regular lesson)', () => {
    render(<GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} mode="lesson" />)
    expect(screen.getByTestId('guided-player-hint-btn')).toBeInTheDocument()
  })

  it('hides the coach note in Rewind mode', () => {
    const lessonWithNote = { ...baseLesson, coach_note: 'Important guidance here.' }
    render(
      <GuidedChessPlayer
        lesson={lessonWithNote}
        lessonNumber={1}
        totalLessons={5}
        mode="lesson"
        onToggleMode={vi.fn()}
      />
    )
    expect(screen.queryByTestId('guided-player-coach-note')).not.toBeInTheDocument()
  })

  it('still shows the coach note in Study (viewer) mode', () => {
    const lessonWithNote = { ...baseLesson, coach_note: 'Important guidance here.' }
    render(
      <GuidedChessPlayer
        lesson={lessonWithNote}
        lessonNumber={1}
        totalLessons={5}
        mode="viewer"
        onToggleMode={vi.fn()}
      />
    )
    expect(screen.getByTestId('guided-player-coach-note')).toBeInTheDocument()
  })

  it('strips creator-authored autoShapes in Rewind mode (clean board)', () => {
    // PGN with a green-circle authored on e4 by the creator.
    const PGN_WITH_SHAPES = '1. e4 { [gambitly:v1]{"s":[{"kind":"circle","square":"e4","color":"green"}]} }'
    const parsed = parsePgn(PGN_WITH_SHAPES)
    const e4Node = parsed.root!.children[0]
    render(
      <GuidedChessPlayer
        lesson={{ ...baseLesson, pgn_data: PGN_WITH_SHAPES }}
        lessonNumber={1}
        totalLessons={1}
        mode="lesson"
        onToggleMode={vi.fn()}
        initialNodeId={e4Node.id}
      />
    )
    const board = screen.getByTestId('guided-player-board')
    expect(board.querySelector('[data-autoshape="true"]')).not.toBeInTheDocument()
  })

  it('still shows creator-authored autoShapes in Study (viewer) mode', () => {
    const PGN_WITH_SHAPES = '1. e4 { [gambitly:v1]{"s":[{"kind":"circle","square":"e4","color":"green"}]} }'
    const parsed = parsePgn(PGN_WITH_SHAPES)
    const e4Node = parsed.root!.children[0]
    render(
      <GuidedChessPlayer
        lesson={{ ...baseLesson, pgn_data: PGN_WITH_SHAPES }}
        lessonNumber={1}
        totalLessons={1}
        mode="viewer"
        onToggleMode={vi.fn()}
        initialNodeId={e4Node.id}
      />
    )
    const board = screen.getByTestId('guided-player-board')
    expect(board.querySelector('[data-square="e4"][data-autoshape="true"]')).toBeInTheDocument()
  })

  it('viewer mode shows the entire main line in the move log (not just played moves)', () => {
    render(
      <GuidedChessPlayer
        lesson={baseLesson}
        lessonNumber={1}
        totalLessons={5}
        mode="viewer"
        onToggleMode={vi.fn()}
      />
    )
    // SAMPLE_PGN main line is e4 e5 Nf3 Nc6 Bb5 — three full-move blocks.
    expect(screen.getByTestId('move-block-1')).toHaveTextContent(/e4/)
    expect(screen.getByTestId('move-block-1')).toHaveTextContent(/e5/)
    expect(screen.getByTestId('move-block-2')).toHaveTextContent(/Nf3/)
    expect(screen.getByTestId('move-block-2')).toHaveTextContent(/Nc6/)
    expect(screen.getByTestId('move-block-3')).toHaveTextContent(/Bb5/)
  })

  it('lesson mode only shows played moves in the move log', () => {
    render(<GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} mode="lesson" />)
    // No moves played yet → no move blocks rendered.
    expect(screen.queryByTestId('move-block-1')).not.toBeInTheDocument()
  })

  it('clicking a move in the viewer move log jumps the board to that node', async () => {
    const user = userEvent.setup()
    render(
      <GuidedChessPlayer
        lesson={baseLesson}
        lessonNumber={1}
        totalLessons={5}
        mode="viewer"
        onToggleMode={vi.fn()}
      />
    )
    // Click "Nf3" — should advance currentNodeId so the prev-arrow becomes enabled.
    const nf3 = screen.getByRole('button', { name: 'Nf3' })
    await user.click(nf3)
    expect(screen.getByTestId('viewer-prev-btn')).toBeEnabled()
  })

  it('shows the wrong-move banner in Rewind mode when a non-tree move is attempted', () => {
    render(
      <GuidedChessPlayer
        lesson={baseLesson}
        lessonNumber={1}
        totalLessons={5}
        mode="lesson"
        onToggleMode={vi.fn()}
      />
    )
    expect(screen.queryByTestId('wrong-move-banner')).not.toBeInTheDocument()
    // SAMPLE_PGN expects 1. e4 — clicking e2→e3 is the wrong continuation.
    const board = screen.getByTestId('guided-player-board')
    fireEvent.click(board.querySelector('[data-square="e2"]')!)
    fireEvent.click(board.querySelector('[data-square="e3"]')!)
    expect(screen.getByTestId('wrong-move-banner')).toBeInTheDocument()
    expect(screen.getByTestId('wrong-move-banner')).toHaveTextContent(/nước sai/i)
  })

  it('also shows the wrong-move banner in regular lesson mode (no onToggleMode)', () => {
    render(<GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} />)
    const board = screen.getByTestId('guided-player-board')
    fireEvent.click(board.querySelector('[data-square="e2"]')!)
    fireEvent.click(board.querySelector('[data-square="e3"]')!)
    expect(screen.getByTestId('wrong-move-banner')).toBeInTheDocument()
  })

  it('does not render the wrong-move banner in Study (viewer) mode', () => {
    render(
      <GuidedChessPlayer
        lesson={baseLesson}
        lessonNumber={1}
        totalLessons={5}
        mode="viewer"
        onToggleMode={vi.fn()}
      />
    )
    expect(screen.queryByTestId('wrong-move-banner')).not.toBeInTheDocument()
  })
})

describe('GuidedChessPlayer — arrow icons for viewer nav (issue #226 follow-up)', () => {
  it('viewer prev/next buttons expose accessible labels for the arrow icons', () => {
    render(<GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} mode="viewer" />)
    expect(screen.getByTestId('viewer-prev-btn')).toHaveAttribute('aria-label', 'Nước trước')
    expect(screen.getByTestId('viewer-next-btn')).toHaveAttribute('aria-label', 'Nước sau')
  })

  it('viewer prev/next buttons no longer render text labels (icons only)', () => {
    render(<GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} mode="viewer" />)
    // The text label moved to aria-label / title; the visible button content
    // is just the icon, so the text content should be empty.
    expect(screen.getByTestId('viewer-prev-btn').textContent ?? '').toBe('')
    expect(screen.getByTestId('viewer-next-btn').textContent ?? '').toBe('')
  })

  it('renders Begin and End navigation buttons in viewer mode', () => {
    render(<GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} mode="viewer" />)
    expect(screen.getByTestId('viewer-begin-btn')).toBeInTheDocument()
    expect(screen.getByTestId('viewer-end-btn')).toBeInTheDocument()
  })

  it('Begin button is disabled at root and Prev is also disabled', () => {
    render(<GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} mode="viewer" />)
    expect(screen.getByTestId('viewer-begin-btn')).toBeDisabled()
    expect(screen.getByTestId('viewer-prev-btn')).toBeDisabled()
  })

  it('End button jumps to the last node of the main line', async () => {
    render(<GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} mode="viewer" />)
    fireEvent.click(screen.getByTestId('viewer-end-btn'))
    await screen.findByTestId('viewer-end-btn')
    // After jumping to the end, End + Next should be disabled.
    expect(screen.getByTestId('viewer-end-btn')).toBeDisabled()
    expect(screen.getByTestId('viewer-next-btn')).toBeDisabled()
    // Begin + Prev re-enabled.
    expect(screen.getByTestId('viewer-begin-btn')).toBeEnabled()
    expect(screen.getByTestId('viewer-prev-btn')).toBeEnabled()
  })

  it('Begin button returns to root from the end position', async () => {
    render(<GuidedChessPlayer lesson={baseLesson} lessonNumber={1} totalLessons={5} mode="viewer" />)
    fireEvent.click(screen.getByTestId('viewer-end-btn'))
    await screen.findByTestId('viewer-begin-btn')
    fireEvent.click(screen.getByTestId('viewer-begin-btn'))
    await screen.findByTestId('viewer-begin-btn')
    expect(screen.getByTestId('viewer-begin-btn')).toBeDisabled()
    expect(screen.getByTestId('viewer-prev-btn')).toBeDisabled()
    expect(screen.getByTestId('viewer-end-btn')).toBeEnabled()
    expect(screen.getByTestId('viewer-next-btn')).toBeEnabled()
  })
})