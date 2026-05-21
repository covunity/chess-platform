# PRD-0008: Admin Analytics & Dashboard

> Status: Locked · Owner: @haunguyen1064 · Created: 2026-05-21 · Branch: `claude/clarify-feature-requirements-FBnDy`
> Phase: **Phase 2** — internal tooling, no learner / creator surface impact.
> Companion ADR: [ADR-0009 — Pre-computed analytics snapshots](../adr/0009-analytics-precomputed-snapshots.md).
> Lifts: [D-03 (admin course-review gate)](../adr/0008-creator-self-publish.md) via ADR-0008.

> **Definitions reference:** every metric below has a canonical, locked
> formula in [`CONTEXT.md`](../../CONTEXT.md). The PRD describes scope,
> personas, and acceptance criteria. The glossary defines the numbers.
> Implementation must follow CONTEXT.md when there is any ambiguity in
> the prose here.

---

## 1. Background & Problem

The platform has shipped its core loop (Create → Purchase → Learn) plus
PayOS automation, vouchers, and campaigns. Admin has multiple operational
pages (`/admin/orders`, `/admin/users`, `/admin/payouts`, etc.) but no
**single landing surface** that answers:

- "How is the platform performing this month vs last month?"
- "Which courses and creators drive revenue?"
- "Are new signups converting?"
- "Where is the content catalog at?"

Today the answer requires running ad-hoc SQL against Supabase. As BizDev
and product cadence pick up, this becomes the daily blocker for every
strategic decision.

The Phase 2 Analytics dashboard collapses that into one screen, anchored
on the principle that **"every number on the dashboard should be either
actionable or comparison-worthy."**

---

## 2. Goals

- **G1.** A single admin route `/admin/overview` ships a three-section
  dashboard (Financial / Content / Users) covering 4 time ranges.
- **G2.** Reads are **fast** — the page loads from `analytics_snapshots`,
  not live aggregates over `orders` / `lesson_progress`.
- **G3.** Data freshness is automatic — `pg_cron` recomputes snapshots
  daily at **00:05 ICT**. Admin can also click **Làm mới** to
  recompute immediately.
- **G4.** Each KPI shows a delta vs the previous comparable period
  (except `all_time`, which has no comparison).
- **G5.** Domain language is locked — terms like "active user",
  "revenue", "conversion rate" have one definition codified in
  CONTEXT.md and reused across UI, RPC, i18n keys.
- **G6.** The dashboard respects existing constraints: admin-only RLS,
  Vietnamese-first UI via i18n keys under `admin.analytics.*`, design
  tokens from `styles.css` (no hardcoded colors).

---

## 3. Non-goals (Phase 2 dashboard scope)

Explicit deferrals — these are **not** built in PRD-0008:

