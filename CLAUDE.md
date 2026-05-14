# Gambitly Chess Course Platform — CLAUDE.md

> PRD v1.1 | Phase 1 MVP | May 2026

---

## Agent skills

### Issue tracker

Issues live on GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses default mattpocock/skills label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — one `CONTEXT.md` at root and `docs/adr/` for architectural decisions. See `docs/agents/domain.md`.

---

## 1. Project Overview

A web-based e-commerce platform for chess courses, inspired by Chessable.

- **Creators** build and sell courses (video + interactive chess board lessons)
- **Learners** purchase and study through interactive chess boards in-browser
- **Admin** reviews courses and confirms manual payments

**Core loop (never break this):** Create course → Admin review → Purchase → Learn

UI language: **Vietnamese** (i18n-ready via react-i18next; all strings in `vi.json`)

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + TypeScript |
| Routing | React Router v6 |
| Styling | Tailwind CSS + shadcn/ui |
| i18n | react-i18next (`vi.json` primary; `en.json` later) |
| Chess | chess.js + chessboard.js (CDN) |
| Backend / DB | Supabase (PostgreSQL + Auth + Storage) |
| Video | Supabase Storage (MP4 progressive, signed URLs, 50 MB max). Provider-pluggable via `src/lib/video/`; Phase 2 will switch to Cloudflare Stream for HLS adaptive — see `docs/adr/0001-video-storage-supabase.md`. |
| QR Payment | VietQR API (`img.vietqr.io`) |
| Email | Resend (low priority — build after core loop) |
| Deployment | Vercel (frontend) + Supabase (backend) |

> **Do not change the tech stack without creating an ADR in `docs/adr/`.**

### State management

Phase 1 uses no state management library — all state is local `useState` + `AuthContext`. This is intentional for MVP scope.

**When to introduce a library (Zustand preferred):**
- Chess board state needs to be shared across multiple unrelated components (e.g., syncing player position with a move list panel, an annotation sidebar, and a variation tree simultaneously)
- A feature requires cross-page or cross-route state that is awkward to hoist or pass via context
- Local state in a single component exceeds ~6–8 `useState` calls and is becoming hard to follow

Do **not** add a state library just to replace simple local state. Add it when the debugging or coordination cost of local state is clearly higher than the migration cost.

---

## 3. Design System

See `docs/design-system.md`. **Read that file before any UI/frontend task.**

Key rules (always apply, no need to open the file):
- Never use hardcoded hex values — always use CSS custom properties from `styles.css`
- UI language is Vietnamese — no hardcoded strings, use `vi.json` keys via react-i18next
- Design target: Desktop 1440px, max-width 1280px, horizontal padding 56px

---

## 4. User Roles


| Role | Created by | Key permissions |
|------|-----------|----------------|
| `admin` | Seeded at setup | Full access — course review, user management, order confirmation |
| `creator` | Admin manually assigns | Create/publish courses, upload videos, view personal revenue |
| `learner` | Default on registration | Browse, purchase, study, bookmark, rate, comment |

### Account tiers (orthogonal to role)

`role` controls **what** a user can do. `account_tier_id` controls **platform fee and chapter limit** for creators. Every user has an `account_tier_id`; only the creator role makes it meaningful.

| Tier code | `name_vi` | Fee % | Max chapters/course |
|-----------|-----------|-------|---------------------|
| `individual` | Cá nhân | 20 % | 10 |
| `business` | Doanh nghiệp | 15 % | 30 |
| `athlete` | Vận động viên | 10 % | 15 |
| `training_center` | Trung tâm đào tạo | 10 % | 50 |

- Default tier for all users: `individual`.
- Admin accounts are **always locked** to `individual` (DB trigger `enforce_admin_individual_tier`).
- Tier is changed via `/become-creator` (upgrade) or Admin panel (direct change).
- See `docs/adr/0002-enterprise-account-tiers.md` for full rationale.

---

## 5. Domain Concepts

### Course status flow

```
draft → pending_review → published
                       → rejected   ← terminal; Creator must create a new course
published → draft  (Creator withdraws)
```

- Rejected courses **cannot** be resubmitted. Creator starts over.
- Admin must provide a rejection reason.

### Lesson types

| Type | Description |
|------|-------------|
| `video` | MP4 (H.264 + AAC) upload via Supabase Storage in Phase 1. Max 50 MB. Phase 2 will switch to Cloudflare Stream for HLS adaptive — see `docs/adr/0001-video-storage-supabase.md`. |
| `chess` | PGN guided mode with inline `{ }` annotations and `(...)` variation trees per ADR-0004. |
| `puzzle` | Bookmark-based review — replays a chess lesson from beginning. |

### Order status flow

```
pending → active      (Admin confirms payment)
        → cancelled   (Admin rejects; reason required)
```

