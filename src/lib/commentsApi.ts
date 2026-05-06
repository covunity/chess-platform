import type { SupabaseClient } from '@supabase/supabase-js'

export type ReportReason = 'inappropriate' | 'spam' | 'misleading'

export interface Comment {
  id: string
  course_id: string
  author_id: string
  body: string
  is_hidden: boolean
  created_at: string
  updated_at: string
  author: { name: string | null } | null
}

const PAGE_SIZE = 20

export async function listComments(
  client: SupabaseClient,
  courseId: string,
  page = 1
): Promise<{ comments: Comment[]; total: number; error: Error | null }> {
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const { data, error, count } = await client
    .from('comments')
    .select('id, course_id, author_id, body, is_hidden, created_at, updated_at, author:author_id(name)', {
      count: 'exact',
    })
    .eq('course_id', courseId)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) return { comments: [], total: 0, error: error as unknown as Error }
  return { comments: (data ?? []) as unknown as Comment[], total: count ?? 0, error: null }
}

export async function createComment(
  client: SupabaseClient,
  input: { courseId: string; authorId: string; body: string }
): Promise<{ comment: Comment | null; error: Error | null }> {
  if (input.body.length > 2000) {
    return { comment: null, error: new Error('Comment body must not exceed 2000 characters') }
  }

  const { data, error } = await client
    .from('comments')
    .insert({ course_id: input.courseId, author_id: input.authorId, body: input.body })
    .select()
    .single()

  if (error) return { comment: null, error: error as unknown as Error }
  return { comment: data as Comment, error: null }
}

export async function updateComment(
  client: SupabaseClient,
  commentId: string,
  authorId: string,
  body: string
): Promise<{ comment: Comment | null; error: Error | null }> {
  if (body.length > 2000) {
    return { comment: null, error: new Error('Comment body must not exceed 2000 characters') }
  }

  const { data, error } = await client
    .from('comments')
    .update({ body, updated_at: new Date().toISOString() })
    .eq('id', commentId)
    .eq('author_id', authorId)
    .select()
    .single()

  if (error) return { comment: null, error: error as unknown as Error }
  return { comment: data as Comment, error: null }
}

export async function deleteComment(
  client: SupabaseClient,
  commentId: string,
  authorId: string
): Promise<{ error: Error | null }> {
  const { error } = await client
    .from('comments')
    .delete()
    .eq('id', commentId)
    .eq('author_id', authorId)

  return { error: error as unknown as Error | null }
}

export async function reportComment(
  client: SupabaseClient,
  commentId: string,
  reporterId: string,
  reason: ReportReason,
  context?: string
): Promise<{ error: Error | null }> {
  const { error } = await client
    .from('reports')
    .insert({ comment_id: commentId, reporter_id: reporterId, reason, context: context ?? null })

  return { error: error as unknown as Error | null }
}