- ❌ Arbitrary custom date ranges (only the four presets ship).
- ❌ Real-time updates (websocket / push).
- ❌ Drill-down navigation from a chart point to the underlying rows.
- ❌ Behavioural analytics (clickstream, funnels, heatmaps).
- ❌ Alerting / threshold notifications.
- ❌ Dimensional filters beyond the time-range selector (no "filter by
  language" or "filter by creator" controls).
- ❌ Multi-admin RBAC sub-roles. Any user with `role='admin'` sees the
  whole dashboard.
- ❌ Mobile responsiveness for `/admin/overview`. Desktop 1440px only,
  per design-system §3.
- ❌ Data export (CSV, PDF, scheduled email).
- ❌ Custom-widget configuration. The layout is fixed in code.
- ❌ Watch-time / video-progress analytics. Completion is lesson-binary
  only (no per-second tracking instrument exists).
- ❌ Revenue projection / forecasting models.

---

## 4. Personas & User Stories

### P1 — Admin (BizDev) — daily check-in

- **US1.1**: Open `/admin/overview` in the morning. See **Doanh thu /
  Số đơn / Phí nền tảng / Tiền creator được nhận** for the default
  range (`30d`-equivalent → since we dropped `30d`, default is
  `mtd`). Each KPI shows value + delta % vs the comparable prior
  period.
- **US1.2**: Switch the range selector to `Tháng trước` to compare
  closed-month performance.
- **US1.3**: Scroll to **Revenue trend** line chart (1 point/day for
  `7d`/`mtd`/`last_month`, 1 point/month for `all_time`).
- **US1.4**: Scroll to **Top 10 courses by revenue** + **Top 10
  creators by revenue** tables, ranked by the formulas in
  CONTEXT.md.
- **US1.5**: See `Cập nhật lần cuối: 21/05/2026 00:05 ICT` near the
  refresh button. Click **Làm mới** → button disables for 30s
  (client-side countdown) → snapshot recomputes → timestamp updates.

### P2 — Admin (Content) — catalog health

- **US2.1**: See **Tổng khoá học mới / Khoá publish trong kỳ / Lượt
  enrollment trong kỳ** for the selected range.
- **US2.2**: See **donut chart by level** (`beginner` /
  `intermediate` / `advanced`) and **pie chart by language**
  (`vi` / `en`), each filtered to courses created in range.
- **US2.3**: See a **horizontal bar chart**: top 10 published
  courses by average lesson-completion rate (range-independent —
  same value regardless of selector position).

### P3 — Admin (Growth) — user health

- **US3.1**: See **New signups / Active users / Conversion rate** for
  the selected range.
- **US3.2**: See **signup trend** line chart.
- **US3.3**: See **Top 10 buyers** table, ranked by spend in range
  (free claims do not displace paying customers — see CONTEXT.md).

### P4 — Admin (any) — error handling

- **US4.1**: If the latest snapshot is older than today's 00:05 ICT
  (cron didn't run, e.g., Supabase paused), the page shows a yellow
  banner `Snapshot mới nhất từ ngày DD/MM. Bấm "Làm mới" để cập
  nhật.` instead of stale data being silent.
- **US4.2**: If `compute_analytics_snapshot()` raises, the refresh
  button re-enables and a toast surfaces the error.

---

## 5. Functional spec

### 5.1 Route & navigation

- Route: `/admin/overview` (replaces the existing
  `AdminComingSoonPage` placeholder).
- Sidebar key: `admin.sidebar.overview` (already exists). Page
  component: `AdminAnalyticsPage`. Lazy-loaded.
- Access: existing `ProtectedAdminRoute` gate. RLS on
  `analytics_snapshots` provides defense in depth.

### 5.2 Time-range selector

Four buttons in a segmented control at the top of the page:

| Key | Label (vi) | Default |
|---|---|---|
| `7d` | 7 ngày qua | — |
| `mtd` | Tháng này | ✅ default on first load |
| `last_month` | Tháng trước | — |
| `all_time` | Toàn thời gian | — |

Selecting a range re-renders all three sections from the matching
`analytics_snapshots` rows for that day.

### 5.3 Refresh button

- Label: `Làm mới`. Right of the timestamp string.
- Disabled state: 30-second client-side countdown after a click.
- Calls RPC `compute_analytics_snapshot(force_now := true)`.
- On success: reloads the four KPI sections + updates
  `computed_at` display.
- On error: re-enable + toast.

### 5.4 KPI cards

12 KPI cards total (4 financial + 3 content + 5 user) — see
CONTEXT.md for the exact list and formulas. Each card shows:

- Vietnamese label
- Big number (formatted: VND with `vi-VN` locale for money,
  comma-thousands for counts, `xx.x%` for ratios)
- Delta pill: `▲ 12.4%` (green) / `▼ 3.1%` (red) / `—` for
  `all_time`

### 5.5 Charts

- **Revenue trend** (line) — `payload.revenue_trend` for selected
  range, financial category.
- **Donut by level** — `payload.by_level`, content category.
- **Pie by language** — `payload.by_language`, content category.
- **Horizontal bar — completion** — `payload.completion_top`,
  content category (same array for all 4 ranges per ADR-0009).
- **Signup trend** (line) — `payload.signup_trend`, users category.

All five charts use **Recharts**, lazy-loaded.

### 5.6 Leaderboard tables

Three tables of up to 10 rows each. Empty state if the range had
zero qualifying rows: `Không có dữ liệu cho kỳ này`.

---

## 6. Acceptance criteria

| # | Test |
|---|---|
| A1 | Visiting `/admin/overview` as a non-admin user → 403 redirect (existing `ProtectedAdminRoute`). |
| A2 | Visiting `/admin/overview` as admin → page renders without any live query against `orders` / `users` / `lesson_progress` (verified by observing only `analytics_snapshots` reads in network tab). |
| A3 | `pg_cron` triggers `compute_analytics_snapshot()` at 00:05 ICT and writes 12 rows for that day (4 ranges × 3 categories). |
| A4 | Calling `compute_analytics_snapshot(force_now := true)` mid-day **upserts** today's 12 rows (no duplicate-key error, no extra rows). |
| A5 | RLS — a learner user calling `select * from analytics_snapshots` via PostgREST gets 0 rows. |
| A6 | Switching range selector from `mtd` to `last_month` re-renders all sections in < 200ms (reads from snapshots only). |
| A7 | A course with one enrolled learner who completes 5 / 10 lessons appears in `completion_top` with `completion_rate = 0.5` (no threshold filtering). |
| A8 | Free order (`amount = 0`) counts toward `kpis.order_count` but adds 0 to `kpis.revenue`. |
| A9 | A learner who signed up in range and bought a paid course in the same range is counted in `kpis.conversion_rate` numerator. |
| A10 | All UI strings live in `vi.json` under `admin.analytics.*`. `grep -r '"[A-ZĐ][a-zàáảã...]'` over the new TSX files finds zero hardcoded Vietnamese. |
| A11 | No hex color appears in the new TSX/CSS — all colors via CSS custom properties (design-system §3 rule). |
| A12 | Clicking **Làm mới** twice in 30 seconds: the second click is blocked client-side (button disabled). |
| A13 | After cron has not run for 36 hours (simulated by deleting today's rows), the page shows the "snapshot stale" yellow banner. |
| A14 | A course's `published_at` is set the **first time** it transitions `draft → published` and is **not** updated by subsequent withdraw / republish cycles. |

---

## 7. Out of scope (deferred)

Same list as §3. Re-included here so future readers do not have to
scroll back: **custom date ranges**, **real-time**, **drill-down**,
**funnels**, **alerting**, **RBAC sub-roles**, **mobile**, **data
export**, **custom widgets**, **watch-time**, **forecasting**.

---

## 8. Dependencies

- **ADR-0008** — Removes admin course review gate. PRD-0008 depends on
  the simplified `draft ↔ published` flow.
- **ADR-0009** — Pre-computed snapshot architecture.
- **ADR-0007** — Existing `pg_cron` pattern (`expire_stale_orders`)
  that PRD-0008 reuses for `compute_analytics_snapshot`.
- **`courses.published_at`** new column — required for "Khoá publish
  trong kỳ" KPI.

---

## 9. Estimate

6–9 dev days, matching the original artifact estimate. Budget
5–9 million VND. Key risk: the `compute_analytics_snapshot` RPC has
12 sub-queries — write tests with realistic data volume before
shipping, not just unit-test-sized fixtures.
