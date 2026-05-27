import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReportReason } from './commentsApi'

export interface CourseReportRow {
  id: string
  reporter_id: string
  reason: ReportReason
  created_at: string
  reporter: { name: string | null } | null
}

export interface ReportedCourse {
  id: string
  title: string
  creator_id: string
  status: string
  creator: { name: string | null } | null
  course_reports: CourseReportRow[]
}

export async function reportCourse(
  client: SupabaseClient,
  courseId: string,
  reporterId: string,
  reason: ReportReason,
  context?: string
): Promise<{ error: Error | null }> {
  const { error } = await client
    .from('course_reports')
    .insert({ course_id: courseId, reporter_id: reporterId, reason, context: context ?? null })

  return { error: error as unknown as Error | null }
}

export async function listReportedCourses(
  client: SupabaseClient
): Promise<{ courses: ReportedCourse[]; error: Error | null }> {
  const { data, error } = await client
    .from('courses')
    .select(`
      id, title, creator_id, status,
      creator:creator_id(name),
      course_reports(id, reporter_id, reason, created_at, reporter:reporter_id(name))
    `)
    .order('created_at', { ascending: false })

  if (error) return { courses: [], error: error as unknown as Error }

  const rows = ((data ?? []) as unknown as ReportedCourse[]).filter(
    c => c.course_reports && c.course_reports.length > 0
  )
  return { courses: rows, error: null }
}

export async function dismissCourseReports(
  client: SupabaseClient,
  courseId: string
): Promise<{ error: Error | null }> {
  const { error } = await client
    .from('course_reports')
    .delete()
    .eq('course_id', courseId)

  return { error: error as unknown as Error | null }
}

export async function unpublishCourse(
  client: SupabaseClient,
  courseId: string
): Promise<{ error: Error | null }> {
  const { error } = await client
    .from('courses')
    .update({ status: 'draft' })
    .eq('id', courseId)

  return { error: error as unknown as Error | null }
}
