# Gambitly — Domain Glossary

Canonical terms used across the codebase. When a term is ambiguous or
overloaded, the definition here wins.

---

## Admin section

### Analytics (Phân tích)

The admin-facing dashboard surfacing financial, content, and user-growth
metrics. Lives at **`/admin/overview`** (the slot reserved in the admin
sidebar since day one — `AdminComingSoonPage` was the placeholder).
Implemented by `AdminAnalyticsPage`.

UI label (vi): **"Phân tích"** under `admin.sidebar.overview`.

Not to be confused with **Reports** (below).

### Reports (Báo cáo nội dung)

The moderation queue at `/admin/reports`, surfacing comments flagged by
learners via the `reports` table. Has nothing to do with analytics.

The word "report" in this codebase always means a user-submitted content
report, never an analytics report. Use "Analytics" for the latter.

---

## Financial metrics

The Analytics dashboard surfaces four independent KPI cards from `orders`.
Each is computed over the selected time range using **`orders.confirmed_at`**
as the bucketing timestamp — money is counted when it actually lands, not
when the customer clicked Mua.

| KPI (vi)              | Formula                                                                 |
|-----------------------|-------------------------------------------------------------------------|
| Doanh thu             | `SUM(orders.amount)              WHERE status='active' AND confirmed_at IN range` |
| Số đơn                | `COUNT(*)                        WHERE status='active' AND confirmed_at IN range` |
| Phí nền tảng          | `SUM(orders.platform_fee_amount) WHERE status='active' AND confirmed_at IN range` |
| Tiền creator được nhận | `SUM(orders.creator_payout_amount) WHERE status='active' AND confirmed_at IN range` |

Notes:

- **`orders.amount` is already net of voucher discount** (it is what the
  learner actually paid). Gross-before-voucher is `amount + voucher_discount_amount`
  but we don't surface that on the dashboard.
- **Free courses** (`amount = 0`, auto-active per D-05) count toward `Số đơn`
  but not toward the three money totals.
- **Refunded orders** (currently expressed as `status='cancelled'` plus refund
  metadata) are **excluded entirely** from every financial KPI — as if the
  order never happened. They are not tracked as a separate KPI in Phase 2.
- **"Tiền creator được nhận"** is what creators *earned* (snapshot per E-07).
  It is **not** the same as money already transferred — that lives in the
  `payouts` table and is a separate concept.

### Analytics time ranges

The dashboard offers **4 preset ranges** (no arbitrary custom range in
Phase 2). All bucketing uses **Asia/Ho_Chi_Minh (ICT, UTC+7)** boundaries.

| Preset key   | Label (vi)       | Span                                    | Delta comparison                  |
|--------------|------------------|-----------------------------------------|------------------------------------|
| `7d`         | 7 ngày qua       | `now() - 7d` → `now()`                  | preceding 7d                       |
| `mtd`        | Tháng này        | first day of current ICT month → `now()` | same span of previous ICT month   |
| `last_month` | Tháng trước      | full previous ICT month                  | the ICT month before that          |
| `all_time`   | Toàn thời gian   | epoch → `now()`                          | **no delta** (absolute only)       |

Trend-line point granularity:

- `7d` / `mtd` / `last_month` → **one point per day**.
- `all_time` → **one point per calendar month** (avoids unbounded point
  count once the platform has years of data).

Snapshot storage (`analytics_snapshots`): one row per
`(snapshot_date, time_range, category)` tuple. With 4 ranges and 3
categories (financial / content / users), that is **12 rows per day**.

---

## User-engagement metrics

### Active user

A user with **at least one `lesson_progress` row whose `viewed_at` falls
inside the selected range**. The dashboard counts them as
`COUNT(DISTINCT user_id)` over that filter.

Not "any login" — Supabase's `auth.users.last_sign_in_at` only stores the
most recent sign-in and would understate active counts for any range that
doesn't include the latest session. Not "any interaction" either — we
deliberately ignore comments / orders / bookmarks here because the
e-learning value signal is whether they *actually studied*.

