# Migration runbook — Supabase Storage → Cloudflare Stream

> Phase 2. Use this when you're ready to move from MP4 progressive playback on
> Supabase Storage to HLS adaptive bitrate via Cloudflare Stream. Background:
> [`docs/adr/0001-video-storage-supabase.md`](../adr/0001-video-storage-supabase.md).

The codebase was designed so this migration touches **one provider file**, **two
new Edge Functions**, **one env var**, and **one npm package**. Existing
Supabase-stored videos keep playing because every lesson row stores the
provider it was uploaded with.

Estimated effort: **1–2 days**, mostly waiting on Cloudflare account/billing
plus testing.

---

## 0. Decide it's time

Trigger any one of:

1. Going public — auto-pause and 5 GB/month egress on Supabase free tier are no
   longer acceptable.
2. Egress > 50% of the Supabase plan quota two months in a row.
3. Average upload size approaches 50 MB and creators complain about
   pre-upload compression.
4. Learner support tickets about buffering on slow networks.

If none of those apply, stay on Supabase Storage — Cloudflare Stream costs
$5/month minimum.

---

## 1. Cloudflare account setup

1. Create / sign in to a Cloudflare account: <https://dash.cloudflare.com/>.
2. Top-right account picker → copy the **Account ID** (looks like
   `8f2c3a…`).
3. Sidebar → **Stream**.
4. Subscribe to the Stream plan: **$5/month** for the first 1,000 minutes
   stored + 1,000 minutes delivered, then $1 per extra 1,000 minutes for each.
   Confirm payment.
5. **Stream → Settings → Signed URLs** → click **Create signing key**.
   Copy the **Key ID** and the **JWK / PEM private key**. Store securely; you
   only see the key material once.
6. **My Profile → API Tokens → Create token**:
   - Template: *Custom token*.
   - Permissions: **Account → Stream → Edit**.
   - Account resources: include only the account you'll use.
   - Save the token. This is `CF_STREAM_API_TOKEN`.

You now have:
- `CF_ACCOUNT_ID`
- `CF_STREAM_API_TOKEN`
- `CF_STREAM_KEY_ID`
- `CF_STREAM_PRIVATE_KEY` (PEM, multi-line)

---

## 2. Edge Function: direct upload URL

Create `supabase/functions/videos-direct-upload/index.ts`:

```ts
// Returns a Cloudflare Stream "direct creator upload" URL the browser can
// PUT/POST to via tus-js-client. The browser never sees the API token.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CF_ACCOUNT_ID    = Deno.env.get('CF_ACCOUNT_ID')!
const CF_API_TOKEN     = Deno.env.get('CF_STREAM_API_TOKEN')!
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON    = Deno.env.get('SUPABASE_ANON_KEY')!
const MAX_DURATION_SEC = 60 * 60   // 1 hour upper bound per upload

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return new Response('unauthorized', { status: 401 })
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: auth } },
  })
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return new Response('unauthorized', { status: 401 })

  const { data: profile } = await supa
    .from('users').select('role').eq('id', user.id).single()
  if (!profile || !['creator', 'admin'].includes(profile.role)) {
    return new Response('forbidden', { status: 403 })
  }

  const { lessonId, sizeBytes } = await req.json()
  if (!lessonId || !Number.isFinite(sizeBytes)) {
    return new Response('bad request', { status: 400 })
  }

  const cf = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream?direct_user=true`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(sizeBytes),
        'Upload-Metadata': [
          `name ${btoa(`${user.id}/${lessonId}`)}`,
          `requiresignedurls ${btoa('true')}`,
          `maxDurationSeconds ${btoa(String(MAX_DURATION_SEC))}`,
        ].join(','),
      },
    }
  )

  if (!cf.ok) {
    return new Response(`cloudflare error: ${await cf.text()}`, { status: 502 })
  }

  const uploadURL = cf.headers.get('Location')!
  const uid       = cf.headers.get('stream-media-id')!

  return Response.json({ uploadURL, uid })
})
```

Set secrets:

```bash
supabase secrets set \
  CF_ACCOUNT_ID=...\
  CF_STREAM_API_TOKEN=...
