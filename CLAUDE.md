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
| `chess` | Linear PGN guided mode with inline `{ }` annotations. |
| `puzzle` | Bookmark-based review — replays a chess lesson from beginning. |

### Order status flow

```
pending → active      (Admin confirms payment)
        → cancelled   (Admin rejects; reason required)
```

Free courses (price = 0) skip payment: instantly create `order` (status = `active`) + `enrollment`.

### Key tables

`users`, `courses`, `chapters`, `lessons`, `enrollments`, `lesson_progress`, `bookmarks`, `orders`, `reviews`, `comments`, `reports`, `config`

Platform fee stored in `config` table as `platform_fee_pct = 20` (Creator receives 80%).

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
| D-07 | **Guided mode is linear PGN only — no variation tree in Phase 1.** |
| D-08 | PGN annotations use standard `{ }` comment syntax parsed by chess.js. |
| D-09 | Board perspective (White/Black) set per lesson by Creator. |
| D-10 | Wrong move: piece snaps back + red highlight ~1 second. No popup. |
| D-11 | Hint: uses chessboard.js native square highlighting. No custom arrows. |
| D-12 | No backward navigation in guided mode. Bookmark + practice is the review mechanism. |
| D-13 | Video complete threshold: **≥80%** of video duration watched. |
| D-14 | Email notifications are low priority — build after core loop is validated. |
| D-15 | Platform fee 20% in `config`; payout settlement is manual in Phase 1. |
| D-16 | No Creator public profile page in Phase 1. |
| D-17 | No "Continue learning" button on Learner dashboard. |
| D-18 | Refund handling not in Phase 1. |
| D-19 | Search uses PostgreSQL `ILIKE`. No Elasticsearch. |
| D-20 | ToS and Privacy Policy are static pages. |

---

## 7. Phase 1 Constraints — Do NOT scope-creep these

The following are explicitly **deferred to Phase 2**:

- Variation tree (branching PGN / guided mode with alternatives)
- Automated payment gateway (PayOS / Stripe webhooks)
- Spaced repetition algorithm (FSRS)
- Email / in-app notifications
- Stockfish engine integration
- Creator public profile page
- Refund handling
- Sub-tier business accounts
- Mobile app

> **D-07 is locked.** Any request to add variation tree to Phase 1 requires a formal scope change.

---

## 8. Chess Board — Critical Implementation Notes

- Use **chess.js** for PGN parsing, move validation, and annotation extraction.
- Use **chessboard.js** (CDN) for board rendering.
- Wrap all `chess.js` calls in `try/catch`. Invalid PGN → show error to Creator, do not crash.
- Test with: castling, en passant, promotion, and complex PGN files.
- Guided mode state machine: forward-only. No "previous move" button.
- Live board preview in Creator authoring updates as PGN textarea changes.

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
3. Learner clicks "I have paid" → "Awaiting confirmation" screen
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
7. **Do not scope-creep variation tree into Phase 1.**
