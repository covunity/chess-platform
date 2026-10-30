import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AssignmentSubmissionsModal from '../AssignmentSubmissionsModal'
import * as assignmentApi from '../../../lib/assignmentApi'

vi.mock('../../../lib/assignmentApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/assignmentApi')>()
  return {
    ...actual,
    listAssignmentSubmissions: vi.fn(),
    gradeAssignmentSubmission: vi.fn(),
  }
})

vi.mock('../../ChessBoard/ChessgroundView', () => ({
  default: () => <div data-testid="mock-preview-board" />,
}))

describe('AssignmentSubmissionsModal', () => {
  const mockAssignment: assignmentApi.AssignmentWithProblems = {
    id: 'as-1',
    course_id: 'c-1',
    title: 'Bài tập tuần 1',
    description: null,
    due_date: '2026-11-01T00:00:00Z',
    max_score: 10,
    created_at: '2026-10-20T00:00:00Z',
    problems: [
      {
        id: 'p-1',
        assignment_id: 'as-1',
        order_index: 0,
        title: 'Thế cờ 1',
        fen: 'fen-1',
        player_side: 'white',
        solution_moves: ['e4'],
        explanation: 'Lời giải từ thầy',
        points: 10,
      },
    ],
  }

  const mockSubmissions: assignmentApi.AssignmentSubmissionDetail[] = [
    {
      id: 'sub-1',
      assignment_id: 'as-1',
      user_id: 'u-1',
      user_name: 'Nguyễn Văn A',
      submitted_at: '2026-10-22T08:00:00Z',
      content: 'Hoàn thành 1/1 thế cờ',
      score: 10,
      teacher_feedback: 'Làm bài rất tốt',
      graded_at: '2026-10-22T10:00:00Z',
      status: 'graded',
      answers: [
        {
          problem_id: 'p-1',
          user_moves: ['e4'],
          attempts: 1,
          is_correct: true,
          earned_points: 10,
        },
      ],
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(assignmentApi.listAssignmentSubmissions).mockResolvedValue({
      submissions: mockSubmissions,
      error: null,
    })
    vi.mocked(assignmentApi.gradeAssignmentSubmission).mockResolvedValue({
      success: true,
      error: null,
    })
  })

  it('renders student submission details and grading form', async () => {
    render(
      <AssignmentSubmissionsModal
        isOpen={true}
        onClose={vi.fn()}
        assignment={mockAssignment}
      />
    )

    expect(screen.getByText('Đang tải danh sách bài nộp...')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getAllByText('Nguyễn Văn A')[0]).toBeInTheDocument()
      expect(screen.getByText(/Làm bài rất tốt/i)).toBeInTheDocument()
      expect(screen.getByText(/Lời giải từ thầy/i)).toBeInTheDocument()
    })
  })

  it('allows teacher to update score and feedback', async () => {
    render(
      <AssignmentSubmissionsModal
        isOpen={true}
        onClose={vi.fn()}
        assignment={mockAssignment}
      />
    )

    await waitFor(() => {
      expect(screen.getAllByText('Nguyễn Văn A')[0]).toBeInTheDocument()
    })

    const feedbackInput = screen.getByTestId('grade-feedback-input')
    fireEvent.change(feedbackInput, { target: { value: 'Nhận xét mới: Xuất sắc!' } })

    const saveGradeBtn = screen.getByTestId('save-grade-btn')
    fireEvent.click(saveGradeBtn)

    await waitFor(() => {
      expect(assignmentApi.gradeAssignmentSubmission).toHaveBeenCalledWith(
        undefined,
        'sub-1',
        10,
        'Nhận xét mới: Xuất sắc!'
      )
    })
  })
})
