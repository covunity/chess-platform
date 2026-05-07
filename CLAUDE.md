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

> Source files: `styles.css`, `shared.jsx`, `design-system/color.html`, `design-system/typography.html`, `screens/*.jsx`
> Design target: Desktop 1440px. Aesthetic: modern SaaS, friendly, lots of whitespace.

### 3.1 Color Palette

All colors as CSS custom properties in `styles.css`. **Never use hardcoded hex values in components** — always reference variables.

#### Surfaces
| Variable | Value | Use |
|----------|-------|-----|
| `--bg` | `#FAFAF7` | App background (warm off-white — not pure white) |
| `--surface` | `#FFFFFF` | Cards, inputs, top nav |
| `--surface-2` | `#F4F2EC` | Sidebar backgrounds, subtle wells, hover states |
| `--surface-3` | `#ECE9E1` | Pressed states, avatars |
| `--border` | `#EAE7DD` | Default borders |
| `--border-strong` | `#D9D5C7` | Input borders, dividers |

#### Ink (Text)
| Variable | Value | Use |
|----------|-------|-----|
| `--ink-1` | `#15171A` | Primary text, headings |
| `--ink-2` | `#4A5058` | Secondary text, descriptions |
| `--ink-3` | `#7A808A` | Muted, captions, metadata |
| `--ink-4` | `#A8AEB6` | Disabled, placeholders, hints |

#### Accent — Single Teal Hue (H≈200)
| Variable | Value | Use |
|----------|-------|-----|
| `--accent` | `oklch(0.62 0.12 200)` | Primary CTAs, links, active indicators, progress bars |
| `--accent-ink` | `oklch(0.32 0.08 200)` | Text on `--accent-soft` backgrounds |
| `--accent-soft` | `oklch(0.95 0.03 200)` | Active lesson bg, pill backgrounds |
| `--accent-border` | `oklch(0.85 0.06 200)` | Accent-tinted outlines |

#### Status Colors
| Variable | Value | Use |
|----------|-------|-----|
| `--success` | `oklch(0.62 0.12 150)` | Published, completed lessons, paid, free preview pills |
| `--success-soft` | `oklch(0.95 0.03 150)` | Success pill backgrounds |
| `--warning` | `oklch(0.72 0.13 75)` | Pending review, awaiting confirmation |
| `--warning-soft` | `oklch(0.96 0.04 75)` | Warning pill backgrounds |
| `--danger` | `oklch(0.58 0.16 25)` | Wrong move, rejection, danger actions |
| `--danger-soft` | `oklch(0.96 0.03 25)` | Danger pill backgrounds |

#### Chess Board
| Variable | Value | Notes |
|----------|-------|-------|
| `--board-light` | `#EFE3C7` | Light squares |
| `--board-dark` | `#B58863` | Dark squares |
| `--board-highlight` | `oklch(0.85 0.14 95 / 0.55)` | Hint — yellow-green overlay |
| `--board-move` | `oklch(0.78 0.13 145 / 0.42)` | Last move — green overlay |
| `--board-error` | `oklch(0.65 0.18 25 / 0.55)` | Wrong move — red overlay, ~1 second |

---

### 3.2 Typography

Three font families, each with a strict role. Load all via Google Fonts.

```
Inter: wght@400;500;600;700
Newsreader: ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400
JetBrains Mono: wght@400;500
```

| Variable | Family | Role |
|----------|--------|------|
| `--font-sans` | Inter | All UI chrome — nav, buttons, body, captions, labels, annotations |
| `--font-serif` | Newsreader | Editorial/display — hero titles, course names, prices, stat numbers |
| `--font-mono` | JetBrains Mono | Chess notation (PGN), FEN strings, order codes (`ORD-2026-000123`) |

**Type scale:**

| Role | Font | Size | Line-height | Weight | Letter-spacing |
|------|------|------|-------------|--------|----------------|
| Display XL | Newsreader | 64px | 1.02 | 400 | -0.025em |
| Display L | Newsreader | 48px | 1.05 | 400 | -0.025em |
| Display M | Newsreader | 32px | 1.1 | 400 | -0.02em |
| Stat number | Newsreader | 32px | 1 | 400 | -0.02em |
| Heading 18 | Inter | 18px | 1.3 | 600 | -0.01em |
| Heading 15 | Inter | 15px | 1.3 | 600 | — |
| Body | Inter | 14px | 1.55 | 400 | — |
| Body S | Inter | 13px | 1.5 | 400 | — |
| Caption | Inter | 12px | 1.5 | 400 | — |
| Eyebrow | Inter | 11.5px | 1 | 600 | 0.08em, UPPERCASE |
| PGN notation | JetBrains Mono | 13px | 1.6 | 500 | — |
| Order code | JetBrains Mono | 11.5px | 1 | 400 | — |

