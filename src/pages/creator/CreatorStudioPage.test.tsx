import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import CreatorStudioPage from './CreatorStudioPage'

const { mockListCourses, mockDeleteCourse, mockCountCourseChildren } = vi.hoisted(() => ({
  mockListCourses: vi.fn(),
  mockDeleteCourse: vi.fn(),
  mockCountCourseChildren: vi.fn(),
}))

vi.mock('../../lib/creatorApi', () => ({
  listCourses: mockListCourses,
  deleteCourse: mockDeleteCourse,
  countCourseChildren: mockCountCourseChildren,
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
    updated_at: '2026-01-01T00:00:00Z',
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
    updated_at: '2026-02-01T00:00:00Z',
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
  })

  it('renders the CREATOR STUDIO eyebrow', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('CREATOR STUDIO')).toBeInTheDocument())
  })

  it('renders the page heading', async () => {
    renderPage()
    // heading is the h1 - testid approach
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
      expect(screen.getByText('Chess Fundamentals')).toBeInTheDocument()
      expect(screen.getByText('Advanced Tactics')).toBeInTheDocument()
    })
  })

  it('filters courses when status pill is clicked', async () => {
    mockListCourses.mockResolvedValueOnce({ courses: mockCourses, total: 2, error: null })
    mockListCourses.mockResolvedValueOnce({ courses: [mockCourses[0]], total: 1, error: null })

    renderPage()
    await waitFor(() => screen.getByText('Chess Fundamentals'))

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
    await waitFor(() => screen.getByText('Chess Fundamentals'))

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
    await waitFor(() => screen.getByText('Chess Fundamentals'))

    const kebabs = screen.getAllByTestId('kebab-btn')
    await userEvent.click(kebabs[0])
    await userEvent.click(screen.getByTestId('kebab-delete-c1'))
    await waitFor(() => screen.getByTestId('delete-course-dialog'))

    await userEvent.click(screen.getByTestId('delete-confirm-btn'))

    await waitFor(() => {
      expect(mockDeleteCourse).toHaveBeenCalledWith(expect.anything(), 'c1')
    })
  })
})
