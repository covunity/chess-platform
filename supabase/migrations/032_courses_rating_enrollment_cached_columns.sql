-- Add cached aggregate columns to courses so homepage can sort server-side
-- without fetching and joining all reviews/enrollments rows.
-- Kept up-to-date by triggers on reviews and enrollments.

alter table public.courses
  add column if not exists avg_rating   numeric(3,2) not null default 0,
  add column if not exists rating_count integer      not null default 0,
  add column if not exists enrollment_count integer  not null default 0;

-- Backfill existing rows
update public.courses c
set
  avg_rating      = coalesce((select round(avg(r.rating)::numeric, 2) from public.reviews r where r.course_id = c.id), 0),
  rating_count    = coalesce((select count(*) from public.reviews r where r.course_id = c.id), 0),
  enrollment_count = coalesce((select count(*) from public.enrollments e where e.course_id = c.id), 0);

-- Trigger function: recompute avg_rating + rating_count after review changes
create or replace function public.refresh_course_rating()
returns trigger language plpgsql security definer as $$
declare
  v_course_id uuid;
begin
  v_course_id := coalesce(new.course_id, old.course_id);
  update public.courses
  set
    avg_rating   = coalesce((select round(avg(r.rating)::numeric, 2) from public.reviews r where r.course_id = v_course_id), 0),
    rating_count = coalesce((select count(*) from public.reviews r where r.course_id = v_course_id), 0)
  where id = v_course_id;
  return null;
end;
$$;

drop trigger if exists trg_refresh_course_rating on public.reviews;
create trigger trg_refresh_course_rating
  after insert or update or delete on public.reviews
  for each row execute procedure public.refresh_course_rating();

-- Trigger function: recompute enrollment_count after enrollment changes
create or replace function public.refresh_course_enrollment_count()
returns trigger language plpgsql security definer as $$
declare
  v_course_id uuid;
begin
  v_course_id := coalesce(new.course_id, old.course_id);
  update public.courses
  set enrollment_count = coalesce((select count(*) from public.enrollments e where e.course_id = v_course_id), 0)
  where id = v_course_id;
  return null;
end;
$$;

drop trigger if exists trg_refresh_course_enrollment_count on public.enrollments;
create trigger trg_refresh_course_enrollment_count
  after insert or delete on public.enrollments
  for each row execute procedure public.refresh_course_enrollment_count();