---

### 3.3 Spacing, Radius & Density

**Border radius:**
| Variable | Value |
|----------|-------|
| `--r-sm` | 6px |
| `--r-md` | 10px |
| `--r-lg` | 14px (cards) |
| `--r-xl` | 20px |
| `--r-2xl` | 28px |

**Density system** — toggle with `data-density="compact"` attribute on `<html>`:

| Token | Default | Compact |
|-------|---------|---------|
| `--d-pad-x` | 24px | 16px |
| `--d-pad-y` | 18px | 12px |
| `--d-gap` | 16px | 10px |
| `--d-row` (button/input height) | 44px | 36px |
| `--d-text` | 14px | 13px |
| `--d-text-sm` | 13px | 12px |

**Shadows:**
| Variable | Use |
|----------|-----|
| `--sh-1` | Subtle depth — inline elements |
| `--sh-2` | Cards, course thumbnails |
| `--sh-3` | Elevated — buy card, floating overlays |

---

### 3.4 Component Conventions

#### Buttons
| Class | Appearance | When to use |
|-------|-----------|-------------|
| `.btn-accent` | `--accent` bg, white text | Primary CTA (Purchase, Browse, Start practice) |
| `.btn-primary` | `--ink-1` bg, white text | Confirm, Resume, Submit |
| `.btn-secondary` | White bg, `--border-strong` border | Secondary actions (Bookmark, Export) |
| `.btn-ghost` | Transparent, hover → `--surface-2` | Icon buttons, Flip board, Reset |
| `.btn-sm` | h: 32px, 13px | In-player controls, table actions |
| `.btn-lg` | h: 52px, 15px | Hero CTAs |

Base `.btn`: height `var(--d-row)`, padding `0 18px`, radius `var(--r-md)`, font-weight 500.

#### Pills / Badges
| Class | Color | Use |
|-------|-------|-----|
| `.pill` | neutral (`--surface-2`) | Tags, lesson duration, level |
| `.pill-accent` | teal soft | Active/current state, `is_free_preview` |
| `.pill-success` | green | `published`, completed, paid, free preview |
| `.pill-warning` | amber | `pending_review`, awaiting payment |
| `.pill-danger` | red | `rejected`, error states |

Height: 22px, padding: `0 8px`, font-size: 11.5px, font-weight: 500, border-radius: 999px.

#### Cards
`.card` = `background: var(--surface)`, `border: 1px solid var(--border)`, `border-radius: var(--r-lg)`. No shadow by default — add `box-shadow: var(--sh-2)` for buy card / elevated cards.

#### Inputs
`.input`: height `var(--d-row)`, padding `0 14px`, radius `var(--r-md)`, border `1px solid var(--border-strong)`. Focus: `border-color: var(--accent)`, `box-shadow: 0 0 0 3px var(--accent-soft)`.

PGN textarea: add `.mono` class (JetBrains Mono, 12.5px, line-height 1.6).

#### Avatar
Circular, 32px default. Background varies by user (use `oklch(0.85 0.07 200)` for the default/current user). Initials in font-weight 600, font-size 12px.

#### Logo Mark
`.logo-mark`: chess-board pattern icon (CSS gradient, 22×22px, border-radius 5px) + "Gambitly" in Newsreader serif 20px.

---

### 3.5 Icon System

Custom inline SVG icons. All stroke-based: `strokeWidth={1.6}`, `strokeLinecap="round"`, `strokeLinejoin="round"`. Default size: 16px.

Filled variants (no stroke): `starFill`, `bookmarked`, `play`, `google`, `facebook`, `dot`.

Full icon set: `search`, `bell`, `bookmark`, `bookmarked`, `star`, `starFill`, `play`, `plus`, `chevronDown`, `chevronRight`, `chevronLeft`, `check`, `checkCircle`, `user`, `users`, `book`, `video`, `chess`, `clipboard`, `chart`, `settings`, `home`, `flame`, `arrow`, `sparkle`, `lock`, `flip`, `hint`, `download`, `eye`, `edit`, `trash`, `upload`, `filter`, `google`, `facebook`, `dot`

Lesson type → icon mapping: `video` → `video`, `chess` → `chess`, `puzzle` → `clipboard`

---

### 3.6 Page Layouts

**Global constants:** max-width `1280px`, horizontal page padding `56px`, design breakpoint `1440px`.

#### TopNav (marketing / learner)
- Height: 64px; `var(--surface)` bg; bottom border `1px var(--border)`
- Logo left → nav links (Browse, Practice, My Library) → search bar (320px, `⌘K` hint) → bell → avatar