Free courses (price = 0) skip payment: instantly create `order` (status = `active`) + `enrollment`.

### Account tier

`account_tier_id` on `users` (FK → `account_tiers.code`) is **orthogonal** to `role`. It determines:
- `platform_fee_pct` charged on orders for this creator's courses.
- `max_chapters_per_course` enforced by DB trigger + UI counter.

Tiers are rows in `account_tiers` table (text PK) — adding a new tier needs only a SQL INSERT, no code deploy.

### Key tables

`users`, `courses`, `chapters`, `lessons`, `enrollments`, `lesson_progress`, `bookmarks`, `orders`, `reviews`, `comments`, `reports`, `config`, `account_tiers`, `account_applications`

Platform fee stored per tier in `account_tiers.platform_fee_pct`. The global `config.platform_fee_pct = 20` remains as a legacy fallback for the individual tier until the migration runs. After migration, fee is always read from the creator's tier row.

---

## 6. Key Design Decisions (locked)

| # | Decision |
|---|----------|
| D-01 | React 18 + Vite — not Next.js. SSR not needed. |
| D-02 | react-i18next from day one, Vietnamese only. No hardcoded strings. |
| D-03 | Rejected courses cannot be resubmitted. Creator starts over. |
| D-04 | Comments have **no reply threading** — each comment is independent. |
| D-05 | Free course (price=0) auto-activates instantly, same order tracking as paid. |
| D-06 | Free preview = Creator flags an existing video lesson, not a separate upload. |
| D-07 | ~~Guided mode is linear PGN only — no variation tree in Phase 1.~~ **Lifted by ADR-0004 + PRD-0003.** Variations live in PGN itself per V-01; player + editor are tree-aware (V-02..V-18). |
| D-08 | PGN annotations use standard `{ }` comment syntax parsed by chess.js. |
| D-09 | Board perspective (White/Black) set per lesson by Creator. |
| D-10 | Wrong move: piece snaps back + red highlight ~1 second. No popup. |
| D-11 | Hint: uses chessboard.js native square highlighting. No custom arrows. |
| D-12 | No backward navigation in guided mode. Bookmark + practice is the review mechanism. |
| D-13 | Video complete threshold: **≥80%** of video duration watched. |
| D-14 | Email notifications are low priority — build after core loop is validated. |
| D-15 | Platform fee 20% in `config`; payout settlement is manual in Phase 1. |
| D-16 | No Creator public profile page in Phase 1. |
| D-17 | No “Continue learning” button on Learner dashboard. |
| D-18 | Refund handling not in Phase 1. |
| D-19 | Search uses PostgreSQL `ILIKE`. No Elasticsearch. |
| D-20 | ToS and Privacy Policy are static pages. |

#### Enterprise account tier decisions (ADR-0002, PRD-0001)

| # | Decision |
|---|----------|
| E-01 | `account_tiers` is a DB lookup table (text PK), not a Postgres enum — new tiers need only a row INSERT. |
| E-02 | Tier codes are short lowercase strings (`individual`, `business`, `athlete`, `training_center`) — human-readable stable FK values. |
| E-03 | Four seed tiers ship with migration 018; fee/limit values are BizDev placeholders marked `-- TODO`. |
| E-04 | `users.account_tier_id` defaults to `'individual'` — all existing users are migrated automatically. |
| E-05 | DB trigger `enforce_admin_individual_tier` on `users` BEFORE INSERT OR UPDATE: admin always = individual tier. |
| E-06 | Chapter limit is per-tier row (`max_chapters_per_course`), not a global config entry. |
| E-07 | Platform fee + creator payout are snapshotted onto `orders` at creation — tier changes don't retroactively alter past orders. |
| E-08 | Fee formula: `floor(price * pct / 100)` — integer arithmetic, no floating-point rounding. |
| E-09 | RPC `create_order_with_fee_snapshot` handles all order creation; client never INSERTs `orders` directly. Free courses auto-activate enrollment in the same transaction. |
| E-10 | AdminUsersPage hides the “Change tier” action for rows where `role = 'admin'`. |
| E-11 | Tier downgrade is blocked if any existing course exceeds the new tier's chapter limit. RPC raises `tier_downgrade_violates_chapter_limit`. |
| E-12 | `creator_applications` is renamed to `account_applications`; `requested_tier_code` column added (FK → `account_tiers`). |
| E-13 | RLS on `account_tiers`: public SELECT (anon) allowed — tier list is marketing info needed before sign-up. |
| E-14 | New application status `superseded`: submitting while one is pending auto-closes the old one. |
| E-15 | Business tier signup: `users.name` is set to `metadata.business_name` at application-submit time. |
| E-16 | localStorage key for pending applications: `pendingAccountApplication` (replaces `pendingCreatorApplication`). |
| E-17 | `/become-creator` is the single entry point for all creator signup and tier-upgrade flows. No separate settings page in Phase 1. |
| E-18 | Tier-specific required fields stored in `account_applications.metadata jsonb` — no separate per-tier tables. |
| E-19 | Required fields validated at both client layer and RPC layer (`submit_account_application`). |
| E-20 | Tier upgrade for existing creators: only `account_tier_id` changes; `role` stays `creator`. |

