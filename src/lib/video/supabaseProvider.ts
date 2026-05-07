import * as tus from 'tus-js-client'
import { supabase } from '../supabase'
import type {
  PlaybackInfo,
  UploadHandle,
  VideoProvider,
} from './types'
import { validateVideoFile } from './types'

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

export const supabaseProvider: VideoProvider = {
  name: 'supabase',

  async upload(file, lessonId, cb): Promise<UploadHandle> {
    const validation = validateVideoFile(file)
    if (!validation.ok) {
      cb.onError(new Error(validation.reason))
      return { abort: () => {} }
    }

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      cb.onError(new Error('Bạn cần đăng nhập để upload video.'))
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
        cb.onError(err instanceof Error ? err : new Error(String(err)))
      },
    })

    upload.start()

    return {
      abort: () => {
        try { void upload.abort() } catch { /* noop */ }
      },
    }
  },

  async getPlaybackInfo(providerId: string): Promise<PlaybackInfo> {
    const { data, error } = await supabase
      .storage
      .from(BUCKET)
      .createSignedUrl(providerId, SIGNED_URL_TTL_SEC)
    if (error || !data) throw error ?? new Error('Không thể tạo signed URL.')
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
