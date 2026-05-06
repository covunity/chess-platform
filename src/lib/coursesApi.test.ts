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
  profiles: { full_name: 'Nguyễn Văn A' },
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

  it('maps creator name from profiles', async () => {
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
})
