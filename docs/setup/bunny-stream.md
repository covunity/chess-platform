# Bunny Stream Setup Runbook

> Reference: ADR-0007, issue #262 (Slice 0 — HITL)

This document is the authoritative runbook for bringing a Bunny Stream environment online. Follow it in order for each environment (`dev`, `prod`).

---

## Prerequisites

- Access to the Supabase project (CLI authenticated: `supabase login`)
- `openssl` available locally (for generating secrets)

---

## Step 1 — Create a Bunny.net account

1. Go to [bunny.net](https://bunny.net) → **Sign Up**
2. Add a payment method and top up at least **$5 credit** (covers months of MVP traffic at low volume)

---

## Step 2 — Create Stream Libraries

Create **two libraries** — one for each environment:

| Library name    | Environment |
|-----------------|-------------|
| `gambitly-dev`  | development |
| `gambitly-prod` | production  |

For each library:

1. Dashboard → **Stream** → **Add Library**
2. Name: `gambitly-dev` (or `gambitly-prod`)
3. **Region**: Singapore (`SG`)
4. After creation, open **Library Settings**:
   - **Token Authentication**: ✅ Enable
   - **MP4 Fallback**: ✅ Enable (required for iOS Safari)
   - **Encoding Resolutions**: enable 240p, 360p, 480p, 720p, 1080p (H.264)

Record the **Library ID** shown on the library overview page — you will need it as `BUNNY_LIBRARY_ID`.

---

## Step 3 — Get the API key

In your Bunny account:

- **Account** → **API** → copy **API Key**

This is your `BUNNY_API_KEY`. It is account-scoped (not per-library).

---

## Step 4 — Get the CDN hostname

In each library's **CDN** or **Delivery** settings:

- Note the pull zone hostname, e.g. `vz-abc12345.b-cdn.net`

This is your `BUNNY_CDN_HOSTNAME`.

---

## Step 5 — Generate webhook secret

Run once per environment:

```bash
openssl rand -hex 32
```

Save the output as `BUNNY_WEBHOOK_SECRET`. You will paste it into both the Bunny library settings and Supabase secrets.

In the Bunny library → **Webhook** tab:
- **Webhook URL**: leave blank for now — fill in after Edge Functions are deployed (Slice 2)
- **Webhook Secret**: paste the generated value

---

## Step 6 — Set Supabase secrets

Run these commands for each environment (dev and prod Supabase projects separately):

### Dev

```bash
supabase secrets set \
  BUNNY_API_KEY=<your-api-key> \
  BUNNY_LIBRARY_ID=<gambitly-dev-library-id> \
  BUNNY_CDN_HOSTNAME=<vz-xxx.b-cdn.net> \
  BUNNY_WEBHOOK_SECRET=<hex-secret-from-step-5>
```

### Prod

```bash
supabase secrets set \
  BUNNY_API_KEY=<your-api-key> \
  BUNNY_LIBRARY_ID=<gambitly-prod-library-id> \
  BUNNY_CDN_HOSTNAME=<vz-yyy.b-cdn.net> \
  BUNNY_WEBHOOK_SECRET=<different-hex-secret> \
  --project-ref <prod-supabase-project-ref>
```

Verify:

```bash
supabase secrets list
```

All four keys should appear (values hidden).

---

## Step 7 — Smoke test

```bash
curl -s \
  -H "AccessKey: $BUNNY_API_KEY" \
  "https://video.bunnycdn.com/library/$BUNNY_LIBRARY_ID" \
  | jq '.Name'
```

Expected output: `"gambitly-dev"` (or `"gambitly-prod"`).

---

## Step 8 — Wire webhook URL (after Slice 2 deploy)

After `supabase functions deploy create-video bunny-webhook`:

1. Copy the Edge Function URL:
   `https://<supabase-project-ref>.supabase.co/functions/v1/bunny-webhook`
2. In the Bunny library → **Webhook** → paste the URL → Save

---

## Step 9 — Vercel production cutover

> **HITL steps** — these require access to Vercel and the production Supabase project. They cannot be automated by the agent.

### 9.1 Deploy Edge Functions to production

```bash
supabase functions deploy create-video bunny-webhook get-video-playback delete-video \
  --project-ref <prod-supabase-project-ref>
```

All four functions must be deployed together so that upload, encoding, playback, and deletion all work end-to-end.

### 9.2 Point the Bunny webhook to production

In the `gambitly-prod` library → **Webhook** tab:

- **Webhook URL**: `https://<prod-supabase-project-ref>.supabase.co/functions/v1/bunny-webhook`
- Save → Bunny will now send encoding status events to your production Edge Function.

### 9.3 Set Vercel production environment variable

In your Vercel project → **Settings** → **Environment Variables**:

| Name | Value | Environment |
|------|-------|-------------|
| `VITE_VIDEO_PROVIDER` | `bunny` | Production only |

Keep `.env.local` (and any `preview` / staging Vercel environments) set to `VITE_VIDEO_PROVIDER=supabase`.

Trigger a new Vercel deployment after saving so the variable is picked up in the build.

### 9.4 Smoke test checklist

After the deployment is live:

- [ ] Upload a short MP4 (< 50 MB) as a Creator — `video_status` should transition `uploading → processing → ready`
- [ ] Open the lesson as an enrolled Learner — HLS playback starts within 3 seconds
- [ ] Watch past the 80% threshold — `lesson_progress.completed` flips to `true`
- [ ] Delete the video from the lesson editor — `video_status` resets to `idle` and the Bunny video is removed

### 9.5 Roll-back

If Bunny is unavailable after cutover:

1. In Vercel: change `VITE_VIDEO_PROVIDER` to `supabase` → redeploy
2. New uploads will go to Supabase Storage immediately
3. Existing Bunny-hosted videos will stop playing until Bunny recovers (no data loss)
4. Re-flip to `bunny` once Bunny is confirmed stable

---

## Environment variable reference

| Secret | Where used | Notes |
|--------|-----------|-------|
| `BUNNY_API_KEY` | Edge Functions only | Never exposed to browser |
| `BUNNY_LIBRARY_ID` | Edge Functions only | Per-environment (dev vs prod) |
| `BUNNY_CDN_HOSTNAME` | Edge Functions only | Used to build playback URL |
| `BUNNY_WEBHOOK_SECRET` | `bunny-webhook` function | Must match Bunny library setting |

Frontend env var (`.env.local`):

```bash
# Switch default provider to Bunny for new uploads (Slice 5 cutover)
VITE_VIDEO_PROVIDER=bunny
```

> **Note**: `VITE_VIDEO_PROVIDER=supabase` remains the default until Slice 5. Do not flip this in dev until Slice 2 is deployed and smoke-tested.

---

## Roll-back plan

If Bunny goes down after Slice 5 cutover:

1. In Vercel (or your host): set `VITE_VIDEO_PROVIDER=supabase` → redeploy
2. New uploads will go to Supabase Storage immediately
3. Existing Bunny-hosted videos will stop playing until Bunny recovers (no data loss)
4. Re-flip to `bunny` once Bunny is stable

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `create-video` returns 500 | Missing Supabase secret | Check `supabase secrets list` |
| TUS upload fails immediately | Wrong `AuthorizationSignature` | Check expiration time is in the future |
| Webhook returns 403 | `BUNNY_WEBHOOK_SECRET` mismatch | Re-paste secret in Bunny library settings |
| Video stuck in `processing` | Webhook URL not configured | Complete Step 8 |
| `video_status` never flips to `ready` | Bunny encoding failed | Check Bunny dashboard → library → video status |
