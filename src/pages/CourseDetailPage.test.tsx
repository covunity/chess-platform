import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, describe, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import CourseDetailPage from './CourseDetailPage'
import * as coursesApi from '../lib/coursesApi'
import type { CourseDetail } from '../lib/coursesApi'
import { AuthContext } from '../context/AuthContext'
import type { AuthContextValue } from '../context/AuthContext'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
}))

const mockGetCourseDetail = vi.spyOn(coursesApi, 'getCourseDetail')
const mockCheckUserEnrollment = vi.spyOn(coursesApi, 'checkUserEnrollment')

const sampleCourse: CourseDetail = {
  id: 'c1',
  title: 'The Italian Game, Refuted',
  description: 'Master the Italian Game opening from both sides.',
  thumbnail_url: null,
  price: 480000,
  original_price: 720000,
  promo_ends_at: null,
  level: 'intermediate',
  language: 'vi',
  tags: ['openings'],
  creator_id: 'u1',
  creator_name: 'GM Anh Lê',
  creator_bio: 'Vietnamese Champion 2022 · 9 courses',
  rating_avg: 4.8,
  rating_count: 312,
  lessons_count: 42,
  hours_total: 8.5,
  enrollment_count: 2140,
  created_at: '2026-01-01T00:00:00Z',
  what_you_learn: ['Understand the Italian Game', 'Counter with black'],
  prerequisites: 'Basic chess knowledge',
  free_preview_count: 3,
  pgn_annotations_count: 96,
  puzzle_count: 18,
  chapters: [
    {
      id: 'ch1',
      title: 'Introduction',
      position: 0,
      lessons: [
        { id: 'l1', title: 'Welcome', type: 'video', position: 0, free_preview: true, duration_seconds: 504 },
        { id: 'l2', title: 'The Opening Theory', type: 'chess', position: 1, free_preview: false, duration_seconds: 900 },
      ],
    },
    {
      id: 'ch2',
      title: 'Advanced Lines',
      position: 1,
      lessons: [
        { id: 'l3', title: 'Advanced Tactics', type: 'chess', position: 0, free_preview: false, duration_seconds: 720 },
      ],
    },
  ],
  reviews: [
    {
      id: 'r1',
      reviewer_name: 'Học viên A',
      rating: 5,
      title: 'Rất tuyệt vời!',
      body: 'Khóa học giải thích rõ ràng và chi tiết.',
      created_at: '2026-03-01T00:00:00Z',
    },
  ],
}

const noAuthContext: AuthContextValue = {
  user: null,
  loading: false,
  profile: null,
  profileLoading: false,
  signUp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  resetPassword: vi.fn(),
  updatePassword: vi.fn(),
}

const loggedInContext: AuthContextValue = {
  ...noAuthContext,
  user: { id: 'u99', email: 'test@example.com' } as AuthContextValue['user'],
  profile: {
    id: 'u99',
    email: 'test@example.com',
    name: 'Test User',
    avatar_url: null,
    role: 'learner',
    created_at: '2026-01-01T00:00:00Z',
  },
}

function renderPage(auth = noAuthContext) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/courses/c1']}>
        <I18nextProvider i18n={i18n}>
          <Routes>
            <Route path="/courses/:courseId" element={<CourseDetailPage />} />
          </Routes>
        </I18nextProvider>
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

