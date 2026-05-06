import { describe, it, expect, vi } from 'vitest'
import { listReportedComments, hideComment, dismissReports } from './adminReportsApi'
import type { SupabaseClient } from '@supabase/supabase-js'

const sampleReportedComment = {
  id: 'cmt-1',
  course_id: 'c1',
  author_id: 'u1',
  body: 'Bad comment',
  is_hidden: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  author: { name: 'User A' },
  course: { title: 'Chess Basics' },
  reports: [
    { id: 'r1', reporter_id: 'u2', reason: 'spam', created_at: '2026-01-02T00:00:00Z', reporter: { name: 'User B' } },
    { id: 'r2', reporter_id: 'u3', reason: 'inappropriate', created_at: '2026-01-03T00:00:00Z', reporter: { name: 'User C' } },
  ],
}

// ── listReportedComments ───────────────────────────────────────────────────

describe('listReportedComments', () => {
  it('returns comments that have reports', async () => {
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [sampleReportedComment], error: null }),
    }
    const client = {
      from: vi.fn().mockReturnValue(selectChain),
    } as unknown as SupabaseClient

    const { comments, error } = await listReportedComments(client)
    expect(error).toBeNull()
    expect(comments).toHaveLength(1)
    expect(comments[0].id).toBe('cmt-1')
    expect(comments[0].reports).toHaveLength(2)
  })

  it('returns empty list on DB error', async () => {
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'fail' } }),
    }
    const client = {
      from: vi.fn().mockReturnValue(selectChain),
    } as unknown as SupabaseClient

    const { comments, error } = await listReportedComments(client)
    expect(comments).toHaveLength(0)
    expect(error).toBeTruthy()
  })
})

// ── hideComment ────────────────────────────────────────────────────────────

describe('hideComment', () => {
  it('sets is_hidden = true and returns no error', async () => {
    const updateChain = {
      eq: vi.fn().mockResolvedValue({ error: null }),
    }
    const client = {
      from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue(updateChain) }),
    } as unknown as SupabaseClient

    const { error } = await hideComment(client, 'cmt-1')
    expect(error).toBeNull()
  })

  it('returns error when update fails', async () => {
    const updateChain = {
      eq: vi.fn().mockResolvedValue({ error: { message: 'forbidden' } }),
    }
    const client = {
      from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue(updateChain) }),
    } as unknown as SupabaseClient

    const { error } = await hideComment(client, 'cmt-1')
    expect(error).toBeTruthy()
  })
})

// ── dismissReports ─────────────────────────────────────────────────────────

describe('dismissReports', () => {
  it('deletes all reports for a comment and returns no error', async () => {
    const deleteChain = {
      eq: vi.fn().mockResolvedValue({ error: null }),
    }
    const client = {
      from: vi.fn().mockReturnValue({ delete: vi.fn().mockReturnValue(deleteChain) }),
    } as unknown as SupabaseClient

    const { error } = await dismissReports(client, 'cmt-1')
    expect(error).toBeNull()
  })

  it('returns error when delete fails', async () => {
    const deleteChain = {
      eq: vi.fn().mockResolvedValue({ error: { message: 'forbidden' } }),
    }
    const client = {
      from: vi.fn().mockReturnValue({ delete: vi.fn().mockReturnValue(deleteChain) }),
    } as unknown as SupabaseClient

    const { error } = await dismissReports(client, 'cmt-1')
    expect(error).toBeTruthy()
  })
})
