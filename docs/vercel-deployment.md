# Vercel Deployment Setup

This document describes the one-time setup required to enable automatic production deployments to Vercel whenever a PR is merged into `main`.

## How it works

The CI pipeline (`.github/workflows/ci.yml`) runs two jobs:

1. **`test`** — runs on every push to `main` and every PR targeting `main`. Executes `npm test` and `npm run build`.
2. **`deploy`** — runs only on push to `main` (i.e. after a PR is merged). It waits for `test` to pass, then deploys to Vercel production.

Preview deployments per PR are not handled by this workflow. Use the [Vercel GitHub Integration](https://vercel.com/docs/deployments/git/vercel-for-github) for that if needed.

---

## Prerequisites

- A [Vercel](https://vercel.com) account
- The [Vercel CLI](https://vercel.com/docs/cli) installed locally (`npm i -g vercel`)
- Admin access to the GitHub repository

---

## Step 1 — Create a Vercel project

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import the GitHub repository
3. Set the framework preset to **Vite**
4. Do **not** enable automatic GitHub deployments in the Vercel dashboard — the GitHub Actions workflow handles deployments instead
5. Click **Deploy** once to initialise the project (this first deploy can be ignored)

---

## Step 2 — Link the project locally

Run the following in the project root:

```bash
vercel login
vercel link
```

When prompted, select the org and project you created in Step 1.

This creates `.vercel/project.json` with the `orgId` and `projectId` values needed in Step 4.

> `.vercel/` is gitignored — do not commit it.

---

## Step 3 — Create a Vercel API token

1. Go to **vercel.com → Account Settings → Tokens**
2. Click **Create Token**
3. Name it (e.g. `github-actions-chess-platform`) and set scope to your team/account
4. Copy the token — it is shown only once

---

## Step 4 — Add GitHub repository secrets

Go to **GitHub repo → Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret name | Where to find it |
|---|---|
| `VERCEL_TOKEN` | Token created in Step 3 |
| `VERCEL_ORG_ID` | `orgId` field in `.vercel/project.json` |
| `VERCEL_PROJECT_ID` | `projectId` field in `.vercel/project.json` |

---

## Step 5 — Add environment variables on Vercel

Go to **Vercel project → Settings → Environment Variables** and add the following for the **Production** environment:

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL (e.g. `https://xxxx.supabase.co`) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Your Supabase anon/public key |

These values are found in **Supabase project → Settings → API**.

---

## Step 6 — Verify

1. Open a PR targeting `main` — the `test` job should run
2. Merge the PR — the `deploy` job should appear after `test` passes
3. Check **GitHub Actions → deploy → Deploy to production** step for the live URL
4. The deployed URL is also surfaced in **GitHub → Environments → production**

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `deploy` job skipped | Check that the push is to `main`, not another branch |
| `Error: No project linked` | Re-run `vercel link` and update `VERCEL_PROJECT_ID` / `VERCEL_ORG_ID` secrets |
| `Build failed` | Check that all `VITE_*` env vars are set on Vercel (Step 5) |
| React Router returns 404 on refresh | Ensure `vercel.json` rewrite rule is present (already committed) |
| `VERCEL_TOKEN` unauthorized | Token may have expired or been deleted — recreate in Step 3 |
