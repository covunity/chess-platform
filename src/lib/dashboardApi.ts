import type { SupabaseClient } from '@supabase/supabase-js'
import type { CourseLevel } from './creatorApi'

export interface LearnerStats {
  currentStreak: number
  bestStreak: number
  lessonsThisWeek: number
  lessonsLastWeek: number
  bookmarksCount: number
  hoursStudied: number
  coursesCount: number
}

export interface EnrolledCourseProgress {
  course_id: string
  title: string
  thumbnail_url: string | null
  level: CourseLevel
  creator_name: string | null
  enrolled_at: string
  lessonsCount: number
  completedCount: number
  nextLesson: { id: string; title: string } | null
  isComplete: boolean
}

export interface RecommendedCourse {
  id: string
  title: string
  thumbnail_url: string | null
  creator_name: string | null
  rating_avg: number
  rating_count: number
  enrollment_count: number
  price: number
}

const ZERO_STATS: LearnerStats = {
  currentStreak: 0,
  bestStreak: 0,
  lessonsThisWeek: 0,
  lessonsLastWeek: 0,
  bookmarksCount: 0,
  hoursStudied: 0,
  coursesCount: 0,
}

// ── stats ───────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

function startOfIsoWeek(d: Date): Date {
  const out = startOfDay(d)
  const dayOfWeek = out.getDay() // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const offset = (dayOfWeek + 6) % 7 // distance to most recent Monday
  out.setDate(out.getDate() - offset)
  return out
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function computeStreaks(
  completedAtList: string[]
): { currentStreak: number; bestStreak: number } {
  if (completedAtList.length === 0) return { currentStreak: 0, bestStreak: 0 }

  const uniqueDayKeys = new Set<string>()
  const dayDates: Date[] = []
  for (const iso of completedAtList) {
    const d = startOfDay(new Date(iso))
    const key = dayKey(d)
    if (!uniqueDayKeys.has(key)) {
      uniqueDayKeys.add(key)
      dayDates.push(d)
    }
  }
  dayDates.sort((a, b) => b.getTime() - a.getTime()) // newest first

  // Current streak: anchor to today (or yesterday if no completion today).
  const today = startOfDay(new Date())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  let currentStreak = 0
  let cursor: Date | null = null
  if (dayKey(dayDates[0]) === dayKey(today)) cursor = today
  else if (dayKey(dayDates[0]) === dayKey(yesterday)) cursor = yesterday

  if (cursor) {
    const lookup = new Set(dayDates.map(dayKey))
    while (lookup.has(dayKey(cursor))) {
      currentStreak += 1
      cursor.setDate(cursor.getDate() - 1)
    }
  }

  // Best streak: scan oldest → newest, counting consecutive runs.
  const ascending = [...dayDates].reverse()
  let bestStreak = 1
  let run = 1
  for (let i = 1; i < ascending.length; i++) {
    const prev = ascending[i - 1]
    const cur = ascending[i]
    const expectedNext = new Date(prev)
    expectedNext.setDate(expectedNext.getDate() + 1)
    if (dayKey(expectedNext) === dayKey(cur)) {
      run += 1
      if (run > bestStreak) bestStreak = run
    } else {
      run = 1
    }
  }

  return { currentStreak, bestStreak: Math.max(bestStreak, currentStreak) }
}

export async function getLearnerStats(
  client: SupabaseClient,
  userId: string
): Promise<{ stats: LearnerStats | null; error: Error | null }> {
  const [progressRes, bookmarksRes, enrollmentsRes] = await Promise.all([
    client
      .from('lesson_progress')
      .select('completed_at, lessons(duration_seconds)')
      .eq('user_id', userId)
      .eq('completed', true),
    client.from('bookmarks').select('id').eq('user_id', userId),
    client.from('enrollments').select('course_id').eq('user_id', userId),
  ])

  if (progressRes.error || bookmarksRes.error || enrollmentsRes.error) {
    const msg =
      progressRes.error?.message ??
      bookmarksRes.error?.message ??
      enrollmentsRes.error?.message ??
      'Failed to load dashboard stats'
    return { stats: null, error: new Error(msg) }
  }

  const completions = (progressRes.data ?? []) as unknown as Array<{
    completed_at: string | null
    // Supabase types this as an array even for to-one joins; normalize below.
    lessons: { duration_seconds: number | null } | { duration_seconds: number | null }[] | null
  }>

  function durationOf(row: typeof completions[number]): number {
    if (!row.lessons) return 0
    if (Array.isArray(row.lessons)) return row.lessons[0]?.duration_seconds ?? 0
    return row.lessons.duration_seconds ?? 0
  }

  const validCompletions = completions.filter(c => c.completed_at)

  const { currentStreak, bestStreak } = computeStreaks(
    validCompletions.map(c => c.completed_at as string)
  )

  const now = new Date()
  const thisWeekStart = startOfIsoWeek(now)
  const lastWeekStart = new Date(thisWeekStart)
  lastWeekStart.setDate(lastWeekStart.getDate() - 7)

  let lessonsThisWeek = 0
  let lessonsLastWeek = 0
  let durationSecondsTotal = 0
  for (const c of validCompletions) {
    const t = new Date(c.completed_at as string).getTime()
    if (t >= thisWeekStart.getTime()) lessonsThisWeek += 1
    else if (t >= lastWeekStart.getTime()) lessonsLastWeek += 1
    durationSecondsTotal += durationOf(c)
  }

  return {
    stats: {
      ...ZERO_STATS,
      currentStreak,
      bestStreak,
      lessonsThisWeek,
      lessonsLastWeek,
      hoursStudied: durationSecondsTotal / 3600,
      bookmarksCount: (bookmarksRes.data ?? []).length,
      coursesCount: (enrollmentsRes.data ?? []).length,
    },
    error: null,
  }
}

// ── enrolled courses progress ───────────────────────────────────────────

export async function getEnrolledCoursesProgress(
  client: SupabaseClient,
  userId: string
): Promise<{ courses: EnrolledCourseProgress[] | null; error: Error | null }> {
  const enrollmentsRes = await client
    .from('enrollments')
    .select(`
      course_id,
      enrolled_at,
      courses:course_id (
        id, title, thumbnail_url, level,
        users:creator_id ( name ),
        chapters (
          id, position,
          lessons ( id, title, position )
        )
      )
    `)
    .eq('user_id', userId)
    .order('enrolled_at', { ascending: false })

  if (enrollmentsRes.error) {
    return { courses: null, error: new Error(enrollmentsRes.error.message) }
  }

  const enrollmentRows = (enrollmentsRes.data ?? []) as Array<Record<string, unknown>>

  const completedRes = await client
    .from('lesson_progress')
    .select('lesson_id')
    .eq('user_id', userId)
    .eq('completed', true)

  if (completedRes.error) {
    return { courses: null, error: new Error(completedRes.error.message) }
  }

  const completedLessonIds = new Set<string>(
    (completedRes.data ?? []).map((r: { lesson_id: string }) => r.lesson_id)
  )

  const courses: EnrolledCourseProgress[] = enrollmentRows.map(row => {
    const courseObj = (row.courses ?? null) as Record<string, unknown> | null
    const creator = (courseObj?.users ?? null) as { name?: string } | null
    const chapters = Array.isArray(courseObj?.chapters)
      ? (courseObj?.chapters as Array<Record<string, unknown>>)
      : []

    const orderedLessons = [...chapters]
      .sort((a, b) => (a.position as number) - (b.position as number))
      .flatMap(ch => {
        const ls = Array.isArray(ch.lessons) ? (ch.lessons as Array<Record<string, unknown>>) : []
        return [...ls].sort((a, b) => (a.position as number) - (b.position as number))
      })

    const lessonsCount = orderedLessons.length
    let completedCount = 0
    let nextLesson: { id: string; title: string } | null = null
    for (const l of orderedLessons) {
      const id = l.id as string
      const title = l.title as string
      if (completedLessonIds.has(id)) {
        completedCount += 1
      } else if (!nextLesson) {
        nextLesson = { id, title }
      }
    }

    const isComplete = lessonsCount > 0 && completedCount === lessonsCount
    if (isComplete) nextLesson = null

    return {
      course_id: (courseObj?.id as string) ?? (row.course_id as string),
      title: (courseObj?.title as string) ?? '',
      thumbnail_url: (courseObj?.thumbnail_url as string | null) ?? null,
      level: (courseObj?.level as CourseLevel) ?? 'beginner',
      creator_name: creator?.name ?? null,
      enrolled_at: (row.enrolled_at as string) ?? '',
      lessonsCount,
      completedCount,
      nextLesson,
      isComplete,
    }
  })

  return { courses, error: null }
}

// ── recommended courses ─────────────────────────────────────────────────

export async function getRecommendedCourses(
  client: SupabaseClient,
  userId: string,
  limit = 3
): Promise<{ courses: RecommendedCourse[] | null; error: Error | null }> {
  const [coursesRes, myEnrollmentsRes] = await Promise.all([
    client
      .from('courses')
      .select(`
        id, title, price, thumbnail_url, creator_id,
        users:creator_id ( name ),
        reviews ( rating ),
        enrollments ( id )
      `)
      .eq('status', 'published'),
    client.from('enrollments').select('course_id').eq('user_id', userId),
  ])

  if (coursesRes.error || myEnrollmentsRes.error) {
    const msg = coursesRes.error?.message ?? myEnrollmentsRes.error?.message ?? 'Failed to load recommendations'
    return { courses: null, error: new Error(msg) }
  }

  const enrolledIds = new Set<string>(
    (myEnrollmentsRes.data ?? []).map((r: { course_id: string }) => r.course_id)
  )

  const rows = (coursesRes.data ?? []) as Array<Record<string, unknown>>

  const candidates: RecommendedCourse[] = rows
    .filter(row => (row.price as number) === 0 && !enrolledIds.has(row.id as string))
    .map(row => {
      const reviews = Array.isArray(row.reviews) ? (row.reviews as Array<{ rating: number }>) : []
      const enrollments = Array.isArray(row.enrollments) ? row.enrollments : []
      const ratings = reviews.map(r => r.rating)
      const rating_avg = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0
      const creator = row.users as { name?: string } | null
      return {
        id: row.id as string,
        title: row.title as string,
        thumbnail_url: (row.thumbnail_url as string | null) ?? null,
        creator_name: creator?.name ?? null,
        rating_avg,
        rating_count: ratings.length,
        enrollment_count: enrollments.length,
        price: row.price as number,
      }
    })

  candidates.sort((a, b) => {
    const score = b.rating_avg * b.enrollment_count - a.rating_avg * a.enrollment_count
    if (score !== 0) return score
    return b.enrollment_count - a.enrollment_count
  })

  return { courses: candidates.slice(0, Math.max(0, limit)), error: null }
}
