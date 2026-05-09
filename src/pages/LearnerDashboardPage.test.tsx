import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, beforeEach, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import LearnerDashboardPage from './LearnerDashboardPage'
import * as dashboardApi from '../lib/dashboardApi'
import * as orderApi from '../lib/orderApi'
import { AuthContext } from '../context/AuthContext'
import type { AuthContextValue } from '../context/AuthContext'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    from: vi.fn(),
  },
}))

const mockGetLearnerStats = vi.spyOn(dashboardApi, 'getLearnerStats')
const mockGetEnrolledCoursesProgress = vi.spyOn(dashboardApi, 'getEnrolledCoursesProgress')
const mockGetRecommendedCourses = vi.spyOn(dashboardApi, 'getRecommendedCourses')
const mockListMyOrders = vi.spyOn(orderApi, 'listMyOrders')

const mockUser = {
  id: 'u1',
  email: 'minh@example.com',
  user_metadata: { name: 'Minh' },
} as AuthContextValue['user']

const mockAuthValue: AuthContextValue = {
  user: mockUser,
  loading: false,
  profile: { id: 'u1', email: 'minh@example.com', name: 'Minh', avatar_url: null, role: 'learner', created_at: '2026-01-01T00:00:00Z' },
  profileLoading: false,
  signUp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  resetPassword: vi.fn(),
  updatePassword: vi.fn(),
}

const sampleStats: dashboardApi.LearnerStats = {
  currentStreak: 4,
  bestStreak: 9,
  lessonsThisWeek: 6,
  lessonsLastWeek: 4,
  bookmarksCount: 23,
  hoursStudied: 12.5,
  coursesCount: 2,
}

const sampleEnrolled: dashboardApi.EnrolledCourseProgress[] = [
  {
    course_id: 'c1',
    title: 'Italian Game Mastery',
    thumbnail_url: null,
    level: 'beginner',
    creator_name: 'GM Anh Lê',
    enrolled_at: '2026-05-01T00:00:00Z',
    lessonsCount: 10,
    completedCount: 4,
    nextLesson: { id: 'l5', title: 'The c3-d4 break' },
    isComplete: false,
  },
  {
    course_id: 'c2',
    title: 'Endgame Essentials',
    thumbnail_url: null,
    level: 'intermediate',
    creator_name: 'IM Bình',
    enrolled_at: '2026-04-20T00:00:00Z',
    lessonsCount: 8,
    completedCount: 8,
    nextLesson: null,
    isComplete: true,
  },
]

const sampleRecommended: dashboardApi.RecommendedCourse[] = [
  {
    id: 'c10',
    title: 'Caro-Kann Crash Course',
    thumbnail_url: null,
    creator_name: 'GM C',
    rating_avg: 4.8,
    rating_count: 30,
    enrollment_count: 200,
    price: 0,
  },
]

const basePendingOrder: orderApi.MyOrderRow = {
  id: 'ord-p1',
  course_id: 'c-paid-1',
  user_id: 'u1',
  status: 'pending',
  amount: 480000,
  code: 'ORD-2026-000099',
  notes: null,
  platform_fee_pct: 20,
  platform_fee_amount: 96000,
  creator_payout_amount: 384000,
  creator_payout: 384000,
  account_tier_code: 'individual',
  confirmed_at: null,
  confirmed_by: null,
  cancelled_at: null,
  cancelled_by: null,
  cancelled_reason: null,
  created_at: '2026-05-09T10:00:00Z',
  updated_at: '2026-05-09T10:00:00Z',
  course: { id: 'c-paid-1', title: 'The Sicilian Dragon', thumbnail_url: null },
}

const baseCancelledOrder: orderApi.MyOrderRow = {
  ...basePendingOrder,
  id: 'ord-c1',
  status: 'cancelled',
  cancelled_at: '2026-05-09T12:00:00Z',
  cancelled_by: 'admin',
  cancelled_reason: 'Chuyển khoản sai nội dung',
}

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <AuthContext.Provider value={mockAuthValue}>
          <LearnerDashboardPage />
        </AuthContext.Provider>
      </I18nextProvider>
    </MemoryRouter>
  )
}

