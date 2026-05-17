import type { SupabaseClient } from '@supabase/supabase-js'

export type CourseStatus  = 'draft' | 'pending_review' | 'published'
export type CourseLevel   = 'beginner' | 'intermediate' | 'advanced'
export type LessonType    = 'video' | 'chess' | 'puzzle'
export type VideoProvider = 'supabase' | 'cloudflare'
export type VideoStatus   = 'idle' | 'uploading' | 'processing' | 'ready' | 'error'

export interface Course {
  id: string
  creator_id: string
  title: string
  description: string | null
  thumbnail_url: string | null
  price: number
  level: CourseLevel
  language: 'vi' | 'en'
  tags: string[]
  status: CourseStatus
  created_at: string
  updated_at: string
}

export interface Chapter {
  id: string
  course_id: string
  title: string
  position: number
  created_at: string
  lessons?: Lesson[]
}

export interface Lesson {
  id: string
  chapter_id: string
  title: string
  type: LessonType
  position: number
  free_preview: boolean
  pgn_data: string
  board_perspective: 'white' | 'black'
  created_at: string
  duration_seconds?: number
  video_provider?: VideoProvider | null
  video_provider_id?: string | null
  video_status?: VideoStatus
  video_filename?: string | null
  video_size_bytes?: number | null
  video_mime?: string | null
  video_error?: string | null
  description?: string | null
  has_rewind_mode?: boolean
  /** When set, this lesson is the auto-managed Rewind sibling of the referenced source. */
  rewind_source_id?: string | null
}

export interface LessonVideoUpdate {
  video_provider: VideoProvider
  video_provider_id: string
  video_status: VideoStatus
  video_filename: string
  video_size_bytes: number
  video_mime: string
  duration_seconds?: number
}

export interface CreateCourseInput {
  title: string
  description?: string
  thumbnail_url?: string
  price: number
  level: CourseLevel
  language: 'vi' | 'en'
  tags: string[]
}

export interface CreateChapterInput {
  title: string
  position: number
}

export interface CreateLessonInput {
  title: string
  type: LessonType
  position: number
  free_preview: boolean
}

// ── Courses ───────────────────────────────────────────────────────────────

export async function listCourses(
  client: SupabaseClient,
  creatorId: string,
  options: { status?: CourseStatus } = {}
): Promise<{ courses: Course[]; total: number; error: Error | null }> {
  let query = client
    .from('courses')
    .select('*', { count: 'exact' })
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false })

  if (options.status) {
    query = query.eq('status', options.status)
  }

  const { data, count, error } = await query
  return { courses: (data as Course[]) ?? [], total: count ?? 0, error: error as Error | null }
}

export async function createCourse(
  client: SupabaseClient,
  creatorId: string,
  input: CreateCourseInput
): Promise<{ course: Course | null; error: Error | null }> {
  const { data, error } = await client
    .from('courses')
    .insert({ ...input, creator_id: creatorId, status: 'draft' })
    .select()
    .single()

  return { course: (data as Course) ?? null, error: error as Error | null }
}

export async function updateCourse(
  client: SupabaseClient,
  courseId: string,
  patch: Partial<Omit<Course, 'id' | 'creator_id' | 'created_at' | 'updated_at'>>
): Promise<{ course: Course | null; error: Error | null }> {
  const { data, error } = await client
    .from('courses')
    .update(patch)
    .eq('id', courseId)
    .select()
    .single()

  return { course: (data as Course) ?? null, error: error as Error | null }
}

export async function deleteCourse(
  client: SupabaseClient,
  courseId: string
): Promise<{ error: Error | null }> {
  const { error } = await client.from('courses').delete().eq('id', courseId)
  return { error: error as Error | null }
}

