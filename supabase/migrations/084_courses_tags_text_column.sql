-- Generated column for partial text search on tags array.
-- Allows ILIKE queries like "Gambit" to match a tag "Gambit hậu".
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS tags_text text
  GENERATED ALWAYS AS (array_to_string(tags, ' ')) STORED;
