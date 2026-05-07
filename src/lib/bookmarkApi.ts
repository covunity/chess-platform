import type { SupabaseClient } from '@supabase/supabase-js'

export interface BookmarkRow {
  id: string
  user_id: string
  lesson_id: string
  pgn_snapshot: string
  created_at: string
}

export interface BookmarkWithDetails extends BookmarkRow {
  lesson_title: string
  course_id: string
  course_title: string
}

// ---- addBookmark ----

export interface AddBookmarkArgs {
  userId: string
  lessonId: string
  pgnSnapshot: string
}

export interface AddBookmarkResult {
  bookmark: BookmarkRow | null
  error: Error | null
}

export async function addBookmark(
  client: SupabaseClient,
  { userId, lessonId, pgnSnapshot }: AddBookmarkArgs
): Promise<AddBookmarkResult> {
  const { data, error } = await client
    .from('bookmarks')
    .insert({ user_id: userId, lesson_id: lessonId, pgn_snapshot: pgnSnapshot })
    .select()
    .single()

  if (error || !data) {
    return { bookmark: null, error: new Error((error as { message?: string })?.message ?? 'Failed to add bookmark') }
  }
  return { bookmark: data as BookmarkRow, error: null }
}

// ---- getBookmarks ----

export interface GetBookmarksResult {
  bookmarks: BookmarkWithDetails[] | null
  error: Error | null
}

export async function getBookmarks(
  client: SupabaseClient,
  userId: string
): Promise<GetBookmarksResult> {
  const { data, error } = await client
    .from('bookmarks')
    .select(`
      id,
      user_id,
      lesson_id,
      pgn_snapshot,
      created_at,
      lessons!inner(
        id,
        title,
        chapters!inner(
          course_id,
          courses!inner(id, title)
        )
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    return { bookmarks: null, error: new Error((error as { message?: string })?.message ?? 'Failed to fetch bookmarks') }
  }

  const rows = (data ?? []) as unknown as Array<{
    id: string
    user_id: string
    lesson_id: string
    pgn_snapshot: string
    created_at: string
    lessons: {
      id: string
      title: string
      chapters: {
        course_id: string
        courses: { id: string; title: string }
      }
    }
  }>

  const bookmarks: BookmarkWithDetails[] = rows.map(row => ({
    id: row.id,
    user_id: row.user_id,
    lesson_id: row.lesson_id,
    pgn_snapshot: row.pgn_snapshot,
    created_at: row.created_at,
    lesson_title: row.lessons?.title ?? '',
    course_id: row.lessons?.chapters?.course_id ?? '',
    course_title: row.lessons?.chapters?.courses?.title ?? '',
  }))

  return { bookmarks, error: null }
}

// ---- deleteBookmark ----

export interface DeleteBookmarkResult {
  error: Error | null
}

export async function deleteBookmark(
  client: SupabaseClient,
  bookmarkId: string
): Promise<DeleteBookmarkResult> {
  const { error } = await client
    .from('bookmarks')
    .delete()
    .eq('id', bookmarkId)

  if (error) {
    return { error: new Error((error as { message?: string })?.message ?? 'Failed to delete bookmark') }
  }
  return { error: null }
}

// ---- getBookmarkForLesson ----

export interface GetBookmarkForLessonArgs {
  userId: string
  lessonId: string
}

export interface GetBookmarkForLessonResult {
  bookmark: BookmarkRow | null
  error: Error | null
}

export async function getBookmarkForLesson(
  client: SupabaseClient,
  { userId, lessonId }: GetBookmarkForLessonArgs
): Promise<GetBookmarkForLessonResult> {
  const { data, error } = await client
    .from('bookmarks')
    .select('id, user_id, lesson_id, pgn_snapshot, created_at')
    .eq('user_id', userId)
    .eq('lesson_id', lessonId)
    .maybeSingle()

  if (error) {
    return { bookmark: null, error: new Error((error as { message?: string })?.message ?? 'Failed to fetch bookmark') }
  }
  return { bookmark: data as BookmarkRow | null, error: null }
}
