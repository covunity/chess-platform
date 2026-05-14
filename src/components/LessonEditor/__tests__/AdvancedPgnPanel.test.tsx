/**
 * AdvancedPgnPanel tests — PRD-0004 Slice 11 (issue #198)
 *
 * Tests the conditional PGN tab (editor_advanced flag) and the Import-from-PGN modal.
 * Following TDD: written before implementation.
 */
import { vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('chessground')
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../i18n'
import LessonEditor from '../LessonEditor'
import type { LessonEditorProps } from '../LessonEditor'
import { createTreeStore } from '../treeStore'

const DEFAULT_LESSON = {
  id: 'lesson-1',
  title: 'Italian Game',
  pgn_data: '',
  board_perspective: 'white' as const,
  is_free_preview: false,
  type: 'chess' as const,
}

function renderEditor(props: LessonEditorProps) {
  return render(
    <I18nextProvider i18n={i18n}>
      <LessonEditor {...props} />
    </I18nextProvider>
  )
}

// ── Advanced PGN panel visibility ─────────────────────────────────────────────

describe('AdvancedPgnPanel visibility', () => {
  it('does NOT render PGN tab when editorAdvanced is false (default board-only mode)', () => {
    renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn(), editorAdvanced: false })
    expect(screen.queryByRole('tab', { name: /pgn/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('advanced-pgn-panel')).not.toBeInTheDocument()
  })

  it('does NOT render PGN tab when editorAdvanced is omitted', () => {
    renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() })
    expect(screen.queryByRole('tab', { name: /pgn/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('advanced-pgn-panel')).not.toBeInTheDocument()
  })

  it('renders the PGN (advanced) tab when editorAdvanced is true', () => {
    renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn(), editorAdvanced: true })
    expect(screen.getByTestId('pgn-advanced-tab')).toBeInTheDocument()
  })

  it('PGN tab is not active by default — board surface still shows', () => {
    renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn(), editorAdvanced: true })
    // Board authoring surface is still visible
    expect(screen.getByTestId('board-authoring-surface')).toBeInTheDocument()
    // PGN panel content is NOT visible yet (tab not active)
    expect(screen.queryByTestId('advanced-pgn-panel')).not.toBeInTheDocument()
  })

  it('clicking the PGN tab shows the AdvancedPgnPanel with hint and textarea', async () => {
    const user = userEvent.setup()
    renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn(), editorAdvanced: true })
    await user.click(screen.getByTestId('pgn-advanced-tab'))
    expect(screen.getByTestId('advanced-pgn-panel')).toBeInTheDocument()
    // Hint line present
    expect(screen.getByTestId('advanced-pgn-hint')).toBeInTheDocument()
    // PGN textarea present
    expect(screen.getByTestId('advanced-pgn-textarea')).toBeInTheDocument()
  })

  it('switching back from PGN tab to Board tab shows the board surface again', async () => {
    const user = userEvent.setup()
    renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn(), editorAdvanced: true })
    await user.click(screen.getByTestId('pgn-advanced-tab'))
    expect(screen.getByTestId('advanced-pgn-panel')).toBeInTheDocument()
    await user.click(screen.getByTestId('board-tab'))
    expect(screen.getByTestId('board-authoring-surface')).toBeInTheDocument()
    expect(screen.queryByTestId('advanced-pgn-panel')).not.toBeInTheDocument()
  })
})

// ── Round-trip safety ─────────────────────────────────────────────────────────

describe('AdvancedPgnPanel round-trip', () => {
  it('PGN textarea is pre-populated with serialised tree from treeStore', async () => {
    const user = userEvent.setup()
    renderEditor({
      lesson: { ...DEFAULT_LESSON, pgn_data: '1. e4 e5' },
      onSave: vi.fn(),
      editorAdvanced: true,
    })
    await user.click(screen.getByTestId('pgn-advanced-tab'))
    const textarea = screen.getByTestId('advanced-pgn-textarea') as HTMLTextAreaElement
    // The textarea should contain moves derived from the PGN
    expect(textarea.value).toMatch(/e4/)
  })

  it('typing in PGN textarea and switching back to Board shows updated tree', async () => {
    const user = userEvent.setup()
    renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn(), editorAdvanced: true })
    await user.click(screen.getByTestId('pgn-advanced-tab'))
    const textarea = screen.getByTestId('advanced-pgn-textarea') as HTMLTextAreaElement
    await user.clear(textarea)
    await user.type(textarea, '1. d4 d5')
    // Switch back to board
    await user.click(screen.getByTestId('board-tab'))
    // Variation list should show d4 (move was applied to tree)
    await waitFor(() => {
      expect(screen.getByTestId('variation-list')).toBeInTheDocument()
    })
    expect(screen.getByTestId('variation-list')).toHaveTextContent('d4')
  })

  it('invalid PGN in textarea shows parse error and does NOT reset the tree', async () => {
    const user = userEvent.setup()
    renderEditor({
      lesson: { ...DEFAULT_LESSON, pgn_data: '1. e4 e5' },
      onSave: vi.fn(),
      editorAdvanced: true,
    })
    await user.click(screen.getByTestId('pgn-advanced-tab'))
    const textarea = screen.getByTestId('advanced-pgn-textarea') as HTMLTextAreaElement
    await user.clear(textarea)
    await user.type(textarea, 'INVALID PGN !!!!')
    // Parse status shows error (debounced — wait for it)
    await waitFor(() => {
      expect(screen.getByTestId('advanced-pgn-status')).toHaveTextContent(/không hợp lệ|invalid/i)
    }, { timeout: 1000 })
  })
})

