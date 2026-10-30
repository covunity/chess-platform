-- Migration 117: Chess Problems for Teacher Assignments and Interactive Homework Solver

-- 1. Live Assignment Problems (Thế cờ trong bài tập)
CREATE TABLE IF NOT EXISTS public.live_assignment_problems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.live_assignments(id) ON DELETE CASCADE,
  order_index integer NOT NULL DEFAULT 0,
  title text NOT NULL DEFAULT '',
  fen text NOT NULL DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  player_side text NOT NULL DEFAULT 'white' CHECK (player_side IN ('white', 'black')),
  objective text DEFAULT 'best_move',
  solution_moves text[] NOT NULL DEFAULT '{}',
  explanation text DEFAULT '',
  hint text DEFAULT '',
  points numeric NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

-- Index for ordering problems within assignment
CREATE INDEX IF NOT EXISTS idx_live_assignment_problems_assignment
  ON public.live_assignment_problems(assignment_id, order_index);

-- 2. Enhance live_assignment_submissions with answers JSONB
ALTER TABLE public.live_assignment_submissions
  ADD COLUMN IF NOT EXISTS answers jsonb DEFAULT '[]'::jsonb;

-- 3. Enhance live_assignments with updated_at
ALTER TABLE public.live_assignments
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Enable RLS
ALTER TABLE public.live_assignment_problems ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_assignment_problems TO anon, authenticated;

-- Policies for live_assignment_problems
DROP POLICY IF EXISTS "Public read assignment problems" ON public.live_assignment_problems;
CREATE POLICY "Public read assignment problems" ON public.live_assignment_problems FOR ALL USING (true);

