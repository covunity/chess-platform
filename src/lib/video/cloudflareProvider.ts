// Phase 2 placeholder. Implement when migrating off Supabase Storage.
//
// Expected wiring:
//   - Edge Function POST /videos/direct-upload
//       Returns { uploadURL, uid } from
//       https://api.cloudflare.com/client/v4/accounts/<acct>/stream/direct_upload
//       The uploadURL is a one-shot Cloudflare TUS endpoint; the user JWT is
//       NOT used for the upload itself.
//   - Edge Function POST /videos/signed-url
//       Returns a Cloudflare Stream signed JWT and the manifest URL,
//       https://customer-<id>.cloudflarestream.com/<uid>/manifest/video.m3u8?token=<jwt>
//   - On the client, install hls.js and let VideoView lazy-import it whenever
//       getPlaybackInfo returns format='hls'.

import type {
  UploadCallbacks,
  UploadHandle,
  VideoProvider,
  PlaybackInfo,
} from './types'

const NOT_IMPLEMENTED = 'Cloudflare Stream provider chưa được triển khai (Phase 2).'

export const cloudflareProvider: VideoProvider = {
  name: 'cloudflare',

  async upload(file: File, lessonId: string, cb: UploadCallbacks): Promise<UploadHandle> {
    void file
    void lessonId
    cb.onError(new Error(NOT_IMPLEMENTED))
    return { abort: () => {} }
  },

  async getPlaybackInfo(providerId: string): Promise<PlaybackInfo> {
    void providerId
    throw new Error(NOT_IMPLEMENTED)
  },

  async delete(providerId: string): Promise<void> {
    void providerId
    throw new Error(NOT_IMPLEMENTED)
  },

  async pollStatus(providerId: string): Promise<'processing' | 'ready' | 'error'> {
    void providerId
    throw new Error(NOT_IMPLEMENTED)
  },
}