export async function duplicateCourse(
  client: SupabaseClient,
  courseId: string
): Promise<{ course: Course | null; error: Error | null }> {
  const { data: original, error: fetchErr } = await client
    .from('courses')
    .select('*')
    .eq('id', courseId)
    .single()

  if (fetchErr || !original) {
    return { course: null, error: (fetchErr as Error | null) ?? new Error('course_not_found') }
  }

  const orig = original as Course
  const courseInsert = {
    creator_id: orig.creator_id,
    title: `Copy of ${orig.title}`,
    description: orig.description,
    thumbnail_url: orig.thumbnail_url,
    price: orig.price,
    level: orig.level,
    language: orig.language,
    tags: orig.tags,
    status: 'draft' as const,
  }

  const { data: newCourseRow, error: insertErr } = await client
    .from('courses')
    .insert(courseInsert)
    .select()
    .single()

  if (insertErr || !newCourseRow) {
    return { course: null, error: (insertErr as Error | null) ?? new Error('insert_failed') }
  }

  const newCourse = newCourseRow as Course

  const { data: chapterRows } = await client
    .from('chapters')
    .select('*, lessons(*)')
    .eq('course_id', courseId)
    .order('position', { ascending: true })

  const chapters = (chapterRows ?? []) as (Chapter & { lessons?: Lesson[] })[]

  for (const ch of chapters) {
    const { data: newChapterRow } = await client
      .from('chapters')
      .insert({
        course_id: newCourse.id,
        title: ch.title,
        position: ch.position,
      })
      .select()
      .single()

    const newChapter = newChapterRow as Chapter | null
    const sourceLessons = ch.lessons ?? []
    if (newChapter && sourceLessons.length > 0) {
      const lessonsInsert = sourceLessons.map(l => ({
        chapter_id: newChapter.id,
        title: l.title,
        type: l.type,
        position: l.position,
        free_preview: l.free_preview,
        pgn_data: l.pgn_data,
        board_perspective: l.board_perspective,
        video_provider: l.video_provider,
        video_provider_id: l.video_provider_id,
        video_status: l.video_status,
        video_filename: l.video_filename,
        video_size_bytes: l.video_size_bytes,
        video_mime: l.video_mime,
        duration_seconds: l.duration_seconds,
      }))
      const { error: insertLessonErr } = await client.from('lessons').insert(lessonsInsert)
      if (insertLessonErr) {
        // Best-effort rollback of the partial clone (cascades through chapters/lessons).
        // supabase-js has no client transactions, so we accept a small window where
        // a delete failure leaves a stray draft — the user can delete it manually.
        await client.from('courses').delete().eq('id', newCourse.id)
        const friendly = insertLessonErr.message?.includes('lesson_limit_exceeded')
          ? new Error('errors.lessonLimitReached')
          : (insertLessonErr as unknown as Error)
        return { course: null, error: friendly }
      }
    }
  }

  return { course: newCourse, error: null }
}

// ── Chapters ──────────────────────────────────────────────────────────────

export async function listChapters(
  client: SupabaseClient,
  courseId: string
): Promise<{ chapters: Chapter[]; error: Error | null }> {
  const { data, error } = await client
    .from('chapters')
    .select('*, lessons(*)')
    .eq('course_id', courseId)
    .order('position', { ascending: true })

  return { chapters: (data as Chapter[]) ?? [], error: error as Error | null }
}

export async function createChapter(
  client: SupabaseClient,
  courseId: string,
  input: CreateChapterInput
): Promise<{ chapter: Chapter | null; error: Error | null }> {
  // Pre-check: count chapters vs creator's tier limit before attempting insert.
  // The DB trigger is the authoritative backstop; this gives a friendly error earlier.
  const [{ count: chapterCount }, { data: courseRow }] = await Promise.all([
    client.from('chapters').select('*', { count: 'exact', head: true }).eq('course_id', courseId),
    client.from('courses').select('creator_id').eq('id', courseId).single(),
  ])

  if (courseRow?.creator_id) {
    const { data: userRow } = await client
      .from('users')
      .select('account_tier_id, account_tiers!account_tier_id(max_chapters_per_course)')
      .eq('id', courseRow.creator_id)
      .single()

    const maxChapters = (userRow as { account_tiers?: { max_chapters_per_course?: number } } | null)
      ?.account_tiers?.max_chapters_per_course

    if (maxChapters != null && (chapterCount ?? 0) >= maxChapters) {
      return { chapter: null, error: new Error('errors.chapterLimitReached') }
    }
  }

  const { data, error } = await client
    .from('chapters')
    .insert({ ...input, course_id: courseId })
    .select()
    .single()

  return { chapter: (data as Chapter) ?? null, error: error as Error | null }
}

