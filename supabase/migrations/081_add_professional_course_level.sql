-- Add 'professional' to course_level enum.
-- ALTER TYPE ADD VALUE cannot be used in the same transaction as rows inserting the new value,
-- so this is a separate migration from the course_price_limits table (082).
ALTER TYPE public.course_level ADD VALUE IF NOT EXISTS 'professional';
