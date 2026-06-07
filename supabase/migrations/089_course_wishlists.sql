-- ── Create course_wishlists table ────────────────────────────────────────
-- Stores user wishlist for courses (distinct from lesson bookmarks)

create table if not exists course_wishlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  added_at timestamp with time zone not null default now(),
  unique(user_id, course_id)
);

-- Indexes for fast lookups
create index if not exists course_wishlists_user_id_idx on course_wishlists(user_id);
create index if not exists course_wishlists_course_id_idx on course_wishlists(course_id);

-- Enable RLS
alter table course_wishlists enable row level security;

-- RLS: Users can only see their own wishlist
create policy "users_can_view_own_wishlists" on course_wishlists
  for select using (auth.uid() = user_id);

-- RLS: Users can insert their own wishlist items
create policy "users_can_insert_own_wishlists" on course_wishlists
  for insert with check (auth.uid() = user_id);

-- RLS: Users can delete their own wishlist items
create policy "users_can_delete_own_wishlists" on course_wishlists
  for delete using (auth.uid() = user_id);