export async function updateChapter(
  client: SupabaseClient,
  chapterId: string,
  patch: Partial<Pick<Chapter, 'title' | 'position'>>
): Promise<{ chapter: Chapter | null; error: Error | null }> {
  const { data, error } = await client
    .from('chapters')
    .update(patch)
    .eq('id', chapterId)
    .select()
    .single()

  return { chapter: (data as Chapter) ?? null, error: error as Error | null }
}

export async function deleteChapter(
  client: SupabaseClient,
  chapterId: string
): Promise<{ error: Error | null }> {
  const { error } = await client.from('chapters').delete().eq('id', chapterId)
  return { error: error as Error | null }
}

export async function reorderChapters(
  client: SupabaseClient,
  updates: { id: string; position: number }[]
): Promise<{ error: Error | null }> {
  const { error } = await client
    .from('chapters')
    .upsert(updates, { onConflict: 'id' })

  return { error: error as Error | null }
}

// ── Lessons ───────────────────────────────────────────────────────────────

export async function createLesson(
  client: SupabaseClient,
  chapterId: string,
  input: CreateLessonInput
): Promise<{ lesson: Lesson | null; error: Error | null }> {
  const { data, error } = await client
    .from('lessons')
    .insert({ ...input, chapter_id: chapterId })
    .select()
    .single()

  // enforce_lesson_limit trigger raises 'lesson_limit_exceeded: current=X, max=Y'
  // (SQLSTATE check_violation). Map to a friendly i18n key for the UI.
  if (error?.message?.includes('lesson_limit_exceeded')) {
    return { lesson: null, error: new Error('errors.lessonLimitReached') }
  }
  return { lesson: (data as Lesson) ?? null, error: error as Error | null }
}

export async function updateLesson(
  client: SupabaseClient,
  lessonId: string,
  patch: Partial<Pick<Lesson, 'title' | 'type' | 'position' | 'free_preview' | 'pgn_data' | 'board_perspective' | 'description' | 'has_rewind_mode'>>
): Promise<{ lesson: Lesson | null; error: Error | null }> {
  const { data, error } = await client
    .from('lessons')
    .update(patch)
    .eq('id', lessonId)
    .select()
    .single()

  // Toggling has_rewind_mode=true fires the sibling-create trigger which inserts
  // a new lesson row — that insert can fail enforce_lesson_limit. Map here too
  // so the UI can show the friendly toast.
  if (error?.message?.includes('lesson_limit_exceeded')) {
    return { lesson: null, error: new Error('errors.lessonLimitReached') }
  }
  return { lesson: (data as Lesson) ?? null, error: error as Error | null }
}

export async function deleteLesson(
  client: SupabaseClient,
  lessonId: string
): Promise<{ error: Error | null }> {
  const { error } = await client.from('lessons').delete().eq('id', lessonId)
  return { error: error as Error | null }
}

export async function reorderLessons(
  client: SupabaseClient,
  updates: { id: string; position: number }[]
): Promise<{ error: Error | null }> {
  const { error } = await client
    .from('lessons')
    .upsert(updates, { onConflict: 'id' })

  return { error: error as Error | null }
}

// ── Lesson video ──────────────────────────────────────────────────────────

export async function setLessonVideo(
  client: SupabaseClient,
  lessonId: string,
  patch: LessonVideoUpdate
): Promise<{ lesson: Lesson | null; error: Error | null }> {
  const { data, error } = await client
    .from('lessons')
    .update(patch)
    .eq('id', lessonId)
    .select()
    .single()

  return { lesson: (data as Lesson) ?? null, error: error as Error | null }
}

