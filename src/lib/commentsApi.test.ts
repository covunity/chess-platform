import { describe, it, expect, vi } from 'vitest'
import {
  listComments,
  createComment,
  updateComment,
  deleteComment,
  reportComment,
} from './commentsApi'
import type { SupabaseClient } from '@supabase/supabase-js'

const sampleComment = {
  id: 'cmt-1',
  course_id: 'c1',
  author_id: 'u1',
  body: 'Great course!',
  is_hidden: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  author: { name: 'Nguyễn Văn A' },
}

// ── helpers ────────────────────────────────────────────────────────────────

function makeSelectChain(data: unknown = [], error: unknown = null, count = 0) {
  return {
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data, error, count }),
    single: vi.fn().mockResolvedValue({ data, error }),
  }
}

function makeInsertChain(data: unknown = null, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
  }
}

function makeUpdateChain(data: unknown = null, error: unknown = null) {
  return {
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
  }
}

function makeDeleteChain(error: unknown = null) {
  const inner = { eq: vi.fn().mockResolvedValue({ error }) }
  return { eq: vi.fn().mockReturnValue(inner) }
}

// ── listComments ───────────────────────────────────────────────────────────

describe('listComments', () => {
  it('returns paginated comments for a course', async () => {
    const selectChain = makeSelectChain([sampleComment], null, 1)
    const client = {
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(selectChain) }),
    } as unknown as SupabaseClient

    const { comments, total, error } = await listComments(client, 'c1', 1)
    expect(error).toBeNull()
    expect(comments).toHaveLength(1)
    expect(comments[0].id).toBe('cmt-1')
    expect(total).toBe(1)
  })

  it('returns empty list on DB error', async () => {
    const selectChain = makeSelectChain([], { message: 'fail' }, 0)
    const client = {
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(selectChain) }),
    } as unknown as SupabaseClient

    const { comments, error } = await listComments(client, 'c1', 1)
    expect(comments).toHaveLength(0)
    expect(error).toBeTruthy()
  })

  it('uses page offset correctly', async () => {
    const selectChain = makeSelectChain([], null, 0)
    const client = {
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(selectChain) }),
    } as unknown as SupabaseClient

    await listComments(client, 'c1', 2)
    // page 2 → range(20, 39)
    expect(selectChain.range).toHaveBeenCalledWith(20, 39)
  })
})

// ── createComment ──────────────────────────────────────────────────────────

describe('createComment', () => {
  it('inserts a new comment and returns it', async () => {
    const insertChain = makeInsertChain(sampleComment)
    const client = {
      from: vi.fn().mockReturnValue({ insert: vi.fn().mockReturnValue(insertChain) }),
    } as unknown as SupabaseClient

    const { comment, error } = await createComment(client, { courseId: 'c1', authorId: 'u1', body: 'Great course!' })
    expect(error).toBeNull()
    expect(comment?.body).toBe('Great course!')
  })

  it('returns error when insert fails', async () => {
    const insertChain = makeInsertChain(null, { message: 'DB error' })
    const client = {
      from: vi.fn().mockReturnValue({ insert: vi.fn().mockReturnValue(insertChain) }),
    } as unknown as SupabaseClient

    const { comment, error } = await createComment(client, { courseId: 'c1', authorId: 'u1', body: 'hi' })
    expect(comment).toBeNull()
    expect(error).toBeTruthy()
  })

  it('rejects body longer than 2000 chars', async () => {
    const insertChain = makeInsertChain(null)
    const client = {
      from: vi.fn().mockReturnValue({ insert: vi.fn().mockReturnValue(insertChain) }),
    } as unknown as SupabaseClient

    const longBody = 'a'.repeat(2001)
    const { comment, error } = await createComment(client, { courseId: 'c1', authorId: 'u1', body: longBody })
    expect(comment).toBeNull()
    expect(error?.message).toMatch(/2000/)
  })
})

// ── updateComment ──────────────────────────────────────────────────────────

describe('updateComment', () => {
  it('updates a comment body and returns updated row', async () => {
    const updatedRow = { ...sampleComment, body: 'Edited!', updated_at: '2026-02-01T00:00:00Z' }
    const updateChain = makeUpdateChain(updatedRow)
    const client = {
      from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue(updateChain) }),
    } as unknown as SupabaseClient

    const { comment, error } = await updateComment(client, 'cmt-1', 'u1', 'Edited!')
    expect(error).toBeNull()
    expect(comment?.body).toBe('Edited!')
  })

  it('returns error when update fails', async () => {
    const updateChain = makeUpdateChain(null, { message: 'forbidden' })
    const client = {
      from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue(updateChain) }),
    } as unknown as SupabaseClient

    const { comment, error } = await updateComment(client, 'cmt-1', 'u1', 'hi')
    expect(comment).toBeNull()
    expect(error).toBeTruthy()
  })

  it('rejects body longer than 2000 chars', async () => {
    const updateChain = makeUpdateChain(null)
    const client = {
      from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue(updateChain) }),
    } as unknown as SupabaseClient

    const { comment, error } = await updateComment(client, 'cmt-1', 'u1', 'a'.repeat(2001))
    expect(comment).toBeNull()
    expect(error?.message).toMatch(/2000/)
  })
})

// ── deleteComment ──────────────────────────────────────────────────────────

describe('deleteComment', () => {
  it('deletes a comment and returns no error', async () => {
    const deleteChain = makeDeleteChain(null)
    const client = {
      from: vi.fn().mockReturnValue({ delete: vi.fn().mockReturnValue(deleteChain) }),
    } as unknown as SupabaseClient

    const { error } = await deleteComment(client, 'cmt-1', 'u1')
    expect(error).toBeNull()
  })

  it('returns error when delete fails', async () => {
    const deleteChain = makeDeleteChain({ message: 'not owner' })
    const client = {
      from: vi.fn().mockReturnValue({ delete: vi.fn().mockReturnValue(deleteChain) }),
    } as unknown as SupabaseClient

    const { error } = await deleteComment(client, 'cmt-1', 'u2')
    expect(error).toBeTruthy()
  })
})

// ── reportComment ──────────────────────────────────────────────────────────

describe('reportComment', () => {
  it('inserts a report row and returns no error', async () => {
    const insertResult = Promise.resolve({ error: null })
    const client = {
      from: vi.fn().mockReturnValue({ insert: vi.fn().mockReturnValue(insertResult) }),
    } as unknown as SupabaseClient

    const { error } = await reportComment(client, 'cmt-1', 'u2', 'spam')
    expect(error).toBeNull()
  })

  it('returns error on duplicate report', async () => {
    const insertResult = Promise.resolve({ error: { message: 'duplicate' } })
    const client = {
      from: vi.fn().mockReturnValue({ insert: vi.fn().mockReturnValue(insertResult) }),
    } as unknown as SupabaseClient

    const { error } = await reportComment(client, 'cmt-1', 'u2', 'spam')
    expect(error).toBeTruthy()
  })
})
