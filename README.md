# Gambitly — Chess Course Platform

A modern SaaS platform for learning chess through structured courses. Built with React 18, TypeScript, Vite, and Supabase. Vietnamese-first UI with English support.

## Tech stack

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS + custom design tokens + shadcn/ui
- **Routing**: React Router v7
- **i18n**: react-i18next (Vietnamese default, English fallback)
- **Backend**: Supabase (auth, database, storage)
- **CI/CD**: GitHub Actions → Vercel

## Getting started

### Prerequisites

- Node.js 20+
- npm 10+

### 1. Clone and install

```bash
git clone https://github.com/haunguyen1064/chess-course-platform.git
cd chess-course-platform
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in your Supabase credentials:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Start dev server

```bash
npm run dev
```

App runs at **http://localhost:5173**.

## Available scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server with HMR |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build locally |
| `npm test` | Run test suite (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint with ESLint |

## Project structure

```
src/
├── components/       # Shared UI components (TopNav, Footer)
├── pages/            # Route-level page components
├── locales/          # Translation files (vi.json, en.json)
├── lib/              # Utilities (supabase client, cn helper)
├── i18n.ts           # i18next configuration
└── main.tsx          # App entry point
```

## Design system

Design tokens are defined as CSS custom properties in `src/index.css`:

- **Colors**: `--bg`, `--surface`, `--ink-1..4`, `--accent` (teal), semantic `--success/warning/danger`
- **Typography**: Inter (UI), Newsreader (display/serif), JetBrains Mono (code/PGN)
- **Radius**: `--r-sm` (6px) → `--r-2xl` (28px)
- **Shared classes**: `.btn`, `.card`, `.pill`, `.input`, `.avatar`, `.logo-mark`

## SQL test scripts

Manual SQL test suites live in `scripts/`. Run them against a **local** Supabase instance after `supabase db reset`:

```bash
# Start local Supabase (requires supabase CLI)
supabase start

# Run individual test suites
psql "$DATABASE_URL" -f scripts/test-account-tier-schema.sql
psql "$DATABASE_URL" -f scripts/test-chapter-limit.sql
psql "$DATABASE_URL" -f scripts/test-order-fee-snapshot.sql
psql "$DATABASE_URL" -f scripts/test-admin-change-tier.sql
psql "$DATABASE_URL" -f scripts/test-application-supersede.sql
psql "$DATABASE_URL" -f scripts/test-application-approve.sql
```

`DATABASE_URL` is printed by `supabase start` (e.g. `postgresql://postgres:postgres@localhost:54322/postgres`).

Each file uses `DO $$ ... $$` blocks with `ASSERT` and `RAISE NOTICE 'PASS: ...'`. A failed assertion stops the script with a non-zero exit code.

> **Note**: Scripts that test RPCs (change-tier, application-approve/supersede) call `set_config('request.jwt.claims', ...)` to simulate `auth.uid()`. They require the corresponding migrations to be applied and write+delete their own test data.

## Deployment

Pushes to `main` automatically deploy to Vercel via GitHub Actions. Set the following environment variables in your Vercel project settings:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