export async function setLessonVideoStatus(
  client: SupabaseClient,
  lessonId: string,
  status: VideoStatus,
  errorMessage?: string,
): Promise<{ error: Error | null }> {
  const { error } = await client
    .from('lessons')
    .update({ video_status: status, video_error: errorMessage ?? null })
    .eq('id', lessonId)
  return { error: error as Error | null }
}

export async function clearLessonVideo(
  client: SupabaseClient,
  lessonId: string
): Promise<{ error: Error | null }> {
  const { error } = await client
    .from('lessons')
    .update({
      video_provider: null,
      video_provider_id: null,
      video_status: 'idle',
      video_filename: null,
      video_size_bytes: null,
      video_mime: null,
      video_error: null,
      duration_seconds: 0,
    })
    .eq('id', lessonId)
  return { error: error as Error | null }
}

// ── Helpers ───────────────────────────────────────────────────────────────

export async function countCourseChildren(
  client: SupabaseClient,
  courseId: string
): Promise<{ chapters: number; lessons: number }> {
  const { data: chapterData, count: chapterCount } = await client
    .from('chapters')
    .select('id', { count: 'exact' })
    .eq('course_id', courseId)

  const chapterIds = ((chapterData ?? []) as { id: string }[]).map(ch => ch.id)

  let lessonCount = 0
  if (chapterIds.length > 0) {
    const { count } = await client
      .from('lessons')
      .select('*', { count: 'exact', head: true })
      .in('chapter_id', chapterIds)
    lessonCount = count ?? 0
  }

  return { chapters: chapterCount ?? 0, lessons: lessonCount }
}

// ── Publish flow ──────────────────────────────────────────────────────────

export interface PublishReadiness {
  ready: boolean
  reasons: string[]
}

export async function canPublishCourse(
  client: SupabaseClient,
  courseId: string
): Promise<PublishReadiness> {
  const reasons: string[] = []

  const { data: course } = await client
    .from('courses')
    .select('title, description, thumbnail_url, price, status')
    .eq('id', courseId)
    .single()

  if (!course) return { ready: false, reasons: ['course_not_found'] }

  if (!course.title?.trim()) reasons.push('missing_title')
  if (!course.description?.trim()) reasons.push('missing_description')
  if (!course.thumbnail_url?.trim()) reasons.push('missing_thumbnail')
  if (course.price == null) reasons.push('missing_price')
  if (course.status !== 'draft') reasons.push('status_not_draft')

  const { data: chapterData } = await client
    .from('chapters')
    .select('id')
    .eq('course_id', courseId)

  const chapterIds = ((chapterData ?? []) as { id: string }[]).map(ch => ch.id)

  if (chapterIds.length === 0) {
    reasons.push('no_chapters')
  } else {
    const { count } = await client
      .from('lessons')
      .select('*', { count: 'exact', head: true })
      .in('chapter_id', chapterIds)

    if ((count ?? 0) === 0) reasons.push('no_lessons')
  }

  return { ready: reasons.length === 0, reasons }
}

export async function publishCourse(
  client: SupabaseClient,
  courseId: string
): Promise<{ course: Course | null; error: Error | null }> {
  const { data, error } = await client
    .from('courses')
    .update({ status: 'published' })
    .eq('id', courseId)
    .eq('status', 'draft')
    .select()
    .single()

  return { course: (data as Course) ?? null, error: error as Error | null }
}

export async function unpublishCourse(
  client: SupabaseClient,
  courseId: string
): Promise<{ course: Course | null; error: Error | null }> {
  const { data, error } = await client
    .from('courses')
    .update({ status: 'draft' })
    .eq('id', courseId)
    .eq('status', 'published')
    .select()
    .single()

  return { course: (data as Course) ?? null, error: error as Error | null }
}

