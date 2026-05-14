/**
 * BoardAuthoringSurface tests — PRD-0004 Slice 5a
 */
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../i18n'

vi.mock('chessground')

// We import the component. If it doesn't exist yet, this is RED.
import BoardAuthoringSurface from '../BoardAuthoring/BoardAuthoringSurface'
import { createTreeStore } from '../treeStore'
import type { TreeStore } from '../treeStore'
import { parsePgn } from '../../../utils/parsePgn'

function render(ui: React.ReactNode) {
  return rtlRender(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
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

    it('does not show the variation list when the tree has no variations (linear)', () => {
      render(<BoardAuthoringSurface store={store} perspective="white" />)
      expect(screen.queryByTestId('variation-list')).not.toBeInTheDocument()
    })

    it('shows the variation list when the tree has moves', () => {
      store.getState().applyMove('e2', 'e4')
      render(<BoardAuthoringSurface store={store} perspective="white" />)
      expect(screen.getByTestId('variation-list')).toBeInTheDocument()
    })

    it('shows move log entries for played moves', () => {
      store.getState().applyMove('e2', 'e4')
      store.getState().applyMove('e7', 'e5')
      render(<BoardAuthoringSurface store={store} perspective="white" />)
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

      render(<BoardAuthoringSurface store={store} perspective="white" />)

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
      render(<BoardAuthoringSurface store={store} perspective="white" />)
      const varList = screen.getByTestId('variation-list')
      expect(varList).toHaveTextContent('e4')
      expect(varList).toHaveTextContent('c5')
    })
  })

  describe('right-click on variation list rows', () => {
    it('does not crash on right-click (no context menu in this slice)', () => {
      store.getState().applyMove('e2', 'e4')
      render(<BoardAuthoringSurface store={store} perspective="white" />)
      const varList = screen.getByTestId('variation-list')
      // Should not throw
      expect(() => fireEvent.contextMenu(varList)).not.toThrow()
    })
  })
})
