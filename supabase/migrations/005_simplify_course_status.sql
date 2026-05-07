-- Slice 8: Simplify course status — Creator publishes directly, no admin review

-- Remove 'pending' status: update any existing 'pending' courses back to 'draft'
UPDATE public.courses SET status = 'draft' WHERE status = 'pending';

-- PostgreSQL does not support removing enum values directly.
-- Create new enum type with only valid values, swap it in.
--
-- The DEFAULT must be dropped before ALTER COLUMN ... TYPE because Postgres
-- can't auto-cast a DEFAULT expression that references the soon-to-be-renamed
-- old type. Restore the default after the type swap.
ALTER TABLE public.courses ALTER COLUMN status DROP DEFAULT;
ALTER TYPE public.course_status RENAME TO course_status_old;
CREATE TYPE public.course_status AS ENUM ('draft', 'published');
ALTER TABLE public.courses
  ALTER COLUMN status TYPE public.course_status
  USING status::text::public.course_status;
ALTER TABLE public.courses ALTER COLUMN status SET DEFAULT 'draft';
DROP TYPE public.course_status_old;