describe('CourseDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckUserEnrollment.mockResolvedValue(false)
  })

  describe('loading state', () => {
    it('shows loading skeleton while fetching', () => {
      mockGetCourseDetail.mockReturnValue(new Promise(() => {}))
      renderPage()
      expect(screen.getByTestId('course-detail-skeleton')).toBeInTheDocument()
    })
  })

  describe('not found', () => {
    it('shows not-found message when course is null', async () => {
      mockGetCourseDetail.mockResolvedValue({ course: null, error: new Error('not found') })
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('course-not-found')).toBeInTheDocument()
      })
    })
  })

  describe('hero section', () => {
    beforeEach(() => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
    })

    it('renders course title as h1', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: /italian game/i })).toBeInTheDocument()
      })
    })

    it('renders course description', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByText(/master the italian game/i)).toBeInTheDocument()
      })
    })

    it('renders creator name', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByText(/GM Anh Lê/)).toBeInTheDocument()
      })
    })

    it('renders rating value', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('hero-rating')).toBeInTheDocument()
      })
    })

    it('renders lessons stat', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('stat-lessons')).toBeInTheDocument()
      })
    })

    it('renders enrollment count', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('hero-enrollment')).toBeInTheDocument()
      })
    })
  })

  describe('buy card', () => {
    it('shows "Mua khóa học" CTA for paid course visitor', async () => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      renderPage(noAuthContext)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /mua khóa học/i })).toBeInTheDocument()
      })
    })

    it('shows "Đăng ký miễn phí" CTA for free course', async () => {
      mockGetCourseDetail.mockResolvedValue({ course: { ...sampleCourse, price: 0 }, error: null })
      renderPage(noAuthContext)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /đăng ký miễn phí/i })).toBeInTheDocument()
      })
    })

    it('shows "Tiếp tục học" CTA when user is enrolled', async () => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      mockCheckUserEnrollment.mockResolvedValue(true)
      renderPage(loggedInContext)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /tiếp tục học/i })).toBeInTheDocument()
      })
    })

    it('renders price in buy card', async () => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('buy-card-price')).toBeInTheDocument()
      })
    })

    it('renders strikethrough original price when present', async () => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('buy-card-original-price')).toBeInTheDocument()
      })
    })

    it('renders add-to-wishlist button', async () => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      renderPage()
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /thêm vào danh sách/i })).toBeInTheDocument()
      })
    })
  })

  describe('curriculum accordion', () => {
    beforeEach(() => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
    })

    it('renders all chapter titles', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByText(/introduction/i)).toBeInTheDocument()
        expect(screen.getByText(/advanced lines/i)).toBeInTheDocument()
      })
    })

    it('first chapter is expanded by default (its lessons visible)', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByText('Welcome')).toBeInTheDocument()
        expect(screen.getByText('The Opening Theory')).toBeInTheDocument()
      })
    })

    it('second chapter is collapsed by default (its lessons hidden)', async () => {
      renderPage()
      await waitFor(() => screen.getByText(/advanced lines/i))
      expect(screen.queryByText('Advanced Tactics')).not.toBeInTheDocument()
    })

    it('clicking a collapsed chapter header expands it', async () => {
      const user = userEvent.setup()
      renderPage()
      await waitFor(() => screen.getByText(/advanced lines/i))
      await user.click(screen.getByTestId('chapter-header-ch2'))
      await waitFor(() => {
        expect(screen.getByText('Advanced Tactics')).toBeInTheDocument()
      })
    })

    it('clicking an expanded chapter header collapses it', async () => {
      const user = userEvent.setup()
      renderPage()
      await waitFor(() => screen.getByText('Welcome'))
      await user.click(screen.getByTestId('chapter-header-ch1'))
      await waitFor(() => {
        expect(screen.queryByText('Welcome')).not.toBeInTheDocument()
      })
    })

    it('shows free-preview pill on free preview lessons', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('free-preview-pill-l1')).toBeInTheDocument()
      })
    })

    it('does not show free-preview pill on non-preview lessons', async () => {
      renderPage()
      await waitFor(() => screen.getByText('The Opening Theory'))
      expect(screen.queryByTestId('free-preview-pill-l2')).not.toBeInTheDocument()
    })

    it('shows lock icon on non-preview lessons for unauthenticated users', async () => {
      renderPage(noAuthContext)
      await waitFor(() => {
        expect(screen.getByTestId('lock-icon-l2')).toBeInTheDocument()
      })
    })
  })

  describe('ratings histogram', () => {
    it('renders the average rating display', async () => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('rating-avg-display')).toBeInTheDocument()
      })
    })

    it('shows the rating count', async () => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('rating-count-display')).toBeInTheDocument()
      })
    })
  })

  describe('reviews list', () => {
    it('renders review title', async () => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      renderPage()
      await waitFor(() => {
        expect(screen.getByText('Rất tuyệt vời!')).toBeInTheDocument()
      })
    })

    it('renders reviewer name', async () => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      renderPage()
      await waitFor(() => {
        expect(screen.getByText('Học viên A')).toBeInTheDocument()
      })
    })
  })

  describe('what you learn sidebar', () => {
    it('renders "what you learn" section', async () => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      renderPage()
      await waitFor(() => {
        expect(screen.getByText('Understand the Italian Game')).toBeInTheDocument()
      })
    })
  })

  describe('free preview interaction', () => {
    it('clicking free-preview pill opens preview modal', async () => {
      const user = userEvent.setup()
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      renderPage(noAuthContext)
      await waitFor(() => screen.getByTestId('free-preview-pill-l1'))
      await user.click(screen.getByTestId('free-preview-pill-l1'))
      await waitFor(() => {
        expect(screen.getByTestId('preview-modal')).toBeInTheDocument()
      })
    })

    it('preview modal can be closed', async () => {
      const user = userEvent.setup()
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      renderPage(noAuthContext)
      await waitFor(() => screen.getByTestId('free-preview-pill-l1'))
      await user.click(screen.getByTestId('free-preview-pill-l1'))
      await waitFor(() => screen.getByTestId('preview-modal'))
      await user.click(screen.getByTestId('close-preview-modal'))
      await waitFor(() => {
        expect(screen.queryByTestId('preview-modal')).not.toBeInTheDocument()
      })
    })

    it('clicking a lock icon shows lock prompt', async () => {
      const user = userEvent.setup()
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      renderPage(noAuthContext)
      await waitFor(() => screen.getByTestId('lock-icon-l2'))
      await user.click(screen.getByTestId('lock-icon-l2'))
      await waitFor(() => {
        expect(screen.getByTestId('lock-prompt')).toBeInTheDocument()
      })
    })

    it('lock prompt can be closed', async () => {
      const user = userEvent.setup()
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      renderPage(noAuthContext)
      await waitFor(() => screen.getByTestId('lock-icon-l2'))
      await user.click(screen.getByTestId('lock-icon-l2'))
      await waitFor(() => screen.getByTestId('lock-prompt'))
      await user.click(screen.getByTestId('close-lock-prompt'))
      await waitFor(() => {
        expect(screen.queryByTestId('lock-prompt')).not.toBeInTheDocument()
      })
    })
  })
})
