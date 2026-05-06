import type { SupabaseClient } from '@supabase/supabase-js'
import type { CourseLevel } from './creatorApi'

export type SortOption = 'newest' | 'popular' | 'rating'

export interface PublicCourse {
  id: string
  title: string
  description: string | null
  thumbnail_url: string | null
  price: number
  level: CourseLevel
  tags: string[]
  creator_id: string
  creator_name: string | null
  rating_avg: number
  rating_count: number
  lessons_count: number
  hours_total: number
  created_at: string
  enrollment_count: number
}

export interface ListPublishedCoursesOptions {
  q?: string
  level?: CourseLevel
  tag?: string
  sort?: SortOption
}

export async function listPublishedCourses(
  client: SupabaseClient,
  options: ListPublishedCoursesOptions = {}
): Promise<{ courses: PublicCourse[]; error: Error | null }> {
  let query = client
    .from('courses')
    .select(`
      id,
      title,
      description,
      thumbnail_url,
      price,
      level,
      tags,
      creator_id,
      created_at,
      profiles:creator_id ( full_name ),
      reviews ( rating ),
      enrollments ( id ),
      chapters ( lessons ( id ) )
    `)
    .eq('status', 'published')

  if (options.q) {
    query = query.ilike('title', `%${options.q}%`)
  }

  if (options.level) {
    query = query.eq('level', options.level)
  }

  if (options.tag) {
    query = query.contains('tags', [options.tag])
  }

  if (options.sort === 'popular') {
    query = query.order('created_at', { ascending: false })
  } else if (options.sort === 'rating') {
    query = query.order('created_at', { ascending: false })
  } else {
    query = query.order('created_at', { ascending: false })
  }

  const { data, error } = await query

  if (error) {
    return { courses: [], error: error as unknown as Error }
  }

  const courses: PublicCourse[] = (data ?? []).map((row: Record<string, unknown>) => {
    const reviews = Array.isArray(row.reviews) ? row.reviews as Array<{ rating: number }> : []
    const enrollments = Array.isArray(row.enrollments) ? row.enrollments : []
    const chapters = Array.isArray(row.chapters) ? row.chapters as Array<{ lessons: Array<unknown> }> : []
    const lessons = chapters.flatMap(ch => Array.isArray(ch.lessons) ? ch.lessons : [])
    const ratings = reviews.map(r => r.rating)
    const rating_avg = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0
    const profiles = row.profiles as { full_name?: string } | null

    return {
      id: row.id as string,
      title: row.title as string,
      description: row.description as string | null,
      thumbnail_url: row.thumbnail_url as string | null,
      price: row.price as number,
      level: row.level as CourseLevel,
      tags: Array.isArray(row.tags) ? row.tags as string[] : [],
      creator_id: row.creator_id as string,
      creator_name: profiles?.full_name ?? null,
      rating_avg,
      rating_count: ratings.length,
      lessons_count: lessons.length,
      hours_total: 0,
      created_at: row.created_at as string,
      enrollment_count: enrollments.length,
    }
  })

  return { courses, error: null }
}
