import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import { vi } from 'vitest'
import i18n from '../i18n'
import CourseCard from './CourseCard'
import { listPublishedCourses, type PublicCourse } from '../lib/coursesApi'
import type { SupabaseClient } from '@supabase/supabase-js'

const freeCourse: PublicCourse = {
  id: 'c1',
  title: 'Khai cuộc cơ bản',
  description: null,
  thumbnail_url: null,
  price: 0,
  level: 'beginner',
  tags: ['openings'],
  creator_id: 'u1',
  creator_name: 'GM Anh Lê',
  rating_avg: 4.8,
  rating_count: 120,
  lessons_count: 20,
  hours_total: 5,
  created_at: '2026-01-01T00:00:00Z',
  enrollment_count: 300,
}

const paidCourse: PublicCourse = {
  ...freeCourse,
  id: 'c2',
  price: 480000,
  enrollment_count: 50,
}

function renderCard(course: PublicCourse) {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <CourseCard course={course} />
      </I18nextProvider>
    </MemoryRouter>
  )
}

describe('CourseCard', () => {
  it('renders course title', () => {
    renderCard(freeCourse)
    expect(screen.getByRole('heading', { name: /khai cuộc cơ bản/i })).toBeInTheDocument()
  })

  it('renders creator name', () => {
    renderCard(freeCourse)
    expect(screen.getByText('GM Anh Lê')).toBeInTheDocument()
  })

  it('shows "Miễn phí" for free course', () => {
    renderCard(freeCourse)
    expect(screen.getByText(/miễn phí/i)).toBeInTheDocument()
  })

  it('shows formatted price for paid course', () => {
    renderCard(paidCourse)
    expect(screen.getByText(/480/)).toBeInTheDocument()
  })

  it('shows lesson count', () => {
    renderCard(freeCourse)
    expect(screen.getByText(/20/)).toBeInTheDocument()
  })

  it('shows level pill', () => {
    renderCard(freeCourse)
    // Look for the pill span specifically (exact text "Cơ bản" / level badge)
    const pills = screen.getAllByText(/^(cơ bản|trung cấp|nâng cao)$/i)
    expect(pills.length).toBeGreaterThan(0)
  })

  it('shows first tag as pill', () => {
    renderCard(freeCourse)
    expect(screen.getByText(/openings/i)).toBeInTheDocument()
  })

  it('shows "Free" badge for free course', () => {
    renderCard(freeCourse)
    expect(screen.getByText(/free/i)).toBeInTheDocument()
  })

  it('shows star rating', () => {
    renderCard(freeCourse)
    expect(screen.getByText(/4\.8/)).toBeInTheDocument()
  })

  it('renders creator name from a course built by listPublishedCourses (users join)', async () => {
    // Integration: simulate a real Supabase response shape (`users: { name }`)
    // and verify the creator name flows through the API into the CourseCard.
    const supabaseRow = {
      id: 'c-int',
      title: 'Tích hợp creator name',
      description: null,
      thumbnail_url: null,
      price: 0,
      level: 'beginner' as const,
      tags: [],
      creator_id: 'u-int',
      created_at: '2026-01-01T00:00:00Z',
      users: { name: 'GM Tuấn Phạm' },
      reviews: [],
      enrollments: [],
      chapters: [],
    }
    const query = {
      eq: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      contains: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [supabaseRow], error: null }),
    }
    const client = {
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(query) }),
    } as unknown as SupabaseClient

    const { courses } = await listPublishedCourses(client)
    expect(courses[0].creator_name).toBe('GM Tuấn Phạm')
    renderCard(courses[0])
    expect(screen.getByText('GM Tuấn Phạm')).toBeInTheDocument()
  })
})
