-- Migration 040: PRD-0004 Slice 2 — lesson authoring columns (#189)
-- Three nullable columns on `lessons` required for board-direct authoring,
-- puzzle mode, and viewer mode.

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS starting_fen text
    CONSTRAINT lessons_starting_fen_shape CHECK (
      starting_fen IS NULL
      OR starting_fen ~ '^[rnbqkpRNBQKP1-8/]{1,71} [wb] [KQkq-]{1,4} [a-h][1-8]|-{1} [0-9]{1,3} [0-9]{1,4}$'
    ),
  ADD COLUMN IF NOT EXISTS puzzle_player_side text
    CONSTRAINT lessons_puzzle_player_side_check CHECK (
      puzzle_player_side IS NULL
      OR puzzle_player_side IN ('white', 'black')
    ),
  ADD COLUMN IF NOT EXISTS is_view_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.lessons.starting_fen IS
  'Custom starting position for chess/puzzle lessons. NULL = standard initial position. '
  'Server-side check enforces basic FEN shape; full chess-legality is validated client-side.';

COMMENT ON COLUMN public.lessons.puzzle_player_side IS
  'Which side the learner plays in puzzle mode (white or black). '
  'Required by app layer for type=''puzzle'', NULL otherwise.';

COMMENT ON COLUMN public.lessons.is_view_only IS
  'When true, the lesson opens in viewer mode (navigate with arrows) rather than interactive mode. '
  'Only meaningful for type=''chess''; ignored for type=''puzzle''.';
