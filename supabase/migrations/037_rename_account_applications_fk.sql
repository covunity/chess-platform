-- Migration 037: Canonicalize FK names on account_applications after the
-- table rename in migration 022 (creator_applications → account_applications).
-- Postgres auto-renames FKs on table rename, but the reviewed_by FK was created
-- referencing the old table name and its constraint name was never updated.
-- Dropping and recreating both FKs ensures PostgREST's schema cache sees the
-- canonical names and the hint in accountApplicationApi.ts resolves correctly.

-- FK on user_id (the applicant)
ALTER TABLE public.account_applications
  DROP CONSTRAINT IF EXISTS creator_applications_user_id_fkey,
  DROP CONSTRAINT IF EXISTS account_applications_user_id_fkey;

ALTER TABLE public.account_applications
  ADD CONSTRAINT account_applications_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- FK on reviewed_by (the admin reviewer)
ALTER TABLE public.account_applications
  DROP CONSTRAINT IF EXISTS creator_applications_reviewed_by_fkey,
  DROP CONSTRAINT IF EXISTS account_applications_reviewed_by_fkey;

ALTER TABLE public.account_applications
  ADD CONSTRAINT account_applications_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;
