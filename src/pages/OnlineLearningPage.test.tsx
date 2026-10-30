import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import '../i18n'
import OnlineLearningPage from './OnlineLearningPage'
import * as AuthContext from '../context/AuthContext'
import * as livePortalApi from '../lib/livePortalApi'

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../lib/livePortalApi', () => ({
  getEnrolledLiveCourses: vi.fn(),
  getCourseLiveSessions: vi.fn(),
  getCourseAssignments: vi.fn(),
  submitAssignment: vi.fn(),
  getCourseAnnouncements: vi.fn(),
  getCourseMaterials: vi.fn(),
  getCourseDiscussions: vi.fn(),
  createDiscussion: vi.fn(),
  createDiscussionReply: vi.fn(),
  getCourseTuition: vi.fn(),
  getCourseChatMessages: vi.fn(),
  sendCourseChatMessage: vi.fn(),
  subscribeToCourseChat: vi.fn(() => vi.fn()),
}))

const mockEnrolledCourses = [
  {
    id: 'course-live-1',
    title: 'Lớp Cờ Vua Trực Tuyến Chuyên Sâu',
    description: 'Học cờ online cùng kiện tướng',
    thumbnail_url: null,
    live_schedule: 'Thứ 2, 4, 6 (19:30 - 21:00)',
    live_status: 'live' as const,
    live_room_id: 'room-1',
    price: 450000,
    creator_id: 't1',
    creator_name: 'Thầy Dạy Cờ',
    creator_avatar_url: null,
    creator_bio: 'Kiện tướng FIDE',
  },
]

const mockSessions = [
  {
    id: 'sess-1',
    course_id: 'course-live-1',
    title: 'Buổi 3: Đòn phối hợp trung cuộc',
    description: 'Chữa bài tập và thực hành',
    scheduled_start_at: new Date(Date.now() + 3600000).toISOString(),
    scheduled_end_at: new Date(Date.now() + 7200000).toISOString(),
    status: 'SCHEDULED' as const,
    livekit_room_name: 'live-room-1',
    teacher_name: 'Thầy Dạy Cờ',
  },
]

const mockAssignments = [
  {
    id: 'ass-1',
    course_id: 'course-live-1',
    title: 'Phân tích biến thể Sicilian',
    description: 'Phân tích 5 nước đầu',
    due_date: new Date(Date.now() + 86400000 * 3).toISOString(), // upcoming
    max_score: 10,
    created_at: new Date().toISOString(),
    submission: null,
  },
  {
    id: 'ass-2',
    course_id: 'course-live-1',
    title: 'Thực hành bẫy Ruy Lopez',
    description: 'Quá hạn nộp',
    due_date: new Date(Date.now() - 86400000 * 2).toISOString(), // overdue
    max_score: 10,
    created_at: new Date().toISOString(),
    submission: null,
  },
  {
    id: 'ass-3',
    course_id: 'course-live-1',
    title: 'Chiến thuật chĩa đôi',
    description: 'Bài đã nộp và chấm điểm',
    due_date: new Date(Date.now() - 86400000 * 5).toISOString(),
    max_score: 10,
    created_at: new Date().toISOString(),
    submission: {
      id: 'sub-1',
      content: 'Bài giải của em',
      submitted_at: new Date().toISOString(),
      score: 9.5,
      teacher_feedback: 'Phân tích rất sắc bén, nước cờ tìm ra đòn phối hợp tốt!',
      graded_at: new Date().toISOString(),
      status: 'graded' as const,
    },
  },
]

const mockTuition = {
  id: 'tui-1',
  course_id: 'course-live-1',
  amount: 450000,
  due_date: new Date(Date.now() + 86400000 * 15).toISOString(),
  status: 'paid' as const,
  period: 'Kỳ tháng 10/2026',
  paid_at: new Date().toISOString(),
  note: 'Đã hoàn thành học phí',
}

