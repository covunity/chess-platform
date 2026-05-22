-- Migration 073 — Drop `pending_review` from the `course_status` enum (ADR-0008).
--
-- ## Why
--
-- ADR-0008 (creator self-publish) removed the admin course-review gate.
-- The course lifecycle collapses to `draft ↔ published`, so the
-- `pending_review` enum value is now dead. It was originally re-added in
-- migration 006 to support the gate; with the gate gone, we drop it to
-- keep the type system honest and prevent future drift.
--
-- ## What
--
-- PostgreSQL does not support `ALTER TYPE ... DROP VALUE`. The standard
-- workaround is to create a new enum with the desired values, swap
-- columns over to it, then drop the old type. Two extra steps are
-- needed because the `courses.status` column has dependents:
--
--   1. The column `DEFAULT` references the old enum and must be dropped
--      and re-set after the swap.
--   2. RLS policies in migrations 007/008/009 filter on
--      `courses.status = 'published'` (some directly, some via
--      subquery). Postgres blocks `ALTER COLUMN TYPE` while a policy's
--      USING/WITH CHECK expression references the column, so each
--      dependent policy must be dropped before the swap and recreated
--      after with the same body. The recreated bodies are identical to
--      the original definitions — no semantic change.
--
-- A safety `UPDATE` first migrates any rows still on `pending_review`
-- (pre-launch we expect zero, but we don't want the cast in the column
-- ALTER to choke if one slipped through) down to `'draft'`. Note that
-- `'rejected'` was never actually added to `course_status` (only ever
-- planned in D-03, now lifted), so it does not need a similar fallback.
--
-- This mirrors the structure of migration 005 (`simplify_course_status`)
-- which performed the same kind of swap when removing the legacy
-- `'pending'` value — at the time, the dependent policies in 007/008/009
-- did not yet exist, which is why 005 did not need the extra dance.

BEGIN;

-- 1. Move any stray pending_review rows back to draft so the cast below
--    cannot fail.
UPDATE public.courses
   SET status = 'draft'
 WHERE status = 'pending_review';

-- 2. Drop the column default — it references the old enum type and
--    blocks the ALTER COLUMN TYPE step otherwise.
ALTER TABLE public.courses ALTER COLUMN status DROP DEFAULT;

-- 3. Drop the five RLS policies that reference `courses.status`. They
--    are recreated verbatim in step 5 after the type swap completes.
DROP POLICY IF EXISTS "Published courses are publicly readable"
  ON public.courses;
DROP POLICY IF EXISTS "Chapters of published courses are publicly readable"
  ON public.chapters;
DROP POLICY IF EXISTS "Lessons of published courses are publicly readable"
  ON public.lessons;
DROP POLICY IF EXISTS "Anyone can view published course enrollments count"
  ON public.enrollments;
DROP POLICY IF EXISTS "Anyone can view visible comments"
  ON public.comments;

-- 4. Rename the existing type, create the new one with only the
--    surviving values, swap the column over, restore the default,
--    then drop the renamed-aside type.
ALTER TYPE public.course_status RENAME TO course_status_old;

CREATE TYPE public.course_status AS ENUM ('draft', 'published');

ALTER TABLE public.courses
  ALTER COLUMN status TYPE public.course_status
  USING status::text::public.course_status;

ALTER TABLE public.courses ALTER COLUMN status SET DEFAULT 'draft'::public.course_status;

DROP TYPE public.course_status_old;

-- 5. Recreate the policies dropped in step 3 with identical bodies.
CREATE POLICY "Published courses are publicly readable"
  ON public.courses FOR SELECT
  USING (status = 'published');

CREATE POLICY "Chapters of published courses are publicly readable"
  ON public.chapters FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.courses
      WHERE id = course_id AND status = 'published'
    )
  );

CREATE POLICY "Lessons of published courses are publicly readable"
  ON public.lessons FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.chapters ch
      JOIN public.courses co ON co.id = ch.course_id
      WHERE ch.id = chapter_id AND co.status = 'published'
    )
  );

CREATE POLICY "Anyone can view published course enrollments count"
  ON public.enrollments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.courses
      WHERE id = course_id AND status = 'published'
    )
  );

CREATE POLICY "Anyone can view visible comments"
  ON public.comments FOR SELECT
  USING (
    is_hidden = false
    AND EXISTS (
      SELECT 1 FROM public.courses
      WHERE id = course_id AND status = 'published'
    )
  );

COMMIT;