Browsing the catalog without enrolling is not counted as active. Those
visitors show up under "new signups" or "top buyers" instead.

### Conversion rate

% of users who signed up *in the range* and placed at least one active
order *in the same range*.

- **Denominator**: `COUNT(*) FROM users WHERE role = 'learner' AND created_at IN range`
- **Numerator**:   `COUNT(DISTINCT u.id) FROM users u JOIN orders o ON o.user_id = u.id WHERE u.role = 'learner' AND u.created_at IN range AND o.status = 'active' AND o.confirmed_at IN range`

Free-course activations (`orders.amount = 0`, auto-active per D-05) **count
as conversions**. The metric measures behavioral commitment, not revenue —
claiming a free course is a strong intent signal, and a learner who later
upgrades to a paid course is one of the most valuable cohorts.

Caveat by design: with a short range (e.g. `7d`), a learner who signs up
late in the range and converts after it ends won't be counted. This
underreports conversion for short windows; that's an accepted trade-off
for keeping the metric self-contained inside one range.

---

## Content metrics

Three KPI cards in the Content Section, all **period-bounded** by the
selected range. Per ADR-0008, the platform has no admin review gate —
courses go straight from `draft` to `published` — so there is no
"Chờ duyệt" KPI, and `course_status` only ever holds `draft` or
`published`.

| KPI (vi)                     | Formula                                                                 |
|------------------------------|-------------------------------------------------------------------------|
| Tổng khoá học mới            | `COUNT(*) FROM courses WHERE created_at IN range`                       |
| Khoá publish trong kỳ        | `COUNT(*) FROM courses WHERE published_at IN range`                     |
| Lượt enrollment trong kỳ     | `COUNT(*) FROM enrollments WHERE enrolled_at IN range`                  |

