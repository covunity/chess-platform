-- Generated column for partial text search on tags array.
-- Allows ILIKE queries like "Gambit" to match a tag "Gambit hậu".

-- array_to_string is STABLE, not IMMUTABLE, so we need an IMMUTABLE
-- wrapper to use it in a generated column expression.
CREATE OR REPLACE FUNCTION immutable_array_to_string(arr text[], sep text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT array_to_string(arr, sep);
$$;

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS tags_text text
  GENERATED ALWAYS AS (immutable_array_to_string(tags, ' ')) STORED;
