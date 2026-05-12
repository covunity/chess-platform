import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import CreatorStudioPage from './CreatorStudioPage'

const {
  mockListCourses,
  mockDeleteCourse,
  mockCountCourseChildren,
  mockFetchCreatorKpis,
  mockFetchCoursesWithStats,
  mockListChapters,
  mockUpdateLesson,
  mockSubmitCourseForReview,
  mockDuplicateCourse,
  mockGetMyLatestAccountApplication,
} = vi.hoisted(() => ({
  mockListCourses: vi.fn(),
  mockDeleteCourse: vi.fn(),
  mockCountCourseChildren: vi.fn(),
  mockFetchCreatorKpis: vi.fn(),
  mockFetchCoursesWithStats: vi.fn(),
  mockListChapters: vi.fn(),
  mockUpdateLesson: vi.fn(),
  mockSubmitCourseForReview: vi.fn(),
  mockDuplicateCourse: vi.fn(),
  mockGetMyLatestAccountApplication: vi.fn(),
}))

vi.mock('../../lib/creatorApi', () => ({
  listCourses: mockListCourses,
  deleteCourse: mockDeleteCourse,
  countCourseChildren: mockCountCourseChildren,
  fetchCreatorKpis: mockFetchCreatorKpis,
  fetchCoursesWithStats: mockFetchCoursesWithStats,
  listChapters: mockListChapters,
  updateLesson: mockUpdateLesson,
  submitCourseForReview: mockSubmitCourseForReview,
  duplicateCourse: mockDuplicateCourse,
}))

vi.mock('../../lib/accountApplicationApi', () => ({
  getMyLatestAccountApplication: mockGetMyLatestAccountApplication,
}))

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

