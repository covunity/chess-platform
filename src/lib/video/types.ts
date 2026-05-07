// Provider-pluggable video upload/playback types.
// Phase 1 ships only the Supabase Storage provider; Phase 2 will add a
// Cloudflare Stream provider behind the same interface. See ADR-0001.

export type VideoProviderName = 'supabase' | 'cloudflare'

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
}

export interface VideoProvider {
  readonly name: VideoProviderName
  upload(file: File, lessonId: string, cb: UploadCallbacks): Promise<UploadHandle>
  getPlaybackInfo(providerId: string): Promise<PlaybackInfo>
  delete(providerId: string): Promise<void>
  pollStatus(providerId: string): Promise<'processing' | 'ready' | 'error'>
}

export const VIDEO_LIMITS = {
  maxBytes: 50 * 1024 * 1024,
  maxBytesLabel: '50 MB',
  allowedMime: ['video/mp4'] as const,
  allowedExtensionsLabel: 'MP4',
} as const

export function validateVideoFile(file: File): { ok: true } | { ok: false; reason: string } {
  if (!VIDEO_LIMITS.allowedMime.includes(file.type as 'video/mp4')) {
    return { ok: false, reason: `Chỉ hỗ trợ định dạng ${VIDEO_LIMITS.allowedExtensionsLabel}.` }
  }
  if (file.size > VIDEO_LIMITS.maxBytes) {
    return { ok: false, reason: `File vượt quá ${VIDEO_LIMITS.maxBytesLabel}.` }
  }
  if (file.size === 0) {
    return { ok: false, reason: 'File rỗng.' }
  }
  return { ok: true }
}