#### Homepage
```
TopNav (64px)
├── Hero section — gradient bg, padding 60px 56px 36px
│   grid: 1.1fr / 1fr
│   Left: eyebrow → 64px serif headline (italic em) → body → CTA buttons → trust signals
│   Right: chess board (400px, rotate -3°, sh-3) + floating annotation card + bookmark card
├── Filter bar — level pills + category pills + sort select
├── Course grid — 3 columns, gap 20px
│   CourseCard: 16/10 thumbnail (MiniBoard) + badge overlay + tag pill
│              + title (15px/600) + creator (12.5px muted) + rating+lessons+hours
│              + level pill + price (Newsreader 15px, green if free)
└── Footer ribbon — var(--surface-2), logo + links
```

#### Course Detail
```
TopNav
├── Hero strip — var(--surface), grid 1.4fr / 1fr, padding 32px 56px
│   Left: breadcrumb → pills → 48px serif title → description → creator+rating → stat numbers (Newsreader 22px)
│   Right: Buy card (sh-2)
│          ├── Thumbnail (16/10 with play overlay + "Watch free preview" label)
│          ├── Price (Newsreader 36px) + strike-through original + launch price note
│          ├── btn-accent (Purchase) + btn-secondary (Add to wishlist)
│          └── Feature list (lifetime access, free previews, language)
└── Curriculum section — grid 1.5fr / 1fr, padding 48px 56px
    Left: collapsible chapter accordion → reviews (star distribution + comment cards)
    Right: "What you'll learn" card + Prerequisites card
```

#### Lesson Player — Chess
```
Full-screen (no TopNav)
├── PlayerSidebar (320px, fixed left)
│   ├── Header: back button + course name (truncated)
│   ├── Progress bar: accent teal, 4px height
│   └── Chapter list (collapsible)
│       Lesson row: circle icon (check=done/type=todo) + title + duration
│       Current: accent-soft bg + 2px accent left border, accent-ink text
│       Done: green circle tick (var(--success))
└── Content area (flex: 1)
    ├── Top bar (56px): breadcrumb (Course › Chapter › Lesson) + Bookmark btn + avatar
    └── Player grid: 1.1fr / 0.9fr
        Left (board column):
          ├── Player indicator (piece color + "Move N of N" mono)
          ├── ChessBoard (480px) with lastMove highlight
          └── Controls: Hint btn + Flip board btn + Reset lesson (ghost)
        Right (annotation column, var(--surface)):
          ├── Header: eyebrow "Lesson N of N" + h2 title + instruction text
          ├── Move log: MoveBlock (mono move notation + Inter annotation text)
          │   Highlighted move: var(--surface-2) bg + border
          │   "Your turn" prompt: accent-soft card
          ├── Coach note: avatar + name + italic body text
          └── Footer: "Press B to bookmark" hint + FEN indicator
```

#### Lesson Player — Video
```
Full-screen
├── PlayerSidebar (same as chess player)
└── Content area (flex: 1)
    ├── Top bar (56px): breadcrumb + Bookmark btn + avatar
    └── grid: 1fr / 360px
        Main: 16/9 video player (dark bg) + title/meta below
              Video controls: seek bar (accent), time (mono), speed, HD, fullscreen
        Right panel (360px, var(--surface)):
          Tabs: Chapters / Transcript / Notes
          Chapter markers: timestamp (mono) + title, active = accent-soft + left border
```

#### Auth
```
Split layout: 1fr / 1.05fr (full screen)
Left (dark brand panel, #1A1D22 → #0F1114):
  ├── Logo (off-white #EFE9D9)
  ├── 56px serif headline with italic teal accent em
  ├── Stat row: 3 stats (Newsreader 28px number + uppercase label)
  └── Decorative chess board (opacity 0.18, rotate 8°, positioned right edge)
Right (centered form, max 400px):
  ├── Eyebrow + 38px serif heading
  ├── OAuth buttons: Google + Facebook (btn-secondary, equal width)
  ├── "or with email" divider
  ├── Form fields (full name on signup, email, password + forgot link on signin)
  ├── ToS checkbox (signup only)
  └── btn-accent btn-lg submit + toggle sign in/up link
```