const mockCourses = [
  {
    id: 'c1',
    creator_id: 'u1',
    title: 'Chess Fundamentals',
    description: null,
    thumbnail_url: null,
    price: 0,
    level: 'beginner',
    language: 'vi',
    tags: [],
    status: 'published',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
  },
  {
    id: 'c2',
    creator_id: 'u1',
    title: 'Advanced Tactics',
    description: null,
    thumbnail_url: null,
    price: 199000,
    level: 'advanced',
    language: 'en',
    tags: ['tactics'],
    status: 'draft',
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-01-15T00:00:00Z',
  },
]

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <CreatorStudioPage />
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('CreatorStudioPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ profile: { id: 'u1', role: 'coach' } })
    mockListCourses.mockResolvedValue({ courses: mockCourses, total: 2, error: null })
    mockCountCourseChildren.mockResolvedValue({ chapters: 3, lessons: 14 })
    mockFetchCreatorKpis.mockResolvedValue({
      totalStudents: 42,
      grossRevenue: 1000000,
      totalPayout: 800000,
      avgRating: 4.5,
      courseCount: 2,
    })
    mockFetchCoursesWithStats.mockResolvedValue([
      { courseId: 'c1', students: 30, revenue: 600000, rating: 4.8 },
      { courseId: 'c2', students: 12, revenue: 400000, rating: 4.2 },
    ])
    mockListChapters.mockResolvedValue({ chapters: [], error: null })
    mockUpdateLesson.mockResolvedValue({ lesson: null, error: null })
    mockSubmitCourseForReview.mockResolvedValue({ course: null, error: null })
    mockDuplicateCourse.mockResolvedValue({ course: null, error: null })
    mockGetMyLatestAccountApplication.mockResolvedValue({ application: null, error: null })
  })

  it('renders the CREATOR STUDIO eyebrow', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('CREATOR STUDIO')).toBeInTheDocument())
  })

  it('renders the page heading', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('heading')).toBeInTheDocument())
  })

  it('renders new course link', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('new-course-link')).toBeInTheDocument())
  })

  it('renders KPI strip with 4 cards', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('kpi-students')).toBeInTheDocument()
      expect(screen.getByTestId('kpi-revenue')).toBeInTheDocument()
      expect(screen.getByTestId('kpi-payout')).toBeInTheDocument()
      expect(screen.getByTestId('kpi-rating')).toBeInTheDocument()
    })
  })

  it('shows live total students value from fetchCreatorKpis', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('kpi-students')).toHaveTextContent('42')
    })
  })

  it('shows live gross revenue formatted from fetchCreatorKpis', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('kpi-revenue')).toHaveTextContent('1M ₫')
    })
  })

  it('shows live payout value formatted from fetchCreatorKpis', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('kpi-payout')).toHaveTextContent('800K ₫')
    })
  })

  it('shows live average rating from fetchCreatorKpis', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('kpi-rating')).toHaveTextContent('4.5')
    })
  })

  it('renders status filter pills', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('filter-all')).toBeInTheDocument()
      expect(screen.getByTestId('filter-published')).toBeInTheDocument()
      expect(screen.getByTestId('filter-draft')).toBeInTheDocument()
    })
  })

  it('renders course rows after loading', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('course-title-c1')).toBeInTheDocument()
      expect(screen.getByTestId('course-title-c2')).toBeInTheDocument()
    })
  })

  it('shows per-course student count in table row', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('course-students-c1')).toHaveTextContent('30')
    })
  })

  it('shows per-course revenue in table row', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('course-revenue-c1')).toHaveTextContent('600K ₫')
    })
  })

  it('shows per-course rating in table row', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('course-rating-c1')).toHaveTextContent('4.8')
    })
  })

  it('shows dash for null rating in table row', async () => {
    mockFetchCoursesWithStats.mockResolvedValue([
      { courseId: 'c1', students: 0, revenue: 0, rating: null },
      { courseId: 'c2', students: 0, revenue: 0, rating: null },
    ])
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('course-rating-c1')).toHaveTextContent('—')
    })
  })

  it('filters courses when status pill is clicked', async () => {
    mockListCourses.mockResolvedValueOnce({ courses: mockCourses, total: 2, error: null })
    mockListCourses.mockResolvedValueOnce({ courses: [mockCourses[0]], total: 1, error: null })

    renderPage()
    await waitFor(() => screen.getByTestId('course-title-c1'))

    fireEvent.click(screen.getByTestId('filter-published'))

    await waitFor(() => {
      expect(mockListCourses).toHaveBeenCalledWith(
        expect.anything(),
        'u1',
        expect.objectContaining({ status: 'published' })
      )
    })
  })

  it('shows delete confirmation dialog on delete kebab', async () => {
    renderPage()
    await waitFor(() => screen.getByTestId('course-title-c1'))

    const kebabs = screen.getAllByTestId('kebab-btn')
    await userEvent.click(kebabs[0])

    const deleteBtn = screen.getByTestId('kebab-delete-c1')
    await userEvent.click(deleteBtn)

    await waitFor(() => {
      expect(screen.getByTestId('delete-course-dialog')).toBeInTheDocument()
    })
  })

  it('calls deleteCourse and removes course from list on confirm', async () => {
    mockDeleteCourse.mockResolvedValue({ error: null })

    renderPage()
    await waitFor(() => screen.getByTestId('course-title-c1'))

    const kebabs = screen.getAllByTestId('kebab-btn')
    await userEvent.click(kebabs[0])
    await userEvent.click(screen.getByTestId('kebab-delete-c1'))
    await waitFor(() => screen.getByTestId('delete-course-dialog'))

    await userEvent.click(screen.getByTestId('delete-confirm-btn'))

    await waitFor(() => {
      expect(mockDeleteCourse).toHaveBeenCalledWith(expect.anything(), 'c1')
    })
  })

  it('renders the course builder inline block when courses exist', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('course-builder-block')).toBeInTheDocument()
    })
  })

  it('shows the most recently edited course title in the builder heading', async () => {
    renderPage()
    await waitFor(() => {
      // c1 has updated_at 2026-02-01, c2 has updated_at 2026-01-15 → c1 is most recent
      expect(screen.getByTestId('builder-heading')).toHaveTextContent('Chess Fundamentals')
    })
  })

  it('shows empty state CTA when creator has no courses', async () => {
    mockListCourses.mockResolvedValue({ courses: [], total: 0, error: null })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('empty-state-cta')).toBeInTheDocument()
    })
  })

  it('hides builder block when creator has no courses', async () => {
    mockListCourses.mockResolvedValue({ courses: [], total: 0, error: null })
    renderPage()
    await waitFor(() => {
      expect(screen.queryByTestId('course-builder-block')).not.toBeInTheDocument()
    })
  })

  it('export CSV button is rendered', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('export-csv-btn')).toBeInTheDocument()
    })
  })

  it('kebab menu shows Edit, Duplicate, Delete in that order', async () => {
    renderPage()
    await waitFor(() => screen.getByTestId('course-title-c1'))

    const kebabs = screen.getAllByTestId('kebab-btn')
    await userEvent.click(kebabs[0])

    const edit = screen.getByTestId('kebab-edit-c1')
    const duplicate = screen.getByTestId('kebab-duplicate-c1')
    const del = screen.getByTestId('kebab-delete-c1')

    expect(edit.compareDocumentPosition(duplicate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(duplicate.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('calls duplicateCourse with course id when Duplicate is clicked', async () => {
    const newCourse = {
      id: 'c1-copy',
      creator_id: 'u1',
      title: 'Copy of Chess Fundamentals',
      description: null,
      thumbnail_url: null,
      price: 0,
      level: 'beginner',
      language: 'vi',
      tags: [],
      status: 'draft',
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
    }
    mockDuplicateCourse.mockResolvedValue({ course: newCourse, error: null })

    renderPage()
    await waitFor(() => screen.getByTestId('course-title-c1'))

    const kebabs = screen.getAllByTestId('kebab-btn')
    await userEvent.click(kebabs[0])
    await userEvent.click(screen.getByTestId('kebab-duplicate-c1'))

    await waitFor(() => {
      expect(mockDuplicateCourse).toHaveBeenCalledWith(expect.anything(), 'c1')
    })
  })

  it('prepends the duplicated course to the table on success', async () => {
    const newCourse = {
      id: 'c1-copy',
      creator_id: 'u1',
      title: 'Copy of Chess Fundamentals',
      description: null,
      thumbnail_url: null,
      price: 0,
      level: 'beginner',
      language: 'vi',
      tags: [],
      status: 'draft',
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
    }
    mockDuplicateCourse.mockResolvedValue({ course: newCourse, error: null })

    renderPage()
    await waitFor(() => screen.getByTestId('course-title-c1'))

    await userEvent.click(screen.getAllByTestId('kebab-btn')[0])
    await userEvent.click(screen.getByTestId('kebab-duplicate-c1'))

    await waitFor(() => {
      expect(screen.getByTestId('course-title-c1-copy')).toBeInTheDocument()
    })
  })

  it('shows success toast after successful duplication', async () => {
    const newCourse = {
      id: 'c1-copy',
      creator_id: 'u1',
      title: 'Copy of Chess Fundamentals',
      description: null,
      thumbnail_url: null,
      price: 0,
      level: 'beginner',
      language: 'vi',
      tags: [],
      status: 'draft',
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
    }
    mockDuplicateCourse.mockResolvedValue({ course: newCourse, error: null })

    renderPage()
    await waitFor(() => screen.getByTestId('course-title-c1'))

    await userEvent.click(screen.getAllByTestId('kebab-btn')[0])
    await userEvent.click(screen.getByTestId('kebab-duplicate-c1'))

    await waitFor(() => {
      expect(screen.getByTestId('duplicate-toast')).toBeInTheDocument()
    })
  })

  it('shows error toast when duplication fails', async () => {
    mockDuplicateCourse.mockResolvedValue({ course: null, error: new Error('failed') })

    renderPage()
    await waitFor(() => screen.getByTestId('course-title-c1'))

    await userEvent.click(screen.getAllByTestId('kebab-btn')[0])
    await userEvent.click(screen.getByTestId('kebab-duplicate-c1'))

    await waitFor(() => {
      expect(screen.getByTestId('duplicate-error-toast')).toBeInTheDocument()
    })
  })

  describe('upgrade CTA card', () => {
    it('shows upgrade CTA card when creator has individual tier and no application', async () => {
      mockUseAuth.mockReturnValue({ profile: { id: 'u1', role: 'creator', account_tier_id: 'individual' } })
      mockGetMyLatestAccountApplication.mockResolvedValue({ application: null, error: null })
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('upgrade-cta-card')).toBeInTheDocument()
        expect(screen.getByTestId('upgrade-cta-btn')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('upgrade-pending-badge')).not.toBeInTheDocument()
    })

    it('hides upgrade CTA and shows pending badge when creator has pending application', async () => {
      mockUseAuth.mockReturnValue({ profile: { id: 'u1', role: 'creator', account_tier_id: 'individual' } })
      mockGetMyLatestAccountApplication.mockResolvedValue({
        application: { id: 'app1', status: 'pending', user_id: 'u1' },
        error: null,
      })
      renderPage()
      await waitFor(() => {
        expect(screen.queryByTestId('upgrade-cta-card')).not.toBeInTheDocument()
        expect(screen.getByTestId('upgrade-pending-badge')).toBeInTheDocument()
        expect(screen.getByTestId('upgrade-pending-link')).toHaveAttribute('href', '/become-creator')
      })
    })

    it('shows upgrade CTA again when creator has rejected application', async () => {
      mockUseAuth.mockReturnValue({ profile: { id: 'u1', role: 'creator', account_tier_id: 'individual' } })
      mockGetMyLatestAccountApplication.mockResolvedValue({
        application: { id: 'app1', status: 'rejected', user_id: 'u1' },
        error: null,
      })
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('upgrade-cta-card')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('upgrade-pending-badge')).not.toBeInTheDocument()
    })

    it('hides upgrade CTA when creator has enterprise tier', async () => {
      mockUseAuth.mockReturnValue({ profile: { id: 'u1', role: 'creator', account_tier_id: 'business' } })
      renderPage()
      await waitFor(() => screen.getByTestId('kpi-students'))
      expect(screen.queryByTestId('upgrade-cta-card')).not.toBeInTheDocument()
      expect(screen.queryByTestId('upgrade-pending-badge')).not.toBeInTheDocument()
    })

    it('upgrade CTA button links to /become-creator', async () => {
      mockUseAuth.mockReturnValue({ profile: { id: 'u1', role: 'creator', account_tier_id: 'individual' } })
      mockGetMyLatestAccountApplication.mockResolvedValue({ application: null, error: null })
      renderPage()
      await waitFor(() => screen.getByTestId('upgrade-cta-btn'))
      expect(screen.getByTestId('upgrade-cta-btn')).toHaveAttribute('href', '/become-creator')
    })
  })

  it('export CSV button triggers a file download', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:test')
    const revokeObjectURL = vi.fn()
    const clickSpy = vi.fn()
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const el = originalCreateElement('a')
        el.click = clickSpy
        return el
      }
      return originalCreateElement(tag)
    })

    renderPage()
    await waitFor(() => screen.getByTestId('export-csv-btn'))
    fireEvent.click(screen.getByTestId('export-csv-btn'))

    expect(clickSpy).toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})
