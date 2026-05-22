// Provider-pluggable video upload/playback types.
// Phase 1 ships Supabase Storage; Phase 2 ships Bunny Stream. See ADR-0001, ADR-0007.

import i18n from '../../i18n'
import { supabase } from '../supabase'

export type VideoProviderName = 'supabase' | 'cloudflare' | 'bunny'

export type VideoFormat = 'mp4' | 'hls'

export type UploadProgress = {
  pct: number
  bytesPerSec: number
}

export type UploadHandle = {
  abort: () => void
}

export type UploadResult = {
  providerId: string
  needsProcessing: boolean
}

export type UploadCallbacks = {
  onProgress: (p: UploadProgress) => void
  onSuccess: (result: UploadResult) => void
  onError: (err: Error) => void
}

export type PlaybackInfo = {
  url: string
  format: VideoFormat
  expiresAt: number
  embedUrl?: string  // Bunny iframe embed URL, present only for bunny provider
}

export interface VideoProvider {
  readonly name: VideoProviderName
  upload(file: File, lessonId: string, cb: UploadCallbacks): Promise<UploadHandle>
  getPlaybackInfo(providerId: string, opts?: { lessonId?: string }): Promise<PlaybackInfo>
  delete(providerId: string): Promise<void>
  pollStatus(providerId: string): Promise<'processing' | 'ready' | 'error'>
}

export const VIDEO_LIMITS = {
  maxBytes: 50 * 1024 * 1024,
  maxBytesLabel: '50 MB',
  allowedMime: ['video/mp4'] as const,
  allowedExtensionsLabel: 'MP4',
} as const

function bytesLabel(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(0)} GB`
  return `${(n / (1024 * 1024)).toFixed(0)} MB`
}

// Reads the upload cap from config.video_max_upload_bytes at call time.
// Falls back to 1 GB if the config row is absent or the query fails.
export async function validateVideoFile(file: File): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!VIDEO_LIMITS.allowedMime.includes(file.type as 'video/mp4')) {
    return { ok: false, reason: i18n.t('video.validate.invalidFormat', { ext: VIDEO_LIMITS.allowedExtensionsLabel }) }
  }
  if (file.size === 0) {
    return { ok: false, reason: i18n.t('video.validate.emptyFile') }
  }

  const FALLBACK_BYTES = 1024 * 1024 * 1024 // 1 GB
  let maxBytes = FALLBACK_BYTES
  try {
    const { data } = await supabase
      .from('config')
      .select('value_int')
      .eq('key', 'video_max_upload_bytes')
      .single()
    if (data?.value_int && data.value_int > 0) maxBytes = data.value_int
  } catch {
    // silently use fallback
  }

  if (file.size > maxBytes) {
    return { ok: false, reason: i18n.t('video.validate.tooLarge', { max: bytesLabel(maxBytes) }) }
  }
  return { ok: true }
}
