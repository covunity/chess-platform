import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AssignmentEditorModal from '../AssignmentEditorModal'

vi.mock('../../ChessBoard/ChessgroundView', () => ({
  default: ({ fen, orientation, onMove }: any) => (
    <div data-testid="mock-editor-board" data-fen={fen} data-orientation={orientation}>
      <button
        type="button"
        data-testid="mock-play-move"
        onClick={() => onMove?.('e2', 'e4')}
      >
        Play e4
      </button>
      <button
        type="button"
        data-testid="mock-play-move-e5"
        onClick={() => onMove?.('e7', 'e5')}
      >
        Play e5
      </button>
      <button
        type="button"
        data-testid="mock-play-move-nf3"
        onClick={() => onMove?.('g1', 'f3')}
      >
        Play Nf3
      </button>
    </div>
  ),
}))

describe('AssignmentEditorModal', () => {
  it('renders modal with title, due date, objective selector and board setup controls', () => {
    render(
      <AssignmentEditorModal
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    )

    expect(screen.getByText('Giao bài tập thế cờ mới')).toBeInTheDocument()
    expect(screen.getByTestId('assignment-title-input')).toBeInTheDocument()
    expect(screen.getByTestId('assignment-due-date-input')).toBeInTheDocument()

    // Stage 1 controls
    expect(screen.getByTestId('clear-board-btn')).toBeInTheDocument()
    expect(screen.getByTestId('standard-board-btn')).toBeInTheDocument()
    expect(screen.getByText('Khay quân cờ')).toBeInTheDocument()
    expect(screen.getByText(/Mục tiêu thế cờ/i)).toBeInTheDocument()
  })

  it('allows selecting objective, clearing board, switching to solution stage and saving', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <AssignmentEditorModal
        isOpen={true}
        onClose={vi.fn()}
        onSave={onSave}
      />
    )

    // Set assignment title
    fireEvent.change(screen.getByTestId('assignment-title-input'), {
      target: { value: 'Bài tập tuần 2' },
    })

    // Click "Bàn cờ trống" to start from empty board
    fireEvent.click(screen.getByTestId('clear-board-btn'))

    // Click "Bàn cờ chuẩn" to restore valid board
    fireEvent.click(screen.getByTestId('standard-board-btn'))

    // Switch to Stage 2: Nước đi đáp án
    const step2Btn = screen.getByText(/2. 🎯 Nước đi đáp án/i)
    fireEvent.click(step2Btn)

    // In Stage 2, play move to record solution
    expect(screen.getByTestId('problem-explanation-input')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('mock-play-move'))

    // The recorded move should be visible
    expect(screen.getByText('e4')).toBeInTheDocument()

    // Add problem explanation
    fireEvent.change(screen.getByTestId('problem-explanation-input'), {
      target: { value: 'Nước đi kiểm soát trung tâm' },
    })

    // Click Save
    const saveBtn = screen.getByTestId('save-assignment-btn')
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Bài tập tuần 2',
        }),
        expect.arrayContaining([
          expect.objectContaining({
            solution_moves: ['e4'],
            explanation: 'Nước đi kiểm soát trung tâm',
          }),
        ])
      )
    })
  })

  it('records alternating multi-move sequence and supports Undo, Redo, and Reset', () => {
    render(
      <AssignmentEditorModal
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    )

    // Switch to Stage 2: Nước đi đáp án
    fireEvent.click(screen.getByText(/2. 🎯 Nước đi đáp án/i))

    // Play 1: e4 (Student move 1)
    fireEvent.click(screen.getByTestId('mock-play-move'))
    expect(screen.getByText('e4')).toBeInTheDocument()

    // Play 2: e5 (Opponent reply 1)
    fireEvent.click(screen.getByTestId('mock-play-move-e5'))
    expect(screen.getByText('e5')).toBeInTheDocument()

    // Play 3: Nf3 (Student move 2)
    fireEvent.click(screen.getByTestId('mock-play-move-nf3'))
    expect(screen.getByText('Nf3')).toBeInTheDocument()

    // Test Undo: undoes Nf3
    fireEvent.click(screen.getByTestId('undo-move-btn'))
    expect(screen.queryByText('Nf3')).not.toBeInTheDocument()
    expect(screen.getByText('e5')).toBeInTheDocument()

    // Test Redo: restores Nf3
    fireEvent.click(screen.getByTestId('redo-move-btn'))
    expect(screen.getByText('Nf3')).toBeInTheDocument()

    // Test Reset: clears all moves
    fireEvent.click(screen.getByTestId('reset-moves-btn'))
    expect(screen.queryByText('e4')).not.toBeInTheDocument()
    expect(screen.queryByText('e5')).not.toBeInTheDocument()
    expect(screen.queryByText('Nf3')).not.toBeInTheDocument()
  })

  it('blocks saving and alerts teacher when sequence ends on opponent move (even number of moves)', () => {
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const onSave = vi.fn()

    render(
      <AssignmentEditorModal
        isOpen={true}
        onClose={vi.fn()}
        onSave={onSave}
      />
    )

    fireEvent.change(screen.getByTestId('assignment-title-input'), {
      target: { value: 'Bài tập 2 nước' },
    })

    // Switch to Stage 2
    fireEvent.click(screen.getByText(/2. 🎯 Nước đi đáp án/i))

    // Play e4 (Student) and e5 (Opponent) -> Total 2 moves (even)
    fireEvent.click(screen.getByTestId('mock-play-move'))
    fireEvent.click(screen.getByTestId('mock-play-move-e5'))

    // Notice warning banner is displayed
    expect(
      screen.getByText(/Chuỗi đáp án đang kết thúc ở nước đáp trả của đối thủ/i)
    ).toBeInTheDocument()

    // Attempt to save
    fireEvent.click(screen.getByTestId('save-assignment-btn'))

    expect(alertMock).toHaveBeenCalledWith(
      expect.stringContaining('kết thúc ở nước đối thủ đáp trả')
    )
    expect(onSave).not.toHaveBeenCalled()

    alertMock.mockRestore()
  })
})
