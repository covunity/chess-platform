// TDD: Slice 3 — Bunny Stream signed HLS playback (issue #264)
// Behaviors tested:
//   1. getPlaybackInfo() calls get-video-playback with the lessonId
//   2. getPlaybackInfo() returns { url: hlsUrl, format: 'hls', expiresAt } from response
//   3. getPlaybackInfo() throws Vietnamese error when edge function fails

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { bunnyProvider } from './bunnyProvider'

// Mock supabase
vi.mock('../supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}))

// Import the mocked supabase after setting up mock
import { supabase } from '../supabase'

const mockInvoke = vi.mocked(supabase.functions.invoke)

describe('bunnyProvider.getPlaybackInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls get-video-playback with the lessonId', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: {
        hlsUrl: 'https://cdn.example.com/abc123/playlist.m3u8?token=tok&expires=9999',
        mp4FallbackUrl: 'https://cdn.example.com/abc123/play_720p.mp4?token=tok&expires=9999',
        embedUrl: null,
        expiresAt: 9999,
      },
      error: null,
    })

    await bunnyProvider.getPlaybackInfo('abc123', { lessonId: 'lesson-42' })

    expect(mockInvoke).toHaveBeenCalledWith('get-video-playback', {
      body: { lessonId: 'lesson-42' },
    })
  })

  it('returns { url: hlsUrl, format: "hls", expiresAt } from response (expiresAt in ms)', async () => {
    const expiresAtSeconds = 1_800_000_000
    mockInvoke.mockResolvedValueOnce({
      data: {
        hlsUrl: 'https://cdn.example.com/abc123/playlist.m3u8?token=tok&expires=1800000000',
        mp4FallbackUrl: 'https://cdn.example.com/abc123/play_720p.mp4?token=tok&expires=1800000000',
        embedUrl: null,
        expiresAt: expiresAtSeconds,
      },
      error: null,
    })

    const result = await bunnyProvider.getPlaybackInfo('abc123', { lessonId: 'lesson-42' })

    expect(result.url).toBe('https://cdn.example.com/abc123/playlist.m3u8?token=tok&expires=1800000000')
    expect(result.format).toBe('hls')
    expect(result.expiresAt).toBe(expiresAtSeconds * 1000) // seconds → ms
    expect(result.embedUrl).toBeUndefined()
  })

  it('passes through embedUrl when present in the response', async () => {
    const expiresAtSeconds = 1_800_000_000
    const embedUrl = 'https://iframe.mediadelivery.net/embed/667376/abc123?token=tok&expires=1800000000'
    mockInvoke.mockResolvedValueOnce({
      data: {
        hlsUrl: 'https://cdn.example.com/abc123/playlist.m3u8?token=tok&expires=1800000000',
        mp4FallbackUrl: 'https://cdn.example.com/abc123/play_720p.mp4?token=tok&expires=1800000000',
        embedUrl,
        expiresAt: expiresAtSeconds,
      },
      error: null,
    })

    const result = await bunnyProvider.getPlaybackInfo('abc123', { lessonId: 'lesson-42' })

    expect(result.embedUrl).toBe(embedUrl)
  })

  it('sets embedUrl to undefined when response has null embedUrl', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: {
        hlsUrl: 'https://cdn.example.com/abc123/playlist.m3u8?token=tok&expires=9999',
        mp4FallbackUrl: 'https://cdn.example.com/abc123/play_720p.mp4?token=tok&expires=9999',
        embedUrl: null,
        expiresAt: 9999,
      },
      error: null,
    })

    const result = await bunnyProvider.getPlaybackInfo('abc123', { lessonId: 'lesson-42' })

    expect(result.embedUrl).toBeUndefined()
  })

  it('throws Vietnamese error when edge function returns an error', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: { message: 'Access denied' },
    })

    await expect(
      bunnyProvider.getPlaybackInfo('abc123', { lessonId: 'lesson-42' })
    ).rejects.toThrow('Không thể phát video. Vui lòng thử lại.')
  })
})