#### Variation tree decisions (ADR-0004, PRD-0003)

| # | Decision |
|---|----------|
| V-01 | Variation data is **encoded in PGN itself** using the standard `(...)` syntax. No `mode` column on `lessons`, no separate `lesson_moves` table, no DB migration in this scope. |
| V-02 | `parsePgn` produces a `PgnNode` tree: each node holds `{ id, san, from, to, promotion, fen, moveNumber, side, annotation, children: PgnNode[], parentId }`. First child = main line; subsequent children = alternatives in PGN order. |
| V-03 | Linear PGN parses to a tree of degree 1. The legacy `mainLine: PgnNode[]` derived view preserves backwards compat with editor preview and existing tests. |
| V-04 | The PGN textarea remains the single authoring surface. No graphical tree-builder in Phase 2 — deferred to Phase 3. |
| V-05 | Editor right-side preview pane has a collapsible variation list. Clicking a node updates the preview FEN + last-move highlight. |
| V-06 | `GuidedChessPlayer` navigates by `currentNodeId`. Cursor walks `currentNode.children[0]` by default; learner move matching any child advances along that branch. No-match → snap-back (D-10). |
| V-07 | Hint highlights `children[0]` (main-line continuation). Multiple children → inline pill `+N variations`; hint always points to main line. |
| V-08 | Opponent (auto-played) picks `children[0]` when multiple exist. Editor surfaces a “Coach: opponent will play X” reminder. |
| V-09 | Completion (`onComplete`) fires when the learner reaches any leaf node — via main line or side variation. |
| V-10 | Bookmark contract widened to `onBookmark(currentNodeId, currentFen, depth, totalDepth)`. `bookmarks` table gains nullable `node_id text` + `played_plies integer` (migration 035). Existing bookmarks (`node_id IS NULL`) resolve via legacy ply-walk. |
| V-11 | Editor PGN status row shows `✓ Đã phân tích PGN · N nước (M nhánh phụ, độ sâu tối đa K)`. |
| V-12 | `MAX_PGN_CHARS` raised from 5 000 to **50 000** to accommodate realistic repertoire trees. |
| V-13 | Wrong-move detection matches on `(from, to, promotion)` tuple, not SAN — avoids disambiguation drift and handles under-promotion variations. |
| V-14 | Back button stays forbidden (D-12). Reset dialog is the only way to retry a different branch. |
| V-15 | i18n: variation strings live under the existing `guidedPlayer.*` + `creator.lessonEditor.*` namespaces. No new top-level namespace. |
| V-16 | Node IDs hash on `(parentId, from, to, promotion)`, not SAN. Hash: `sha256((parentId‖'')+'/'+ from+to+(promotion‖'')).slice(0,16)`. |
| V-17 | PGN-to-tree parser is a **custom recursive-descent tokenizer** tracking `(...)` depth — not `chess.js loadPgn` (which discards parenthesised content). `chess.js` is used only for per-node FEN computation by replaying the path from root. |
| V-18 | Leaf-completion fires regardless of which side is to move at the leaf. UI omits “your turn” prompt at a leaf. |

#### Board authoring + puzzle rewind decisions (PRD-0004 — in flight)