supabase functions deploy videos-direct-upload --no-verify-jwt
```

> `--no-verify-jwt` is fine here because we manually verify the JWT inside the
> function. Adjust if you prefer Supabase's automatic gating.

---

## 3. Edge Function: signed playback URL

Create `supabase/functions/videos-signed-url/index.ts`:

```ts
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { create as createJWT, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts'

const CF_ACCOUNT_ID = Deno.env.get('CF_ACCOUNT_ID')!
const CF_KEY_ID     = Deno.env.get('CF_STREAM_KEY_ID')!
const CF_PRIVATE    = Deno.env.get('CF_STREAM_PRIVATE_KEY')!  // PEM
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const TTL_SECONDS   = 4 * 60 * 60

async function importPemRsa(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der  = Uint8Array.from(atob(body), c => c.charCodeAt(0))
  return crypto.subtle.importKey(
    'pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  )
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return new Response('unauthorized', { status: 401 })
  }
  const supa = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: auth } },
  })
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return new Response('unauthorized', { status: 401 })

  const { lessonId } = await req.json()
  if (!lessonId) return new Response('bad request', { status: 400 })

  const { data: lesson } = await supa
    .from('lessons')
    .select('id, free_preview, video_provider, video_provider_id, chapter_id')
    .eq('id', lessonId).single()
  if (!lesson || lesson.video_provider !== 'cloudflare' || !lesson.video_provider_id) {
    return new Response('not found', { status: 404 })
  }

  // Enrollment / free-preview gate.
  if (!lesson.free_preview) {
    const { data: enrollment } = await supa.rpc('user_is_enrolled_in_lesson', {
      p_lesson: lessonId,
    })
    if (!enrollment) return new Response('forbidden', { status: 403 })
  }

  const key = await importPemRsa(CF_PRIVATE)
  const token = await createJWT(
    { alg: 'RS256', kid: CF_KEY_ID, typ: 'JWT' },
    {
      sub: lesson.video_provider_id,
      kid: CF_KEY_ID,
      exp: getNumericDate(TTL_SECONDS),
      accessRules: [
        { type: 'any', action: 'allow' },
      ],
    },
    key
  )

  const manifestUrl =
    `https://customer-${CF_ACCOUNT_ID}.cloudflarestream.com/${lesson.video_provider_id}/manifest/video.m3u8?token=${token}`

  return Response.json({ url: manifestUrl, format: 'hls', expiresAt: Date.now() + TTL_SECONDS * 1000 })
})
```

Set secrets and deploy:

```bash
supabase secrets set \
  CF_STREAM_KEY_ID=... \
  CF_STREAM_PRIVATE_KEY="$(cat private.pem)"
supabase functions deploy videos-signed-url --no-verify-jwt
```

> The `user_is_enrolled_in_lesson` RPC is a one-line SQL helper; if you don't
> have it yet, write a `SECURITY DEFINER` function that joins `enrollments` →
> `chapters` → `lessons`.

---

## 4. Frontend: implement `cloudflareProvider.ts`

Replace the stub in `src/lib/video/cloudflareProvider.ts`:

```ts
import * as tus from 'tus-js-client'
import { supabase } from '../supabase'
import type { PlaybackInfo, UploadCallbacks, UploadHandle, VideoProvider } from './types'
import { validateVideoFile } from './types'

