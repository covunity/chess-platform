-- Course reports table (mirrors the comment reports pattern)
create table public.course_reports (
  id          uuid                 primary key default gen_random_uuid(),
  course_id   uuid                 not null references public.courses(id) on delete cascade,
  reporter_id uuid                 not null references public.users(id) on delete cascade,
  reason      public.report_reason not null,
  context     text,
  created_at  timestamptz          not null default now(),
  unique(course_id, reporter_id)
);

alter table public.course_reports enable row level security;

-- Any logged-in user can file one report per course
create policy "Logged-in users can report courses"
  on public.course_reports for insert
  with check (reporter_id = auth.uid());

-- Admins can read all course reports
create policy "Admins can view course reports"
  on public.course_reports for select
  using (exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

-- Admins can dismiss (delete) course reports
create policy "Admins can delete course reports"
  on public.course_reports for delete
  using (exists (select 1 from public.users where id = auth.uid() and role = 'admin'));