PRD-0004 design decisions (D-21 through D-25) land with slice 12 (issue #199). Architectural decisions are recorded ahead of code:

- **ADR-0005** — Migrate board library from `react-chessboard` to `chessground` for native arrow/marker support and the chess-standard right-click + Shift/Alt/Ctrl drawing vocabulary.
- **ADR-0006** — Introduce Zustand for editor state only (`treeStore`); player + viewer + puzzle modes stay on local `useState`.

---

## 7. Phase 1 Constraints — Do NOT scope-creep these

The following are explicitly **deferred to Phase 2**:

- Automated payment gateway (PayOS / Stripe webhooks)
- Spaced repetition algorithm (FSRS)
- Email / in-app notifications
- Stockfish engine integration
- Creator public profile page
- Refund handling
- Mobile app

> D-07 has been **lifted** — variation tree shipped in Phase 2 (ADR-0004, PRD-0003, merged 2026-05-10).

---

## 8. Chess Board — Critical Implementation Notes

- Use **chess.js** for PGN parsing, move validation, and annotation extraction.
- Use **chessboard.js** (CDN) for board rendering.
- Wrap all `chess.js` calls in `try/catch`. Invalid PGN → show error to Creator, do not crash.
- Test with: castling, en passant, promotion, and complex PGN files.
- Guided mode state machine: forward-only. No “previous move” button.
- Live board preview in Creator authoring updates as PGN textarea changes.
- Variation parsing uses a custom recursive-descent tokenizer (V-17), not `chess.js loadPgn`. `chess.js` is the chess engine for FEN/move validation only.

---

## 9. Video Upload — Critical Implementation Notes

> Phase 1 ships **Supabase Storage** behind a `VideoProvider` adapter so we can swap in
> Cloudflare Stream in Phase 2 without touching UI code. See ADR-0001.

- Provider lookup: `getDefaultProvider()` (env-selected) for new uploads;
  `getProvider(lesson.video_provider)` for playback so old rows keep working.
- Upload: `tus-js-client` directly to Supabase Storage `/storage/v1/upload/resumable`,
  authenticated with the user's Supabase JWT. Bucket `lesson-videos` is private.
- Object path convention: `<auth.uid()>/<lesson_id>/<filename>`. RLS on
  `storage.objects` requires the first segment to match `auth.uid()` and the user's
  role to be `creator` or `admin`.
- Constraints (Phase 1): MP4 only, max **50 MB** per file (matches Supabase free tier).
  Both client (`validateVideoFile`) and bucket (`allowed_mime_types`, `file_size_limit`)
  enforce this.
- Playback: server-side `supabase.storage.from('lesson-videos').createSignedUrl(path, 4h)`.
  Only generate signed URLs for enrolled learners or for `free_preview` lessons.
- DB columns are provider-neutral: `video_provider`, `video_provider_id`, `video_status`
  (`idle | uploading | processing | ready | error`), `video_filename`, `video_size_bytes`,
  `video_mime`, `video_error`, `duration_seconds`. The `processing` state is reserved
  for the Phase 2 Cloudflare encoding step.
- Resumable upload: tus-js-client retry delays `[0, 3000, 5000, 10000, 20000]` and 6 MB
  chunks. Progress bar + Cancel + Replace + Delete in the editor UI.
- Player: `<VideoView url format>` switches between MP4 (`<video>` native) and HLS
  (lazy-imports `hls.js` only on browsers that don't natively support HLS — Safari does).
- ⚠️ Phase 1 has **no transcoding and no adaptive bitrate**. Creators must compress to
  ~720p, H.264, ≲1500 kbps before uploading.

---

## 10. Payment Flow (Phase 1 — Manual QR)

1. Learner clicks Purchase → system creates `order` (status = `pending`) with unique code e.g. `ORD-2026-000123`
2. Payment page shows VietQR code, amount, bank account, required transfer note = order code
3. Learner clicks “I have paid” → “Awaiting confirmation” screen
4. Admin verifies in dashboard → Confirm → `order.status = active` + enrollment created
5. Free courses (price = 0): skip steps 1–4, instant enrollment

---

## 11. Lesson Player Layout

- Two-column layout (Chessable-inspired): left sidebar + right content area
- Sidebar: chapter list with collapsible lessons, completion tick, current lesson highlighted
- Top: breadcrumb `Course Name > Chapter Name`
- Video lesson: player fills content area
- Chess lesson: board (left of content area) + annotation text panel (right)
- Navigation: sidebar only — no Previous/Next lesson buttons

---

## 12. Security Requirements

- HTTPS enforced on all routes
- Supabase Row Level Security (RLS) on all tables
- Supabase Storage signed URLs for video playback (4h expiry); switches to Cloudflare Stream signed URLs in Phase 2
- CSRF protection
- Signed playback URLs only served to enrolled Learners

---

## 13. Non-Functional Requirements

| Criterion | Requirement |
|-----------|-------------|
| Page load | Course pages < 2 seconds |
| Video start | Playback within 3 seconds of pressing Play |
| Uptime | ≥99% monthly |
| Responsive | Fully usable on mobile; chess board supports touch drag-and-drop |
| Browsers | Chrome, Safari, Firefox — latest 2 major versions |
| Scalability | Supabase free tier: 500 MB DB, 1 GB storage, 5 GB egress/month, 50 MB per-file. Auto-pauses after ~1 week idle. Upgrade to Pro before public launch (or front Storage with a CDN once egress > 50% of quota). |

---

## 14. Development Principles

1. Always prioritize the **core loop**: Create course → Review → Purchase → Learn.
2. The interactive chess board is the key differentiator — allocate sufficient time and test thoroughly.
3. Do not invest in UI polish before logic is correct and tested.
4. Admin panel: tables + buttons are sufficient for Phase 1. No charts.
5. Video upload has many edge cases (large files, encoding delays) — test thoroughly.
6. Email notifications are low priority — build after core loop is validated.
