-- Migration 114: Student Online Portal (Assignments, Announcements, Materials, Discussions, Tuition)

-- 1. Live Assignments
CREATE TABLE IF NOT EXISTS public.live_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  due_date timestamptz NOT NULL,
  max_score numeric DEFAULT 10,
  created_at timestamptz DEFAULT now()
);

-- 2. Assignment Submissions
CREATE TABLE IF NOT EXISTS public.live_assignment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.live_assignments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  submitted_at timestamptz DEFAULT now(),
  content text NOT NULL,
  score numeric,
  teacher_feedback text,
  graded_at timestamptz,
  status text DEFAULT 'submitted' CHECK (status IN ('submitted', 'graded', 'returned')),
  UNIQUE (assignment_id, user_id)
);

-- 3. Live Announcements
CREATE TABLE IF NOT EXISTS public.live_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  author_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  content text NOT NULL,
  is_pinned boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- 4. Live Materials
CREATE TABLE IF NOT EXISTS public.live_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text DEFAULT 'document' CHECK (category IN ('document', 'pgn', 'slide', 'video')),
  file_url text,
  file_size text,
  created_at timestamptz DEFAULT now()
);

-- 5. Live Discussions
CREATE TABLE IF NOT EXISTS public.live_discussions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 6. Discussion Replies
CREATE TABLE IF NOT EXISTS public.live_discussion_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discussion_id uuid NOT NULL REFERENCES public.live_discussions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 7. Tuition Records
CREATE TABLE IF NOT EXISTS public.live_tuition_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount integer NOT NULL DEFAULT 0,
  due_date timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'pending', 'overdue')),
  period text NOT NULL DEFAULT 'Khóa hiện tại',
  paid_at timestamptz,
  note text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (course_id, user_id, period)
);

-- Enable RLS on all tables
ALTER TABLE public.live_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_assignment_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_discussions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_discussion_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_tuition_records ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_assignments TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_assignment_submissions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_announcements TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_materials TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_discussions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_discussion_replies TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_tuition_records TO anon, authenticated;

-- Policies for public / authenticated read and interaction
DROP POLICY IF EXISTS "Public read assignments" ON public.live_assignments;
CREATE POLICY "Public read assignments" ON public.live_assignments FOR ALL USING (true);

DROP POLICY IF EXISTS "Submissions access" ON public.live_assignment_submissions;
CREATE POLICY "Submissions access" ON public.live_assignment_submissions FOR ALL USING (true);

DROP POLICY IF EXISTS "Public read announcements" ON public.live_announcements;
CREATE POLICY "Public read announcements" ON public.live_announcements FOR ALL USING (true);

DROP POLICY IF EXISTS "Public read materials" ON public.live_materials;
CREATE POLICY "Public read materials" ON public.live_materials FOR ALL USING (true);

DROP POLICY IF EXISTS "Discussions access" ON public.live_discussions;
CREATE POLICY "Discussions access" ON public.live_discussions FOR ALL USING (true);

DROP POLICY IF EXISTS "Replies access" ON public.live_discussion_replies;
CREATE POLICY "Replies access" ON public.live_discussion_replies FOR ALL USING (true);

DROP POLICY IF EXISTS "Tuition access" ON public.live_tuition_records;
CREATE POLICY "Tuition access" ON public.live_tuition_records FOR ALL USING (true);
