import type { SupabaseClient } from '@supabase/supabase-js'

export interface PlayerLesson {
  id: string
  title: string
  type: 'video' | 'chess' | 'puzzle'
  pgn_data: string
  board_perspective: 'white' | 'black'
  coach_note: string | null
}

export interface GetLessonForPlayerResult {
  lesson: PlayerLesson | null
  error: Error | null
}

export async function getLessonForPlayer(
  client: SupabaseClient,
  lessonId: string
): Promise<GetLessonForPlayerResult> {
  const { data, error } = await client
    .from('lessons')
    .select('id, title, type, pgn_data, board_perspective, coach_note')
    .eq('id', lessonId)
    .single()

  if (error || !data) {
    return { lesson: null, error: new Error(error?.message ?? 'Lesson not found') }
  }

  const row = data as Record<string, unknown>
  return {
    lesson: {
      id: row.id as string,
      title: row.title as string,
      type: row.type as PlayerLesson['type'],
      pgn_data: (row.pgn_data as string | null) ?? '',
      board_perspective: ((row.board_perspective as string | null) ?? 'white') as 'white' | 'black',
      coach_note: (row.coach_note as string | null) ?? null,
    },
    error: null,
  }
}

export interface MarkLessonCompletedArgs {
  courseId: string
  lessonId: string
  userId: string
}

export interface MarkLessonCompletedResult {
  error: Error | null
}

export async function markLessonCompleted(
  client: SupabaseClient,
  { courseId, lessonId, userId }: MarkLessonCompletedArgs
): Promise<MarkLessonCompletedResult> {
  const now = new Date().toISOString()
  const { error } = await client.from('lesson_progress').upsert(
    {
      user_id: userId,
      course_id: courseId,
      lesson_id: lessonId,
      completed: true,
      completed_at: now,
      viewed_at: now,
    },
    { onConflict: 'user_id,lesson_id' }
  )

  if (error) {
    return { error: new Error((error as { message?: string }).message ?? 'Failed to mark complete') }
  }
  return { error: null }
}
