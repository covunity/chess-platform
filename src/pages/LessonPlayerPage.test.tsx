import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, beforeEach, expect } from 'vitest'

vi.mock('react-chessboard')
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import LessonPlayerPage from './LessonPlayerPage'
import * as enrollmentApi from '../lib/enrollmentApi'
import * as coursesApi from '../lib/coursesApi'
import * as lessonPlayerApi from '../lib/lessonPlayerApi'
import * as bookmarkApi from '../lib/bookmarkApi'
import * as orderApi from '../lib/orderApi'
import { AuthContext } from '../context/AuthContext'
import type { AuthContextValue } from '../context/AuthContext'
import type { CourseDetail } from '../lib/coursesApi'

function CourseDetailStub() {
  const [searchParams] = useSearchParams()
  return (
    <div
      data-testid="course-detail-page"
      data-paywall={searchParams.get('paywall') ?? ''}
      data-pending-order={searchParams.get('pendingOrder') ?? ''}
    />
  )
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
}))

const mockCheckUserEnrollment = vi.spyOn(coursesApi, 'checkUserEnrollment')
const mockGetCourseDetail = vi.spyOn(coursesApi, 'getCourseDetail')
const mockGetLastViewedLesson = vi.spyOn(enrollmentApi, 'getLastViewedLesson')
const mockGetFirstLesson = vi.spyOn(enrollmentApi, 'getFirstLesson')
const mockGetLessonForPlayer = vi.spyOn(lessonPlayerApi, 'getLessonForPlayer')
const mockMarkLessonCompleted = vi.spyOn(lessonPlayerApi, 'markLessonCompleted')
const mockGetBookmarkForLesson = vi.spyOn(bookmarkApi, 'getBookmarkForLesson')
const mockAddBookmark = vi.spyOn(bookmarkApi, 'addBookmark')
const mockGetPendingOrderForCourse = vi.spyOn(orderApi, 'getPendingOrderForCourse')

const sampleCourse: CourseDetail = {
  id: 'c1',
  title: 'Italian Game Mastery',
  description: 'Learn the Italian Game.',
  thumbnail_url: null,
  price: 0,
  original_price: null,
  promo_ends_at: null,
  level: 'intermediate',
  language: 'vi',
  tags: ['openings'],
  creator_id: 'u1',
  creator_name: 'GM Test',
  creator_bio: null,
  rating_avg: 4.5,
  rating_count: 10,
  lessons_count: 3,
  hours_total: 1,
  enrollment_count: 50,
  created_at: '2026-01-01T00:00:00Z',
  what_you_learn: ['Italian Game basics'],
  prerequisites: null,
  free_preview_count: 1,
  pgn_annotations_count: 2,
  puzzle_count: 0,
  chapters: [
    {
      id: 'ch1',
      title: 'Introduction',
      position: 0,
      lessons: [
        { id: 'l1', title: 'Welcome', type: 'video', position: 0, free_preview: true, duration_seconds: 300 },
        { id: 'l2', title: 'The Opening', type: 'chess', position: 1, free_preview: false, duration_seconds: 600 },
      ],
    },
    {
      id: 'ch2',
      title: 'Advanced Lines',
      position: 1,
      lessons: [
        { id: 'l3', title: 'Giuoco Piano', type: 'chess', position: 0, free_preview: false, duration_seconds: 480 },
      ],
    },
  ],
  reviews: [],
}

const enrolledUser: AuthContextValue = {
  user: { id: 'u99', email: 'learner@example.com' } as AuthContextValue['user'],
  loading: false,
  profile: {
    id: 'u99',
    email: 'learner@example.com',
    name: 'Test Learner',
    avatar_url: null,
    role: 'learner',
    created_at: '2026-01-01T00:00:00Z',
  },
  profileLoading: false,
  signUp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  resetPassword: vi.fn(),
  updatePassword: vi.fn(),
}

const unauthenticated: AuthContextValue = {
  ...enrolledUser,
  user: null,
  profile: null,
}

const adminUser: AuthContextValue = {
  ...enrolledUser,
  user: { id: 'u-admin', email: 'admin@example.com' } as AuthContextValue['user'],
  profile: {
    id: 'u-admin',
    email: 'admin@example.com',
    name: 'Admin',
    avatar_url: null,
    role: 'admin',
    created_at: '2026-01-01T00:00:00Z',
  },
}

