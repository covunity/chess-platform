// Bunny Stream provider — Slice 2: upload + pollStatus.
// Slice 3: signed playback URLs. Slice 4: delete.
// See docs/adr/0007-bunny-stream.md.

import { Upload as TusUpload } from 'tus-js-client'
import i18n from '../../i18n'
import { supabase } from '../supabase'
import type {
  UploadCallbacks,
  UploadHandle,
  VideoProvider,
  PlaybackInfo,
} from './types'

/**
 * Maps errors returned by the create-video Edge Function to user-friendly
 * Vietnamese messages.
 */
function friendlyCreateVideoError(err: { message?: string; status?: number } | null | undefined): Error {
  if (!err) {
    return new Error(i18n.t('video.bunny.errors.initUploadFailed'))
  }

  const msg = err.message ?? ''
  const status = err.status ?? 0

  if (status === 403 || /not_authorized|forbidden/i.test(msg)) {
    return new Error(i18n.t('video.bunny.errors.notAuthorized'))
  }
  if (status === 413 || /file_too_large/i.test(msg)) {
    return new Error(i18n.t('video.bunny.errors.fileTooLarge'))
  }
  return new Error(i18n.t('video.bunny.errors.initUploadFailed'))
}

export const bunnyProvider: VideoProvider = {
  name: 'bunny',

  async upload(file: File, lessonId: string, cb: UploadCallbacks): Promise<UploadHandle> {
    // 1. Call the Edge Function to create the video record in Bunny and get TUS credentials.
    const { data, error } = await supabase.functions.invoke('create-video', {
      body: {
        lessonId,
        filename: file.name,
        sizeBytes: file.size,
      },
    })

    if (error || !data) {
      cb.onError(friendlyCreateVideoError(error))
      return { abort: () => {} }
    }

    const {
      uploadEndpoint,
      videoGuid,
      libraryId,
      authorizationSignature,
      authorizationExpire,
    } = data as {
      uploadEndpoint: string
      videoGuid: string
      libraryId: number
      authorizationSignature: string
      authorizationExpire: number
    }

    let lastTs = Date.now()
    let lastBytes = 0

    // 2. Start TUS resumable upload to Bunny.
    const upload = new TusUpload(file, {
      endpoint: uploadEndpoint,
      headers: {
        AuthorizationSignature: authorizationSignature,
        AuthorizationExpire: String(authorizationExpire),
        VideoId: videoGuid,
        LibraryId: String(libraryId),
      },
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      metadata: {
        filetype: file.type,
        title: file.name,
      },
      onProgress: (uploaded: number, total: number) => {
        if (!total) return
        const now = Date.now()
        const dt = (now - lastTs) / 1000
        const speed = dt > 0 ? Math.max(0, uploaded - lastBytes) / dt : 0
        lastTs = now
        lastBytes = uploaded
        cb.onProgress({ pct: (uploaded / total) * 100, bytesPerSec: speed })
      },
      onSuccess: () => {
        cb.onSuccess({ providerId: videoGuid, needsProcessing: true })
      },
      onError: (err: Error) => {
        cb.onError(err)
      },
    })

    upload.start()

    return {
      abort: () => {
        try { void upload.abort() } catch { /* noop */ }
      },
    }
  },

  async getPlaybackInfo(_providerId: string, opts?: { lessonId?: string }): Promise<PlaybackInfo> {
    const { data, error } = await supabase.functions.invoke('get-video-playback', {
      body: { lessonId: opts?.lessonId },
    })

    if (error || !data) {
      throw new Error(i18n.t('video.bunny.errors.playbackFailed'))
    }

    return {
      url: data.hlsUrl as string,
      format: 'hls',
      expiresAt: (data.expiresAt as number) * 1000, // seconds → ms
      embedUrl: (data.embedUrl as string | null) ?? undefined,
    }
  },

  async delete(providerId: string): Promise<void> {
    // Look up the lessonId from the DB using the providerId.
    const { data, error: dbError } = await supabase
      .from('lessons')
      .select('id')
      .eq('video_provider', 'bunny')
      .eq('video_provider_id', providerId)
      .single()

    if (dbError || !data) {
      throw new Error(i18n.t('video.bunny.errors.deleteFailed'))
    }

    const { error: fnError } = await supabase.functions.invoke('delete-video', {
      body: { lessonId: data.id },
    })

    if (fnError) {
      throw new Error(i18n.t('video.bunny.errors.deleteFailed'))
    }
  },

  async pollStatus(providerId: string): Promise<'processing' | 'ready' | 'error'> {
    const { data } = await supabase
      .from('lessons')
      .select('video_status')
      .eq('video_provider', 'bunny')
      .eq('video_provider_id', providerId)
      .single()

    if (data?.video_status === 'ready') return 'ready'
    if (data?.video_status === 'error') return 'error'
    return 'processing'
  },
}
