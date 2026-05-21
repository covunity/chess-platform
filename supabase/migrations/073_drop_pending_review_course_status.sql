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
-- columns over to it, then drop the old type. The `DEFAULT` clause must
-- be dropped before the type swap because the default expression
-- references the soon-to-be-renamed old type and Postgres can't
-- auto-cast it; we restore the default to `'draft'` after the swap.
--
-- A safety `UPDATE` first migrates any rows still on `pending_review`
-- (pre-launch we expect zero, but we don't want the cast in the column
-- ALTER to choke if one slipped through) down to `'draft'`. Note that
-- `'rejected'` was never actually added to `course_status` (only ever
-- planned in D-03, now lifted), so it does not need a similar fallback.
--
-- This mirrors the structure of migration 005 (`simplify_course_status`)
-- which performed the same kind of swap when removing the legacy
-- `'pending'` value.

BEGIN;

-- 1. Move any stray pending_review rows back to draft so the cast below
--    cannot fail.
UPDATE public.courses
   SET status = 'draft'
 WHERE status = 'pending_review';

-- 2. Drop the column default — it references the old enum type and
--    blocks the ALTER COLUMN TYPE step otherwise.
ALTER TABLE public.courses ALTER COLUMN status DROP DEFAULT;

-- 3. Rename the existing type, create the new one with only the
--    surviving values, swap the column over, restore the default,
--    then drop the renamed-aside type.
ALTER TYPE public.course_status RENAME TO course_status_old;

CREATE TYPE public.course_status AS ENUM ('draft', 'published');

ALTER TABLE public.courses
  ALTER COLUMN status TYPE public.course_status
  USING status::text::public.course_status;

ALTER TABLE public.courses ALTER COLUMN status SET DEFAULT 'draft'::public.course_status;

DROP TYPE public.course_status_old;

COMMIT;
