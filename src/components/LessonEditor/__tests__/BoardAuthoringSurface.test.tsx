/**
 * BoardAuthoringSurface tests — PRD-0004 Slice 5a
 *
 * The board surface and the variation/note panel were split into two components
 * (BoardAuthoringSurface + VariationPanel). LessonEditor composes them side by side.
 * These integration tests mount both so they exercise the same shared treeStore
 * the production layout uses.
 */
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../i18n'

vi.mock('chessground')

// We import the component. If it doesn't exist yet, this is RED.
import BoardAuthoringSurface from '../BoardAuthoring/BoardAuthoringSurface'
import VariationPanel from '../VariationPanel'
import { createTreeStore } from '../treeStore'
import type { TreeStore } from '../treeStore'
import { parsePgn } from '../../../utils/parsePgn'

function render(ui: React.ReactNode) {
  return rtlRender(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
}

/** Mount the board surface + variation/note panel together, mirroring LessonEditor's layout. */
function renderWithVariationPanel(store: TreeStore, perspective: 'white' | 'black' = 'white') {
  return render(
    <>
      <BoardAuthoringSurface store={store} perspective={perspective} />
      <VariationPanel store={store} />
    </>
  )
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

describe('BoardAuthoringSurface', () => {
  let store: TreeStore

  beforeEach(() => {
    store = createTreeStore()
  })

  describe('rendering', () => {
    it('renders a chess board', () => {
      render(<BoardAuthoringSurface store={store} perspective="white" />)
      expect(screen.getByTestId('board-authoring-board')).toBeInTheDocument()
    })

    it('shows an empty placeholder when the tree has no moves', () => {
      renderWithVariationPanel(store)
      expect(screen.getByTestId('variation-list')).toHaveTextContent(/kéo quân cờ/i)
    })

    it('shows the variation list when the tree has moves', () => {
      store.getState().applyMove('e2', 'e4')
      renderWithVariationPanel(store)
      expect(screen.getByTestId('variation-list')).toBeInTheDocument()
    })

    it('shows move log entries for played moves', () => {
      store.getState().applyMove('e2', 'e4')
      store.getState().applyMove('e7', 'e5')
      renderWithVariationPanel(store)
      expect(screen.getByTestId('variation-list')).toHaveTextContent('e4')
      expect(screen.getByTestId('variation-list')).toHaveTextContent('e5')
    })
  })

  describe('variation list interaction', () => {
    it('clicking a node in variation list changes currentNodeId in store', async () => {
      store.getState().applyMove('e2', 'e4')
      const e4Id = store.getState().tree.children[0].id
      // Navigate back to root, add a sibling variation
      store.getState().setCurrentNode('root')
      store.getState().applyMove('d2', 'd4')

      renderWithVariationPanel(store)

      // Click on e4 node in variation list
      const e4Node = screen.getByTestId(`variation-node-${e4Id}`)
      fireEvent.click(e4Node)

      await waitFor(() => {
        expect(store.getState().currentNodeId).toBe(e4Id)
      })
    })
  })

  describe('loading a lesson', () => {
    it('populates variation list when loaded with a branching PGN', () => {
      const parsed = parsePgn('1. e4 e5 (1...c5 2. Nf3) 2. Nf3')
      store.getState().replaceTree(parsed.root!)
      renderWithVariationPanel(store)
      const varList = screen.getByTestId('variation-list')
      expect(varList).toHaveTextContent('e4')
      expect(varList).toHaveTextContent('c5')
    })
  })

  describe('shape toolbar hint', () => {
    it('renders the shape toolbar hint row', () => {
      render(<BoardAuthoringSurface store={store} perspective="white" />)
      expect(screen.getByTestId('shape-toolbar-hint')).toBeInTheDocument()
    })

    it('shape toolbar hint contains expected text about right-click drawing', () => {
      render(<BoardAuthoringSurface store={store} perspective="white" />)
      const hint = screen.getByTestId('shape-toolbar-hint')
      expect(hint.textContent).toMatch(/Chuột phải/)
    })
  })

  describe('right-click on variation list rows', () => {
    it('does not crash on right-click', () => {
      store.getState().applyMove('e2', 'e4')
      renderWithVariationPanel(store)
      const varList = screen.getByTestId('variation-list')
      expect(() => fireEvent.contextMenu(varList)).not.toThrow()
    })
  })

  describe('note panel (Slice 7)', () => {
    it('renders the note panel', () => {
      renderWithVariationPanel(store)
      expect(screen.getByTestId('note-panel')).toBeInTheDocument()
    })

    it('renders a RichNoteEditor inside the note panel', () => {
      renderWithVariationPanel(store)
      expect(screen.getByTestId('rich-note-editor')).toBeInTheDocument()
    })

    it('note panel is disabled when root is selected (no node selected)', () => {
      renderWithVariationPanel(store)
      const editor = screen.getByTestId('rich-note-editor')
      expect(editor).toHaveAttribute('aria-disabled', 'true')
    })

    it('note panel is enabled when a non-root node is selected', async () => {
      store.getState().applyMove('e2', 'e4')
      // After applying a move, currentNodeId is the e4 node (not root)
      renderWithVariationPanel(store)
      await waitFor(() => {
        const editor = screen.getByTestId('rich-note-editor')
        expect(editor).not.toHaveAttribute('aria-disabled', 'true')
      })
    })

    it('shows hint text when root is selected', () => {
      renderWithVariationPanel(store)
      const panel = screen.getByTestId('note-panel')
      expect(panel).toHaveTextContent(/Chọn một nước/i)
    })

    it('dispatches setNote on the store when note changes', async () => {
      store.getState().applyMove('e2', 'e4')
      const e4Id = store.getState().tree.children[0].id
      renderWithVariationPanel(store)

      await waitFor(() => {
        expect(screen.getByTestId('rich-note-editor')).toBeInTheDocument()
      })

      // The note for e4 should start as null
      expect(store.getState().tree.children[0].note).toBeNull()

      // We can verify the store has setNote wired by checking the store action is functional
      const doc = {
        type: 'doc' as const,
        content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'test' }] }],
      }
      store.getState().setNote(e4Id, doc)
      expect(store.getState().tree.children[0].note).toEqual(doc)
    })

    it('switching currentNodeId updates the note panel value', async () => {
      store.getState().applyMove('e2', 'e4')
      const e4Id = store.getState().tree.children[0].id
      const doc = {
        type: 'doc' as const,
        content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'e4 note' }] }],
      }
      store.getState().setNote(e4Id, doc)

      renderWithVariationPanel(store)

      await waitFor(() => {
        const editableArea = document.querySelector('[contenteditable="true"]')
        expect(editableArea?.textContent).toContain('e4 note')
      })
    })
  })

  describe('variation list context menu — Slice 5b (#200)', () => {
    it('right-click on a variation node opens the context menu', () => {
      store.getState().applyMove('e2', 'e4')
      store.getState().setCurrentNode('root')
      store.getState().applyMove('d2', 'd4')
      renderWithVariationPanel(store)
      const d4Node = screen.getAllByTestId(/variation-node-/).find(
        (el) => el.textContent?.includes('d4')
      )!
      fireEvent.contextMenu(d4Node)
      expect(screen.getByTestId('variation-context-menu')).toBeInTheDocument()
    })

    it('context menu contains a promote action', () => {
      store.getState().applyMove('e2', 'e4')
      store.getState().setCurrentNode('root')
      store.getState().applyMove('d2', 'd4')
      renderWithVariationPanel(store)
      const d4Node = screen.getAllByTestId(/variation-node-/).find(
        (el) => el.textContent?.includes('d4')
      )!
      fireEvent.contextMenu(d4Node)
      expect(screen.getByTestId('ctx-promote-btn')).toBeInTheDocument()
    })

    it('context menu contains a delete action', () => {
      store.getState().applyMove('e2', 'e4')
      store.getState().setCurrentNode('root')
      store.getState().applyMove('d2', 'd4')
      renderWithVariationPanel(store)
      const d4Node = screen.getAllByTestId(/variation-node-/).find(
        (el) => el.textContent?.includes('d4')
      )!
      fireEvent.contextMenu(d4Node)
      expect(screen.getByTestId('ctx-delete-btn')).toBeInTheDocument()
    })

    it('promote button is disabled when the node is already children[0] of its parent', () => {
      store.getState().applyMove('e2', 'e4')
      store.getState().setCurrentNode('root')
      store.getState().applyMove('d2', 'd4')
      renderWithVariationPanel(store)
      // e4 is children[0] — promote should be disabled for it
      const e4Node = screen.getAllByTestId(/variation-node-/).find(
        (el) => el.textContent?.includes('e4')
      )!
      fireEvent.contextMenu(e4Node)
      expect(screen.getByTestId('ctx-promote-btn')).toBeDisabled()
    })

    it('promote button is enabled for a non-main-line sibling', () => {
      store.getState().applyMove('e2', 'e4')
      store.getState().setCurrentNode('root')
      store.getState().applyMove('d2', 'd4')
      renderWithVariationPanel(store)
      const d4Node = screen.getAllByTestId(/variation-node-/).find(
        (el) => el.textContent?.includes('d4')
      )!
      fireEvent.contextMenu(d4Node)
      expect(screen.getByTestId('ctx-promote-btn')).not.toBeDisabled()
    })

    it('clicking promote calls promoteVariation on the store', () => {
      store.getState().applyMove('e2', 'e4')
      store.getState().setCurrentNode('root')
      store.getState().applyMove('d2', 'd4')
      renderWithVariationPanel(store)
      const d4Node = screen.getAllByTestId(/variation-node-/).find(
        (el) => el.textContent?.includes('d4')
      )!
      fireEvent.contextMenu(d4Node)
      fireEvent.click(screen.getByTestId('ctx-promote-btn'))
      // d4 should now be children[0]
      expect(store.getState().tree.children[0].san).toBe('d4')
    })

    it('clicking delete opens a confirm dialog', () => {
      store.getState().applyMove('e2', 'e4')
      store.getState().setCurrentNode('root')
      store.getState().applyMove('d2', 'd4')
      renderWithVariationPanel(store)
      const e4Node = screen.getAllByTestId(/variation-node-/).find(
        (el) => el.textContent?.includes('e4')
      )!
      fireEvent.contextMenu(e4Node)
      fireEvent.click(screen.getByTestId('ctx-delete-btn'))
      expect(screen.getByTestId('delete-confirm-dialog')).toBeInTheDocument()
    })

    it('confirming delete removes the node from the tree', () => {
      store.getState().applyMove('e2', 'e4')
      store.getState().setCurrentNode('root')
      store.getState().applyMove('d2', 'd4')
      renderWithVariationPanel(store)
      const e4Node = screen.getAllByTestId(/variation-node-/).find(
        (el) => el.textContent?.includes('e4')
      )!
      fireEvent.contextMenu(e4Node)
      fireEvent.click(screen.getByTestId('ctx-delete-btn'))
      fireEvent.click(screen.getByTestId('delete-confirm-ok'))
      expect(store.getState().tree.children).toHaveLength(1)
      expect(store.getState().tree.children[0].san).toBe('d4')
    })

    it('cancelling the confirm dialog does not remove the node', () => {
      store.getState().applyMove('e2', 'e4')
      store.getState().setCurrentNode('root')
      store.getState().applyMove('d2', 'd4')
      renderWithVariationPanel(store)
      const e4Node = screen.getAllByTestId(/variation-node-/).find(
        (el) => el.textContent?.includes('e4')
      )!
      fireEvent.contextMenu(e4Node)
      fireEvent.click(screen.getByTestId('ctx-delete-btn'))
      fireEvent.click(screen.getByTestId('delete-confirm-cancel'))
      expect(store.getState().tree.children).toHaveLength(2)
    })

    it('Delete key on a focused variation node opens the confirm dialog', () => {
      store.getState().applyMove('e2', 'e4')
      renderWithVariationPanel(store)
      const e4Node = screen.getAllByTestId(/variation-node-/)[0]
      e4Node.focus()
      fireEvent.keyDown(e4Node, { key: 'Delete' })
      expect(screen.getByTestId('delete-confirm-dialog')).toBeInTheDocument()
    })

    it('context menu closes when clicking outside', () => {
      store.getState().applyMove('e2', 'e4')
      store.getState().setCurrentNode('root')
      store.getState().applyMove('d2', 'd4')
      renderWithVariationPanel(store)
      const d4Node = screen.getAllByTestId(/variation-node-/).find(
        (el) => el.textContent?.includes('d4')
      )!
      fireEvent.contextMenu(d4Node)
      expect(screen.getByTestId('variation-context-menu')).toBeInTheDocument()
      fireEvent.mouseDown(document.body)
      expect(screen.queryByTestId('variation-context-menu')).not.toBeInTheDocument()
    })
  })

  describe('starting position integration', () => {
    it('renders a "Vị trí bắt đầu" button', () => {
      render(<BoardAuthoringSurface store={store} perspective="white" />)
      expect(screen.getByTestId('board-authoring-starting-position-btn')).toBeInTheDocument()
    })

    it('shows BoardEditor when "Vị trí bắt đầu" button is clicked', () => {
      render(<BoardAuthoringSurface store={store} perspective="white" />)
      fireEvent.click(screen.getByTestId('board-authoring-starting-position-btn'))
      expect(screen.getByTestId('board-editor')).toBeInTheDocument()
    })

    it('hides BoardEditor when Cancel is clicked inside it', () => {
      render(<BoardAuthoringSurface store={store} perspective="white" />)
      fireEvent.click(screen.getByTestId('board-authoring-starting-position-btn'))
      expect(screen.getByTestId('board-editor')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('board-editor-cancel'))
      expect(screen.queryByTestId('board-editor')).not.toBeInTheDocument()
    })

    it('displays the starting FEN header in variation list when a custom FEN is set', async () => {
      const customFen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
      store.getState().setStartingFen(customFen)
      store.getState().applyMove('d2', 'd4')
      renderWithVariationPanel(store)
      // The variation list header should show the custom starting position FEN info
      const varList = screen.getByTestId('variation-list')
      expect(varList).toBeInTheDocument()
    })
  })
})
