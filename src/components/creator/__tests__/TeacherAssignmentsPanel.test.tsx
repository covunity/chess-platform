import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TeacherAssignmentsPanel from '../TeacherAssignmentsPanel'
import * as assignmentApi from '../../../lib/assignmentApi'

vi.mock('../../../lib/assignmentApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/assignmentApi')>()
  return {
    ...actual,
    listTeacherAssignments: vi.fn(),
    createAssignmentWithProblems: vi.fn(),
    updateAssignmentWithProblems: vi.fn(),
    deleteAssignment: vi.fn(),
  }
})

describe('TeacherAssignmentsPanel', () => {
  const mockAssignments: assignmentApi.AssignmentWithProblems[] = [
    {
      id: 'as-1',
      course_id: 'c-1',
      title: 'Bài tập tuần 1: Đòn ghim',
      description: 'Luyện tập đòn ghim cơ bản',
      due_date: '2026-11-01T12:00:00Z',
      max_score: 10,
      created_at: '2026-10-20T10:00:00Z',
      submissions_count: 3,
      enrolled_students_count: 10,
      problems: [
        {
          id: 'p-1',
          assignment_id: 'as-1',
          order_index: 0,
          title: 'Thế cờ 1',
          fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          player_side: 'white',
          solution_moves: ['e4'],
          explanation: 'Mở đường cho tượng và hậu',
          points: 5,
        },
      ],
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(assignmentApi.listTeacherAssignments).mockResolvedValue({
      assignments: mockAssignments,
      error: null,
    })
  })

  it('renders assignment title, problem count, and submissions count', async () => {
    render(<TeacherAssignmentsPanel courseId="c-1" courseTitle="Lớp Cờ Vua Trực Tuyến" />)

    expect(screen.getByText('Đang tải danh sách bài tập...')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Bài tập tuần 1: Đòn ghim')).toBeInTheDocument()
    })

    expect(screen.getByText('1 thế cờ')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('/ 10 học viên')).toBeInTheDocument()
  })

  it('opens assignment editor modal when clicking Giao bài tập mới', async () => {
    render(<TeacherAssignmentsPanel courseId="c-1" />)

    await waitFor(() => {
      expect(screen.getByText('Bài tập tuần 1: Đòn ghim')).toBeInTheDocument()
    })

    const createBtn = screen.getByTestId('create-assignment-btn')
    fireEvent.click(createBtn)

    expect(screen.getByText('Giao bài tập thế cờ mới')).toBeInTheDocument()
    expect(screen.getByTestId('assignment-title-input')).toBeInTheDocument()
  })

  it('shows empty state when no assignments exist', async () => {
    vi.mocked(assignmentApi.listTeacherAssignments).mockResolvedValueOnce({
      assignments: [],
      error: null,
    })

    render(<TeacherAssignmentsPanel courseId="c-empty" />)

    await waitFor(() => {
      expect(screen.getByText('Chưa có bài tập nào được giao')).toBeInTheDocument()
    })
  })
})

