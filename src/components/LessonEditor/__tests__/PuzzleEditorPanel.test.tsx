/**
 * PuzzleEditorPanel tests — PRD-0004 Slice 9a (issue #196)
 */

import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../i18n'

vi.mock('chessground')

import PuzzleEditorPanel from '../PuzzleEditorPanel'
import { createTreeStore } from '../treeStore'
import type { TreeStore } from '../treeStore'

function render(ui: React.ReactNode) {
  return rtlRender(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
}

describe('PuzzleEditorPanel', () => {
  let store: TreeStore

  beforeEach(() => {
    store = createTreeStore()
  })

  describe('playerSide picker', () => {
    it('renders a playerSide picker with White and Black options', () => {
      const onPlayerSideChange = vi.fn()
      render(
        <PuzzleEditorPanel
          store={store}
          playerSide={null}
          onPlayerSideChange={onPlayerSideChange}
        />
      )
      expect(screen.getByTestId('puzzle-player-side-white')).toBeInTheDocument()
      expect(screen.getByTestId('puzzle-player-side-black')).toBeInTheDocument()
    })

    it('calls onPlayerSideChange("white") when White is clicked', () => {
      const onPlayerSideChange = vi.fn()
      render(
        <PuzzleEditorPanel
          store={store}
          playerSide={null}
          onPlayerSideChange={onPlayerSideChange}
        />
      )
      fireEvent.click(screen.getByTestId('puzzle-player-side-white'))
      expect(onPlayerSideChange).toHaveBeenCalledWith('white')
    })

    it('calls onPlayerSideChange("black") when Black is clicked', () => {
      const onPlayerSideChange = vi.fn()
      render(
        <PuzzleEditorPanel
          store={store}
          playerSide="white"
          onPlayerSideChange={onPlayerSideChange}
        />
      )
      fireEvent.click(screen.getByTestId('puzzle-player-side-black'))
      expect(onPlayerSideChange).toHaveBeenCalledWith('black')
    })

    it('shows white as selected when playerSide is "white"', () => {
      render(
        <PuzzleEditorPanel
          store={store}
          playerSide="white"
          onPlayerSideChange={vi.fn()}
        />
      )
      expect(screen.getByTestId('puzzle-player-side-white')).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(screen.getByTestId('puzzle-player-side-black')).toHaveAttribute(
        'aria-pressed',
        'false'
      )
    })

    it('shows black as selected when playerSide is "black"', () => {
      render(
        <PuzzleEditorPanel
          store={store}
          playerSide="black"
          onPlayerSideChange={vi.fn()}
        />
      )
      expect(screen.getByTestId('puzzle-player-side-black')).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    })
  })

  describe('purpose radio group', () => {
    it('does not show purpose selector when no node is selected (at root)', () => {
      render(
        <PuzzleEditorPanel
          store={store}
          playerSide="white"
          onPlayerSideChange={vi.fn()}
        />
      )
      // At root, purpose selector should not appear
      expect(screen.queryByTestId('node-purpose-none')).not.toBeInTheDocument()
    })

    it('shows purpose selector when a move node is selected', () => {
      store.getState().applyMove('e2', 'e4')
      const e4Id = store.getState().tree.children[0].id
      store.getState().setCurrentNode(e4Id)

      render(
        <PuzzleEditorPanel
          store={store}
          playerSide="white"
          onPlayerSideChange={vi.fn()}
        />
      )
      expect(screen.getByTestId('node-purpose-none')).toBeInTheDocument()
      expect(screen.getByTestId('node-purpose-correct')).toBeInTheDocument()
      expect(screen.getByTestId('node-purpose-mistake')).toBeInTheDocument()
    })

    it('default purpose is "none" (null) for a new node', () => {
      store.getState().applyMove('e2', 'e4')
      const e4Id = store.getState().tree.children[0].id
      store.getState().setCurrentNode(e4Id)

      render(
        <PuzzleEditorPanel
          store={store}
          playerSide="white"
          onPlayerSideChange={vi.fn()}
        />
      )
      const noneRadio = screen.getByTestId('node-purpose-none')
      expect(noneRadio).toHaveAttribute('aria-checked', 'true')
    })

    it('clicking "correct" sets purpose to correct via store.setPurpose', async () => {
      store.getState().applyMove('e2', 'e4')
      const e4Id = store.getState().tree.children[0].id
      store.getState().setCurrentNode(e4Id)

      render(
        <PuzzleEditorPanel
          store={store}
          playerSide="white"
          onPlayerSideChange={vi.fn()}
        />
      )
      fireEvent.click(screen.getByTestId('node-purpose-correct'))

      await waitFor(() => {
        const node = store.getState().tree.children[0]
        expect(node.purpose).toBe('correct')
      })
    })

    it('clicking "mistake" sets purpose to mistake via store.setPurpose', async () => {
      store.getState().applyMove('e2', 'e4')
      const e4Id = store.getState().tree.children[0].id
      store.getState().setCurrentNode(e4Id)

      render(
        <PuzzleEditorPanel
          store={store}
          playerSide="white"
          onPlayerSideChange={vi.fn()}
        />
      )
      fireEvent.click(screen.getByTestId('node-purpose-mistake'))

      await waitFor(() => {
        const node = store.getState().tree.children[0]
        expect(node.purpose).toBe('mistake')
      })
    })

    it('clicking "none" resets purpose to null', async () => {
      store.getState().applyMove('e2', 'e4')
      const e4Id = store.getState().tree.children[0].id
      store.getState().setCurrentNode(e4Id)
      store.getState().setPurpose(e4Id, 'correct')

      render(
        <PuzzleEditorPanel
          store={store}
          playerSide="white"
          onPlayerSideChange={vi.fn()}
        />
      )
      fireEvent.click(screen.getByTestId('node-purpose-none'))

      await waitFor(() => {
        const node = store.getState().tree.children[0]
        expect(node.purpose).toBeNull()
      })
    })
  })

  describe('board authoring surface integration', () => {
    it('renders BoardAuthoringSurface within PuzzleEditorPanel', () => {
      render(
        <PuzzleEditorPanel
          store={store}
          playerSide="white"
          onPlayerSideChange={vi.fn()}
        />
      )
      expect(screen.getByTestId('board-authoring-surface')).toBeInTheDocument()
    })
  })
})