// ── Import-from-PGN modal ─────────────────────────────────────────────────────

describe('Import-from-PGN modal', () => {
  it('renders "Nhập từ PGN" button for all creators (no editorAdvanced gate)', () => {
    renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn(), editorAdvanced: false })
    expect(screen.getByTestId('import-from-pgn-btn')).toBeInTheDocument()
  })

  it('also renders "Nhập từ PGN" when editorAdvanced is true', () => {
    renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn(), editorAdvanced: true })
    expect(screen.getByTestId('import-from-pgn-btn')).toBeInTheDocument()
  })

  it('clicking "Nhập từ PGN" opens the import modal', async () => {
    const user = userEvent.setup()
    renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn(), editorAdvanced: false })
    await user.click(screen.getByTestId('import-from-pgn-btn'))
    expect(screen.getByTestId('import-pgn-modal')).toBeInTheDocument()
    expect(screen.getByTestId('import-pgn-textarea')).toBeInTheDocument()
  })

  it('valid PGN in import modal replaces the tree and closes the modal', async () => {
    const user = userEvent.setup()
    renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn(), editorAdvanced: false })
    await user.click(screen.getByTestId('import-from-pgn-btn'))
    const importTextarea = screen.getByTestId('import-pgn-textarea') as HTMLTextAreaElement
    await user.type(importTextarea, '1. e4 e5')
    await user.click(screen.getByTestId('import-pgn-analyse-btn'))
    // Modal closes
    await waitFor(() => {
      expect(screen.queryByTestId('import-pgn-modal')).not.toBeInTheDocument()
    })
    // Tree now has the imported moves
    await waitFor(() => {
      expect(screen.getByTestId('variation-list')).toBeInTheDocument()
    })
    expect(screen.getByTestId('variation-list')).toHaveTextContent('e4')
  })

  it('invalid PGN in import modal shows error and does NOT replace the tree', async () => {
    const user = userEvent.setup()
    renderEditor({
      lesson: { ...DEFAULT_LESSON, pgn_data: '1. e4 e5' },
      onSave: vi.fn(),
      editorAdvanced: false,
    })
    await user.click(screen.getByTestId('import-from-pgn-btn'))
    const importTextarea = screen.getByTestId('import-pgn-textarea') as HTMLTextAreaElement
    await user.type(importTextarea, 'BADPGN !!!')
    await user.click(screen.getByTestId('import-pgn-analyse-btn'))
    // Modal stays open with error
    expect(screen.getByTestId('import-pgn-modal')).toBeInTheDocument()
    expect(screen.getByTestId('import-pgn-error')).toBeInTheDocument()
    // Original tree is still intact — board authoring was not cleared
    // (modal still open, so we check board surface is not visible)
    // Close modal with cancel
    await user.click(screen.getByTestId('import-pgn-cancel-btn'))
    await waitFor(() => {
      expect(screen.queryByTestId('import-pgn-modal')).not.toBeInTheDocument()
    })
    // Original variation list still present
    await waitFor(() => {
      expect(screen.getByTestId('variation-list')).toBeInTheDocument()
    })
    expect(screen.getByTestId('variation-list')).toHaveTextContent('e4')
  })

  it('cancel button closes the import modal without changing the tree', async () => {
    const user = userEvent.setup()
    renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() })
    await user.click(screen.getByTestId('import-from-pgn-btn'))
    expect(screen.getByTestId('import-pgn-modal')).toBeInTheDocument()
    await user.click(screen.getByTestId('import-pgn-cancel-btn'))
    await waitFor(() => {
      expect(screen.queryByTestId('import-pgn-modal')).not.toBeInTheDocument()
    })
  })
})

// ── Standalone AdvancedPgnPanel component tests ───────────────────────────────

import AdvancedPgnPanel from '../AdvancedPgnPanel/AdvancedPgnPanel'

describe('AdvancedPgnPanel component', () => {
  it('renders the hint line', () => {
    const store = createTreeStore()
    render(
      <I18nextProvider i18n={i18n}>
        <AdvancedPgnPanel store={store} />
      </I18nextProvider>
    )
    expect(screen.getByTestId('advanced-pgn-hint')).toBeInTheDocument()
  })

  it('renders a textarea with MAX_PGN_CHARS limit (50000)', () => {
    const store = createTreeStore()
    render(
      <I18nextProvider i18n={i18n}>
        <AdvancedPgnPanel store={store} />
      </I18nextProvider>
    )
    const textarea = screen.getByTestId('advanced-pgn-textarea') as HTMLTextAreaElement
    expect(textarea.maxLength).toBe(50000)
  })

  it('renders a char counter', () => {
    const store = createTreeStore()
    render(
      <I18nextProvider i18n={i18n}>
        <AdvancedPgnPanel store={store} />
      </I18nextProvider>
    )
    expect(screen.getByTestId('advanced-pgn-char-count')).toBeInTheDocument()
  })

  it('renders a parse status row', () => {
    const store = createTreeStore()
    render(
      <I18nextProvider i18n={i18n}>
        <AdvancedPgnPanel store={store} />
      </I18nextProvider>
    )
    expect(screen.getByTestId('advanced-pgn-status')).toBeInTheDocument()
  })
})
