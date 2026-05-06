---
name: ui-tester
description: >
  UI fidelity audit against the design system in CLAUDE.md. Use when the user
  wants to verify that implemented screens match the design spec — colors,
  typography, spacing, layout, component classes, and design tokens. The skill
  starts the dev server, inspects each page, and produces a concise mismatch
  report. No code fixes or source references in the output.
---

<what-to-do>

You are a UI auditor. Your job is to compare the running app against the design
spec defined in CLAUDE.md (sections 3.1–3.7 cover the full design system) and
produce a clean report. You do NOT suggest fixes or reference source files.

Follow these phases in order.

</what-to-do>

<phase-1-start-server>

## Phase 1 — Start the dev server

1. Check if a dev server is already running on port 5173 (default Vite port):
   ```
   curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
   ```
2. If not running, start it in the background:
   ```
   npm run dev -- --port 5173
   ```
   Wait up to 15 seconds for it to become ready (poll with curl).
3. Confirm the base URL before proceeding.

</phase-1-start-server>

<phase-2-page-inventory>

## Phase 2 — Build the page list

Scan `src/App.tsx` (and any router config files) for `<Route path=` entries.
Build the full list of auditable routes. For routes with dynamic segments
(e.g. `:courseId`), skip them unless the user supplies test IDs — note the skip
in the report.

Known routes in this project (update if routes change):

| Route | Screen name per CLAUDE.md |
|-------|--------------------------|
| `/` | Homepage |
| `/login` | Auth — Sign In |
| `/signup` | Auth — Sign Up |
| `/forgot-password` | Auth — Forgot Password |
| `/creator` | Creator Dashboard |
| `/creator/courses/new` | Course Builder — New Course |
| `/admin` | Admin Panel |
| `/admin/users` | Admin — Users |
| `/terms` | Static — Terms |
| `/privacy` | Static — Privacy |

</phase-2-page-inventory>

<phase-3-fetch-and-inspect>

## Phase 3 — Fetch and inspect each page

For each auditable route, use **WebFetch** to retrieve the page HTML from the
running dev server (e.g. `http://localhost:5173/login`).

For each page, check the following dimensions against the CLAUDE.md spec.
Note every deviation, no matter how minor.

### 3a. Layout structure
- Does the top-level layout match the spec? (e.g., Auth uses split 1fr/1.05fr;
  Homepage has TopNav → Hero → Filter bar → Course grid → Footer)
- Are the correct layout containers present (sidebar, content area, grid columns)?
- Does max-width match the 1280px global constant with 56px horizontal padding?

### 3b. Color tokens
- Are hardcoded hex/rgb/hsl values used instead of CSS custom properties (`var(--…)`)?
- Are semantic color variables used correctly?
  - Backgrounds: `--bg`, `--surface`, `--surface-2`, `--surface-3`
  - Text: `--ink-1` (primary), `--ink-2` (secondary), `--ink-3` (muted)
  - Accents: `--accent` on CTAs, `--accent-soft` for active states
  - Status pills: `--success`/`--warning`/`--danger` variants

### 3c. Typography
- Are Google Fonts (`Inter`, `Newsreader`, `JetBrains Mono`) loaded in `<head>`?
- Do headings use the correct font family?
  - Newsreader: hero titles, course names, stat numbers, prices
  - Inter: all UI chrome, body, buttons, labels
  - JetBrains Mono: PGN, FEN, order codes
- Do font sizes match the type scale? (Display XL=64px, Display L=48px,
  Heading 18=18px/600, Body=14px, Caption=12px, Eyebrow=11.5px uppercase, etc.)

### 3d. Components
- **Buttons**: Do CTAs use `.btn-accent`? Confirm/Submit use `.btn-primary`?
  Secondary actions use `.btn-secondary`? Icon buttons use `.btn-ghost`?
  Base height is `var(--d-row)` (44px default).
- **Pills/Badges**: Do status badges use the correct pill class?
  (`pill-success`=published/paid, `pill-warning`=pending, `pill-danger`=rejected)
  Height 22px, border-radius 999px.
- **Cards**: Does `.card` use `var(--surface)` bg, `1px solid var(--border)`,
  `var(--r-lg)` radius?
- **Inputs**: Height `var(--d-row)`, `var(--r-md)` radius, `var(--border-strong)` border.
  Focus state: `var(--accent)` border + `var(--accent-soft)` ring.

### 3e. Page-specific checklist
Apply the layout blueprint from CLAUDE.md §3.6 for each page:

**Homepage**: Hero grid 1.1fr/1fr; filter bar with level+category pills; 3-col
course grid; footer ribbon with `var(--surface-2)` bg.

**Auth (Login/Signup)**: Split layout — left dark panel (#1A1D22) with serif
headline, italic teal `<em>`, stat row (Newsreader 28px), decorative board
(opacity 0.18); right centered form max 400px with eyebrow, OAuth buttons,
divider, fields, btn-accent submit.

**Creator Dashboard**: Eyebrow "Creator studio" + 38px serif heading +
btn-accent "New course"; 4-col KPI strip (Newsreader 32px values); course
table with status tab pills; course builder 3-col layout with live board
preview.

**Admin Panel**: 220px fixed sidebar with logo + nav items + admin avatar
footer; main area with 60px header; 2-col content grid (1.1fr/1fr) — review
queue left, sticky detail panel right.

### 3f. i18n
- Are there any hardcoded Vietnamese strings (or English strings) in the HTML
  that should be coming from `vi.json` via react-i18next? (Look for visible
  text that is not a translation key output.)

### 3g. Design tokens — spot check
Look for these common violations:
- `border-radius` values hardcoded instead of `var(--r-sm/md/lg/xl/2xl)`
- `box-shadow` hardcoded instead of `var(--sh-1/2/3)`
- `gap`, `padding`, `height` hardcoded where density tokens should apply

</phase-3-fetch-and-inspect>

<phase-4-report>

## Phase 4 — Write the report

After inspecting all pages, write a single, clean mismatch report. Structure it
as follows. Omit any section where there are zero findings.

---

```
# UI Audit Report
Date: [today]
Pages audited: [N] | Pages skipped: [N] (dynamic routes)

## Summary
[One sentence: overall fidelity assessment — e.g., "Auth pages are mostly
faithful; Homepage and Creator Dashboard have several token and layout gaps."]

---

## [Page Name] — [route]

### Layout
- [Finding: what was expected vs. what was found]

### Colors & Tokens
- [Finding]

### Typography
- [Finding]

### Components
- [Finding]

### i18n
- [Finding]

---

## [Next Page] — [route]
…

---

## Cross-cutting Issues
[Issues that appear on multiple pages — e.g., "Missing Google Fonts import on
all pages", "Hardcoded hex #FFFFFF used instead of var(--surface) site-wide"]
```

---

**Report rules:**
- Each finding is one bullet: state what was expected, then what was observed.
- Use plain language. No jargon beyond what is in CLAUDE.md.
- No code snippets, no file paths, no fix suggestions.
- If a page matches the spec exactly, write "✓ No issues found."
- Keep the entire report under 600 words unless there are many findings.

</phase-4-report>

<guardrails>

- Do NOT suggest code changes.
- Do NOT reference source file paths or line numbers.
- Do NOT run `npm run build` — dev server only.
- If the dev server fails to start, stop and report the error to the user.
- If WebFetch returns an error (e.g., 302 redirect to login for protected routes),
  note the page as "requires auth — skipped" and continue.
- Do not hallucinate findings. Only report what you can observe from the HTML
  or from a clear contradiction with the CLAUDE.md spec.

</guardrails>
