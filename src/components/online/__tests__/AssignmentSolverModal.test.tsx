import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AssignmentSolverModal from '../AssignmentSolverModal'
import * as assignmentApi from '../../../lib/assignmentApi'

vi.mock('../../../lib/assignmentApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/assignmentApi')>()
  return {
    ...actual,
    getAssignmentWithProblems: vi.fn(),
    submitAssignmentAttempt: vi.fn(),
  }
})

vi.mock('../../ChessBoard/ChessgroundView', () => ({
  default: ({ fen, orientation, onMove }: any) => (
    <div data-testid="chessground-view" data-fen={fen} data-orientation={orientation}>
      <button
        type="button"
        data-testid="mock-correct-move"
        onClick={() => onMove?.('e2', 'e4')}
      >
        Make Correct Move
      </button>
      <button
        type="button"
        data-testid="mock-move-nf3"
        onClick={() => onMove?.('g1', 'f3')}
      >
        Make Move Nf3
      </button>
      <button
        type="button"
        data-testid="mock-move-e5-black"
        onClick={() => onMove?.('e7', 'e5')}
      >
        Make Move e5 Black
      </button>
      <button
        type="button"
        data-testid="mock-scholars-mate"
        onClick={() => onMove?.('a7', 'a8')}
      >
        Make Qa8#
      </button>
      <button
        type="button"
        data-testid="mock-alt-mate"
        onClick={() => onMove?.('b7', 'b8')}
      >
        Make Qb8#
      </button>
      <button
        type="button"
        data-testid="mock-wrong-move"
        onClick={() => onMove?.('e2', 'e5')}
      >
        Make Wrong Move
      </button>
    </div>
  ),
}))

