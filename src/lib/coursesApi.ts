import type { SupabaseClient } from '@supabase/supabase-js'
import type { CourseLevel, LessonType } from './creatorApi'

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

export interface CourseDetailLesson {
  id: string
  title: string
  type: LessonType
  position: number
  free_preview: boolean
  duration_seconds: number
}

export interface CourseDetailChapter {
  id: string
  title: string
  position: number
  lessons: CourseDetailLesson[]
}

export interface CourseReview {
  id: string
  reviewer_name: string | null
  rating: number
  title: string | null
  body: string | null
  created_at: string
}

export interface CourseDetail extends PublicCourse {
  what_you_learn: string[]
  prerequisites: string | null
  language: 'vi' | 'en'
  original_price: number | null
  promo_ends_at: string | null
  creator_bio: string | null
  chapters: CourseDetailChapter[]
  reviews: CourseReview[]
  free_preview_count: number
  pgn_annotations_count: number
  puzzle_count: number
}

export async function getCourseDetail(
  client: SupabaseClient,
  courseId: string
): Promise<{ course: CourseDetail | null; error: Error | null }> {
  const { data, error } = await client
    .from('courses')
    .select(`
      id, title, description, thumbnail_url, price, original_price, promo_ends_at,
      level, language, tags, creator_id, what_you_learn, prerequisites, created_at,
      creator:creator_id ( name ),
      reviews ( id, rating, title, body, created_at, reviewer:reviewer_id ( name ) ),
      enrollments ( id ),
      chapters (
        id, title, position,
        lessons ( id, title, type, position, free_preview, duration_seconds )
      )
    `)
    .eq('id', courseId)
    .eq('status', 'published')
    .single()

  if (error || !data) {
    return { course: null, error: (error as Error | null) ?? new Error('Not found') }
  }

  const row = data as Record<string, unknown>
  const reviews = Array.isArray(row.reviews) ? (row.reviews as Array<Record<string, unknown>>) : []
  const enrollments = Array.isArray(row.enrollments) ? row.enrollments : []
  const rawChapters = Array.isArray(row.chapters) ? (row.chapters as Array<Record<string, unknown>>) : []
  const creator = row.creator as { name?: string } | null

  const ratings = reviews.map(r => r.rating as number)
  const rating_avg = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0

  const chapters: CourseDetailChapter[] = rawChapters
    .sort((a, b) => (a.position as number) - (b.position as number))
    .map(ch => {
      const rawLessons = Array.isArray(ch.lessons) ? (ch.lessons as Array<Record<string, unknown>>) : []
      const lessons: CourseDetailLesson[] = rawLessons
        .sort((a, b) => (a.position as number) - (b.position as number))
        .map(l => ({
          id: l.id as string,
          title: l.title as string,
          type: l.type as LessonType,
          position: l.position as number,
          free_preview: Boolean(l.free_preview),
          duration_seconds: (l.duration_seconds as number) ?? 0,
        }))
      return {
        id: ch.id as string,
        title: ch.title as string,
        position: ch.position as number,
        lessons,
      }
    })

  const allLessons = chapters.flatMap(ch => ch.lessons)
  const free_preview_count = allLessons.filter(l => l.free_preview).length
  const pgn_annotations_count = allLessons.filter(l => l.type === 'chess').length
  const puzzle_count = allLessons.filter(l => l.type === 'puzzle').length
  const hours_total = allLessons.reduce((sum, l) => sum + l.duration_seconds, 0) / 3600

  const courseReviews: CourseReview[] = reviews.map(r => {
    const reviewer = r.reviewer as { name?: string } | null
    return {
      id: r.id as string,
      reviewer_name: reviewer?.name ?? null,
      rating: r.rating as number,
      title: (r.title as string | null) ?? null,
      body: (r.body as string | null) ?? null,
      created_at: r.created_at as string,
    }
  })

  const what_you_learn = Array.isArray(row.what_you_learn) ? (row.what_you_learn as string[]) : []

  return {
    course: {
      id: row.id as string,
      title: row.title as string,
      description: (row.description as string | null) ?? null,
      thumbnail_url: (row.thumbnail_url as string | null) ?? null,
      price: row.price as number,
      original_price: (row.original_price as number | null) ?? null,
      promo_ends_at: (row.promo_ends_at as string | null) ?? null,
      level: row.level as CourseLevel,
      language: (row.language as 'vi' | 'en') ?? 'vi',
      tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
      creator_id: row.creator_id as string,
      creator_name: creator?.name ?? null,
      creator_bio: null,
      rating_avg,
      rating_count: ratings.length,
      lessons_count: allLessons.length,
      hours_total,
      enrollment_count: enrollments.length,
      created_at: row.created_at as string,
      what_you_learn,
      prerequisites: (row.prerequisites as string | null) ?? null,
      chapters,
      reviews: courseReviews,
      free_preview_count,
      pgn_annotations_count,
      puzzle_count,
    },
    error: null,
  }
}

export async function checkUserEnrollment(
  client: SupabaseClient,
  courseId: string,
  userId: string
): Promise<boolean> {
  const { count } = await client
    .from('enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('course_id', courseId)
    .eq('user_id', userId)
  return (count ?? 0) > 0
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
