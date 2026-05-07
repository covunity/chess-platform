import type { SupabaseClient } from '@supabase/supabase-js'

export interface PlayerLesson {
  id: string
  title: string
  type: 'video' | 'chess' | 'puzzle'
  pgn_data: string
  board_perspective: 'white' | 'black'
  coach_note: string | null
  video_provider: string | null
  video_provider_id: string | null
  video_status: string | null
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
    .select('id, title, type, pgn_data, board_perspective, coach_note, video_provider, video_provider_id, video_status')
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
      video_provider: (row.video_provider as string | null) ?? null,
      video_provider_id: (row.video_provider_id as string | null) ?? null,
      video_status: (row.video_status as string | null) ?? null,
    },
    error: null,
  }
}

export interface GetVideoPlaybackInfoResult {
  url: string | null
  format: 'mp4' | 'hls'
  error: Error | null
}

export async function getVideoPlaybackInfo(
  client: SupabaseClient,
  lesson: Pick<PlayerLesson, 'video_provider' | 'video_provider_id' | 'video_status'>
): Promise<GetVideoPlaybackInfoResult> {
  if (lesson.video_status !== 'ready') {
    return { url: null, format: 'mp4', error: new Error('Video chưa sẵn sàng.') }
  }
  if (!lesson.video_provider_id) {
    return { url: null, format: 'mp4', error: new Error('Bài học chưa có video.') }
  }
  if (lesson.video_provider === 'supabase') {
    const { data, error } = await client
      .storage
      .from('lesson-videos')
      .createSignedUrl(lesson.video_provider_id, 4 * 3600)
    if (error || !data) {
      return { url: null, format: 'mp4', error: new Error(error?.message ?? 'Không thể tải video.') }
    }
    return { url: data.signedUrl, format: 'mp4', error: null }
  }
  return { url: null, format: 'mp4', error: new Error('Video provider chưa được hỗ trợ.') }
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