describe('OnlineLearningPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(AuthContext.useAuth as any).mockReturnValue({
      user: { id: 'u-student', email: 'student@test.com', user_metadata: { name: 'Nam Học Viên' } },
      loading: false,
    })
    ;(livePortalApi.getEnrolledLiveCourses as any).mockResolvedValue({ courses: mockEnrolledCourses, error: null })
    ;(livePortalApi.getCourseLiveSessions as any).mockResolvedValue({ sessions: mockSessions, error: null })
    ;(livePortalApi.getCourseAssignments as any).mockResolvedValue({ assignments: mockAssignments, error: null })
    ;(livePortalApi.getCourseAnnouncements as any).mockResolvedValue({ announcements: [], error: null })
    ;(livePortalApi.getCourseMaterials as any).mockResolvedValue({ materials: [], error: null })
    ;(livePortalApi.getCourseDiscussions as any).mockResolvedValue({ discussions: [], error: null })
    ;(livePortalApi.getCourseTuition as any).mockResolvedValue({ tuition: mockTuition, error: null })
    ;(livePortalApi.getCourseChatMessages as any).mockResolvedValue({
      messages: [
        {
          id: 'chat-1',
          sender_id: 't1',
          sender_name: 'Thầy Dạy Cờ',
          sender_role: 'teacher',
          content: 'Chào mừng các em!',
          created_at: new Date().toISOString(),
        },
      ],
      error: null,
    })
    ;(livePortalApi.subscribeToCourseChat as any).mockReturnValue(vi.fn())
    ;(livePortalApi.sendCourseChatMessage as any).mockResolvedValue({
      message: {
        id: 'chat-2',
        sender_id: 'u-student',
        sender_name: 'Nam Học Viên',
        sender_role: 'student',
        content: 'Chào thầy!',
        created_at: new Date().toISOString(),
      },
      error: null,
    })
  })

  it('disables join button when session is not yet class time (SCHEDULED)', async () => {
    render(
      <MemoryRouter>
        <OnlineLearningPage />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/Lớp Cờ Vua Trực Tuyến Chuyên Sâu/i)).toBeInTheDocument()
      expect(screen.getByText(/Buổi 3: Đòn phối hợp trung cuộc/i)).toBeInTheDocument()
      const btn = screen.getByTestId('join-classroom-btn')
      expect(btn).toBeInTheDocument()
      expect(btn).toBeDisabled()
      expect(screen.getByText(/Chưa đến giờ học/i)).toBeInTheDocument()
      expect(screen.getByText(/Mở khi đến giờ học hoặc khi giảng viên bắt đầu/i)).toBeInTheDocument()
    })
  })

  it('enables join button when session is LIVE', async () => {
    ;(livePortalApi.getCourseLiveSessions as any).mockResolvedValue({
      sessions: [
        {
          ...mockSessions[0],
          status: 'LIVE',
        },
      ],
      error: null,
    })

    render(
      <MemoryRouter>
        <OnlineLearningPage />
      </MemoryRouter>
    )

    await waitFor(() => {
      const btn = screen.getByTestId('join-classroom-btn')
      expect(btn).toBeInTheDocument()
      expect(btn).toBeEnabled()
      expect(screen.getByText(/Vào lớp học ngay/i)).toBeInTheDocument()
      expect(screen.getByText(/🔴 ĐANG DIỄN RA/i)).toBeInTheDocument()
    })
  })

  it('renders assignments with 3 sub-tabs: sắp tới, quá hạn, đã hoàn thành', async () => {
    render(
      <MemoryRouter>
        <OnlineLearningPage />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByTestId('assignment-subtab-upcoming')).toBeInTheDocument()
      expect(screen.getByTestId('assignment-subtab-overdue')).toBeInTheDocument()
      expect(screen.getByTestId('assignment-subtab-completed')).toBeInTheDocument()
      expect(screen.getByText(/Phân tích biến thể Sicilian/i)).toBeInTheDocument()
      expect(screen.getByText(/Làm bài tập|Nộp bài tập/i)).toBeInTheDocument()
    })

    // Switch to Quá hạn
    fireEvent.click(screen.getByTestId('assignment-subtab-overdue'))
    expect(screen.getByText(/Thực hành bẫy Ruy Lopez/i)).toBeInTheDocument()

    // Switch to Đã hoàn thành
    fireEvent.click(screen.getByTestId('assignment-subtab-completed'))
    expect(screen.getByText(/Chiến thuật chĩa đôi/i)).toBeInTheDocument()
    expect(screen.getByText('9.5')).toBeInTheDocument()
    expect(screen.getByText(/Phân tích rất sắc bén, nước cờ tìm ra đòn phối hợp tốt!/i)).toBeInTheDocument()
  })

  it('shows empty state when not enrolled in any live course', async () => {
    ;(livePortalApi.getEnrolledLiveCourses as any).mockResolvedValue({ courses: [], error: null })

    render(
      <MemoryRouter>
        <OnlineLearningPage />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Bạn chưa đăng ký khóa học trực tuyến nào/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /Vào mục Khám phá/i })).toBeInTheDocument()
    })
  })

  it('renders chat messages from database and sends new message', async () => {
    render(
      <MemoryRouter>
        <OnlineLearningPage />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/Chat lớp học/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText(/Chat lớp học/i))

    await waitFor(() => {
      expect(screen.getByText('Chào mừng các em!')).toBeInTheDocument()
      expect(screen.getAllByText('Thầy Dạy Cờ').length).toBeGreaterThan(0)
      expect(screen.getByText('Realtime')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText(/Nhập tin nhắn trao đổi/i)
    fireEvent.change(input, { target: { value: 'Chào thầy!' } })
    fireEvent.click(screen.getByTitle('Gửi tin nhắn'))

    await waitFor(() => {
      expect(livePortalApi.sendCourseChatMessage).toHaveBeenCalledWith(
        undefined,
        'course-live-1',
        'u-student',
        'Chào thầy!'
      )
      expect(screen.getByText('Chào thầy!')).toBeInTheDocument()
    })
  })
})