`courses.published_at timestamptz` is a new column added by an upcoming
migration. It is set the **first** time a course transitions to
`published`; subsequent withdraw-then-republish cycles **do not** reset
it (so the metric represents "first reached the catalog", not "currently
live"). For "currently live", the catalog query uses `status='published'`
directly.

### Distribution charts

- **Donut by level** — `courses.level` distribution over the same
  filter as "Tổng khoá học mới" (i.e. `created_at IN range`).
- **Pie by language** — `courses.language` distribution over the same
  filter.

### Completion-rate bar chart

Horizontal bar chart showing the **top 10 published courses by average
lesson-completion rate**, computed across all enrollments — **not bound
by the dashboard range**. Completion rate is a property of the course,
not the period, so range-bounding it would make the bars jitter weekly
without informing any decision.

Formula per course (lesson-level average, **not** "all lessons done"
binary):

```
AVG(
  (lessons in the course that the enrollee has marked completed)
  / (total lessons in the course)
) over all enrollments for that course
```

**No minimum-enrollment threshold** — early-stage admins want to see
the real picture even when a course has only one or two enrollees. Add
a threshold later if noise becomes a real problem.

---

## Leaderboards

Three top-10 tables. All three are **bound by the selected range** —
they live in (or alongside) the flow-metric sections so they stay
consistent with the rest of the section.

| Table                                | Section   | `ORDER BY`                                                                                  |
|--------------------------------------|-----------|----------------------------------------------------------------------------------------------|
| Top 10 khoá học theo doanh thu       | Financial | `SUM(orders.amount)              WHERE status='active' AND confirmed_at IN range`, DESC      |
| Top 10 creator theo doanh thu        | Financial | `SUM(orders.creator_payout_amount) WHERE status='active' AND confirmed_at IN range`, DESC    |
| Top 10 khách hàng                    | Users     | `SUM(orders.amount)              WHERE status='active' AND confirmed_at IN range`, DESC      |

Notes:

- **Top creators** ranks by `creator_payout_amount`, not by `amount`.
  These are the same when every creator is on the same tier, but
  diverge across tiers — and the creator's perspective is "how much
  did *I* earn", which is the payout snapshot per E-07.
- **Top buyers** ranks by total *spend*, not by order count, so free
  course claimers do not crowd out paying customers. The card
  optionally shows order-count as a secondary column; the sort always
  uses spend.
- Refunded orders are excluded from all three tables (same rule as the
  Financial KPIs).

### New signups

`COUNT(*) FROM users WHERE created_at IN range` — **no `role` filter**.

Role can change after signup (a learner who later does *Become Creator*
flips to `role='creator'`), so filtering by current role would let a
historical signup silently fall out of last month's count. The count of
seeded admins is small enough not to skew anything.

Signup trend line uses the same bucketing rule as revenue: one point
per day for `7d` / `mtd` / `last_month`, one point per calendar month
for `all_time`.

---

## Analytics refresh architecture

The dashboard reads exclusively from `analytics_snapshots`. There is no
"live query" code path that bypasses the snapshot table — the snapshot
is always the source of truth, so UI and cron and manual refresh all
agree on the same numbers.

| Trigger             | Mechanism                                                                                          |
|---------------------|----------------------------------------------------------------------------------------------------|
| Daily auto-update   | `pg_cron` calls SQL function `compute_analytics_snapshot()` at **00:05 ICT** every day             |
| Manual refresh      | Admin clicks the refresh button → client calls RPC `compute_analytics_snapshot(force_now := true)` |

`compute_analytics_snapshot()` is an `UPSERT` keyed by
`(snapshot_date, time_range, category)`, so running it multiple times
in the same day is idempotent — it just overwrites today's row.

**Cooldown** is enforced **client-side only** (button disabled for 30s
after a click, with a visible countdown). The server has no rate limit
on the RPC. Trade-off: an admin who reloads the page or opens a second
tab can fire two RPCs back-to-back. The snapshot UPSERT is idempotent
so this only wastes a few DB cycles — no data correctness risk.

`pg_cron` runs in the same Postgres database used elsewhere
(consistent with ADR-0007's `expire_stale_orders` cron). 90-day
retention of `analytics_snapshots` rows is enforced by the same cron
job, deleting rows where `snapshot_date < now() - interval '90 days'`.

### `analytics_snapshots` schema

```sql
CREATE TABLE public.analytics_snapshots (
  snapshot_date date         NOT NULL,
  time_range    text         NOT NULL CHECK (time_range IN ('7d','mtd','last_month','all_time')),
  category      text         NOT NULL CHECK (category IN ('financial','content','users')),
  payload       jsonb        NOT NULL,
  computed_at   timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_date, time_range, category)
);
```

One row per `(snapshot_date, time_range, category)` tuple →
4 ranges × 3 categories = 12 rows per day. `payload` is JSONB rather
than flat columns so the shape can evolve without a migration per
metric. The downside (typing must be done in the RPC + on the FE)
is accepted in exchange for ship speed at this early stage.

### `payload` shape

**`category = 'financial'`**

```json
{
  "kpis": {
    "revenue":        { "value": 12500000, "delta_pct": 12.4 },
    "order_count":    { "value": 87,       "delta_pct": -3.1 },
    "platform_fee":   { "value": 2500000,  "delta_pct": 12.4 },
    "creator_payout": { "value": 10000000, "delta_pct": 12.4 }
  },
  "revenue_trend":  [ { "bucket": "2026-05-15", "value": 450000 }, ... ],
  "top_courses":    [ { "course_id":  "uuid", "title": "...", "revenue": 3200000 }, ... up to 10 ],
  "top_creators":   [ { "creator_id": "uuid", "name":  "...", "revenue": 4100000 }, ... up to 10 ]
}
```

**`category = 'content'`**

```json
{
  "kpis": {
    "new_courses":       { "value": 5,   "delta_pct": 25.0 },
    "published_courses": { "value": 3,   "delta_pct": -10.0 },
    "total_enrollments": { "value": 124, "delta_pct": 18.2 }
  },
  "by_level":     [ { "level":    "beginner", "count": 12 }, ... ],
  "by_language":  [ { "language": "vi",       "count": 18 }, ... ],
  "completion_top": [
    { "course_id": "uuid", "title": "...", "completion_rate": 0.62, "enrollment_count": 87 },
    ... up to 10
  ]
}
```

`completion_top` is **range-independent** — the same array is duplicated
across all four `time_range` rows for a given day. Cost ≈ a few KB of
JSON, in exchange for keeping the snapshot table to a single shape.
If this ever becomes a problem we add a `time_range = '_global'`
sentinel row instead of a separate table.

**`category = 'users'`**

```json
{
  "kpis": {
    "new_signups":     { "value": 42,    "delta_pct": 8.0 },
    "active_users":    { "value": 31,    "delta_pct": 4.5 },
    "conversion_rate": { "value": 0.286, "delta_pct": 11.0 }
  },
  "signup_trend": [ { "bucket": "2026-05-15", "value": 7 }, ... ],
  "top_buyers":   [
    { "user_id": "uuid", "name": "...", "spend": 850000, "order_count": 3 },
    ... up to 10
  ]
}
```

Numbers stored as plain integers in VND (no decimals, no formatting —
the UI formats). Trend buckets use ISO date strings.

### Chart library

**Recharts**, lazy-loaded in the admin bundle. Picked because:

- React-native declarative API fits the rest of the codebase
- Styling via Tailwind / CSS custom properties respects the
  no-hardcoded-colors rule in `docs/design-system.md`
- Covers all four chart types the dashboard needs (line, donut, pie,
  horizontal bar) without pulling in a mini-framework like Tremor
  that would collide with the existing shadcn/ui setup

`/admin/overview` lazy-imports the chart module so the learner bundle
stays unaffected by Recharts' ~95 KB gzipped weight.

### Indexes added for analytics

```sql
CREATE INDEX IF NOT EXISTS orders_active_confirmed_at_idx
  ON orders (confirmed_at)             WHERE status = 'active';
CREATE INDEX IF NOT EXISTS orders_user_confirmed_idx
  ON orders (user_id, confirmed_at)    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS orders_course_confirmed_idx
  ON orders (course_id, confirmed_at)  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS users_created_at_idx
  ON users (created_at);
CREATE INDEX IF NOT EXISTS enrollments_enrolled_at_idx
  ON enrollments (enrolled_at);
CREATE INDEX IF NOT EXISTS lesson_progress_viewed_at_idx
  ON lesson_progress (viewed_at);
CREATE INDEX IF NOT EXISTS lesson_progress_completed_idx
  ON lesson_progress (course_id, user_id) WHERE completed;
CREATE INDEX IF NOT EXISTS courses_created_at_idx
  ON courses (created_at);
CREATE INDEX IF NOT EXISTS courses_published_at_idx
  ON courses (published_at) WHERE published_at IS NOT NULL;
```

Partial indexes on `WHERE status = 'active'` and `WHERE completed` keep
the index small — they exclude pending/cancelled orders and
not-yet-completed lesson rows, which the analytics queries always
filter out anyway.

### RLS on `analytics_snapshots`

```sql
ALTER TABLE analytics_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY analytics_snapshots_admin_select
  ON analytics_snapshots FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid() AND users.role = 'admin'
  ));
-- No INSERT/UPDATE/DELETE policy: writes only via the
-- SECURITY DEFINER compute_analytics_snapshot() RPC.
```

`compute_analytics_snapshot()` runs as `SECURITY DEFINER` so both
`pg_cron` (postgres owner) and the manual-refresh button (admin caller)
can write. The RPC itself raises `'42501'` if `auth.uid()` is set and
does not resolve to an admin, so non-admins can't trigger an
unauthorized recompute.
