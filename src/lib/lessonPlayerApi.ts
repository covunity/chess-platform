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
  description: string | null
  is_view_only: boolean
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
    .select('id, title, type, pgn_data, board_perspective, coach_note, video_provider, video_provider_id, video_status, description, is_view_only')
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
      description: (row.description as string | null) ?? null,
      is_view_only: (row.is_view_only as boolean | null) ?? false,
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
  lessonId: string
): Promise<GetVideoPlaybackInfoResult> {
  const { data: rows, error: rpcError } = await client.rpc('get_video_playback_info', { p_lesson_id: lessonId })

  if (rpcError) {
    const msg = (rpcError as { message?: string; code?: string }).message ?? 'Không thể tải video.'
    return { url: null, format: 'mp4', error: new Error(msg) }
  }

  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] as Record<string, string> : null
  if (!row) {
    return { url: null, format: 'mp4', error: new Error('Bài học chưa có video.') }
  }

  if (row.video_status !== 'ready') {
    return { url: null, format: 'mp4', error: new Error('Video chưa sẵn sàng.') }
  }

  if (row.video_provider === 'supabase') {
    const { data, error } = await client
      .storage
      .from('lesson-videos')
      .createSignedUrl(row.video_provider_id, 4 * 3600)
    if (error || !data) {
      return { url: null, format: 'mp4', error: new Error((error as { message?: string })?.message ?? 'Không thể tải video.') }
    }
    return { url: data.signedUrl, format: 'mp4', error: null }
  }

  return { url: null, format: 'mp4', error: new Error('Video provider chưa được hỗ trợ.') }
}

// ── Resume position ───────────────────────────────────────────────────────────

export interface SaveResumeNodeArgs {
  lessonId: string
  userId: string
  nodeId: string
}

export interface SaveResumeNodeResult {
  error: Error | null
}

export async function saveResumeNode(
  client: SupabaseClient,
  { lessonId, userId, nodeId }: SaveResumeNodeArgs
): Promise<SaveResumeNodeResult> {
  const { error } = await client.from('lesson_progress').upsert(
    { user_id: userId, lesson_id: lessonId, last_viewed_node_id: nodeId },
    { onConflict: 'user_id,lesson_id' }
  )
  if (error) {
    return { error: new Error((error as { message?: string }).message ?? 'Failed to save resume node') }
  }
  return { error: null }
}

export interface GetResumeNodeArgs {
  lessonId: string
  userId: string
}

export interface GetResumeNodeResult {
  nodeId: string | null
  error: Error | null
}

export async function getResumeNode(
  client: SupabaseClient,
  { lessonId, userId }: GetResumeNodeArgs
): Promise<GetResumeNodeResult> {
  const { data, error } = await client
    .from('lesson_progress')
    .select('last_viewed_node_id')
    .eq('user_id', userId)
    .eq('lesson_id', lessonId)
    .maybeSingle()

  if (error) {
    return { nodeId: null, error: new Error((error as { message?: string }).message ?? 'Failed to get resume node') }
  }
  const row = data as { last_viewed_node_id: string | null } | null
  return { nodeId: row?.last_viewed_node_id ?? null, error: null }
}

// ── Lesson completion ─────────────────────────────────────────────────────────


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
