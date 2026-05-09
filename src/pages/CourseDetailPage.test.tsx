import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, describe, it } from 'vitest'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import CourseDetailPage from './CourseDetailPage'
import * as coursesApi from '../lib/coursesApi'
import * as enrollmentApi from '../lib/enrollmentApi'
import * as reviewsApi from '../lib/reviewsApi'
import * as commentsApi from '../lib/commentsApi'
import * as orderApi from '../lib/orderApi'
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

const mockGetUserReview = vi.spyOn(reviewsApi, 'getUserReview')
const mockSubmitReview = vi.spyOn(reviewsApi, 'submitReview')
const mockListComments = vi.spyOn(commentsApi, 'listComments')
const mockCreateComment = vi.spyOn(commentsApi, 'createComment')
const mockReportComment = vi.spyOn(commentsApi, 'reportComment')
const mockUpdateComment = vi.spyOn(commentsApi, 'updateComment')
const mockDeleteComment = vi.spyOn(commentsApi, 'deleteComment')

const mockGetCourseDetail = vi.spyOn(coursesApi, 'getCourseDetail')
const mockListReviews = vi.spyOn(coursesApi, 'listReviews')
const mockCheckUserEnrollment = vi.spyOn(coursesApi, 'checkUserEnrollment')
const mockEnrollForFree = vi.spyOn(enrollmentApi, 'enrollForFree')
const mockGetFirstLesson = vi.spyOn(enrollmentApi, 'getFirstLesson')
const mockCreateOrder = vi.spyOn(orderApi, 'createOrder')
const mockGetPendingOrderForCourse = vi.spyOn(orderApi, 'getPendingOrderForCourse')

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

function CheckoutStub() {
  const { orderId } = useParams<{ orderId: string }>()
  return <div data-testid={`checkout-page-${orderId}`} />
}

