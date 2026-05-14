/**
 * BoardEditor tests — PRD-0004 Slice 6
 *
 * Tests for custom starting position via FEN paste or click-to-place editor.
 * Follows TDD: one test → RED → minimal impl → GREEN → repeat.
 */
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../i18n'

vi.mock('chessground')

// Component under test — will fail until it exists (RED)
import BoardEditor from '../BoardEditor/BoardEditor'
import { createTreeStore } from '../treeStore'
import type { TreeStore } from '../treeStore'

function render(ui: React.ReactNode) {
  return rtlRender(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
}

const VALID_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
const INVALID_FEN_TWO_WHITE_KINGS = 'rnbqkKnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKB1R w KQkq - 0 1'
const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

describe('BoardEditor', () => {
  let store: TreeStore
  let onClose: ReturnType<typeof vi.fn>

  beforeEach(() => {
    store = createTreeStore()
    onClose = vi.fn()
  })

  describe('rendering', () => {
    it('renders the board editor dialog', () => {
      render(<BoardEditor store={store} onClose={onClose} />)
      expect(screen.getByTestId('board-editor')).toBeInTheDocument()
    })

    it('shows two tabs: FEN paste and piece editor', () => {
      render(<BoardEditor store={store} onClose={onClose} />)
      expect(screen.getByTestId('board-editor-tab-fen')).toBeInTheDocument()
      expect(screen.getByTestId('board-editor-tab-editor')).toBeInTheDocument()
    })

    it('renders the FEN textarea when FEN tab is active', () => {
      render(<BoardEditor store={store} onClose={onClose} />)
      // FEN tab is default
      expect(screen.getByTestId('board-editor-fen-input')).toBeInTheDocument()
    })

    it('renders Apply and Cancel buttons', () => {
      render(<BoardEditor store={store} onClose={onClose} />)
      expect(screen.getByTestId('board-editor-apply')).toBeInTheDocument()
      expect(screen.getByTestId('board-editor-cancel')).toBeInTheDocument()
    })
  })

  describe('FEN tab', () => {
    it('shows current starting FEN (default standard) in the input', () => {
      render(<BoardEditor store={store} onClose={onClose} />)
      const input = screen.getByTestId('board-editor-fen-input') as HTMLTextAreaElement
      expect(input.value).toBe(STARTING_FEN)
    })

    it('shows custom FEN in input when store has a custom starting FEN', () => {
      store.getState().setStartingFen(VALID_FEN)
      render(<BoardEditor store={store} onClose={onClose} />)
      const input = screen.getByTestId('board-editor-fen-input') as HTMLTextAreaElement
      expect(input.value).toBe(VALID_FEN)
    })

    it('clears error message when a valid FEN is entered', async () => {
      const user = userEvent.setup()
      render(<BoardEditor store={store} onClose={onClose} />)
      const input = screen.getByTestId('board-editor-fen-input')
      await user.clear(input)
      await user.type(input, 'invalid-fen')
      fireEvent.click(screen.getByTestId('board-editor-apply'))
      expect(screen.getByTestId('board-editor-fen-error')).toBeInTheDocument()
      // Now type valid FEN
      await user.clear(input)
      await user.type(input, VALID_FEN)
      // Error should be gone after new valid input
      waitFor(() => {
        expect(screen.queryByTestId('board-editor-fen-error')).not.toBeInTheDocument()
      })
    })

    it('shows an error for invalid FEN when Apply is clicked', async () => {
      const user = userEvent.setup()
      render(<BoardEditor store={store} onClose={onClose} />)
      const input = screen.getByTestId('board-editor-fen-input')
      await user.clear(input)
      await user.type(input, 'not-a-valid-fen')
      fireEvent.click(screen.getByTestId('board-editor-apply'))
      expect(screen.getByTestId('board-editor-fen-error')).toBeInTheDocument()
    })

    it('calls store.setStartingFen with the parsed FEN on Apply with valid FEN', async () => {
      const user = userEvent.setup()
      render(<BoardEditor store={store} onClose={onClose} />)
      const input = screen.getByTestId('board-editor-fen-input')
      await user.clear(input)
      await user.type(input, VALID_FEN)
      fireEvent.click(screen.getByTestId('board-editor-apply'))
      expect(store.getState().tree.fen).toBe(VALID_FEN)
    })

    it('calls onClose after successful Apply', async () => {
      const user = userEvent.setup()
      render(<BoardEditor store={store} onClose={onClose} />)
      const input = screen.getByTestId('board-editor-fen-input')
      await user.clear(input)
      await user.type(input, VALID_FEN)
      fireEvent.click(screen.getByTestId('board-editor-apply'))
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('does NOT call onClose on Apply with invalid FEN', async () => {
      const user = userEvent.setup()
      render(<BoardEditor store={store} onClose={onClose} />)
      const input = screen.getByTestId('board-editor-fen-input')
      await user.clear(input)
      await user.type(input, INVALID_FEN_TWO_WHITE_KINGS)
      fireEvent.click(screen.getByTestId('board-editor-apply'))
      expect(onClose).not.toHaveBeenCalled()
    })

    it('resets to standard position when Reset button is clicked', async () => {
      const user = userEvent.setup()
      store.getState().setStartingFen(VALID_FEN)
      render(<BoardEditor store={store} onClose={onClose} />)
      const resetBtn = screen.getByTestId('board-editor-reset')
      await user.click(resetBtn)
      const input = screen.getByTestId('board-editor-fen-input') as HTMLTextAreaElement
      expect(input.value).toBe(STARTING_FEN)
    })
  })

  describe('Cancel button', () => {
    it('calls onClose when Cancel is clicked without applying', () => {
      render(<BoardEditor store={store} onClose={onClose} />)
      fireEvent.click(screen.getByTestId('board-editor-cancel'))
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('does NOT change the store when Cancel is clicked', () => {
      render(<BoardEditor store={store} onClose={onClose} />)
      const originalFen = store.getState().tree.fen
      fireEvent.click(screen.getByTestId('board-editor-cancel'))
      expect(store.getState().tree.fen).toBe(originalFen)
    })
  })

  describe('piece editor tab', () => {
    it('shows the piece editor board when piece editor tab is clicked', async () => {
      const user = userEvent.setup()
      render(<BoardEditor store={store} onClose={onClose} />)
      await user.click(screen.getByTestId('board-editor-tab-editor'))
      expect(screen.getByTestId('board-editor-piece-palette')).toBeInTheDocument()
    })

    it('shows a piece palette with 12 pieces (6 white + 6 black)', async () => {
      const user = userEvent.setup()
      render(<BoardEditor store={store} onClose={onClose} />)
      await user.click(screen.getByTestId('board-editor-tab-editor'))
      const palette = screen.getByTestId('board-editor-piece-palette')
      // Expect 12 piece buttons (P, N, B, R, Q, K for each side)
      const pieceButtons = palette.querySelectorAll('[data-piece]')
      expect(pieceButtons).toHaveLength(12)
    })

    it('shows clear-all button in piece editor tab', async () => {
      const user = userEvent.setup()
      render(<BoardEditor store={store} onClose={onClose} />)
      await user.click(screen.getByTestId('board-editor-tab-editor'))
      expect(screen.getByTestId('board-editor-clear-all')).toBeInTheDocument()
    })
  })
})
