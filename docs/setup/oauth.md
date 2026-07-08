# Social OAuth setup — Google & Facebook

Phase 1 ships social login via Supabase Auth. This page covers the **HITL**
(human-in-the-loop) steps needed to wire real credentials. The frontend
code, callback route (`/auth/callback`), and DB trigger that imports name +
avatar from the provider are already merged — once credentials are pasted
into Supabase, the buttons start working.

## 0. Prerequisites

- Supabase project `<PROJECT_REF>` (find it in `Project Settings → General`).
- ToS + Privacy URLs published (Slice 1 — required for Facebook App Review):
  - `https://<APP_URL>/terms`
  - `https://<APP_URL>/privacy`
- One Supabase **callback URL** is used by both providers:

  ```
  https://<PROJECT_REF>.supabase.co/auth/v1/callback
  ```

## 1. Google Cloud Console

1. Go to <https://console.cloud.google.com> → create or pick a project.
2. **APIs & Services → OAuth consent screen**
   - User type: **External**.
   - App name: `Covunity`, support email, developer email.
   - Authorized domains: your production app domain + `supabase.co`.
   - Scopes: `userinfo.email`, `userinfo.profile`, `openid` (default).
   - Add yourself as a Test user while the app is in `Testing` mode.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**.
   - Authorized JavaScript origins:
     - `https://<APP_URL>` (production)
     - `http://localhost:5173` (Vite dev)
   - Authorized redirect URIs: `https://<PROJECT_REF>.supabase.co/auth/v1/callback`
4. Copy the generated **Client ID** and **Client secret**.

## 2. Meta for Developers (Facebook)

1. Go to <https://developers.facebook.com/apps> → **Create App** → use case
   **Authenticate and request data from users with Facebook Login** →
   App type **Business** (or **Consumer**, depending on org). Name: `Covunity`.
2. **Add product → Facebook Login → Web**
   - Site URL: `https://<APP_URL>`
3. **Facebook Login → Settings**
   - Valid OAuth Redirect URIs: `https://<PROJECT_REF>.supabase.co/auth/v1/callback`
4. **App Settings → Basic**
   - Privacy Policy URL: `https://<APP_URL>/privacy`
   - Terms of Service URL: `https://<APP_URL>/terms`
   - App icon: 1024×1024 Covunity logo.
   - Category: Education.
   - Copy **App ID** and **App secret**.
5. **App Review → Permissions and features**
   - Request **`email`** and **`public_profile`** permissions.
   - Submit for review — Facebook needs the published ToS + Privacy URLs and
     a screencast of the login flow against a staging build.
   - While in Development mode, only listed **Roles → Testers / Admins** can
     log in. Add the QA accounts that need to test before approval lands.

## 3. Supabase configuration

1. Supabase Dashboard → **Authentication → Providers**
   - **Google**: toggle on, paste Client ID + Client secret from step 1, save.
   - **Facebook**: toggle on, paste App ID + App secret from step 2, save.
2. **Authentication → URL Configuration**
   - Site URL: `https://<APP_URL>`
   - Add to Redirect URLs (one per line):
     - `https://<APP_URL>/auth/callback`
     - `http://localhost:5173/auth/callback`
3. **Authentication → Providers → Settings** (or
   `Authentication → Sign In / Up → Account Linking`)
   - Enable **"Allow linking the same email across providers"** /
     **Manual Linking → Automatic**. This is the mechanism we rely on for
     the email-clash case: if a learner already registered with
     `you@example.com` via email/password and then logs in with Google
     using the same verified email, Supabase merges both identities into
     a single `auth.users` row instead of erroring or creating a duplicate.

## 4. Verify end-to-end

1. From `/signup` click **Google** → consent → land back on `/dashboard`.
2. In Supabase `Table Editor → public.users`, the new row has:
   - `role = 'learner'`
   - `account_tier_id = 'individual'`
   - `name` and `avatar_url` populated from the provider.
3. Sign out, sign back in via `/login` with the same provider — no
   duplicate row created.
4. Email-clash check: create `clash@test.com` via email/password, log out,
   then log in with the Google account that owns `clash@test.com`. Both
   identities should map to the same `auth.users` row.
5. TopNav shows the imported avatar; replace `avatar_url` with a broken URL
   in `public.users` to confirm initials fallback works.

## 5. HITL checklist

- [ ] Google OAuth client created, secret stored in 1Password (or equivalent).
- [ ] Facebook app created, secret stored.
- [ ] Both secrets pasted into Supabase providers.
- [ ] Account linking toggle enabled.
- [ ] Redirect URLs added (prod + localhost).
- [ ] Facebook App Review submitted (`email` + `public_profile`).
- [ ] Production rollout blocked until Facebook review is approved
      (`Development mode` only lets testers in).