describe('LearnerDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetLearnerStats.mockResolvedValue({ stats: sampleStats, error: null })
    mockGetEnrolledCoursesProgress.mockResolvedValue({ courses: sampleEnrolled, error: null })
    mockGetRecommendedCourses.mockResolvedValue({ courses: sampleRecommended, error: null })
    mockListMyOrders.mockResolvedValue({ orders: [], total: 0, error: null })
  })

  it('renders the welcome header with the learner name', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-welcome')).toBeInTheDocument()
    })
    expect(screen.getByTestId('dashboard-welcome').textContent ?? '').toMatch(/Minh/i)
    expect(screen.getByTestId('dashboard-heading')).toBeInTheDocument()
  })

  it('renders Bookmarks(N) and Browse buttons in the action row', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-bookmarks-btn')).toBeInTheDocument()
    })
    expect(screen.getByTestId('dashboard-bookmarks-btn')).toHaveAttribute('href', '/practice')
    expect(screen.getByTestId('dashboard-bookmarks-btn').textContent ?? '').toMatch(/23/)
    expect(screen.getByTestId('dashboard-browse-btn')).toHaveAttribute('href', '/')
  })

  it('renders the 4 stat cards with computed values', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('stat-streak')).toBeInTheDocument()
    })
    expect(screen.getByTestId('stat-streak').textContent ?? '').toMatch(/4/)
    expect(screen.getByTestId('stat-lessons-week').textContent ?? '').toMatch(/6/)
    expect(screen.getByTestId('stat-bookmarks').textContent ?? '').toMatch(/23/)
    expect(screen.getByTestId('stat-hours').textContent ?? '').toMatch(/12/)
  })

  it('renders enrolled-course rows with Resume button linking to next lesson', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('enrolled-course-c1')).toBeInTheDocument()
    })
    const resume = screen.getByTestId('resume-c1')
    expect(resume).toHaveAttribute('href', '/learn/c1/l5')
    expect(resume.textContent ?? '').toMatch(/Tiếp tục|Resume/i)
    expect(screen.getByTestId('enrolled-course-c1').textContent ?? '').toMatch(/Italian Game Mastery/)
    expect(screen.getByTestId('enrolled-course-c1').textContent ?? '').toMatch(/The c3-d4 break/)
  })

  it('hides Resume and shows complete pill on a 100% complete course', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('enrolled-course-c2')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('resume-c2')).not.toBeInTheDocument()
    expect(screen.getByTestId('course-complete-c2')).toBeInTheDocument()
  })

  it('renders the Practice shortcut card with bookmark count and Start practice CTA', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('practice-shortcut')).toBeInTheDocument()
    })
    expect(screen.getByTestId('practice-shortcut').textContent ?? '').toMatch(/23/)
    expect(screen.getByTestId('practice-shortcut-cta')).toHaveAttribute('href', '/practice')
  })

  it('renders the Recommended courses card with each suggestion', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('recommended-card')).toBeInTheDocument()
    })
    expect(screen.getByTestId('recommended-c10')).toBeInTheDocument()
    expect(screen.getByTestId('recommended-c10').textContent ?? '').toMatch(/Caro-Kann/)
    // Recommended links to course detail
    const link = screen.getByTestId('recommended-link-c10')
    expect(link).toHaveAttribute('href', '/courses/c10')
  })

  it('shows an empty state when the learner has no enrolled courses', async () => {
    mockGetEnrolledCoursesProgress.mockResolvedValue({ courses: [], error: null })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('my-courses-empty')).toBeInTheDocument()
    })
  })

  describe('recommended course price display', () => {
    it('shows "Miễn phí" for a free recommended course', async () => {
      renderPage()
      await waitFor(() => expect(screen.getByTestId('recommended-c10')).toBeInTheDocument())
      expect(screen.getByTestId('recommended-c10').textContent ?? '').toMatch(/Miễn phí/i)
    })

    it('shows formatted ₫ price for a paid recommended course', async () => {
      mockGetRecommendedCourses.mockResolvedValue({
        courses: [{ ...sampleRecommended[0], price: 299000 }],
        error: null,
      })
      renderPage()
      await waitFor(() => expect(screen.getByTestId('recommended-c10')).toBeInTheDocument())
      expect(screen.getByTestId('recommended-c10').textContent ?? '').toContain('₫')
      expect(screen.getByTestId('recommended-c10').textContent ?? '').not.toMatch(/Miễn phí/i)
    })
  })

  describe('pending order row', () => {
    beforeEach(() => {
      mockListMyOrders.mockImplementation(async (_client, opts) => {
        if (opts?.status === 'pending') return { orders: [basePendingOrder], total: 1, error: null }
        return { orders: [], total: 0, error: null }
      })
    })

    it('shows a pending-payment row in My-courses with course title', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('pending-order-ord-p1')).toBeInTheDocument()
      })
      expect(screen.getByTestId('pending-order-ord-p1').textContent ?? '').toMatch(/Sicilian Dragon/i)
    })

    it('shows "Đang chờ xác nhận" status text in the pending row', async () => {
      renderPage()
      await waitFor(() => expect(screen.getByTestId('pending-order-ord-p1')).toBeInTheDocument())
      expect(screen.getByTestId('pending-order-ord-p1').textContent ?? '').toMatch(/Đang chờ|chờ xác nhận/i)
    })

    it('renders a checkout link for the pending order and no Resume button', async () => {
      renderPage()
      await waitFor(() => expect(screen.getByTestId('pending-pay-btn-ord-p1')).toBeInTheDocument())
      expect(screen.getByTestId('pending-pay-btn-ord-p1')).toHaveAttribute('href', '/checkout/ord-p1')
      expect(screen.queryByTestId('resume-ord-p1')).not.toBeInTheDocument()
    })

    it('does not show the empty state when only pending orders exist', async () => {
      mockGetEnrolledCoursesProgress.mockResolvedValue({ courses: [], error: null })
      renderPage()
      await waitFor(() => expect(screen.getByTestId('pending-order-ord-p1')).toBeInTheDocument())
      expect(screen.queryByTestId('my-courses-empty')).not.toBeInTheDocument()
    })
  })

  describe('cancelled order row', () => {
    beforeEach(() => {
      mockListMyOrders.mockImplementation(async (_client, opts) => {
        if (opts?.status === 'cancelled') return { orders: [baseCancelledOrder], total: 1, error: null }
        return { orders: [], total: 0, error: null }
      })
    })

    it('shows a cancelled-order row in My-courses with course title', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('cancelled-order-ord-c1')).toBeInTheDocument()
      })
      expect(screen.getByTestId('cancelled-order-ord-c1').textContent ?? '').toMatch(/Sicilian Dragon/i)
    })

    it('renders a reason-reveal button that toggles the cancellation reason', async () => {
      const user = userEvent.setup()
      renderPage()
      await waitFor(() => expect(screen.getByTestId('cancelled-reveal-btn-ord-c1')).toBeInTheDocument())
      // Reason not visible before clicking
      expect(screen.queryByTestId('cancelled-reason-ord-c1')).not.toBeInTheDocument()
      await user.click(screen.getByTestId('cancelled-reveal-btn-ord-c1'))
      await waitFor(() => {
        expect(screen.getByTestId('cancelled-reason-ord-c1')).toBeInTheDocument()
      })
      expect(screen.getByTestId('cancelled-reason-ord-c1').textContent ?? '').toMatch(/Chuyển khoản sai nội dung/i)
    })
  })
})