function renderPage(auth = noAuthContext) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/courses/c1']}>
        <I18nextProvider i18n={i18n}>
          <Routes>
            <Route path="/courses/:courseId" element={<CourseDetailPage />} />
            <Route path="/learn/:courseId/:lessonId" element={<div data-testid="lesson-player-page" />} />
            <Route path="/signup" element={<div data-testid="signup-page" />} />
            <Route path="/login" element={<div data-testid="login-page" />} />
            <Route path="/checkout/:orderId" element={<CheckoutStub />} />
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
    mockEnrollForFree.mockResolvedValue({ enrollmentId: 'e1', orderId: 'o1', error: null })
    mockGetFirstLesson.mockResolvedValue({ lessonId: 'l1', error: null })
    mockGetUserReview.mockResolvedValue({ review: null, error: null })
    mockListComments.mockResolvedValue({ comments: [], total: 0, error: null })
    mockSubmitReview.mockResolvedValue({ review: null, error: null })
    mockCreateComment.mockResolvedValue({ comment: null, error: null })
    mockReportComment.mockResolvedValue({ error: null })
    mockCreateOrder.mockResolvedValue({ order: null, error: null })
    mockGetPendingOrderForCourse.mockResolvedValue({ order: null, error: null })
    mockListReviews.mockResolvedValue({ reviews: [], total: 0, error: null })
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

  describe('write review block', () => {
    it('shows write-review block for enrolled learner who has not reviewed', async () => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      mockCheckUserEnrollment.mockResolvedValue(true)
      mockGetUserReview.mockResolvedValue({ review: null, error: null })
      renderPage(loggedInContext)
      await waitFor(() => {
        expect(screen.getByTestId('write-review-block')).toBeInTheDocument()
      })
    })

    it('hides write-review block for non-enrolled user', async () => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      mockCheckUserEnrollment.mockResolvedValue(false)
      renderPage(loggedInContext)
      await waitFor(() => screen.getByRole('heading', { level: 1, name: /italian game/i }))
      expect(screen.queryByTestId('write-review-block')).not.toBeInTheDocument()
    })

    it('hides write-review block for unauthenticated visitor', async () => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      renderPage(noAuthContext)
      await waitFor(() => screen.getByRole('heading', { level: 1, name: /italian game/i }))
      expect(screen.queryByTestId('write-review-block')).not.toBeInTheDocument()
    })

    it('shows "Edit your review" link when user already has a review', async () => {
      const existingReview = {
        id: 'r-own',
        course_id: 'c1',
        reviewer_id: 'u99',
        rating: 4,
        title: 'Good',
        body: 'Nice',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      mockCheckUserEnrollment.mockResolvedValue(true)
      mockGetUserReview.mockResolvedValue({ review: existingReview, error: null })
      renderPage(loggedInContext)
      await waitFor(() => {
        expect(screen.getByTestId('edit-review-link')).toBeInTheDocument()
      })
    })

    it('clicking a star sets rating and enables submit button', async () => {
      const user = userEvent.setup()
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      mockCheckUserEnrollment.mockResolvedValue(true)
      renderPage(loggedInContext)
      await waitFor(() => screen.getByTestId('write-review-block'))
      await user.click(screen.getByTestId('star-input-5'))
      expect(screen.getByTestId('submit-review-btn')).not.toBeDisabled()
    })

    it('submit button is disabled when no star selected', async () => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      mockCheckUserEnrollment.mockResolvedValue(true)
      renderPage(loggedInContext)
      await waitFor(() => screen.getByTestId('write-review-block'))
      expect(screen.getByTestId('submit-review-btn')).toBeDisabled()
    })

    it('submitting review calls submitReview with correct args', async () => {
      const user = userEvent.setup()
      const savedReview = {
        id: 'r-new',
        course_id: 'c1',
        reviewer_id: 'u99',
        rating: 5,
        title: '',
        body: '',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      mockCheckUserEnrollment.mockResolvedValue(true)
      mockSubmitReview.mockResolvedValue({ review: savedReview, error: null })
      renderPage(loggedInContext)
      await waitFor(() => screen.getByTestId('write-review-block'))
      await user.click(screen.getByTestId('star-input-5'))
      await user.click(screen.getByTestId('submit-review-btn'))
      await waitFor(() => {
        expect(mockSubmitReview).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ courseId: 'c1', reviewerId: 'u99', rating: 5 })
        )
      })
    })

    it('shows thank-you state after successful submission', async () => {
      const user = userEvent.setup()
      const savedReview = {
        id: 'r-new',
        course_id: 'c1',
        reviewer_id: 'u99',
        rating: 5,
        title: null,
        body: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      mockCheckUserEnrollment.mockResolvedValue(true)
      mockSubmitReview.mockResolvedValue({ review: savedReview, error: null })
      renderPage(loggedInContext)
      await waitFor(() => screen.getByTestId('write-review-block'))
      await user.click(screen.getByTestId('star-input-5'))
      await user.click(screen.getByTestId('submit-review-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('review-submitted-thanks')).toBeInTheDocument()
      })
    })
  })

  describe('comments section', () => {
    it('renders the comments section heading', async () => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      renderPage(noAuthContext)
      await waitFor(() => {
        expect(screen.getByTestId('comments-section')).toBeInTheDocument()
      })
    })

    it('shows comment composer for enrolled learner', async () => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      mockCheckUserEnrollment.mockResolvedValue(true)
      renderPage(loggedInContext)
      await waitFor(() => {
        expect(screen.getByTestId('comment-composer')).toBeInTheDocument()
      })
    })

    it('hides comment composer for non-enrolled user, shows enroll prompt', async () => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      mockCheckUserEnrollment.mockResolvedValue(false)
      renderPage(loggedInContext)
      await waitFor(() => screen.getByTestId('comments-section'))
      expect(screen.queryByTestId('comment-composer')).not.toBeInTheDocument()
      expect(screen.getByTestId('comments-enroll-prompt')).toBeInTheDocument()
    })

    it('renders loaded comments in the list', async () => {
      const sampleCommentRow = {
        id: 'cmt-1',
        course_id: 'c1',
        author_id: 'u2',
        body: 'Khóa học rất hay!',
        is_hidden: false,
        created_at: '2026-01-10T00:00:00Z',
        updated_at: '2026-01-10T00:00:00Z',
        author: { name: 'Người dùng B' },
      }
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      mockListComments.mockResolvedValue({ comments: [sampleCommentRow], total: 1, error: null })
      renderPage(noAuthContext)
      await waitFor(() => {
        expect(screen.getByText('Khóa học rất hay!')).toBeInTheDocument()
        expect(screen.getByText('Người dùng B')).toBeInTheDocument()
      })
    })

    it('shows placeholder for hidden comments', async () => {
      const hiddenComment = {
        id: 'cmt-2',
        course_id: 'c1',
        author_id: 'u3',
        body: 'Bad content',
        is_hidden: true,
        created_at: '2026-01-11T00:00:00Z',
        updated_at: '2026-01-11T00:00:00Z',
        author: { name: 'User C' },
      }
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      mockListComments.mockResolvedValue({ comments: [hiddenComment], total: 1, error: null })
      renderPage(noAuthContext)
      await waitFor(() => {
        expect(screen.getByTestId('comment-hidden-placeholder-cmt-2')).toBeInTheDocument()
      })
    })

    it('posting a comment calls createComment and adds it to the list', async () => {
      const user = userEvent.setup()
      const newComment = {
        id: 'cmt-new',
        course_id: 'c1',
        author_id: 'u99',
        body: 'Tuyệt vời!',
        is_hidden: false,
        created_at: '2026-01-20T00:00:00Z',
        updated_at: '2026-01-20T00:00:00Z',
        author: { name: 'Test User' },
      }
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      mockCheckUserEnrollment.mockResolvedValue(true)
      mockCreateComment.mockResolvedValue({ comment: newComment, error: null })
      renderPage(loggedInContext)
      await waitFor(() => screen.getByTestId('comment-composer'))
      await user.type(screen.getByTestId('comment-textarea'), 'Tuyệt vời!')
      await user.click(screen.getByTestId('post-comment-btn'))
      await waitFor(() => {
        expect(mockCreateComment).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ courseId: 'c1', authorId: 'u99', body: 'Tuyệt vời!' })
        )
      })
    })

    it('shows report dialog when Report is clicked on a comment', async () => {
      const user = userEvent.setup()
      const commentRow = {
        id: 'cmt-3',
        course_id: 'c1',
        author_id: 'u2',
        body: 'Test comment',
        is_hidden: false,
        created_at: '2026-01-10T00:00:00Z',
        updated_at: '2026-01-10T00:00:00Z',
        author: { name: 'User D' },
      }
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      mockCheckUserEnrollment.mockResolvedValue(true)
      mockListComments.mockResolvedValue({ comments: [commentRow], total: 1, error: null })
      renderPage(loggedInContext)
      await waitFor(() => screen.getByText('Test comment'))
      await user.click(screen.getByTestId('comment-kebab-cmt-3'))
      await waitFor(() => screen.getByTestId('kebab-menu-cmt-3'))
      await user.click(screen.getByTestId('report-btn-cmt-3'))
      await waitFor(() => {
        expect(screen.getByTestId('report-dialog')).toBeInTheDocument()
      })
    })
  })

  describe('free course enrollment flow', () => {
    it('clicking "Đăng ký miễn phí" while logged in calls enrollForFree and navigates to player', async () => {
      const user = userEvent.setup()
      mockGetCourseDetail.mockResolvedValue({ course: { ...sampleCourse, price: 0 }, error: null })
      renderPage(loggedInContext)
      await waitFor(() => screen.getByRole('button', { name: /đăng ký miễn phí/i }))
      await user.click(screen.getByRole('button', { name: /đăng ký miễn phí/i }))
      await waitFor(() => {
        expect(mockEnrollForFree).toHaveBeenCalledWith(
          expect.anything(),
          'c1',
          'u99'
        )
      })
      await waitFor(() => {
        expect(screen.getByTestId('lesson-player-page')).toBeInTheDocument()
      })
    })

    it('clicking "Đăng ký miễn phí" when not logged in redirects to signup with redirect param', async () => {
      const user = userEvent.setup()
      mockGetCourseDetail.mockResolvedValue({ course: { ...sampleCourse, price: 0 }, error: null })
      renderPage(noAuthContext)
      await waitFor(() => screen.getByRole('button', { name: /đăng ký miễn phí/i }))
      await user.click(screen.getByRole('button', { name: /đăng ký miễn phí/i }))
      await waitFor(() => {
        expect(screen.getByTestId('signup-page')).toBeInTheDocument()
      })
    })

    it('shows loading state on CTA button while enrolling', async () => {
      const user = userEvent.setup()
      mockGetCourseDetail.mockResolvedValue({ course: { ...sampleCourse, price: 0 }, error: null })
      mockEnrollForFree.mockImplementation(() => new Promise(() => {}))
      renderPage(loggedInContext)
      await waitFor(() => screen.getByRole('button', { name: /đăng ký miễn phí/i }))
      await user.click(screen.getByRole('button', { name: /đăng ký miễn phí/i }))
      await waitFor(() => {
        expect(screen.getByTestId('cta-loading')).toBeInTheDocument()
      })
    })
  })

  describe('paid course buy flow', () => {
    beforeEach(() => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
    })

    it('clicking "Mua khoá học" when not logged in redirects to /login', async () => {
      const user = userEvent.setup()
      renderPage(noAuthContext)
      await waitFor(() => screen.getByRole('button', { name: /mua khóa học/i }))
      await user.click(screen.getByRole('button', { name: /mua khóa học/i }))
      await waitFor(() => {
        expect(screen.getByTestId('login-page')).toBeInTheDocument()
      })
    })

    it('clicking "Mua khoá học" when logged in calls createOrder and navigates to checkout', async () => {
      const user = userEvent.setup()
      mockCreateOrder.mockResolvedValue({
        order: {
          id: 'ord-99', course_id: 'c1', user_id: 'u99', status: 'pending',
          amount: 480000, code: 'ORD-2026-000099',
        } as never,
        error: null,
      })
      renderPage(loggedInContext)
      await waitFor(() => screen.getByRole('button', { name: /mua khóa học/i }))
      await user.click(screen.getByRole('button', { name: /mua khóa học/i }))
      await waitFor(() => {
        expect(mockCreateOrder).toHaveBeenCalledWith(expect.anything(), 'c1')
        expect(screen.getByTestId('checkout-page-ord-99')).toBeInTheDocument()
      })
    })

    it('handles duplicate_pending_order error by navigating to the existing order checkout', async () => {
      const user = userEvent.setup()
      mockCreateOrder.mockResolvedValue({
        order: null,
        error: { message: 'duplicate_pending_order:ord-existing', code: 'P0001' },
      })
      renderPage(loggedInContext)
      await waitFor(() => screen.getByRole('button', { name: /mua khóa học/i }))
      await user.click(screen.getByRole('button', { name: /mua khóa học/i }))
      await waitFor(() => {
        expect(mockCreateOrder).toHaveBeenCalledTimes(1)
        expect(screen.getByTestId('checkout-page-ord-existing')).toBeInTheDocument()
      })
    })

    it('shows pending order banner when user has pending order', async () => {
      mockGetPendingOrderForCourse.mockResolvedValue({
        order: { id: 'ord-p', code: 'ORD-2026-000001', status: 'pending', amount: 480000 } as never,
        error: null,
      })
      renderPage(loggedInContext)
      await waitFor(() => {
        expect(screen.getByTestId('pending-order-banner')).toBeInTheDocument()
      })
    })

    it('shows "Tiếp tục thanh toán" CTA when user has pending order', async () => {
      mockGetPendingOrderForCourse.mockResolvedValue({
        order: { id: 'ord-p', code: 'ORD-2026-000001', status: 'pending', amount: 480000 } as never,
        error: null,
      })
      renderPage(loggedInContext)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /tiếp tục thanh toán/i })).toBeInTheDocument()
      })
    })

    it('clicking "Tiếp tục thanh toán" navigates to existing pending order checkout', async () => {
      const user = userEvent.setup()
      mockGetPendingOrderForCourse.mockResolvedValue({
        order: { id: 'ord-p', code: 'ORD-2026-000001', status: 'pending', amount: 480000 } as never,
        error: null,
      })
      renderPage(loggedInContext)
      await waitFor(() => screen.getByRole('button', { name: /tiếp tục thanh toán/i }))
      await user.click(screen.getByRole('button', { name: /tiếp tục thanh toán/i }))
      await waitFor(() => {
        expect(screen.getByTestId('checkout-page-ord-p')).toBeInTheDocument()
      })
    })
  })

  describe('paywall banner', () => {
    function renderWithPaywall(auth = loggedInContext) {
      return render(
        <AuthContext.Provider value={auth}>
          <MemoryRouter initialEntries={['/courses/c1?paywall=true']}>
            <I18nextProvider i18n={i18n}>
              <Routes>
                <Route path="/courses/:courseId" element={<CourseDetailPage />} />
                <Route path="/learn/:courseId/:lessonId" element={<div data-testid="lesson-player-page" />} />
                <Route path="/login" element={<div data-testid="login-page" />} />
                <Route path="/checkout/:orderId" element={<CheckoutStub />} />
              </Routes>
            </I18nextProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      )
    }

    it('shows paywall banner when ?paywall=true is in the URL', async () => {
      renderWithPaywall()
      await waitFor(() => {
        expect(screen.getByTestId('paywall-banner')).toBeInTheDocument()
      })
    })

    it('does NOT show paywall banner when query param is absent', async () => {
      renderPage(loggedInContext)
      await waitFor(() => expect(screen.getByTestId('course-hero')).toBeInTheDocument())
      expect(screen.queryByTestId('paywall-banner')).not.toBeInTheDocument()
    })
  })

  describe('reviews pagination', () => {
    function makeReviews(count: number) {
      return Array.from({ length: count }, (_, i) => ({
        id: `rv-${i}`,
        reviewer_name: `Reviewer ${i}`,
        rating: 5,
        title: `Review title ${i}`,
        body: `Review body ${i}`,
        created_at: '2026-03-01T00:00:00Z',
      }))
    }

    it('renders first 10 reviews and shows Load-more when more exist', async () => {
      const twelveReviews = makeReviews(12)
      mockGetCourseDetail.mockResolvedValue({
        course: { ...sampleCourse, reviews: twelveReviews, rating_count: 12 },
        error: null,
      })
      renderPage()
      await waitFor(() => screen.getByText('Review body 0'))
      // First 10 shown
      expect(screen.getByText('Review body 9')).toBeInTheDocument()
      expect(screen.queryByText('Review body 10')).not.toBeInTheDocument()
      // Load more button present
      expect(screen.getByTestId('reviews-load-more')).toBeInTheDocument()
    })

    it('hides Load-more when all reviews fit in first page', async () => {
      mockGetCourseDetail.mockResolvedValue({
        course: { ...sampleCourse, reviews: makeReviews(5), rating_count: 5 },
        error: null,
      })
      renderPage()
      await waitFor(() => screen.getByText('Review body 0'))
      expect(screen.queryByTestId('reviews-load-more')).not.toBeInTheDocument()
    })

    it('clicking Load-more calls listReviews and appends results', async () => {
      const user = userEvent.setup()
      const twelveReviews = makeReviews(12)
      const page2Reviews = makeReviews(2).map((r, i) => ({ ...r, id: `rv-p2-${i}`, body: `Page2 body ${i}` }))
      mockGetCourseDetail.mockResolvedValue({
        course: { ...sampleCourse, reviews: twelveReviews, rating_count: 12 },
        error: null,
      })
      mockListReviews.mockResolvedValue({ reviews: page2Reviews, total: 12, error: null })
      renderPage()
      await waitFor(() => screen.getByTestId('reviews-load-more'))
      await user.click(screen.getByTestId('reviews-load-more'))
      await waitFor(() => {
        expect(mockListReviews).toHaveBeenCalledWith(expect.anything(), 'c1', 2, 10)
        expect(screen.getByText('Page2 body 0')).toBeInTheDocument()
        expect(screen.getByText('Page2 body 1')).toBeInTheDocument()
      })
    })

    it('hides Load-more after all reviews are loaded', async () => {
      const user = userEvent.setup()
      const twelveReviews = makeReviews(12)
      const page2Reviews = makeReviews(2).map((r, i) => ({ ...r, id: `rv-p2-${i}`, body: `Page2 body ${i}` }))
      mockGetCourseDetail.mockResolvedValue({
        course: { ...sampleCourse, reviews: twelveReviews, rating_count: 12 },
        error: null,
      })
      mockListReviews.mockResolvedValue({ reviews: page2Reviews, total: 12, error: null })
      renderPage()
      await waitFor(() => screen.getByTestId('reviews-load-more'))
      await user.click(screen.getByTestId('reviews-load-more'))
      await waitFor(() => {
        expect(screen.queryByTestId('reviews-load-more')).not.toBeInTheDocument()
      })
    })

    it('histogram uses all reviews regardless of display page', async () => {
      const twelveReviews = makeReviews(12)
      mockGetCourseDetail.mockResolvedValue({
        course: { ...sampleCourse, reviews: twelveReviews, rating_count: 12, rating_avg: 5 },
        error: null,
      })
      renderPage()
      await waitFor(() => screen.getByText('Review body 0'))
      // rating_count shown in histogram — all 12 reflected in rating-count-display
      expect(screen.getByTestId('rating-count-display').textContent).toMatch(/12/)
    })
  })

  describe('comment edit and delete', () => {
    const ownComment = {
      id: 'cmt-own',
      course_id: 'c1',
      author_id: 'u99',
      body: 'My original comment',
      is_hidden: false,
      created_at: '2026-01-10T00:00:00Z',
      updated_at: '2026-01-10T00:00:00Z',
      author: { name: 'Test User' },
    }

    beforeEach(() => {
      mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
      mockCheckUserEnrollment.mockResolvedValue(true)
      mockListComments.mockResolvedValue({ comments: [ownComment], total: 1, error: null })
    })

    it('owner sees Edit and Delete buttons in kebab menu', async () => {
      const user = userEvent.setup()
      renderPage(loggedInContext)
      await waitFor(() => screen.getByText('My original comment'))
      await user.click(screen.getByTestId('comment-kebab-cmt-own'))
      await waitFor(() => screen.getByTestId('edit-btn-cmt-own'))
      expect(screen.getByTestId('edit-btn-cmt-own')).toBeInTheDocument()
      expect(screen.getByTestId('delete-btn-cmt-own')).toBeInTheDocument()
    })

    it('click Edit shows inline textarea pre-filled with comment body', async () => {
      const user = userEvent.setup()
      renderPage(loggedInContext)
      await waitFor(() => screen.getByText('My original comment'))
      await user.click(screen.getByTestId('comment-kebab-cmt-own'))
      await user.click(screen.getByTestId('edit-btn-cmt-own'))
      await waitFor(() => {
        const textarea = screen.getByTestId('edit-textarea-cmt-own') as HTMLTextAreaElement
        expect(textarea).toBeInTheDocument()
        expect(textarea.value).toBe('My original comment')
      })
    })

    it('saving edit calls updateComment and updates comment in list', async () => {
      const user = userEvent.setup()
      const updated = { ...ownComment, body: 'Updated body', updated_at: '2026-01-11T00:00:00Z' }
      mockUpdateComment.mockResolvedValue({ comment: updated, error: null })
      renderPage(loggedInContext)
      await waitFor(() => screen.getByText('My original comment'))
      await user.click(screen.getByTestId('comment-kebab-cmt-own'))
      await user.click(screen.getByTestId('edit-btn-cmt-own'))
      await waitFor(() => screen.getByTestId('edit-textarea-cmt-own'))
      await user.clear(screen.getByTestId('edit-textarea-cmt-own'))
      await user.type(screen.getByTestId('edit-textarea-cmt-own'), 'Updated body')
      await user.click(screen.getByTestId('save-edit-btn-cmt-own'))
      await waitFor(() => {
        expect(mockUpdateComment).toHaveBeenCalledWith(
          expect.anything(), 'cmt-own', 'u99', 'Updated body'
        )
        expect(screen.getByText('Updated body')).toBeInTheDocument()
      })
    })

    it('cancel edit hides inline form and keeps original body', async () => {
      const user = userEvent.setup()
      renderPage(loggedInContext)
      await waitFor(() => screen.getByText('My original comment'))
      await user.click(screen.getByTestId('comment-kebab-cmt-own'))
      await user.click(screen.getByTestId('edit-btn-cmt-own'))
      await waitFor(() => screen.getByTestId('edit-textarea-cmt-own'))
      await user.click(screen.getByTestId('cancel-edit-btn-cmt-own'))
      await waitFor(() => {
        expect(screen.queryByTestId('edit-textarea-cmt-own')).not.toBeInTheDocument()
        expect(screen.getByText('My original comment')).toBeInTheDocument()
      })
    })

    it('edit textarea enforces 2000-char maxLength', async () => {
      const user = userEvent.setup()
      renderPage(loggedInContext)
      await waitFor(() => screen.getByText('My original comment'))
      await user.click(screen.getByTestId('comment-kebab-cmt-own'))
      await user.click(screen.getByTestId('edit-btn-cmt-own'))
      await waitFor(() => screen.getByTestId('edit-textarea-cmt-own'))
      const textarea = screen.getByTestId('edit-textarea-cmt-own') as HTMLTextAreaElement
      expect(textarea.maxLength).toBe(2000)
    })

    it('click Delete shows confirm dialog', async () => {
      const user = userEvent.setup()
      renderPage(loggedInContext)
      await waitFor(() => screen.getByText('My original comment'))
      await user.click(screen.getByTestId('comment-kebab-cmt-own'))
      await user.click(screen.getByTestId('delete-btn-cmt-own'))
      await waitFor(() => {
        expect(screen.getByTestId('delete-confirm-dialog-cmt-own')).toBeInTheDocument()
      })
    })

    it('confirming delete calls deleteComment and removes comment', async () => {
      const user = userEvent.setup()
      mockDeleteComment.mockResolvedValue({ error: null })
      renderPage(loggedInContext)
      await waitFor(() => screen.getByText('My original comment'))
      await user.click(screen.getByTestId('comment-kebab-cmt-own'))
      await user.click(screen.getByTestId('delete-btn-cmt-own'))
      await waitFor(() => screen.getByTestId('delete-confirm-dialog-cmt-own'))
      await user.click(screen.getByTestId('confirm-delete-btn-cmt-own'))
      await waitFor(() => {
        expect(mockDeleteComment).toHaveBeenCalledWith(expect.anything(), 'cmt-own', 'u99')
        expect(screen.queryByText('My original comment')).not.toBeInTheDocument()
      })
    })

    it('cancelling delete dialog keeps comment in list', async () => {
      const user = userEvent.setup()
      renderPage(loggedInContext)
      await waitFor(() => screen.getByText('My original comment'))
      await user.click(screen.getByTestId('comment-kebab-cmt-own'))
      await user.click(screen.getByTestId('delete-btn-cmt-own'))
      await waitFor(() => screen.getByTestId('delete-confirm-dialog-cmt-own'))
      await user.click(screen.getByTestId('cancel-delete-btn-cmt-own'))
      await waitFor(() => {
        expect(screen.queryByTestId('delete-confirm-dialog-cmt-own')).not.toBeInTheDocument()
        expect(screen.getByText('My original comment')).toBeInTheDocument()
      })
    })

    it('non-owner sees only Report, not Edit or Delete', async () => {
      const otherComment = { ...ownComment, id: 'cmt-other', author_id: 'u-other' }
      mockListComments.mockResolvedValue({ comments: [otherComment], total: 1, error: null })
      const user = userEvent.setup()
      renderPage(loggedInContext)
      await waitFor(() => screen.getByText('My original comment'))
      await user.click(screen.getByTestId('comment-kebab-cmt-other'))
      await waitFor(() => screen.getByTestId('kebab-menu-cmt-other'))
      expect(screen.queryByTestId('edit-btn-cmt-other')).not.toBeInTheDocument()
      expect(screen.queryByTestId('delete-btn-cmt-other')).not.toBeInTheDocument()
      expect(screen.getByTestId('report-btn-cmt-other')).toBeInTheDocument()
    })
  })
})