describe('AssignmentSolverModal', () => {
  const mockAssignment: assignmentApi.AssignmentWithProblems = {
    id: 'as-1',
    course_id: 'c-1',
    title: 'Bài tập chiến thuật tuần 1',
    description: 'Giải các thế cờ sau',
    due_date: '2026-12-01T00:00:00Z',
    max_score: 10,
    created_at: '2026-10-20T00:00:00Z',
    problems: [
      {
        id: 'p-1',
        assignment_id: 'as-1',
        order_index: 0,
        title: 'Thế cờ 1: Mở cờ kiểm soát trung tâm',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        player_side: 'white',
        solution_moves: ['e4'],
        explanation: 'Nước đi e4 chiếm lĩnh ô trung tâm d5 và f5, mở đường cho Tượng f1 và Hậu d1.',
        hint: 'Hãy đẩy tốt trước mặt vua.',
        points: 5,
      },
      {
        id: 'p-2',
        assignment_id: 'as-1',
        order_index: 1,
        title: 'Thế cờ 2: Phát triển mã',
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        player_side: 'black',
        solution_moves: ['e5'],
        explanation: 'Đen đáp trả cân bằng trung tâm.',
        points: 5,
      },
      {
        id: 'p-3',
        assignment_id: 'as-1',
        order_index: 2,
        title: 'Thế cờ 3: Chuỗi 3 nước',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        player_side: 'white',
        solution_moves: ['e4', 'e5', 'Nf3'],
        explanation: 'Chuỗi nước cờ kiểm soát trung tâm và phát triển mã.',
        points: 5,
      },
      {
        id: 'p-4',
        assignment_id: 'as-1',
        order_index: 3,
        title: 'Thế cờ 4: Chiếu bí 1 nước',
        fen: '7k/QQ6/8/8/8/8/8/7K w - - 0 1',
        player_side: 'white',
        objective: 'mate_in_1',
        solution_moves: ['Qa8#'],
        explanation: 'Hậu chiếu bí vua đen.',
        points: 5,
      },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(assignmentApi.getAssignmentWithProblems).mockResolvedValue({
      assignment: mockAssignment,
      submission: null,
      error: null,
    })
    vi.mocked(assignmentApi.submitAssignmentAttempt).mockResolvedValue({
      success: true,
      error: null,
    })
  })

  it('renders loading state then problem details with player turn', async () => {
    render(
      <AssignmentSolverModal
        assignmentId="as-1"
        userId="u-student"
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('Đang chuẩn bị thế cờ bài tập...')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Thế cờ 1: Mở cờ kiểm soát trung tâm')).toBeInTheDocument()
      expect(screen.getByText('Lượt: Trắng đi')).toBeInTheDocument()
    })
  })

  it('shows hint when clicking Xem gợi ý', async () => {
    render(
      <AssignmentSolverModal
        assignmentId="as-1"
        userId="u-student"
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Thế cờ 1: Mở cờ kiểm soát trung tâm')).toBeInTheDocument()
    })

    const hintBtn = screen.getByText('Xem gợi ý')
    fireEvent.click(hintBtn)

    expect(screen.getByText(/Gợi ý từ giáo viên:/i)).toBeInTheDocument()
    expect(screen.getByText('Hãy đẩy tốt trước mặt vua.')).toBeInTheDocument()
  })

  it('displays correct message and teacher explanation when making correct move', async () => {
    render(
      <AssignmentSolverModal
        assignmentId="as-1"
        userId="u-student"
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Thế cờ 1: Mở cờ kiểm soát trung tâm')).toBeInTheDocument()
    })

    const moveBtn = screen.getByTestId('mock-correct-move')
    fireEvent.click(moveBtn)

    await waitFor(() => {
      expect(screen.getByText('Chính xác! 🎉')).toBeInTheDocument()
    })

    // Check teacher explanation is displayed
    expect(
      screen.getByText(/Nước đi e4 chiếm lĩnh ô trung tâm d5 và f5/i)
    ).toBeInTheDocument()

    // Next problem button should be available
    expect(screen.getByTestId('next-problem-btn')).toBeInTheDocument()
  })

  it('shows surrendered state with 0 points and teacher explanation when clicking Xem đáp án', async () => {
    render(
      <AssignmentSolverModal
        assignmentId="as-1"
        userId="u-student"
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Thế cờ 1: Mở cờ kiểm soát trung tâm')).toBeInTheDocument()
    })

    const surrenderBtn = screen.getByText(/Xem đáp án \(0 đ\)/i)
    fireEvent.click(surrenderBtn)

    await waitFor(() => {
      expect(screen.getByText('Đáp án của thế cờ')).toBeInTheDocument()
      expect(screen.getByText('Đã xem đáp án')).toBeInTheDocument()
      expect(
        screen.getByText(/Nước đi e4 chiếm lĩnh ô trung tâm d5 và f5/i)
      ).toBeInTheDocument()
    })
  })

  it('solves multi-move problem with opponent auto-reply (e4 -> auto e5 -> Nf3)', async () => {
    const multiMoveAssignment = {
      ...mockAssignment,
      problems: [mockAssignment.problems[2]], // Problem 3: e4, e5, Nf3
    }
    vi.mocked(assignmentApi.getAssignmentWithProblems).mockResolvedValueOnce({
      assignment: multiMoveAssignment,
      submission: null,
      error: null,
    })

    render(
      <AssignmentSolverModal
        assignmentId="as-1"
        userId="u-student"
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Thế cờ 3: Chuỗi 3 nước')).toBeInTheDocument()
    })

    // Student plays Move 1: e4
    fireEvent.click(screen.getByTestId('mock-correct-move'))

    // Opponent indicator should appear while auto-reply is pending
    expect(screen.getByTestId('opponent-moving-indicator')).toBeInTheDocument()

    // Wait for opponent auto-reply (400ms setTimeout)
    await waitFor(
      () => {
        expect(screen.queryByTestId('opponent-moving-indicator')).not.toBeInTheDocument()
      },
      { timeout: 1000 }
    )

    // Now student plays Move 3: Nf3
    fireEvent.click(screen.getByTestId('mock-move-nf3'))

    await waitFor(() => {
      expect(screen.getByText('Chính xác! 🎉')).toBeInTheDocument()
    })
    expect(
      screen.getByText(/Chuỗi nước cờ kiểm soát trung tâm và phát triển mã/i)
    ).toBeInTheDocument()
  })

  it('accepts alternate checkmating move for mate_in_1 objective', async () => {
    const mateAssignment = {
      ...mockAssignment,
      problems: [mockAssignment.problems[3]], // Problem 4: mate_in_1
    }
    vi.mocked(assignmentApi.getAssignmentWithProblems).mockResolvedValueOnce({
      assignment: mateAssignment,
      submission: null,
      error: null,
    })

    render(
      <AssignmentSolverModal
        assignmentId="as-1"
        userId="u-student"
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Thế cờ 4: Chiếu bí 1 nước')).toBeInTheDocument()
    })

    // Teacher recorded solution is Qxf7#. Student plays Bxf7# which is ALSO checkmate!
    fireEvent.click(screen.getByTestId('mock-alt-mate'))

    await waitFor(() => {
      expect(screen.getByText('Chính xác! 🎉')).toBeInTheDocument()
    })
  })

  it('cancels opponent auto-reply timer when user resets problem', async () => {
    const multiMoveAssignment = {
      ...mockAssignment,
      problems: [mockAssignment.problems[2]], // Problem 3: e4, e5, Nf3
    }
    vi.mocked(assignmentApi.getAssignmentWithProblems).mockResolvedValueOnce({
      assignment: multiMoveAssignment,
      submission: null,
      error: null,
    })

    render(
      <AssignmentSolverModal
        assignmentId="as-1"
        userId="u-student"
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Thế cờ 3: Chuỗi 3 nước')).toBeInTheDocument()
    })

    // Student plays Move 1: e4
    fireEvent.click(screen.getByTestId('mock-correct-move'))
    expect(screen.getByTestId('opponent-moving-indicator')).toBeInTheDocument()

    // Immediately click Reset ("Làm lại") before 400ms passes
    const retryBtn = screen.getByTestId('retry-problem-btn')
    fireEvent.click(retryBtn)

    // Opponent indicator should immediately vanish and board resets
    expect(screen.queryByTestId('opponent-moving-indicator')).not.toBeInTheDocument()
    expect(screen.getByText('Thế cờ 3: Chuỗi 3 nước')).toBeInTheDocument()
  })

  it('allows student playing as Black to solve problem', async () => {
    const blackAssignment = {
      ...mockAssignment,
      problems: [mockAssignment.problems[1]], // Problem 2: Black to move
    }
    vi.mocked(assignmentApi.getAssignmentWithProblems).mockResolvedValueOnce({
      assignment: blackAssignment,
      submission: null,
      error: null,
    })

    render(
      <AssignmentSolverModal
        assignmentId="as-1"
        userId="u-student"
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Thế cờ 2: Phát triển mã')).toBeInTheDocument()
      expect(screen.getByText(/Lượt: Đen đi/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('mock-move-e5-black'))

    await waitFor(() => {
      expect(screen.getByText('Chính xác! 🎉')).toBeInTheDocument()
    })
  })
})

