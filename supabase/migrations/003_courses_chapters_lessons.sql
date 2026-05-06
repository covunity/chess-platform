-- Enums
create type public.course_status as enum ('draft', 'pending', 'published');
create type public.course_level  as enum ('beginner', 'intermediate', 'advanced');
create type public.lesson_type   as enum ('video', 'chess', 'puzzle');

-- Courses
create table public.courses (
  id            uuid        primary key default gen_random_uuid(),
  creator_id    uuid        not null references public.users(id) on delete cascade,
  title         text        not null check (char_length(title) <= 200),
  description   text,
  thumbnail_url text,
  price         integer     not null default 0 check (price >= 0),
  level         public.course_level not null default 'beginner',
  language      text        not null default 'vi' check (language in ('vi', 'en')),
  tags          text[]      not null default '{}',
  status        public.course_status not null default 'draft',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Chapters
create table public.chapters (
  id         uuid        primary key default gen_random_uuid(),
  course_id  uuid        not null references public.courses(id) on delete cascade,
  title      text        not null,
  position   integer     not null default 0,
  created_at timestamptz not null default now()
);

-- Lessons (skeleton — no body content yet)
create table public.lessons (
  id           uuid        primary key default gen_random_uuid(),
  chapter_id   uuid        not null references public.chapters(id) on delete cascade,
  title        text        not null,
  type         public.lesson_type not null default 'video',
  position     integer     not null default 0,
  free_preview boolean     not null default false,
  created_at   timestamptz not null default now()
);

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table public.courses  enable row level security;
alter table public.chapters enable row level security;
alter table public.lessons  enable row level security;

-- Creators manage their own courses
create policy "Creators can manage own courses"
  on public.courses for all
  using  (creator_id = auth.uid())
  with check (creator_id = auth.uid());

-- Admins read all courses
create policy "Admins can view all courses"
  on public.courses for select
  using (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

-- Creators manage chapters belonging to their courses
create policy "Creators can manage own chapters"
  on public.chapters for all
  using (
    exists (select 1 from public.courses where id = course_id and creator_id = auth.uid())
  )
  with check (
    exists (select 1 from public.courses where id = course_id and creator_id = auth.uid())
  );

-- Admins read all chapters
create policy "Admins can view all chapters"
  on public.chapters for select
  using (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

-- Creators manage lessons belonging to their chapters
create policy "Creators can manage own lessons"
  on public.lessons for all
  using (
    exists (
      select 1
      from public.chapters ch
      join public.courses  co on co.id = ch.course_id
      where ch.id = chapter_id and co.creator_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.chapters ch
      join public.courses  co on co.id = ch.course_id
      where ch.id = chapter_id and co.creator_id = auth.uid()
    )
  );

-- Admins read all lessons
create policy "Admins can view all lessons"
  on public.lessons for select
  using (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

-- Auto-update updated_at on courses
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger courses_updated_at
  before update on public.courses
  for each row execute procedure public.set_updated_at();
