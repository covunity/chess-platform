import type { SupabaseClient } from '@supabase/supabase-js'

export type CourseStatus = 'draft' | 'pending' | 'published'
export type CourseLevel  = 'beginner' | 'intermediate' | 'advanced'
export type LessonType   = 'video' | 'chess' | 'puzzle'

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

  return { lesson: (data as Lesson) ?? null, error: error as Error | null }
}

export async function updateLesson(
  client: SupabaseClient,
  lessonId: string,
  patch: Partial<Pick<Lesson, 'title' | 'type' | 'position' | 'free_preview' | 'pgn_data' | 'board_perspective'>>
): Promise<{ lesson: Lesson | null; error: Error | null }> {
  const { data, error } = await client
    .from('lessons')
    .update(patch)
    .eq('id', lessonId)
    .select()
    .single()

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
