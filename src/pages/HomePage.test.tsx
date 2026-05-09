import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import HomePage from './HomePage'
import * as coursesApi from '../lib/coursesApi'
import type { PublicCourse } from '../lib/coursesApi'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }),
  },
}))

const mockListPublishedCourses = vi.spyOn(coursesApi, 'listPublishedCourses')

const sampleCourses: PublicCourse[] = [
  {
    id: 'c1',
    title: 'Khai cuộc cho người mới',
    description: null,
    thumbnail_url: null,
    price: 0,
    level: 'beginner',
    tags: ['openings'],
    creator_id: 'u1',
    creator_name: 'GM Anh Lê',
    rating_avg: 4.8,
    rating_count: 50,
    lessons_count: 15,
    hours_total: 3,
    created_at: '2026-01-01T00:00:00Z',
    enrollment_count: 200,
  },
  {
    id: 'c2',
    title: 'Chiến thuật nâng cao',
    description: null,
    thumbnail_url: null,
    price: 480000,
    level: 'advanced',
    tags: ['tactics'],
    creator_id: 'u2',
    creator_name: 'IM Bình Trần',
    rating_avg: 4.5,
    rating_count: 30,
    lessons_count: 25,
    hours_total: 8,
    created_at: '2026-02-01T00:00:00Z',
    enrollment_count: 80,
  },
]

function renderHome(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <I18nextProvider i18n={i18n}>
        <HomePage />
      </I18nextProvider>
    </MemoryRouter>
  )
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('hero section', () => {
    it('renders a hero heading', async () => {
      mockListPublishedCourses.mockResolvedValue({ courses: sampleCourses, error: null })
      renderHome()
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    })

    it('renders CTA buttons', async () => {
      mockListPublishedCourses.mockResolvedValue({ courses: sampleCourses, error: null })
      renderHome()
      expect(screen.getByText(/xem tất cả khóa học/i)).toBeInTheDocument()
    })
  })

  describe('loading state', () => {
    it('shows loading skeletons while fetching', () => {
      let resolve: (v: unknown) => void
      mockListPublishedCourses.mockReturnValue(new Promise(r => { resolve = r }) as ReturnType<typeof coursesApi.listPublishedCourses>)
      renderHome()
      const skeletons = document.querySelectorAll('[data-testid="course-skeleton"]')
      expect(skeletons.length).toBeGreaterThan(0)
      // satisfy eslint
      resolve!({ courses: [], error: null })
    })
  })

  describe('course grid', () => {
    it('renders course cards after loading', async () => {
      mockListPublishedCourses.mockResolvedValue({ courses: sampleCourses, error: null })
      renderHome()
      await waitFor(() => {
        expect(screen.getByText('Khai cuộc cho người mới')).toBeInTheDocument()
        expect(screen.getByText('Chiến thuật nâng cao')).toBeInTheDocument()
      })
    })

    it('course grid has responsive breakpoint classes for mobile and tablet', async () => {
      mockListPublishedCourses.mockResolvedValue({ courses: sampleCourses, error: null })
      renderHome()
      await waitFor(() => screen.getByTestId('course-grid'))
      const grid = screen.getByTestId('course-grid')
      // Must have single-column class for small screens
      expect(grid.className).toMatch(/grid-cols-1/)
      // Must have two-column class for medium screens
      expect(grid.className).toMatch(/md:grid-cols-2|sm:grid-cols-2/)
    })
  })

  describe('empty state', () => {
    it('shows empty state when no courses returned', async () => {
      mockListPublishedCourses.mockResolvedValue({ courses: [], error: null })
      renderHome()
      await waitFor(() => {
        expect(screen.getByText(/không có khóa học nào phù hợp/i)).toBeInTheDocument()
      })
    })

    it('clear filters button is shown in empty state', async () => {
      mockListPublishedCourses.mockResolvedValue({ courses: [], error: null })
      renderHome()
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /xóa bộ lọc/i })).toBeInTheDocument()
      })
    })
  })

  describe('filter pills', () => {
    it('renders level filter pills', async () => {
      mockListPublishedCourses.mockResolvedValue({ courses: sampleCourses, error: null })
      renderHome()
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /tất cả trình độ/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /cơ bản/i })).toBeInTheDocument()
      })
    })

    it('clicking a level pill updates the URL search params', async () => {
      mockListPublishedCourses.mockResolvedValue({ courses: sampleCourses, error: null })
      const user = userEvent.setup()
      renderHome()
      await waitFor(() => screen.getByRole('button', { name: /cơ bản/i }))
      await user.click(screen.getByRole('button', { name: /cơ bản/i }))
      await waitFor(() => {
        expect(mockListPublishedCourses).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ level: 'beginner' })
        )
      })
    })

    it('renders topic/tag filter pills', async () => {
      mockListPublishedCourses.mockResolvedValue({ courses: sampleCourses, error: null })
      renderHome()
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /khai cuộc/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /chiến thuật/i })).toBeInTheDocument()
      })
    })
  })

  describe('sort', () => {
    it('renders sort dropdown', async () => {
      mockListPublishedCourses.mockResolvedValue({ courses: sampleCourses, error: null })
      renderHome()
      await waitFor(() => {
        expect(screen.getByRole('combobox')).toBeInTheDocument()
      })
    })
  })
})
