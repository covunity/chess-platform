import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import { vi } from 'vitest'
import i18n from '../i18n'
import CourseCard from './CourseCard'
import { listPublishedCourses, type PublicCourse } from '../lib/coursesApi'
import type { Campaign } from '../lib/campaignsApi'
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

function renderCard(course: PublicCourse, activeCampaign: Campaign | null = null) {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <CourseCard course={course} activeCampaign={activeCampaign} />
      </I18nextProvider>
    </MemoryRouter>
  )
}

const platformWideCampaign: Campaign = {
  id: 'cmp-1',
  name: 'Tết Sale 2026',
  description: null,
  discount_type: 'percentage',
  discount_value: 20,
  max_discount_amount: null,
  applicable_courses: null,
  starts_at: '2026-01-15T00:00:00Z',
  ends_at: '2026-02-15T00:00:00Z',
  is_active: true,
  created_by: 'admin-1',
  created_at: '2026-01-10T00:00:00Z',
  updated_at: '2026-01-10T00:00:00Z',
  orders_count: 0,
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
    // "openings" translates to "Khai cuộc"; appears in thumbnail badge + body pill
    const tagEls = screen.getAllByText('Khai cuộc')
    expect(tagEls.length).toBeGreaterThanOrEqual(1)
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

  describe('"New" badge', () => {
    function recentCourse(daysAgo: number): PublicCourse {
      const d = new Date()
      d.setDate(d.getDate() - daysAgo)
      return { ...paidCourse, id: 'c-new', enrollment_count: 10, created_at: d.toISOString() }
    }

    it('shows "New" badge for paid course created within 30 days', () => {
      renderCard(recentCourse(5))
      expect(screen.getByTestId('badge-new')).toBeInTheDocument()
    })

    it('does NOT show "New" badge for course older than 30 days', () => {
      renderCard(recentCourse(31))
      expect(screen.queryByTestId('badge-new')).not.toBeInTheDocument()
    })

    it('does NOT show "New" badge for free courses (Free badge takes priority)', () => {
      const newFree = recentCourse(5)
      renderCard({ ...newFree, price: 0 })
      expect(screen.queryByTestId('badge-new')).not.toBeInTheDocument()
      expect(screen.getByTestId('badge-free')).toBeInTheDocument()
    })

    it('does NOT show "New" badge for bestseller courses (Bestseller takes priority)', () => {
      const newBestseller = recentCourse(5)
      renderCard({ ...newBestseller, enrollment_count: 200 })
      expect(screen.queryByTestId('badge-new')).not.toBeInTheDocument()
      expect(screen.getByTestId('badge-bestseller')).toBeInTheDocument()
    })

    it('shows no badge for old non-free non-bestseller course', () => {
      renderCard(recentCourse(60))
      expect(screen.queryByTestId('badge-new')).not.toBeInTheDocument()
      expect(screen.queryByTestId('badge-free')).not.toBeInTheDocument()
      expect(screen.queryByTestId('badge-bestseller')).not.toBeInTheDocument()
    })
  })

  describe('campaign discount', () => {
    it('does NOT render strikethrough when activeCampaign is null', () => {
      renderCard(paidCourse, null)
      expect(screen.queryByTestId('card-strikethrough-price')).not.toBeInTheDocument()
      expect(screen.queryByTestId('card-discount-badge')).not.toBeInTheDocument()
    })

    it('renders strikethrough + discounted price + discount badge when campaign applies to paid course', () => {
      renderCard(paidCourse, platformWideCampaign)
      const strikethrough = screen.getByTestId('card-strikethrough-price')
      const discounted = screen.getByTestId('card-discounted-price')
      expect(strikethrough).toBeInTheDocument()
      expect(strikethrough.textContent).toMatch(/480/)
      expect(discounted).toBeInTheDocument()
      // 20% off 480_000 = 96_000 discount → final 384_000 → "384k"
      expect(discounted.textContent).toMatch(/384/)
      expect(screen.getByTestId('card-discount-badge')).toBeInTheDocument()
    })

    it('does NOT render strikethrough for free course even if campaign is active', () => {
      renderCard(freeCourse, platformWideCampaign)
      expect(screen.queryByTestId('card-strikethrough-price')).not.toBeInTheDocument()
      expect(screen.queryByTestId('card-discount-badge')).not.toBeInTheDocument()
      // Free badge still wins
      expect(screen.getByTestId('badge-free')).toBeInTheDocument()
    })

    it('does NOT render discount when campaign does not target this course', () => {
      const targeted: Campaign = { ...platformWideCampaign, applicable_courses: ['other-id'] }
      renderCard(paidCourse, targeted)
      expect(screen.queryByTestId('card-strikethrough-price')).not.toBeInTheDocument()
      expect(screen.queryByTestId('card-discount-badge')).not.toBeInTheDocument()
    })
  })
})