#### Creator Dashboard
```
TopNav (no search)
└── Content (max-width 1280, padding 32px 56px)
    ├── Header: eyebrow "Creator studio" + 38px serif title + btn-accent "New course"
    ├── KPI strip: 4-column cards
    │   Each card: label (12px muted) + Newsreader 32px value + sub-label
    │   Metrics: Total students, Gross revenue, Your payout (80%), Avg. rating
    ├── Courses table: status tab pills + table
    │   Columns: Course (MiniBoard 40px + name) | Status pill | Students | Revenue | Rating | ⋯
    │   Status → pill class: published=success, pending_review=warning, draft=neutral
    └── Course builder (3-column, 560px height, card)
        Left 260px (var(--surface-2)): lesson tree with chapter headers + lesson rows
          Active lesson: accent-soft bg + 2px accent left border
        Center: lesson type tabs + form fields + PGN textarea (mono, 180px)
          PGN validation feedback: green check + move/annotation count
        Right 380px (var(--surface-2)): live board preview (ChessBoard 300px) + annotation preview
          Footer: "Save draft" + "Submit for review" buttons
```

#### Learner Dashboard
```
TopNav
└── Content (max-width 1280, padding 32px 56px)
    ├── Header: eyebrow "Welcome back, [name]" + 38px serif + Bookmarks btn + Browse btn
    ├── Stats strip: 4-column cards
    │   Metrics: Current streak (flame/warm), Lessons this week (checkCircle/good),
    │            Bookmarks to review (bookmarked/accent), Hours studied (book/neutral)
    │   Each: 32px icon bg + 32px Newsreader value + sub-label
    ├── "My courses" list (horizontal cards)
    │   Each card: MiniBoard (120×90) + level pill + creator + title (16px/600) +
    │              "Up next: [lesson name]" + progress bar (accent, 6px) + lesson count
    │              + btn-primary "Resume" (right-aligned)
    └── Bottom grid: 1.2fr / 1fr
        Left — Practice card (accent-gradient bg):
          Eyebrow + 26px serif title + description + btn-accent "Start practice"
          Mini board grid (4 boards + "+N more" placeholder)
        Right — Recommended courses:
          3 rows: MiniBoard (44px) + title + creator+rating + price
```

#### Admin Panel
```
Full-screen
├── Admin sidebar (220px, fixed)
│   ├── Logo + "Admin" eyebrow label
│   ├── Nav items: Overview | Course review (badge) | Orders (badge) |
│   │            Users | Reports (badge) | Settings
│   │   Active: var(--surface-2) bg, badge = ink-1 bg white text
│   └── Footer: admin avatar + name + email
└── Main area (flex: 1)
    ├── Header (60px): page title (18px/600) + pending count pill + search input
    └── Content (padding 32px, var(--bg))
        2-column grid (1.1fr / 1fr):
        Left:
          ├── Review queue: list of course cards
          │   Selected: accent border + accent-soft bg
          │   Each: MiniBoard (56px) + title + creator·level·lessons + price + date
          └── Pending orders table: Order code (mono) | Learner | Amount | Fee/Payout | Confirm btn
        Right (sticky detail panel):
          ├── Status pill + course title + submitter + date
          ├── Stats: lessons, runtime, price, level
          ├── Description
          ├── Sample lesson preview: ChessBoard (180px) + lesson title (mono) + PGN validity pills
          └── Actions: "Reject with reason" (secondary) + "Approve & publish" (accent)
```

---

### 3.7 Chess Board Component

Rendered via Unicode chess pieces with CSS, not images. Board is a `8×8` CSS grid.

**Piece Unicode map:** `K=♔ Q=♕ R=♖ B=♗ N=♘ P=♙` (white), `k=♚ q=♛ r=♜ b=♝ n=♞ p=♟` (black)

**Piece text styling:**
- White pieces: color `#FAFAF7`, textShadow `0 1px 0 rgba(0,0,0,0.25), 0 0 1px rgba(0,0,0,0.6)`
- Black pieces: color `#222`, textShadow `0 1px 0 rgba(255,255,255,0.25)`

**Square size:** `boardSize / 8` px (default 480px board → 60px squares, piece fontSize = squareSize × 0.78)

**Board shadow:** `0 12px 36px rgba(20,22,26,0.12), 0 2px 8px rgba(20,22,26,0.06)`, border-radius 6px, border `1px solid var(--border-strong)`

**Overlays** (absolute positioned, inset 0):
- Last move (from/to): `var(--board-move)` overlay
- Hint highlight: `var(--board-highlight)` overlay + `inset 0 0 0 3px oklch(0.7 0.18 95)` inner shadow
- Wrong move: `var(--board-error)` overlay, remove after ~1 second

**Coordinate labels:** font-size 9.5px, font-weight 600, contrasting color (light square coord = `--board-dark`, dark square coord = `--board-light`). File labels bottom-right, rank labels top-left.

**`MiniBoard`** (for cards, lesson tree, admin queue): same as ChessBoard, `showCoords={false}`, default size 120px.

**"Your move" indicator:** dark pill overlay (`rgba(20,22,26,0.85)`), top-right corner, "Your move" text, 11px.

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
