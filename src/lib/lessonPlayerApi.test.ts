import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getLessonForPlayer, getVideoPlaybackInfo, markLessonCompleted } from './lessonPlayerApi'

describe('getLessonForPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the lesson with pgn fields when found', async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: 'l1',
        title: 'Lesson 1',
        type: 'chess',
        pgn_data: '1. e4 e5',
        board_perspective: 'white',
        coach_note: 'Note here',
      },
      error: null,
    })
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single,
      }),
    }

    const result = await getLessonForPlayer(client as never, 'l1')

    expect(result.lesson).toEqual({
      id: 'l1',
      title: 'Lesson 1',
      type: 'chess',
      pgn_data: '1. e4 e5',
      board_perspective: 'white',
      coach_note: 'Note here',
      video_provider: null,
      video_provider_id: null,
      video_status: null,
    })
    expect(result.error).toBeNull()
  })

  it('returns lesson: null and error when not found', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } })
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single,
      }),
    }

    const result = await getLessonForPlayer(client as never, 'missing')
    expect(result.lesson).toBeNull()
    expect(result.error).not.toBeNull()
  })
})

describe('getVideoPlaybackInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeRpcClient(rpcResult: { data: unknown; error: unknown }, signedUrlResult?: { data: unknown; error: unknown }) {
    const createSignedUrl = vi.fn().mockResolvedValue(signedUrlResult ?? { data: null, error: { message: 'storage error' } })
    return {
      rpc: vi.fn().mockResolvedValue(rpcResult),
      storage: { from: vi.fn().mockReturnValue({ createSignedUrl }) },
    }
  }

  it('calls get_video_playback_info RPC with lesson id', async () => {
    const client = makeRpcClient(
      { data: [{ video_provider: 'supabase', video_provider_id: 'u1/l1/video.mp4', video_status: 'ready' }], error: null },
      { data: { signedUrl: 'https://cdn.example.com/video.mp4' }, error: null }
    )
    await getVideoPlaybackInfo(client as never, 'lesson-1')
    expect(client.rpc).toHaveBeenCalledWith('get_video_playback_info', { p_lesson_id: 'lesson-1' })
  })

  it('returns signed URL when RPC succeeds and video is ready', async () => {
    const client = makeRpcClient(
      { data: [{ video_provider: 'supabase', video_provider_id: 'u1/l1/video.mp4', video_status: 'ready' }], error: null },
      { data: { signedUrl: 'https://cdn.example.com/video.mp4' }, error: null }
    )
    const result = await getVideoPlaybackInfo(client as never, 'lesson-1')
    expect(result.url).toBe('https://cdn.example.com/video.mp4')
    expect(result.format).toBe('mp4')
    expect(result.error).toBeNull()
  })

  it('returns forbidden error when RPC returns code 42501', async () => {
    const client = makeRpcClient({ data: null, error: { message: 'forbidden', code: '42501' } })
    const result = await getVideoPlaybackInfo(client as never, 'lesson-1')
    expect(result.url).toBeNull()
    expect(result.error?.message).toMatch(/forbidden|access/i)
  })

  it('returns error when RPC returns video_status not ready', async () => {
    const client = makeRpcClient(
      { data: [{ video_provider: 'supabase', video_provider_id: 'path/video.mp4', video_status: 'uploading' }], error: null }
    )
    const result = await getVideoPlaybackInfo(client as never, 'lesson-1')
    expect(result.url).toBeNull()
    expect(result.error).not.toBeNull()
  })

  it('returns error when RPC returns null data', async () => {
    const client = makeRpcClient({ data: null, error: null })
    const result = await getVideoPlaybackInfo(client as never, 'lesson-1')
    expect(result.url).toBeNull()
    expect(result.error).not.toBeNull()
  })

  it('returns error when signed URL generation fails', async () => {
    const client = makeRpcClient(
      { data: [{ video_provider: 'supabase', video_provider_id: 'u1/l1/video.mp4', video_status: 'ready' }], error: null },
      { data: null, error: { message: 'storage error' } }
    )
    const result = await getVideoPlaybackInfo(client as never, 'lesson-1')
    expect(result.url).toBeNull()
    expect(result.error).not.toBeNull()
  })
})

describe('markLessonCompleted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upserts lesson_progress with completed=true and a completed_at timestamp', async () => {
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null })
    const from = vi.fn().mockReturnValue({ upsert })
    const client = { from }

    const result = await markLessonCompleted(client as never, {
      courseId: 'c1',
      lessonId: 'l1',
      userId: 'u1',
    })

    expect(from).toHaveBeenCalledWith('lesson_progress')
    expect(upsert).toHaveBeenCalledTimes(1)
    const payload = upsert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.user_id).toBe('u1')
    expect(payload.course_id).toBe('c1')
    expect(payload.lesson_id).toBe('l1')
    expect(payload.completed).toBe(true)
    expect(typeof payload.completed_at).toBe('string')
    expect(result.error).toBeNull()
  })

  it('returns the supabase error when upsert fails', async () => {
    const upsert = vi.fn().mockResolvedValue({ data: null, error: { message: 'rls denied' } })
    const client = { from: vi.fn().mockReturnValue({ upsert }) }

    const result = await markLessonCompleted(client as never, {
      courseId: 'c1',
      lessonId: 'l1',
      userId: 'u1',
    })

    expect(result.error).not.toBeNull()
    expect(result.error?.message).toMatch(/rls denied/)
  })
})
