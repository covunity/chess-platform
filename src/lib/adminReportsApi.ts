import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReportReason } from './commentsApi'

export interface ReportRow {
  id: string
  reporter_id: string
  reason: ReportReason
  created_at: string
  reporter: { name: string | null } | null
}

export interface ReportedComment {
  id: string
  course_id: string
  author_id: string
  body: string
  is_hidden: boolean
  created_at: string
  updated_at: string
  author: { name: string | null } | null
  course: { title: string } | null
  reports: ReportRow[]
}

export async function listReportedComments(
  client: SupabaseClient
): Promise<{ comments: ReportedComment[]; error: Error | null }> {
  const { data, error } = await client
    .from('comments')
    .select(`
      id, course_id, author_id, body, is_hidden, created_at, updated_at,
      author:author_id(name),
      course:course_id(title),
      reports(id, reporter_id, reason, created_at, reporter:reporter_id(name))
    `)
    .gt('reports.count', 0)
    .order('created_at', { ascending: false })

  if (error) return { comments: [], error: error as unknown as Error }

  // Filter to comments that actually have reports (gt filter on nested may not work on all Supabase versions)
  const rows = ((data ?? []) as unknown as ReportedComment[]).filter(c => c.reports && c.reports.length > 0)
  return { comments: rows, error: null }
}

export async function hideComment(
  client: SupabaseClient,
  commentId: string
): Promise<{ error: Error | null }> {
  const { error } = await client
    .from('comments')
    .update({ is_hidden: true })
    .eq('id', commentId)

  return { error: error as unknown as Error | null }
}

export async function dismissReports(
  client: SupabaseClient,
  commentId: string
): Promise<{ error: Error | null }> {
  const { error } = await client
    .from('reports')
    .delete()
    .eq('comment_id', commentId)

  return { error: error as unknown as Error | null }
}

/** Returns the total number of distinct items (comments + courses) with at least one pending report. */
export async function getPendingReportCount(
  client: SupabaseClient
): Promise<{ count: number }> {
  const [commentRes, courseRes] = await Promise.all([
    client.from('reports').select('comment_id', { count: 'exact', head: false }),
    client.from('course_reports').select('course_id', { count: 'exact', head: false }),
  ])

  // Distinct comment IDs
  const commentIds = new Set((commentRes.data ?? []).map((r: { comment_id: string }) => r.comment_id))
  // Distinct course IDs
  const courseIds = new Set((courseRes.data ?? []).map((r: { course_id: string }) => r.course_id))

  return { count: commentIds.size + courseIds.size }
}

/** Returns separate pending counts for comment reports and course reports. */
export async function getPendingReportCounts(
  client: SupabaseClient
): Promise<{ commentCount: number; courseCount: number }> {
  const [commentRes, courseRes] = await Promise.all([
    client.from('reports').select('comment_id', { head: false }),
    client.from('course_reports').select('course_id', { head: false }),
  ])

  const commentIds = new Set((commentRes.data ?? []).map((r: { comment_id: string }) => r.comment_id))
  const courseIds = new Set((courseRes.data ?? []).map((r: { course_id: string }) => r.course_id))

  return { commentCount: commentIds.size, courseCount: courseIds.size }
}
