-- Migration 116: Course Portal Chat (Persistent messages & Realtime)

CREATE TABLE IF NOT EXISTS public.course_portal_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_course_portal_chats_course_created
  ON public.course_portal_chats (course_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_course_portal_chats_sender
  ON public.course_portal_chats (sender_id);

-- Enable RLS
ALTER TABLE public.course_portal_chats ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_portal_chats TO anon, authenticated;

-- Policies
DROP POLICY IF EXISTS "Public read and write course portal chats" ON public.course_portal_chats;
CREATE POLICY "Public read and write course portal chats" ON public.course_portal_chats FOR ALL USING (true);

-- Enable Realtime for course_portal_chats
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.course_portal_chats;
  EXCEPTION
    WHEN duplicate_object THEN
      NULL;
  END;
END $$;

-- Seed initial welcome messages for live courses
INSERT INTO public.course_portal_chats (course_id, sender_id, content, created_at)
SELECT
  '00000000-0000-0000-0000-000000000020'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  'Chào mừng các em đến với lớp học trực tuyến! Buổi học tới chúng ta sẽ bắt đầu đúng 19:30 nhé.',
  now() - interval '4 hours'
WHERE EXISTS (SELECT 1 FROM public.courses WHERE id = '00000000-0000-0000-0000-000000000020'::uuid)
  AND EXISTS (SELECT 1 FROM public.users WHERE id = '00000000-0000-0000-0000-000000000002'::uuid);

INSERT INTO public.course_portal_chats (course_id, sender_id, content, created_at)
SELECT
  '00000000-0000-0000-0000-000000000020'::uuid,
  '00000000-0000-0000-0000-000000000004'::uuid,
  'Dạ thầy, em đã chuẩn bị xong bàn cờ và tải file PGN rồi ạ!',
  now() - interval '2 hours'
WHERE EXISTS (SELECT 1 FROM public.courses WHERE id = '00000000-0000-0000-0000-000000000020'::uuid)
  AND EXISTS (SELECT 1 FROM public.users WHERE id = '00000000-0000-0000-0000-000000000004'::uuid);

INSERT INTO public.course_portal_chats (course_id, sender_id, content, created_at)
SELECT
  '35fc87c4-8d9c-4ed6-8634-696fb4e028d1'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  'Chào mừng các bạn đến với lớp Cờ Vua Trực Tuyến: Chiến Thuật Khai Cuộc Chuyên Sâu! Ai có câu hỏi gì trước buổi học thì nhắn lên đây nhé.',
  now() - interval '3 hours'
WHERE EXISTS (SELECT 1 FROM public.courses WHERE id = '35fc87c4-8d9c-4ed6-8634-696fb4e028d1'::uuid)
  AND EXISTS (SELECT 1 FROM public.users WHERE id = '00000000-0000-0000-0000-000000000002'::uuid);
