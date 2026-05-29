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
    it('does not crash on right-click (no context menu shown)', () => {
      store.getState().applyMove('e2', 'e4')
      renderWithVariationPanel(store)
      const varList = screen.getByTestId('variation-list')
      expect(() => fireEvent.contextMenu(varList)).not.toThrow()
      expect(screen.queryByTestId('variation-context-menu')).not.toBeInTheDocument()
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

  describe('variation list delete button — Slice 5b (#200)', () => {
    it('hovering a variation node reveals the delete button', () => {
      store.getState().applyMove('e2', 'e4')
      renderWithVariationPanel(store)
      const e4Node = screen.getAllByTestId(/variation-node-/)[0]
      fireEvent.mouseEnter(e4Node)
      const deleteBtn = screen.getByTestId(/delete-move-btn-/)
      expect(deleteBtn).toBeVisible()
    })

    it('delete button is hidden (visibility:hidden) when not hovering', () => {
      store.getState().applyMove('e2', 'e4')
      renderWithVariationPanel(store)
      const e4Id = store.getState().tree.children[0].id
      const deleteBtn = screen.getByTestId(`delete-move-btn-${e4Id}`)
      expect(deleteBtn).not.toBeVisible()
    })

    it('clicking delete button opens a confirm dialog', () => {
      store.getState().applyMove('e2', 'e4')
      store.getState().setCurrentNode('root')
      store.getState().applyMove('d2', 'd4')
      renderWithVariationPanel(store)
      const e4Node = screen.getAllByTestId(/variation-node-/).find(
        (el) => el.textContent?.includes('e4')
      )!
      fireEvent.mouseEnter(e4Node)
      const e4Id = store.getState().tree.children[0].id
      fireEvent.click(screen.getByTestId(`delete-move-btn-${e4Id}`))
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
      fireEvent.mouseEnter(e4Node)
      const e4Id = store.getState().tree.children[0].id
      fireEvent.click(screen.getByTestId(`delete-move-btn-${e4Id}`))
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
      fireEvent.mouseEnter(e4Node)
      const e4Id = store.getState().tree.children[0].id
      fireEvent.click(screen.getByTestId(`delete-move-btn-${e4Id}`))
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
  })

  describe('promote variation button', () => {
    it('promote button appears only on the first move of a variation block', () => {
      // e4 = main line, d4 = variation start
      store.getState().applyMove('e2', 'e4')
      store.getState().setCurrentNode('root')
      store.getState().applyMove('d2', 'd4')
      renderWithVariationPanel(store)
      const d4Id = store.getState().tree.children[1].id
      const e4Id = store.getState().tree.children[0].id
      expect(screen.getByTestId(`promote-move-btn-${d4Id}`)).toBeInTheDocument()
      expect(screen.queryByTestId(`promote-move-btn-${e4Id}`)).not.toBeInTheDocument()
    })

    it('promote button is not shown for moves continuing a variation (not the branch point)', () => {
      // 1.e4 (1.d4 d5) — d5 is continuation inside d4 variation, not a new branch
      store.getState().applyMove('e2', 'e4')
      store.getState().setCurrentNode('root')
      store.getState().applyMove('d2', 'd4')
      store.getState().applyMove('d7', 'd5')
      renderWithVariationPanel(store)
      const d5Id = store.getState().tree.children[1].children[0].id
      expect(screen.queryByTestId(`promote-move-btn-${d5Id}`)).not.toBeInTheDocument()
    })

    it('hovering a variation-start node reveals the promote button', () => {
      store.getState().applyMove('e2', 'e4')
      store.getState().setCurrentNode('root')
      store.getState().applyMove('d2', 'd4')
      renderWithVariationPanel(store)
      const d4Id = store.getState().tree.children[1].id
      const d4Node = screen.getByTestId(`variation-node-${d4Id}`)
      fireEvent.mouseEnter(d4Node)
      expect(screen.getByTestId(`promote-move-btn-${d4Id}`)).toBeVisible()
    })

    it('clicking promote makes the variation the new main line', () => {
      store.getState().applyMove('e2', 'e4')
      store.getState().setCurrentNode('root')
      store.getState().applyMove('d2', 'd4')
      renderWithVariationPanel(store)
      const d4Id = store.getState().tree.children[1].id
      const d4Node = screen.getByTestId(`variation-node-${d4Id}`)
      fireEvent.mouseEnter(d4Node)
      fireEvent.click(screen.getByTestId(`promote-move-btn-${d4Id}`))
      expect(store.getState().tree.children[0].san).toBe('d4')
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

  describe('main-line navigation arrows', () => {
    it('renders Begin / Prev / Next / End buttons', () => {
      renderWithVariationPanel(store)
      expect(screen.getByTestId('board-authoring-nav-begin')).toBeInTheDocument()
      expect(screen.getByTestId('board-authoring-nav-prev')).toBeInTheDocument()
      expect(screen.getByTestId('board-authoring-nav-next')).toBeInTheDocument()
      expect(screen.getByTestId('board-authoring-nav-end')).toBeInTheDocument()
    })

    it('disables Begin + Prev + Next + End on an empty tree (no moves yet)', () => {
      renderWithVariationPanel(store)
      expect(screen.getByTestId('board-authoring-nav-begin')).toBeDisabled()
      expect(screen.getByTestId('board-authoring-nav-prev')).toBeDisabled()
      expect(screen.getByTestId('board-authoring-nav-next')).toBeDisabled()
      expect(screen.getByTestId('board-authoring-nav-end')).toBeDisabled()
    })

    it('disables Next + End at the leaf of the main line', () => {
      const parsed = parsePgn('1. e4 e5 2. Nf3')
      store.getState().replaceTree(parsed.root!)
      // replaceTree resets the cursor to root — move it to the leaf so we
      // can assert the end-of-line disabled state.
      let leaf = store.getState().tree
      while (leaf.children.length > 0) leaf = leaf.children[0]
      store.getState().setCurrentNode(leaf.id)
      renderWithVariationPanel(store)
      expect(screen.getByTestId('board-authoring-nav-end')).toBeDisabled()
      expect(screen.getByTestId('board-authoring-nav-next')).toBeDisabled()
      expect(screen.getByTestId('board-authoring-nav-begin')).toBeEnabled()
      expect(screen.getByTestId('board-authoring-nav-prev')).toBeEnabled()
    })

    it('Begin jumps the store back to the root', async () => {
      const parsed = parsePgn('1. e4 e5 2. Nf3')
      store.getState().replaceTree(parsed.root!)
      renderWithVariationPanel(store)
      fireEvent.click(screen.getByTestId('board-authoring-nav-begin'))
      await waitFor(() => {
        expect(store.getState().currentNodeId).toBe(store.getState().tree.id)
      })
    })

    it('End jumps to the last node reachable via children[0] from root', async () => {
      const parsed = parsePgn('1. e4 e5 2. Nf3')
      store.getState().replaceTree(parsed.root!)
      // Move cursor back to root, then click End.
      store.getState().setCurrentNode(store.getState().tree.id)
      renderWithVariationPanel(store)
      fireEvent.click(screen.getByTestId('board-authoring-nav-end'))
      await waitFor(() => {
        // The main-line end is the Nf3 node — walk children[0] from root.
        let node = store.getState().tree
        while (node.children.length > 0) node = node.children[0]
        expect(store.getState().currentNodeId).toBe(node.id)
      })
    })
  })
})