export async function submitCourseForReview(
  client: SupabaseClient,
  courseId: string
): Promise<{ course: Course | null; error: Error | null }> {
  const { data, error } = await client
    .from('courses')
    .update({ status: 'pending_review' })
    .eq('id', courseId)
    .eq('status', 'draft')
    .select()
    .single()

  return { course: (data as Course) ?? null, error: error as Error | null }
}

// ── Dashboard KPIs ────────────────────────────────────────────────────────

export interface CreatorKpis {
  totalStudents: number
  grossRevenue: number
  totalPayout: number
  avgRating: number
  courseCount: number
}

export interface CourseStats {
  courseId: string
  students: number
  revenue: number
  rating: number | null
}

export async function fetchCreatorKpis(
  client: SupabaseClient,
  creatorId: string
): Promise<CreatorKpis> {
  const { data: courseData } = await client
    .from('courses')
    .select('id')
    .eq('creator_id', creatorId)

  const courseIds = ((courseData ?? []) as { id: string }[]).map(c => c.id)

  if (courseIds.length === 0) {
    return { totalStudents: 0, grossRevenue: 0, totalPayout: 0, avgRating: 0, courseCount: 0 }
  }

  const { data: enrollmentData } = await client
    .from('enrollments')
    .select('user_id')
    .in('course_id', courseIds)

  const distinctUsers = new Set(((enrollmentData ?? []) as { user_id: string }[]).map(e => e.user_id))

  const { data: orderData } = await client
    .from('orders')
    .select('amount, creator_payout')
    .eq('status', 'active')
    .in('course_id', courseIds)

  const orders = (orderData ?? []) as { amount: number; creator_payout: number }[]
  const grossRevenue = orders.reduce((sum, o) => sum + (o.amount ?? 0), 0)
  const totalPayout = orders.reduce((sum, o) => sum + (o.creator_payout ?? 0), 0)

  const { data: publishedData } = await client
    .from('courses')
    .select('id')
    .eq('creator_id', creatorId)
    .eq('status', 'published')

  const publishedIds = ((publishedData ?? []) as { id: string }[]).map(c => c.id)

  let avgRating = 0
  if (publishedIds.length > 0) {
    const { data: reviewData } = await client
      .from('reviews')
      .select('rating')
      .in('course_id', publishedIds)

    const reviews = (reviewData ?? []) as { rating: number }[]
    if (reviews.length > 0) {
      avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    }
  }

  return {
    totalStudents: distinctUsers.size,
    grossRevenue,
    totalPayout,
    avgRating,
    courseCount: courseIds.length,
  }
}

export async function fetchCoursesWithStats(
  client: SupabaseClient,
  courseIds: string[]
): Promise<CourseStats[]> {
  if (courseIds.length === 0) return []

  const { data: enrollmentData } = await client
    .from('enrollments')
    .select('course_id, user_id')
    .in('course_id', courseIds)

  const { data: orderData } = await client
    .from('orders')
    .select('course_id, amount')
    .eq('status', 'active')
    .in('course_id', courseIds)

  const { data: reviewData } = await client
    .from('reviews')
    .select('course_id, rating')
    .in('course_id', courseIds)

  const enrollments = (enrollmentData ?? []) as { course_id: string; user_id: string }[]
  const orders = (orderData ?? []) as { course_id: string; amount: number }[]
  const reviews = (reviewData ?? []) as { course_id: string; rating: number }[]

  return courseIds.map(courseId => {
    const courseEnrollments = enrollments.filter(e => e.course_id === courseId)
    const distinctStudents = new Set(courseEnrollments.map(e => e.user_id)).size

    const courseOrders = orders.filter(o => o.course_id === courseId)
    const revenue = courseOrders.reduce((sum, o) => sum + (o.amount ?? 0), 0)

    const courseReviews = reviews.filter(r => r.course_id === courseId)
    const rating = courseReviews.length > 0
      ? courseReviews.reduce((sum, r) => sum + r.rating, 0) / courseReviews.length
      : null

    return { courseId, students: distinctStudents, revenue, rating }
  })
}
