-- Restore pending_review status that was removed in migration 005.
-- Required for the admin review step in the core loop: draft → pending_review → published.
ALTER TYPE public.course_status ADD VALUE IF NOT EXISTS 'pending_review';
