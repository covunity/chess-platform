import * as tus from 'tus-js-client'
import i18n from '../../i18n'
import { supabase } from '../supabase'
import type {
  PlaybackInfo,
  UploadHandle,
  VideoProvider,
} from './types'
import { VIDEO_LIMITS, validateVideoFile } from './types'

const BUCKET = 'lesson-videos'
const SIGNED_URL_TTL_SEC = 4 * 60 * 60

function getSupabaseUrl(): string {
  const url = import.meta.env.VITE_SUPABASE_URL
  if (!url) throw new Error('VITE_SUPABASE_URL is not set')
  return url
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'video.mp4'
}

// Map low-level TUS / Supabase Storage errors to user-friendly Vietnamese
// messages. The raw text from tus-js-client looks like:
//   "tus: unexpected response while creating upload, originated from request
//    (method: POST, url: ..., response code: 403, response text: new row
//    violates row-level security policy, request id: n/a)"
// We never want that string to reach the UI.
function friendlyUploadError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err)

  if (/row-level security/i.test(raw) || /response code:\s*40[13]/i.test(raw)) {
    return new Error(i18n.t('video.upload.errors.notAuthorized'))
  }
  if (/response code:\s*413/i.test(raw) || /payload too large/i.test(raw) || /exceeded the maximum/i.test(raw)) {
    return new Error(i18n.t('video.upload.errors.fileTooLarge', { max: VIDEO_LIMITS.maxBytesLabel }))
  }
  if (/response code:\s*415/i.test(raw) || /mime type .* is not supported/i.test(raw)) {
    return new Error(i18n.t('video.upload.errors.invalidFormat', { ext: VIDEO_LIMITS.allowedExtensionsLabel }))
  }
  if (/response code:\s*404/i.test(raw) || /bucket not found/i.test(raw)) {
    return new Error(i18n.t('video.upload.errors.bucketNotFound'))
  }
  if (/response code:\s*5\d\d/i.test(raw)) {
    return new Error(i18n.t('video.upload.errors.serverError'))
  }
  if (/network|failed to fetch|load failed|networkerror/i.test(raw)) {
    return new Error(i18n.t('video.upload.errors.networkError'))
  }
  return new Error(i18n.t('video.upload.errors.generic'))
}

export const supabaseProvider: VideoProvider = {
  name: 'supabase',

  async upload(file, lessonId, cb): Promise<UploadHandle> {
    const validation = await validateVideoFile(file)
    if (!validation.ok) {
      cb.onError(new Error(validation.reason))
      return { abort: () => {} }
    }

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      cb.onError(new Error(i18n.t('video.upload.errors.loginRequired')))
      return { abort: () => {} }
    }

    const userId = session.user.id
    const objectName = `${userId}/${lessonId}/${sanitizeFilename(file.name)}`

    let lastTs = Date.now()
    let lastBytes = 0

    const upload = new tus.Upload(file, {
      endpoint: `${getSupabaseUrl()}/storage/v1/upload/resumable`,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'x-upsert': 'true',
      },
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      metadata: {
        bucketName: BUCKET,
        objectName,
        contentType: file.type,
        cacheControl: '3600',
      },
      onProgress: (uploaded, total) => {
        if (!total) return
        const now = Date.now()
        const dt = (now - lastTs) / 1000
        const speed = dt > 0 ? Math.max(0, uploaded - lastBytes) / dt : 0
        lastTs = now
        lastBytes = uploaded
        cb.onProgress({ pct: (uploaded / total) * 100, bytesPerSec: speed })
      },
      onSuccess: () => {
        cb.onSuccess({ providerId: objectName, needsProcessing: false })
      },
      onError: (err) => {
        if (import.meta.env.DEV) console.warn('[video upload]', err)
        cb.onError(friendlyUploadError(err))
      },
    })

    upload.start()

    return {
      abort: () => {
        try { void upload.abort() } catch { /* noop */ }
      },
    }
  },

  // opts.lessonId intentionally ignored — the object path (providerId) is self-contained.
  async getPlaybackInfo(providerId: string, _opts?: { lessonId?: string }): Promise<PlaybackInfo> {
    const { data, error } = await supabase
      .storage
      .from(BUCKET)
      .createSignedUrl(providerId, SIGNED_URL_TTL_SEC)
    if (error || !data) throw error ?? new Error(i18n.t('video.upload.errors.signedUrlFailed'))
    return {
      url: data.signedUrl,
      format: 'mp4',
      expiresAt: Date.now() + SIGNED_URL_TTL_SEC * 1000,
    }
  },

  async delete(providerId: string): Promise<void> {
    const { error } = await supabase.storage.from(BUCKET).remove([providerId])
    if (error) throw error
  },

  async pollStatus(): Promise<'ready'> {
    return 'ready'
  },
}
