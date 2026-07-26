import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import NewChapterModal from '../NewChapterModal'

describe('NewChapterModal', () => {
  const defaultProps = {
    defaultChapterNumber: 2,
    onCancel: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(undefined),
    t: (key: string) => key,
  }

  it('renders correctly with default form fields', () => {
    render(<NewChapterModal {...defaultProps} />)
    expect(screen.getByTestId('new-chapter-modal')).toBeInTheDocument()
    expect(screen.getByTestId('new-chapter-title-input')).toBeInTheDocument()
    expect(screen.getByTestId('input-type-empty')).toBeInTheDocument()
    expect(screen.getByTestId('input-type-url')).toBeInTheDocument()
    expect(screen.getByTestId('input-type-fen')).toBeInTheDocument()
    expect(screen.getByTestId('input-type-pgn')).toBeInTheDocument()
    expect(screen.getByTestId('new-chapter-perspective-select')).toBeInTheDocument()
  })

  it('shows manual input box when non-empty input type is selected', async () => {
    render(<NewChapterModal {...defaultProps} />)
    expect(screen.queryByTestId('new-chapter-manual-input')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('input-type-pgn'))
    expect(screen.getByTestId('new-chapter-manual-input')).toBeInTheDocument()
  })

  it('submits form data correctly', async () => {
    const onCreateMock = vi.fn().mockResolvedValue(undefined)
    render(<NewChapterModal {...defaultProps} onCreate={onCreateMock} />)

    const titleInput = screen.getByTestId('new-chapter-title-input')
    await userEvent.type(titleInput, 'Chương Khai Cuộc')

    fireEvent.click(screen.getByTestId('input-type-pgn'))

    const manualInput = screen.getByTestId('new-chapter-manual-input')
    fireEvent.change(manualInput, { target: { value: '[ChapterName "Ván 1"]\n1. e4 e5 *' } })

    fireEvent.click(screen.getByTestId('new-chapter-submit-btn'))

    await waitFor(() => {
      expect(onCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          chapterTitle: 'Chương Khai Cuộc',
          inputType: 'pgn',
          rawText: expect.stringContaining('Ván 1'),
          boardPerspective: 'white',
        })
      )
    })
  })
})