function renderPlayer(
  auth = enrolledUser,
  path = '/learn/c1/l1'
) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <I18nextProvider i18n={i18n}>
          <Routes>
            <Route path="/learn/:courseId/:lessonId" element={<LessonPlayerPage />} />
            <Route path="/learn/:courseId" element={<LessonPlayerPage />} />
            <Route path="/courses/:courseId" element={<CourseDetailStub />} />
            <Route path="/login" element={<div data-testid="login-page" />} />
          </Routes>
        </I18nextProvider>
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

describe('LessonPlayerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCourseDetail.mockResolvedValue({ course: sampleCourse, error: null })
    mockCheckUserEnrollment.mockResolvedValue(true)
    mockGetLastViewedLesson.mockResolvedValue({ lessonId: null, error: null })
    mockGetFirstLesson.mockResolvedValue({ lessonId: 'l1', error: null })
    mockGetLessonForPlayer.mockResolvedValue({
      lesson: {
        id: 'l2',
        title: 'The Opening',
        type: 'chess',
        pgn_data: '1. e4 e5',
        board_perspective: 'white',
        coach_note: null,
      },
      error: null,
    })
    mockMarkLessonCompleted.mockResolvedValue({ error: null })
    mockGetBookmarkForLesson.mockResolvedValue({ bookmark: null, error: null })
    mockAddBookmark.mockResolvedValue({
      bookmark: {
        id: 'bm-new',
        user_id: 'u99',
        lesson_id: 'l2',
        pgn_snapshot: '',
        node_id: null,
        played_plies: 0,
        created_at: '2026-05-10T00:00:00Z',
      },
      error: null,
    })
    mockGetPendingOrderForCourse.mockResolvedValue({ order: null, error: null })
  })

  describe('access control', () => {
    it('redirects unauthenticated user trying to access a paid lesson to course detail with ?paywall=true', async () => {
      renderPlayer(unauthenticated, '/learn/c1/l2')
      await waitFor(() => {
        const el = screen.getByTestId('course-detail-page')
        expect(el).toBeInTheDocument()
        expect(el.getAttribute('data-paywall')).toBe('true')
      })
    })

    it('redirects non-enrolled user trying to access paid lesson to course detail with ?paywall=true', async () => {
      mockCheckUserEnrollment.mockResolvedValue(false)
      // l1 is free_preview=true in sampleCourse; l2 is free_preview=false
      renderPlayer(enrolledUser, '/learn/c1/l2')
      await waitFor(() => {
        const el = screen.getByTestId('course-detail-page')
        expect(el).toBeInTheDocument()
        expect(el.getAttribute('data-paywall')).toBe('true')
      })
    })

    it('redirects non-enrolled user with pending order to course detail with ?pendingOrder=true', async () => {
      mockCheckUserEnrollment.mockResolvedValue(false)
      mockGetPendingOrderForCourse.mockResolvedValue({ order: { id: 'ord-1' } as never, error: null })
      renderPlayer(enrolledUser, '/learn/c1/l2')
      await waitFor(() => {
        const el = screen.getByTestId('course-detail-page')
        expect(el).toBeInTheDocument()
        expect(el.getAttribute('data-pending-order')).toBe('true')
      })
    })

    it('renders player for enrolled user', async () => {
      renderPlayer(enrolledUser)
      await waitFor(() => {
        expect(screen.getByTestId('lesson-player-layout')).toBeInTheDocument()
      })
    })

    it('renders player for unauthenticated user accessing a free-preview lesson', async () => {
      // l1 is free_preview=true in sampleCourse
      renderPlayer(unauthenticated, '/learn/c1/l1')
      await waitFor(() => {
        expect(screen.getByTestId('lesson-player-layout')).toBeInTheDocument()
      })
    })

    it('renders player for non-enrolled authenticated user accessing a free-preview lesson', async () => {
      mockCheckUserEnrollment.mockResolvedValue(false)
      renderPlayer(enrolledUser, '/learn/c1/l1')
      await waitFor(() => {
        expect(screen.getByTestId('lesson-player-layout')).toBeInTheDocument()
      })
    })

    it('renders player with admin-watermark for admin not enrolled on a paid lesson', async () => {
      mockCheckUserEnrollment.mockResolvedValue(false)
      renderPlayer(adminUser, '/learn/c1/l2')
      await waitFor(() => {
        expect(screen.getByTestId('lesson-player-layout')).toBeInTheDocument()
        expect(screen.getByTestId('admin-watermark')).toBeInTheDocument()
      })
    })

    it('admin-watermark shows Vietnamese text and correct spec styling', async () => {
      mockCheckUserEnrollment.mockResolvedValue(false)
      renderPlayer(adminUser, '/learn/c1/l2')
      await waitFor(() => {
        const watermark = screen.getByTestId('admin-watermark')
        expect(watermark).toHaveTextContent('Admin preview · không enrolled')
        expect(watermark).toHaveStyle({ background: 'var(--warning-soft)', color: 'var(--warning)', fontSize: '12px', fontWeight: '500' })
      })
    })
  })

  describe('sidebar', () => {
    it('renders sidebar with course title', async () => {
      renderPlayer()
      await waitFor(() => {
        expect(screen.getByTestId('player-sidebar')).toBeInTheDocument()
        expect(screen.getByTestId('sidebar-course-title')).toHaveTextContent('Italian Game Mastery')
      })
    })

    it('renders back button that links to course detail', async () => {
      renderPlayer()
      await waitFor(() => {
        expect(screen.getByTestId('sidebar-back-btn')).toBeInTheDocument()
      })
    })

    it('renders progress bar', async () => {
      renderPlayer()
      await waitFor(() => {
        expect(screen.getByTestId('progress-bar')).toBeInTheDocument()
      })
    })

    it('renders all chapter titles in sidebar', async () => {
      renderPlayer()
      await waitFor(() => {
        expect(screen.getByTestId('chapter-item-ch1')).toBeInTheDocument()
        expect(screen.getByTestId('chapter-item-ch2')).toBeInTheDocument()
      })
    })

    it('first chapter is expanded by default', async () => {
      renderPlayer()
      await waitFor(() => {
        expect(screen.getByTestId('lesson-item-l1')).toBeInTheDocument()
        expect(screen.getByTestId('lesson-item-l2')).toBeInTheDocument()
      })
    })

    it('second chapter is collapsed by default', async () => {
      renderPlayer()
      await waitFor(() => screen.getByTestId('chapter-item-ch2'))
      expect(screen.queryByTestId('lesson-item-l3')).not.toBeInTheDocument()
    })

    it('clicking a collapsed chapter expands it', async () => {
      const user = userEvent.setup()
      renderPlayer()
      await waitFor(() => screen.getByTestId('chapter-item-ch2'))
      await user.click(screen.getByTestId('chapter-item-ch2'))
      await waitFor(() => {
        expect(screen.getByTestId('lesson-item-l3')).toBeInTheDocument()
      })
    })

    it('current lesson is highlighted in sidebar', async () => {
      renderPlayer(enrolledUser, '/learn/c1/l1')
      await waitFor(() => {
        const lessonItem = screen.getByTestId('lesson-item-l1')
        expect(lessonItem).toHaveAttribute('data-current', 'true')
      })
    })

    it('clicking a lesson in sidebar navigates to that lesson', async () => {
      const user = userEvent.setup()
      renderPlayer(enrolledUser, '/learn/c1/l1')
      await waitFor(() => screen.getByTestId('lesson-item-l2'))
      await user.click(screen.getByTestId('lesson-item-l2'))
      await waitFor(() => {
        expect(screen.getByTestId('lesson-item-l2')).toHaveAttribute('data-current', 'true')
      })
    })
  })

  describe('header bar', () => {
    it('renders breadcrumb in header', async () => {
      renderPlayer()
      await waitFor(() => {
        expect(screen.getByTestId('player-header')).toBeInTheDocument()
        expect(screen.getByTestId('breadcrumb')).toBeInTheDocument()
      })
    })

    it('breadcrumb shows course title', async () => {
      renderPlayer()
      await waitFor(() => {
        expect(screen.getByTestId('breadcrumb')).toHaveTextContent('Italian Game Mastery')
      })
    })

    it('renders bookmark button in header', async () => {
      renderPlayer()
      await waitFor(() => {
        expect(screen.getByTestId('header-bookmark-btn')).toBeInTheDocument()
      })
    })
  })

  describe('content slot', () => {
    it('renders content slot placeholder', async () => {
      renderPlayer()
      await waitFor(() => {
        expect(screen.getByTestId('lesson-content-slot')).toBeInTheDocument()
      })
    })
  })

  describe('resume routing', () => {
    it('redirects /learn/:courseId to last viewed lesson when available', async () => {
      mockGetLastViewedLesson.mockResolvedValue({ lessonId: 'l2', error: null })
      renderPlayer(enrolledUser, '/learn/c1')
      await waitFor(() => {
        expect(screen.getByTestId('lesson-item-l2')).toHaveAttribute('data-current', 'true')
      })
    })

    it('redirects /learn/:courseId to first lesson when no history', async () => {
      mockGetLastViewedLesson.mockResolvedValue({ lessonId: null, error: null })
      renderPlayer(enrolledUser, '/learn/c1')
      await waitFor(() => {
        expect(screen.getByTestId('lesson-item-l1')).toHaveAttribute('data-current', 'true')
      })
    })
  })

  describe('chess lesson — guided player', () => {
    it('renders the guided chess player when current lesson type is "chess"', async () => {
      renderPlayer(enrolledUser, '/learn/c1/l2')
      await waitFor(() => {
        expect(screen.getByTestId('guided-player-root')).toBeInTheDocument()
      })
    })

    it('passes the lesson title to the guided player', async () => {
      renderPlayer(enrolledUser, '/learn/c1/l2')
      await waitFor(() => {
        expect(screen.getByTestId('guided-player-title')).toHaveTextContent('The Opening')
      })
    })

    it('calls markLessonCompleted when the player reports completion', async () => {
      const user = userEvent.setup()
      renderPlayer(enrolledUser, '/learn/c1/l2')
      const board = await screen.findByTestId('guided-player-board')

      // PGN is "1. e4 e5" → play through both plies to fire onComplete
      await user.click(board.querySelector('[data-square="e2"]')!)
      await user.click(board.querySelector('[data-square="e4"]')!)
      await user.click(board.querySelector('[data-square="e7"]')!)
      await user.click(board.querySelector('[data-square="e5"]')!)

      await waitFor(() => {
        expect(mockMarkLessonCompleted).toHaveBeenCalledWith(
          expect.anything(),
          { courseId: 'c1', lessonId: 'l2', userId: 'u99' }
        )
      })
    })
  })

  describe('bookmark restore round-trip (issue #167)', () => {
    it('renders chess player without crashing when bookmark has played_plies for restore', async () => {
      mockGetBookmarkForLesson.mockResolvedValue({
        bookmark: {
          id: 'bm1',
          user_id: 'u99',
          lesson_id: 'l2',
          pgn_snapshot: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
          node_id: null,
          played_plies: 1,
          created_at: '2026-05-01T00:00:00Z',
        },
        error: null,
      })
      renderPlayer(enrolledUser, '/learn/c1/l2')
      await waitFor(() => {
        expect(screen.getByTestId('guided-player-root')).toBeInTheDocument()
      })
    })

    it('addBookmark is called with played_plies when bookmark button clicked', async () => {
      const user = userEvent.setup()
      renderPlayer(enrolledUser, '/learn/c1/l2')
      await waitFor(() => screen.getByTestId('header-bookmark-btn'))
      await user.click(screen.getByTestId('header-bookmark-btn'))
      await waitFor(() => {
        expect(mockAddBookmark).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ playedPlies: 0 })
        )
      })
    })
  })

  describe('enrollment toast', () => {
    it('shows enrollment success toast when enrolled=true query param present', async () => {
      renderPlayer(enrolledUser, '/learn/c1/l1?enrolled=true')
      await waitFor(() => {
        expect(screen.getByTestId('enrollment-toast')).toBeInTheDocument()
      })
    })

    it('does not show toast without enrolled query param', async () => {
      renderPlayer(enrolledUser, '/learn/c1/l1')
      await waitFor(() => screen.getByTestId('lesson-player-layout'))
      expect(screen.queryByTestId('enrollment-toast')).not.toBeInTheDocument()
    })
  })
})