async function authedFetch(path: string, body: unknown) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Bạn cần đăng nhập.')
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export const cloudflareProvider: VideoProvider = {
  name: 'cloudflare',

  async upload(file, lessonId, cb): Promise<UploadHandle> {
    const v = validateVideoFile(file)
    if (!v.ok) { cb.onError(new Error(v.reason)); return { abort: () => {} } }

    const { uploadURL, uid } = await authedFetch('videos-direct-upload', {
      lessonId, sizeBytes: file.size,
    })

    let lastTs = Date.now(); let lastBytes = 0

    const upload = new tus.Upload(file, {
      uploadUrl: uploadURL,            // Cloudflare returns a one-shot URL
      chunkSize: 50 * 1024 * 1024,     // CF requires 5 MB minimum, 50 MB is fine
      retryDelays: [0, 3000, 5000, 10000, 20000],
      onProgress: (uploaded, total) => {
        if (!total) return
        const now = Date.now(); const dt = (now - lastTs) / 1000
        const speed = dt > 0 ? Math.max(0, uploaded - lastBytes) / dt : 0
        lastTs = now; lastBytes = uploaded
        cb.onProgress({ pct: (uploaded / total) * 100, bytesPerSec: speed })
      },
      onSuccess: () => {
        // Cloudflare needs to encode — caller should store status='processing'
        // then poll with pollStatus.
        cb.onSuccess({ providerId: uid, needsProcessing: true })
      },
      onError: (err) => cb.onError(err instanceof Error ? err : new Error(String(err))),
    })

    upload.start()
    return { abort: () => { try { void upload.abort() } catch {} } }
  },

  async getPlaybackInfo(_providerId: string): Promise<PlaybackInfo> {
    // The lesson row carries the lessonId in the editor/player; the Edge
    // Function looks up the providerId itself for security. So callers pass
    // lessonId here, not providerId. Adjust the call site accordingly OR
    // expose a wrapper that passes both.
    throw new Error('Implement via getPlaybackForLesson(lessonId)')
  },

  async delete(providerId: string): Promise<void> {
    await authedFetch('videos-delete', { uid: providerId })
  },

  async pollStatus(providerId: string): Promise<'processing' | 'ready' | 'error'> {
    const { state } = await authedFetch('videos-status', { uid: providerId })
    return state as 'processing' | 'ready' | 'error'
  },
}
```

> The `getPlaybackInfo` signature is a Phase 1 simplification (it takes a
> providerId because Supabase doesn't need to gate by enrollment client-side).
> For Cloudflare, the gate must live in the Edge Function. Add a helper
> `getPlaybackForLesson(lessonId)` in `src/lib/video/index.ts` that calls
> `videos-signed-url` directly, and update the player (Slice 14) to use it.

You'll also want two more small Edge Functions:
- `videos-status` — proxies `GET /accounts/{acct}/stream/{uid}` and returns
  `{ state: 'inprogress' | 'ready' | 'error' }`.
- `videos-delete` — proxies `DELETE /accounts/{acct}/stream/{uid}`.

Both follow the same auth pattern as `videos-direct-upload`.

---

## 5. Frontend: install hls.js + flip env

```bash
npm install hls.js
```

`VideoView.tsx` already lazy-imports it via a runtime specifier. No code
change needed there; the bundle gets a code-split chunk.

Set the env var:

```bash
# .env.local
VITE_VIDEO_PROVIDER=cloudflare
```

On Vercel: **Settings → Environment Variables** → set
`VITE_VIDEO_PROVIDER=cloudflare` for both Production and Preview, then
redeploy.

---

## 6. Update the upload state machine

The editor currently transitions `uploading → ready`. Cloudflare adds a
`processing` step:

In `VideoLessonEditor.tsx`, when the provider's `onSuccess` callback fires
with `needsProcessing: true`:

1. Call `setLessonVideo(..., { video_status: 'processing', ... })`.
2. Render a "Đang xử lý video…" pill.
3. Poll `provider.pollStatus(providerId)` every 5 seconds.
4. When the result is `'ready'`, update the row to `video_status='ready'` and
   show the existing ready-state UI.

Cancel polling on unmount.

---

## 7. Schema — no changes needed

Migration `012_lesson_video_fields.sql` already created the `processing`
state and the polymorphic `video_provider_id` column. Existing rows keep
`video_provider='supabase'`, new rows are `'cloudflare'`. Both providers
coexist forever; you can leave old Supabase-uploaded lessons in place.

---

## 8. (Optional) Re-host old Supabase videos on Cloudflare

Only do this if you want to retire the Supabase bucket entirely.

```ts
// scripts/migrate-supabase-to-cloudflare.ts (sketch — run with tsx)
//
// For each lesson where video_provider='supabase':
//   1. supabase.storage.from('lesson-videos').createSignedUrl(path, 600)
//   2. POST to Cloudflare Stream "copy from URL" endpoint:
//        POST /accounts/{acct}/stream/copy
//        { url: signedUrl, requireSignedURLs: true }
//   3. Wait for Cloudflare encoding to finish (poll /stream/{uid}).
//   4. UPDATE lessons SET video_provider='cloudflare',
//                         video_provider_id=<uid>
//      WHERE id = <lessonId>
//   5. supabase.storage.from('lesson-videos').remove([path])
```

Run during a maintenance window. After verifying playback for a sample, you
can delete the bucket and drop the `Creators upload/update/delete own lesson
videos` policies on `storage.objects`.

---

## 9. Test plan

| Case | Expected |
| --- | --- |
| Upload 50 MB MP4 as creator | Editor: `uploading` → `processing` → `ready`. Cloudflare dashboard shows a new video. |
| Login as enrolled learner, open a Cloudflare-stored lesson | Player fetches HLS manifest, hls.js (Chrome/FF) or native (Safari) plays the video. |
| Login as non-enrolled learner | Edge Function returns 403, player shows "Bạn chưa đăng ký khóa học này." |
| Lesson with `free_preview=true` | Anyone can fetch the signed URL. |
| Open an OLD lesson with `video_provider='supabase'` | Player still works via the Supabase signed URL path — no regression. |
| Replace an old Supabase video with a new upload | New row stores `video_provider='cloudflare'`; old Supabase object can be deleted. |
| Cancel mid-upload | tus.abort() leaves no row update; Cloudflare cleans up the partial upload after ~24h. |
| Slow / dropped network during upload | tus retries with exponential backoff; resumes from last completed chunk. |
| Expired signed URL | Player gets 401 from Cloudflare → re-request a new signed URL on `error` event. |

---

## 10. Rollback

If Cloudflare playback misbehaves before you've migrated old data:

1. Vercel → set `VITE_VIDEO_PROVIDER=supabase` and redeploy.
2. New uploads go back to Supabase Storage.
3. Cloudflare-stored lessons keep their rows; they just won't render until
   you flip back to `cloudflare`.

If you've already migrated old Supabase videos to Cloudflare and need to
revert: you must re-upload them to Supabase Storage and update
`video_provider` back to `'supabase'`. Plan ahead — keep the Supabase bucket
alive for at least two weeks after the switch.

---

## 11. Costs to watch

- **Stream storage**: $5 per 1,000 minutes/month stored.
- **Stream delivery**: $1 per 1,000 minutes delivered.
- **Signed URL cache**: free; signed JWTs are stateless.

A 10-minute lesson watched 200 times = 2,000 minutes delivered = $2.
Compare against your current Supabase egress cost.

---

## 12. Things NOT in this runbook

- Stockfish / engine-side processing — out of scope.
- Adaptive bitrate ladder customisation — Cloudflare auto-encodes; only
  customise via API if absolutely necessary.
- Live streaming — Cloudflare Stream Live is a different SKU; this runbook
  is for VOD only.
