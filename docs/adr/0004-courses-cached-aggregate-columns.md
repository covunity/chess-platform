# ADR-0004: Cached aggregate columns for course rating and enrollment count

**Date:** 2026-05-09  
**Status:** Accepted  
**Relates to:** Issue #61

## Context

`listPublishedCourses` needed to sort courses by average rating ("rating") and by popularity ("popular"). The `courses` table had no aggregate columns, so the API joined all `reviews` and `enrollments` rows, computed the aggregates in JavaScript, then sorted the result array in memory.

This worked at small scale (Phase 1, no pagination) but breaks correctness once pagination is added: an in-memory sort only orders the current page, not the full dataset. It also fetches every review and enrollment on every homepage request, wasting bandwidth and slowing queries as the catalog grows.

Two implementation options were evaluated:

**Option A — Cached columns on `courses` with DB triggers**  
Add `avg_rating`, `rating_count`, `enrollment_count` directly to `courses`. Triggers on `reviews` and `enrollments` keep the values current after every write.

*Pros:* Simple `ORDER BY avg_rating DESC` / `ORDER BY enrollment_count DESC` on `courses`; no extra join; column is indexable.  
*Cons:* Trigger overhead on every review/enrollment mutation (acceptable at Phase 1 scale).

**Option B — Materialized view `courses_with_stats`**  
A view or materialized view that joins and aggregates on read.

*Pros:* No triggers; single source of truth for reads.  
*Cons:* Non-materialized view degrades on large tables (same join cost per request). Materialized view requires a refresh strategy (cron or manual) and adds operational complexity.

## Decision

**Option A** — cached columns with triggers.

Triggers are the lowest-complexity path: writes are infrequent relative to reads, values stay consistent without a refresh job, and columns can be indexed. Adding a new tier or review in the future simply fires a trigger; no additional infrastructure is needed.

## Consequences

- Migration 032 adds `avg_rating numeric(3,2)`, `rating_count integer`, `enrollment_count integer` to `courses` with default `0` and backfills existing rows.
- Two trigger functions (`refresh_course_rating`, `refresh_course_enrollment_count`) run `AFTER INSERT OR UPDATE OR DELETE` on `reviews` and `AFTER INSERT OR DELETE` on `enrollments`.
- `listPublishedCourses` no longer joins `reviews ( rating )` or `enrollments ( id )`. It reads the cached columns directly and uses `.order('avg_rating')` / `.order('enrollment_count')` for server-side sorting.
- The in-memory `Array.sort()` fallback for `sort=popular` and `sort=rating` is removed.
