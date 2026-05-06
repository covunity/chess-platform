-- Add updated_at to reviews (for "edited" badge)
alter table public.reviews
  add column if not exists updated_at timestamptz not null default now();

-- Report reason enum
create type public.report_reason as enum ('inappropriate', 'spam', 'misleading');

-- Comments table
create table public.comments (
  id          uuid        primary key default gen_random_uuid(),
  course_id   uuid        not null references public.courses(id) on delete cascade,
  author_id   uuid        not null references public.users(id) on delete cascade,
  body        text        not null check (char_length(body) <= 2000),
  is_hidden   boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Reports table
create table public.reports (
  id          uuid               primary key default gen_random_uuid(),
  comment_id  uuid               not null references public.comments(id) on delete cascade,
  reporter_id uuid               not null references public.users(id) on delete cascade,
  reason      public.report_reason not null,
  context     text,
  created_at  timestamptz        not null default now(),
  unique(comment_id, reporter_id)
);

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table public.comments enable row level security;
alter table public.reports  enable row level security;

-- Comments: anyone can read visible comments on published courses
create policy "Anyone can view visible comments"
  on public.comments for select
  using (
    is_hidden = false
    and exists (
      select 1 from public.courses
      where id = course_id and status = 'published'
    )
  );

-- Comments: admins can view all comments including hidden ones
create policy "Admins can view all comments"
  on public.comments for select
  using (exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

-- Comments: enrolled learners can insert
create policy "Enrolled learners can post comments"
  on public.comments for insert
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.enrollments
      where course_id = comments.course_id and user_id = auth.uid()
    )
  );

-- Comments: owner can update own non-hidden comment
create policy "Owner can update own comment"
  on public.comments for update
  using (author_id = auth.uid() and is_hidden = false)
  with check (author_id = auth.uid());

-- Comments: owner can delete own comment
create policy "Owner can delete own comment"
  on public.comments for delete
  using (author_id = auth.uid());

-- Comments: admins can update (for hide action)
create policy "Admins can update comments"
  on public.comments for update
  using (exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

-- Reports: any logged-in user can insert (one per comment)
create policy "Logged-in users can report comments"
  on public.reports for insert
  with check (reporter_id = auth.uid());

-- Reports: admins can view all reports
create policy "Admins can view reports"
  on public.reports for select
  using (exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

-- Reports: admins can delete (dismiss)
create policy "Admins can delete reports"
  on public.reports for delete
  using (exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

-- Reviews: add updated_at trigger
create trigger reviews_updated_at
  before update on public.reviews
  for each row execute procedure public.set_updated_at();

-- Comments: auto-update updated_at
create trigger comments_updated_at
  before update on public.comments
  for each row execute procedure public.set_updated_at();
