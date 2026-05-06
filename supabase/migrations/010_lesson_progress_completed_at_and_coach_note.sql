-- Slice 13: Chess lesson player — guided mode
-- Add columns needed by the guided player:
--   • lesson_progress.completed_at — timestamp the lesson was auto-completed
--   • lessons.coach_note          — optional coach's note shown in annotation panel

alter table public.lesson_progress
  add column if not exists completed_at timestamptz;

alter table public.lessons
  add column if not exists coach_note text;
