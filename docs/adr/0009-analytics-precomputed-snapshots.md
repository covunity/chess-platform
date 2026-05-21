# ADR-0009 — Pre-computed analytics snapshots (snapshot-only, no live query)

- **Status:** Accepted
- **Date:** 2026-05-21
- **Slice:** PRD-0008 (Admin Analytics & Dashboard)

## Context

PRD-0008 introduces an admin Analytics dashboard. The page surfaces
roughly 30 distinct numbers (12 KPI cards + 4 ranges + 5 charts +
3 leaderboards) across three sections (financial, content, users),
each viewable through four time ranges (`7d`, `mtd`, `last_month`,
`all_time`).

A naive implementation would issue one aggregate query per number per
range per page load. With the analytics-relevant tables (`orders`,
`enrollments`, `lesson_progress`, `users`, `courses`) all unindexed
for the access patterns we need, that path would:

- be slow to render (multiple seconds even at low data volume —
  worse as volume grows),
- couple page rendering to query planner behaviour on tables that
  are also serving operational writes, and
- duplicate query logic between the UI fetcher and any future
  consumer (export job, email digest, etc.).

The platform is pre-launch with no production data, so we have one
opportunity to choose the storage shape cleanly.

## Decision

The dashboard reads **exclusively** from a single table:

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

The shape of `payload` per category, and the formula for every number
inside it, is locked in
[`CONTEXT.md`](../../CONTEXT.md#analytics_snapshots-schema).

Snapshots are written by **one and only one** path:

```sql
CREATE OR REPLACE FUNCTION compute_analytics_snapshot(force_now boolean DEFAULT false)
RETURNS void
SECURITY DEFINER
LANGUAGE plpgsql
AS $$ ... $$;
```

- `pg_cron` invokes `compute_analytics_snapshot(false)` at **00:05
  ICT** every day. Same pattern as `expire_stale_orders` (ADR-0007).
- The manual **Làm mới** button on the dashboard calls
  `compute_analytics_snapshot(true)` to recompute today's 12 rows
  immediately. `UPSERT` keyed on the primary key makes this
  idempotent.
- The same RPC also deletes rows where
  `snapshot_date < now() - interval '90 days'` (90-day retention).

There is **no live-query code path**. UI, manual refresh, and cron
all converge on the same snapshot table. Trade-offs of this choice
are taken explicitly — see "Trade-offs" below.

## Alternatives considered

### A. Live aggregate queries on every render

UI fires aggregate SQL against `orders` / `users` / `lesson_progress`
on each page load and on every range-selector change.

- ❌ Slow even at low volume (10+ aggregates per render).
- ❌ Couples page rendering to OLTP table contention.
- ❌ Hard to cache because each KPI uses slightly different `WHERE`
  clauses.

### B. Materialized views, refreshed periodically

One materialized view per `(category, time_range)` combination, 12
total, refreshed by `pg_cron`.

- ❌ Schema migration per metric change. We expect the metric
  catalogue to evolve as Analytics matures (Phase 3 will add at
  least watch-time, geographic split, voucher-attribution).
- ❌ Materialized-view refresh acquires `ACCESS EXCLUSIVE` on the
  view — concurrent dashboard reads block briefly.
- ❌ `WHERE` clauses with `now()` semantics (e.g. `confirmed_at >
  now() - 7d`) don't make sense in a materialized view; we'd have
  to bake `snapshot_date` into the view definition anyway, which
  is what `analytics_snapshots` already does without the
  refresh-lock cost.

### C. Incremental daily aggregates + roll-up on read

Store one row per day per metric in a "daily fact" table; the
dashboard sums N rows on read.

- ✅ Supports arbitrary custom ranges cleanly.
- ❌ Some metrics (top-10 courses by revenue, completion-rate top-10)
  are **not summable** across days — top-10 of A union top-10 of B
  ≠ top-10 of (A ∪ B). We'd need to either store all course-level
  daily rows (much wider table) or fall back to a snapshot anyway.
- ❌ PRD-0008 explicitly drops custom ranges as a non-goal, so the
  one feature that justifies this design is out of scope.

### D. External analytics product (Metabase, Cube, Superset)

- ❌ Out of budget. The team is shipping a self-contained Phase 2
  feature in 6–9 days, not procuring infrastructure.
- ❌ Adds an authentication surface and a hosting cost. Defeats the
  point of "single admin route."

## Trade-offs accepted

- **Custom ranges are not possible.** We picked four preset ranges
  and stored 12 rows/day. Adding a 5th preset = one CHECK constraint
  change + 1 cron loop iteration; adding arbitrary custom range =
  redesign to alternative C. Accepted because the four presets
  (`7d`, `mtd`, `last_month`, `all_time`) cover the actual admin
  review cadence.
- **`completion_top` is duplicated across 4 range rows per day.**
  It's range-independent by design (see CONTEXT.md). A few KB of
  duplicated JSON is cheaper than the conceptual cost of carving
  out a fifth "_global" range value.
- **The snapshot lags by up to ~24h** between cron runs. Mitigated
  by the `Làm mới` button; explicitly accepted because intraday
  precision is not a P0 use case ("how did this month go?" not
  "what is happening right now?").
- **No server-side rate limit on the recompute RPC.** Cooldown is
  client-only (see CONTEXT.md "Analytics refresh architecture").
  Admin double-firing = a few wasted CPU cycles; data correctness
  is preserved by `UPSERT` idempotency.
- **JSONB payload is not strongly typed at the DB layer.** A typo
  in the RPC could ship a malformed snapshot that the FE then
  fails to render. Mitigated by: (a) keeping the RPC and the FE
  type definitions in a single PR, (b) the 14 acceptance criteria
  in PRD-0008 that exercise the shape.

## Status of related decisions

- **CLAUDE.md State management §**: this ADR does **not** trigger
  the Zustand introduction rule. The dashboard is a read-only
  display of an RPC payload — local `useState` is sufficient.
- **D-19 (PostgreSQL `ILIKE` for search)**: unchanged. The
  dashboard does no full-text search.
- **D-15 (manual payout settlement)**: unchanged. The "Tiền creator
  được nhận" KPI shows `orders.creator_payout_amount` — the
  *earned* amount, not the *transferred* amount tracked by the
  `payouts` table.
