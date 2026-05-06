import { describe, it, expect, vi } from 'vitest'
import { listPublishedCourses } from './coursesApi'
import type { SupabaseClient } from '@supabase/supabase-js'

function makeSupabase(rows: unknown[] = [], error: unknown = null) {
  const query = {
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: rows, error }),
  }
  return {
    from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(query) }),
    _query: query,
  } as unknown as SupabaseClient & { _query: typeof query }
}

const sampleRow = {
  id: 'course-1',
  title: 'Cờ vua cơ bản',
  description: 'Học cờ vua từ đầu',
  thumbnail_url: null,
  price: 0,
  level: 'beginner' as const,
  tags: ['openings'],
  creator_id: 'user-1',
  created_at: '2026-01-01T00:00:00Z',
  users: { name: 'Nguyễn Văn A' },
  reviews: [{ rating: 5 }, { rating: 4 }],
  enrollments: [{ id: 'e1' }, { id: 'e2' }],
  chapters: [{ lessons: [{ id: 'l1' }, { id: 'l2' }] }],
}

describe('listPublishedCourses', () => {
  it('returns published courses', async () => {
    const client = makeSupabase([sampleRow])
    const { courses, error } = await listPublishedCourses(client)
    expect(error).toBeNull()
    expect(courses).toHaveLength(1)
    expect(courses[0].title).toBe('Cờ vua cơ bản')
  })

  it('queries only published status', async () => {
    const client = makeSupabase([])
    await listPublishedCourses(client)
    expect(client._query.eq).toHaveBeenCalledWith('status', 'published')
  })

  it('maps creator name from users join (users.name)', async () => {
    const client = makeSupabase([sampleRow])
    const { courses } = await listPublishedCourses(client)
    expect(courses[0].creator_name).toBe('Nguyễn Văn A')
  })

  it('computes average rating from reviews', async () => {
    const client = makeSupabase([sampleRow])
    const { courses } = await listPublishedCourses(client)
    expect(courses[0].rating_avg).toBe(4.5)
    expect(courses[0].rating_count).toBe(2)
  })

  it('counts lessons from chapters', async () => {
    const client = makeSupabase([sampleRow])
    const { courses } = await listPublishedCourses(client)
    expect(courses[0].lessons_count).toBe(2)
  })

  it('counts enrollments', async () => {
    const client = makeSupabase([sampleRow])
    const { courses } = await listPublishedCourses(client)
    expect(courses[0].enrollment_count).toBe(2)
  })

  it('applies ILIKE filter when q is given', async () => {
    const client = makeSupabase([])
    await listPublishedCourses(client, { q: 'cờ' })
    expect(client._query.ilike).toHaveBeenCalledWith('title', '%cờ%')
  })

  it('applies level filter', async () => {
    const client = makeSupabase([])
    await listPublishedCourses(client, { level: 'beginner' })
    expect(client._query.eq).toHaveBeenCalledWith('level', 'beginner')
  })

  it('applies tag filter', async () => {
    const client = makeSupabase([])
    await listPublishedCourses(client, { tag: 'openings' })
    expect(client._query.contains).toHaveBeenCalledWith('tags', ['openings'])
  })

  it('returns empty array and error on supabase failure', async () => {
    const client = makeSupabase([], { message: 'DB error' })
    const { courses, error } = await listPublishedCourses(client)
    expect(courses).toHaveLength(0)
    expect(error).toBeTruthy()
  })

  it('returns 0 rating_avg when no reviews', async () => {
    const client = makeSupabase([{ ...sampleRow, reviews: [] }])
    const { courses } = await listPublishedCourses(client)
    expect(courses[0].rating_avg).toBe(0)
    expect(courses[0].rating_count).toBe(0)
  })

  describe('sort behavior', () => {
    const lowRated = {
      ...sampleRow,
      id: 'low',
      title: 'Low rated',
      created_at: '2026-03-01T00:00:00Z',
      reviews: [{ rating: 2 }, { rating: 3 }], // avg 2.5
      enrollments: [{ id: 'e1' }],
    }
    const highRated = {
      ...sampleRow,
      id: 'high',
      title: 'High rated',
      created_at: '2026-01-01T00:00:00Z',
      reviews: [{ rating: 5 }, { rating: 5 }], // avg 5
      enrollments: [{ id: 'e1' }, { id: 'e2' }],
    }
    const midRated = {
      ...sampleRow,
      id: 'mid',
      title: 'Mid rated',
      created_at: '2026-02-01T00:00:00Z',
      reviews: [{ rating: 4 }], // avg 4
      enrollments: Array.from({ length: 50 }, (_, i) => ({ id: `e${i}` })),
    }

    it('orders by rating_avg desc when sort=rating', async () => {
      const client = makeSupabase([lowRated, highRated, midRated])
      const { courses } = await listPublishedCourses(client, { sort: 'rating' })
      expect(courses.map(c => c.id)).toEqual(['high', 'mid', 'low'])
    })

    it('orders by enrollment_count desc when sort=popular', async () => {
      const client = makeSupabase([lowRated, highRated, midRated])
      const { courses } = await listPublishedCourses(client, { sort: 'popular' })
      expect(courses.map(c => c.id)).toEqual(['mid', 'high', 'low'])
    })

    it('keeps DB order (created_at desc) when sort=newest', async () => {
      // Supabase resolves rows already in created_at desc order.
      const client = makeSupabase([lowRated, midRated, highRated])
      const { courses } = await listPublishedCourses(client, { sort: 'newest' })
      // The API must not re-sort — it must preserve DB order.
      expect(courses.map(c => c.id)).toEqual(['low', 'mid', 'high'])
    })

    it('asks DB to order by created_at desc for newest', async () => {
      const client = makeSupabase([])
      await listPublishedCourses(client, { sort: 'newest' })
      expect(client._query.order).toHaveBeenCalledWith('created_at', { ascending: false })
    })
  })
})
