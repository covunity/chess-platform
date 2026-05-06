import { describe, it, expect, vi } from 'vitest'
import { submitReview, getUserReview, deleteReview } from './reviewsApi'
import type { SupabaseClient } from '@supabase/supabase-js'

// Builder for chained Supabase query mocks
function makeSupabase(opts: {
  selectData?: unknown
  selectError?: unknown
  upsertData?: unknown
  upsertError?: unknown
  deleteError?: unknown
} = {}) {
  const selectChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: opts.selectData ?? null, error: opts.selectError ?? null }),
  }
  const upsertChain = {
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: opts.upsertData ?? null, error: opts.upsertError ?? null }),
  }
  const deleteChain = {
    eq: vi.fn().mockReturnThis(),
    then: undefined as unknown,
  }
  // make delete chain awaitable
  const deleteResult = Promise.resolve({ error: opts.deleteError ?? null })
  deleteChain.eq = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue(deleteResult),
  })

  const fromMock = vi.fn((table: string) => {
    if (table === 'reviews') {
      return {
        select: vi.fn().mockReturnValue(selectChain),
        upsert: vi.fn().mockReturnValue(upsertChain),
        delete: vi.fn().mockReturnValue(deleteChain),
      }
    }
    return {}
  })

  return { from: fromMock } as unknown as SupabaseClient
}

describe('submitReview', () => {
  it('upserts a review and returns it', async () => {
    const reviewRow = {
      id: 'rev-1',
      course_id: 'c1',
      reviewer_id: 'u1',
      rating: 5,
      title: 'Great!',
      body: 'Loved it',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    const client = makeSupabase({ upsertData: reviewRow })
    const { review, error } = await submitReview(client, {
      courseId: 'c1',
      reviewerId: 'u1',
      rating: 5,
      title: 'Great!',
      body: 'Loved it',
    })
    expect(error).toBeNull()
    expect(review).toMatchObject({ id: 'rev-1', rating: 5, title: 'Great!' })
  })

  it('returns error when upsert fails', async () => {
    const client = makeSupabase({ upsertError: { message: 'DB error' } })
    const { review, error } = await submitReview(client, {
      courseId: 'c1',
      reviewerId: 'u1',
      rating: 4,
      title: null,
      body: null,
    })
    expect(review).toBeNull()
    expect(error).toBeTruthy()
  })

  it('allows submitting without title and body', async () => {
    const reviewRow = {
      id: 'rev-2',
      course_id: 'c1',
      reviewer_id: 'u1',
      rating: 3,
      title: null,
      body: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    const client = makeSupabase({ upsertData: reviewRow })
    const { review, error } = await submitReview(client, {
      courseId: 'c1',
      reviewerId: 'u1',
      rating: 3,
      title: null,
      body: null,
    })
    expect(error).toBeNull()
    expect(review?.rating).toBe(3)
    expect(review?.title).toBeNull()
  })
})

describe('getUserReview', () => {
  it('returns existing review for user+course', async () => {
    const reviewRow = {
      id: 'rev-1',
      course_id: 'c1',
      reviewer_id: 'u1',
      rating: 4,
      title: 'Good',
      body: 'OK',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    const client = makeSupabase({ selectData: reviewRow })
    const { review, error } = await getUserReview(client, 'c1', 'u1')
    expect(error).toBeNull()
    expect(review?.id).toBe('rev-1')
  })

  it('returns null review when none exists (PGRST116)', async () => {
    const client = makeSupabase({ selectError: { code: 'PGRST116' } })
    const { review, error } = await getUserReview(client, 'c1', 'u1')
    expect(error).toBeNull()
    expect(review).toBeNull()
  })

  it('propagates unexpected errors', async () => {
    const client = makeSupabase({ selectError: { message: 'network error' } })
    const { review, error } = await getUserReview(client, 'c1', 'u1')
    expect(review).toBeNull()
    expect(error).toBeTruthy()
  })
})

describe('deleteReview', () => {
  it('deletes a review and returns no error', async () => {
    const client = makeSupabase({ deleteError: null })
    const { error } = await deleteReview(client, 'c1', 'u1')
    expect(error).toBeNull()
  })
})
