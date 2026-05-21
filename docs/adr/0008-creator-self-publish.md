# ADR-0008 — Creator self-publish (no admin course review)

- **Status:** Accepted
- **Date:** 2026-05-21
- **Slice:** PRD-0008 (Admin Analytics & Dashboard) — clarification of
  domain policy uncovered while grilling the analytics PRD

## Context

`CLAUDE.md` Section 5 and **D-03** described a course-lifecycle flow with
mandatory admin review:

```
draft → pending_review → published
                       → rejected   ← terminal (creator must start over)
```

This implied:

- A dedicated **AdminCourseReviewPage** queue.
- Two intermediate `course_status` enum values: `pending_review`, `rejected`.
- A non-resubmission rule on `rejected` (D-03), forcing creators to
  duplicate their work after a rejection.
- A "Chờ duyệt" KPI in the Analytics dashboard's Content Section.

The decision was inherited from Phase 1 planning when content quality was
the dominant concern. With the platform still pre-launch and pivoting to
fast creator velocity, the team has decided this gate is no longer worth
its cost.

## Decision

The admin review gate is **removed entirely**. The course lifecycle
collapses to:

```
draft ↔ published
```

- Creator clicks **Publish** → the course becomes immediately visible to
  learners. No admin action required.
- Creator can withdraw a published course back to `draft` at any time
  (same as before).
- There is **no rejected terminal state** — D-03 is lifted.
- There is **no pending review queue** — the admin sidebar's
  `courseReview` slot is retired.
- Phase 1 moderation of *user-generated content* (comments) via
  `/admin/reports` is **not** affected. That queue stays.

### Downstream consequences

1. **Migration** drops the `pending_review` and `rejected` enum values
   from `course_status` (safe — pre-launch, no production data).
2. **`AdminCourseReviewPage`** (route placeholder) and its sidebar entry
   are removed.
3. **D-03** is marked Lifted in `CLAUDE.md` and Section 5's flow diagram
   is rewritten.
4. **PRD's Analytics Content Section** loses its "Chờ duyệt" KPI. It is
   replaced with **"Tổng lượt enrollment trong kỳ"** — a flow metric
   that pairs naturally with "courses created" and "courses published"
   to give a Create→Consume picture inside one section.

### Out of scope

Reintroducing moderation later (e.g. an automated content scan or a
report-driven takedown flow on published courses) is **not** ruled out
— it would be a new ADR if and when it happens. This decision only
removes the **mandatory pre-publish gate**.

## Alternatives considered

- **Keep the gate but make it optional** (creator can request fast-track
  publish). Rejected as half-measure: every code path still has to
  branch on a state the product doesn't actually want.
- **Keep the enum values dead in the DB for future re-enablement.**
  Rejected — dead code paths bit-rot and silently break. Pre-launch is
  the right time to remove cleanly; reintroduction later is a forward
  migration when the requirement is real.

## Trade-offs accepted

- Lower quality floor on published catalog — mitigated by the existing
  content-report moderation queue (`reports` table) for after-the-fact
  takedown.
- Admins lose visibility into the "creator pipeline" — the Analytics
  Content Section gains "lượt enrollment" instead, which is a better
  product-health signal anyway.
