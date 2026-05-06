-- Slice 8: Simplify course status — Creator publishes directly, no admin review

-- Remove 'pending' status: update any existing 'pending' courses back to 'draft'
UPDATE public.courses SET status = 'draft' WHERE status = 'pending';

-- PostgreSQL does not support removing enum values directly.
-- Create new enum type with only valid values, swap it in.
ALTER TYPE public.course_status RENAME TO course_status_old;
CREATE TYPE public.course_status AS ENUM ('draft', 'published');
ALTER TABLE public.courses
  ALTER COLUMN status TYPE public.course_status
  USING status::text::public.course_status;
DROP TYPE public.course_status_old;
