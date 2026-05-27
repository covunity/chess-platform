import { describe, it, expect, vi } from 'vitest'
import { listPublishedCourses, listReviews } from './coursesApi'
import type { SupabaseClient } from '@supabase/supabase-js'

function makeSupabase(rows: unknown[] = [], error: unknown = null) {
  const query = {
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
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
  avg_rating: 4.5,
  rating_count: 2,
  enrollment_count: 2,
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

  it('reads avg_rating and rating_count from courses row', async () => {
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

  it('reads enrollment_count from courses row', async () => {
    const client = makeSupabase([sampleRow])
    const { courses } = await listPublishedCourses(client)
    expect(courses[0].enrollment_count).toBe(2)
  })

  it('applies title+tags search filter when q is given', async () => {
    const client = makeSupabase([])
    await listPublishedCourses(client, { q: 'cờ' })
    expect(client._query.or).toHaveBeenCalledWith('title.ilike.%cờ%,tags_text.ilike.%cờ%')
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

  it('returns 0 rating_avg when avg_rating is 0', async () => {
    const client = makeSupabase([{ ...sampleRow, avg_rating: 0, rating_count: 0 }])
    const { courses } = await listPublishedCourses(client)
    expect(courses[0].rating_avg).toBe(0)
    expect(courses[0].rating_count).toBe(0)
  })

  describe('sort behavior', () => {
    it('asks DB to order by avg_rating desc for sort=rating', async () => {
      const client = makeSupabase([])
      await listPublishedCourses(client, { sort: 'rating' })
      expect(client._query.order).toHaveBeenCalledWith('avg_rating', { ascending: false })
    })

    it('asks DB to order by enrollment_count desc for sort=popular', async () => {
      const client = makeSupabase([])
      await listPublishedCourses(client, { sort: 'popular' })
      expect(client._query.order).toHaveBeenCalledWith('enrollment_count', { ascending: false })
    })

    it('keeps DB order when sort=newest', async () => {
      const rows = [
        { ...sampleRow, id: 'low', created_at: '2026-03-01T00:00:00Z' },
        { ...sampleRow, id: 'mid', created_at: '2026-02-01T00:00:00Z' },
        { ...sampleRow, id: 'high', created_at: '2026-01-01T00:00:00Z' },
      ]
      const client = makeSupabase(rows)
      const { courses } = await listPublishedCourses(client, { sort: 'newest' })
      expect(courses.map(c => c.id)).toEqual(['low', 'mid', 'high'])
    })

    it('asks DB to order by created_at desc for sort=newest', async () => {
      const client = makeSupabase([])
      await listPublishedCourses(client, { sort: 'newest' })
      expect(client._query.order).toHaveBeenCalledWith('created_at', { ascending: false })
    })
  })
})

function makeReviewsSupabase(rows: unknown[], total = rows.length, error: unknown = null) {
  const query = {
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: rows, error, count: total }),
  }
  return {
    from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(query) }),
    _query: query,
  } as unknown as SupabaseClient & { _query: typeof query }
}

const sampleReviewRow = {
  id: 'r1',
  rating: 5,
  title: 'Tuyệt vời',
  body: 'Rất hay',
  created_at: '2026-03-01T00:00:00Z',
  reviewer: { name: 'Nguyễn A' },
}

describe('listReviews', () => {
  it('returns mapped reviews and total', async () => {
    const client = makeReviewsSupabase([sampleReviewRow], 12)
    const { reviews, total, error } = await listReviews(client, 'c1', 1)
    expect(error).toBeNull()
    expect(total).toBe(12)
    expect(reviews).toHaveLength(1)
    expect(reviews[0].id).toBe('r1')
    expect(reviews[0].reviewer_name).toBe('Nguyễn A')
    expect(reviews[0].rating).toBe(5)
  })

  it('passes correct range for page 1 (limit 10)', async () => {
    const client = makeReviewsSupabase([])
    await listReviews(client, 'c1', 1, 10)
    expect(client._query.range).toHaveBeenCalledWith(0, 9)
  })

  it('passes correct range for page 2 (limit 10)', async () => {
    const client = makeReviewsSupabase([])
    await listReviews(client, 'c1', 2, 10)
    expect(client._query.range).toHaveBeenCalledWith(10, 19)
  })

  it('filters by course_id', async () => {
    const client = makeReviewsSupabase([])
    await listReviews(client, 'course-xyz', 1)
    expect(client._query.eq).toHaveBeenCalledWith('course_id', 'course-xyz')
  })

  it('returns empty array and zero total on DB error', async () => {
    const client = makeReviewsSupabase([], 0, { message: 'DB error' })
    const { reviews, total, error } = await listReviews(client, 'c1', 1)
    expect(error).not.toBeNull()
    expect(reviews).toHaveLength(0)
    expect(total).toBe(0)
  })
})
