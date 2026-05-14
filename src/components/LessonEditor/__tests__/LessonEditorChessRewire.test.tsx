/**
 * LessonEditor rewire tests — PRD-0004 Slice 5a
 *
 * Verifies that for lesson.type === 'chess':
 *   - The PGN textarea is NOT rendered (replaced by BoardAuthoringSurface)
 *   - BoardAuthoringSurface is rendered
 *   - On Save: serializePgn of the treeStore is passed to onSave
 *   - On load: parsePgn of lesson.pgn_data populates the variation list
 *   - No regression on lesson.type === 'video'
 */
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../i18n'
import LessonEditor from '../LessonEditor'

vi.mock('chessground')

function render(ui: React.ReactNode) {
  return rtlRender(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
}

const DEFAULT_CHESS_LESSON = {
  id: 'lesson-1',
  title: 'Test Chess Lesson',
  pgn_data: '',
  board_perspective: 'white' as const,
  is_free_preview: false,
  type: 'chess' as const,
}

const CHESS_LESSON_WITH_PGN = {
  ...DEFAULT_CHESS_LESSON,
  pgn_data: '1. e4 e5 2. Nf3 Nc6',
}

const BRANCHING_LESSON = {
  ...DEFAULT_CHESS_LESSON,
  pgn_data: '1. e4 e5 (1...c5 2. Nf3) 2. Nf3',
}

describe('LessonEditor rewire for chess type', () => {
  describe('PGN textarea absence', () => {
    it('does NOT render the PGN textarea for chess type lessons', () => {
      render(<LessonEditor lesson={DEFAULT_CHESS_LESSON} onSave={vi.fn()} />)
      expect(screen.queryByRole('textbox', { name: /pgn/i })).not.toBeInTheDocument()
    })

    it('renders the BoardAuthoringSurface instead', () => {
      render(<LessonEditor lesson={DEFAULT_CHESS_LESSON} onSave={vi.fn()} />)
      expect(screen.getByTestId('board-authoring-surface')).toBeInTheDocument()
    })

    it('renders the chess board within the authoring surface', () => {
      render(<LessonEditor lesson={DEFAULT_CHESS_LESSON} onSave={vi.fn()} />)
      expect(screen.getByTestId('board-authoring-board')).toBeInTheDocument()
    })
  })

  describe('loading existing PGN into the board', () => {
    it('populates the variation list from lesson.pgn_data', async () => {
      render(<LessonEditor lesson={CHESS_LESSON_WITH_PGN} onSave={vi.fn()} />)
      // The variation list should show the loaded moves
      await waitFor(() => {
        expect(screen.getByTestId('variation-list')).toBeInTheDocument()
      })
      expect(screen.getByTestId('variation-list')).toHaveTextContent('e4')
      expect(screen.getByTestId('variation-list')).toHaveTextContent('e5')
    })

    it('shows branching moves in the variation list for PGN with variations', async () => {
      render(<LessonEditor lesson={BRANCHING_LESSON} onSave={vi.fn()} />)
      await waitFor(() => {
        expect(screen.getByTestId('variation-list')).toBeInTheDocument()
      })
      expect(screen.getByTestId('variation-list')).toHaveTextContent('c5')
    })
  })

  describe('save', () => {
    it('calls onSave with a serialized PGN string when Save draft is clicked', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      // Start with a lesson that has pgn_data
      render(<LessonEditor lesson={CHESS_LESSON_WITH_PGN} onSave={onSave} />)
      const saveBtn = screen.getByRole('button', { name: /lưu nháp/i })
      await user.click(saveBtn)
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          pgn_data: expect.any(String),
          board_perspective: 'white',
          is_free_preview: false,
        })
      )
    })

    it('saves a valid PGN string that can be re-parsed', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(<LessonEditor lesson={CHESS_LESSON_WITH_PGN} onSave={onSave} />)
      await user.click(screen.getByRole('button', { name: /lưu nháp/i }))
      const { pgn_data } = onSave.mock.calls[0][0] as { pgn_data: string }
      // Should produce a valid PGN that can be parsed
      const { parsePgn } = await import('../../../utils/parsePgn')
      const result = parsePgn(pgn_data)
      expect(result.valid).toBe(true)
    })
  })

  describe('starting FEN integration', () => {
    it('loads a lesson with a [FEN "..."] tag in pgn_data and shows moves relative to that position', async () => {
      // Italian game position after 1. e4 e5 2. Nf3 Nc6 3. Bc4
      const CUSTOM_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3'
      const lessonWithFen = {
        ...DEFAULT_CHESS_LESSON,
        pgn_data: `[FEN "${CUSTOM_FEN}"]\n3...Bc5`,
      }
      render(<LessonEditor lesson={lessonWithFen} onSave={vi.fn()} />)
      await waitFor(() => {
        expect(screen.getByTestId('variation-list')).toBeInTheDocument()
      })
      // Should show Bc5 as the move in the variation list
      expect(screen.getByTestId('variation-list')).toHaveTextContent('Bc5')
    })

    it('saves a PGN with [FEN "..."] tag when the tree has a custom starting FEN', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      const CUSTOM_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
      const lessonWithFen = {
        ...DEFAULT_CHESS_LESSON,
        pgn_data: `[FEN "${CUSTOM_FEN}"]\n1. d4`,
      }
      render(<LessonEditor lesson={lessonWithFen} onSave={onSave} />)
      await waitFor(() => {
        expect(screen.getByTestId('variation-list')).toBeInTheDocument()
      })
      await user.click(screen.getByRole('button', { name: /lưu nháp/i }))
      const { pgn_data } = onSave.mock.calls[0][0] as { pgn_data: string }
      expect(pgn_data).toContain('[FEN "')
    })
  })

  describe('no regression — video type', () => {
    it('video type lessons still render the video editor (no board authoring surface)', () => {
      render(
        <LessonEditor
          lesson={{ ...DEFAULT_CHESS_LESSON, type: 'video' }}
          onSave={vi.fn()}
        />
      )
      // Board authoring surface should NOT be present in video mode
      // (it may be in a different tab; clicking video tab should be the default)
      // We can click the video tab to be sure
      const videoTab = screen.getByTestId('lesson-type-tab-video')
      fireEvent.click(videoTab)
      expect(screen.queryByTestId('board-authoring-surface')).not.toBeInTheDocument()
    })
  })
})
