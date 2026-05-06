-- Slice 6: Add PGN lesson authoring fields to lessons table
ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS pgn_data       TEXT        NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS board_perspective TEXT      NOT NULL DEFAULT 'white'
    CHECK (board_perspective IN ('white', 'black'));
