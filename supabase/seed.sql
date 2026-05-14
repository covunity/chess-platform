-- Seed data for staging / local development.
-- Run after all migrations: psql $DATABASE_URL -f supabase/seed.sql
-- Idempotent: uses INSERT ... ON CONFLICT DO NOTHING.

-- ── Account tier (required FK) ────────────────────────────────────────────────
INSERT INTO public.account_tiers (code, name_vi, platform_fee_pct, max_chapters_per_course)
  VALUES ('individual', 'Cá nhân', 20, 10)
  ON CONFLICT (code) DO NOTHING;

-- ── Seed creator user ─────────────────────────────────────────────────────────
INSERT INTO public.users (id, email, name, role, account_tier_id)
  VALUES (
    '00000000-0000-0000-0000-000000000001',
    'creator@gambitly.demo',
    'Demo Creator',
    'creator',
    'individual'
  )
  ON CONFLICT (id) DO NOTHING;

-- ── Seed demo course ──────────────────────────────────────────────────────────
INSERT INTO public.courses (
  id, creator_id, title, description, price, level, language, status
) VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'Khai cuộc Italy — Nền tảng',
  'Học khai cuộc Italy với các biến thể phổ biến nhất.',
  0,
  'beginner',
  'vi',
  'published'
)
ON CONFLICT (id) DO NOTHING;

-- ── Seed chapter ──────────────────────────────────────────────────────────────
INSERT INTO public.chapters (id, course_id, title, position)
  VALUES (
    '00000000-0000-0000-0000-000000000020',
    '00000000-0000-0000-0000-000000000010',
    'Chương 1 — Nguyên lý cơ bản',
    1
  )
  ON CONFLICT (id) DO NOTHING;

-- ── Seed Italian Game lesson (variation-tree fixture) ─────────────────────────
-- PGN source: src/components/LessonEditor/__fixtures__/italian-game.pgn
-- 4 Black responses to 3.Bc4; max depth 17; 35 variation nodes.
INSERT INTO public.lessons (
  id, chapter_id, title, type, position, free_preview, board_perspective, pgn_data
) VALUES (
  '00000000-0000-0000-0000-000000000030',
  '00000000-0000-0000-0000-000000000020',
  'Tượng Italy — 4 cách phòng của Đen',
  'chess',
  1,
  true,
  'white',
  '; TODO: replace placeholder annotations with creator-authored content before Phase 2 GA
[Event "Italian Game Repertoire"]
[Site "Gambitly"]
[Date "2026.05.10"]
[White "Trắng"]
[Black "Đen"]
[Result "*"]

1. e4 {Kiểm soát trung tâm, mở đường cho Tượng và Hậu.} e5 {Đáp trả trung tâm — đối xứng.} 2. Nf3 {Phát triển Mã, tấn công Tốt e5.} Nc6 {Bảo vệ Tốt e5, phát triển quân.} 3. Bc4 {Tượng Italy — nhắm vào ô f7 yếu của Đen.} Bc5 {Giuoco Piano — đường chính, Tượng đối xứng.} (3...Nf6 {Thủ Two Knights — phản công tích cực nhất, tạo nhiều phức tạp.} 4. Ng5 d5 5. exd5 Na5 6. Bb5+ c6 7. dxc6 bxc6) (3...Be7 {Thủ Hungary — phòng thủ vững chắc, chấp nhận thế trận thụ động.} 4. d4 d6 5. dxe5 dxe5 6. Nc3 Nf6 7. O-O O-O) (3...d6 {Thủ Pianissimo — chờ thời cơ, tránh giao chiến sớm.} 4. c3 Nf6 5. d4 Be7 6. O-O O-O 7. Nbd2) (3...g6 {Biến bất thường — phát triển Tượng fianchetto.} 4. d4 exd4 5. Nxd4 Bg7 6. Nc3 Nf6 7. O-O O-O) 4. c3 {Chuẩn bị d4, củng cố Tốt trung tâm.} Nf6 {Phát triển Mã, tấn công Tốt e4.} 5. d4 {Mở trung tâm — đường chính của Giuoco Piano.} exd4 {Đổi Tốt trung tâm.} 6. cxd4 {Lấy lại Tốt, trung tâm mạnh.} Bb4+ {Chiếu Vua, tấn công Tốt d4.} 7. Nc3 {Chặn chiếu, tiếp tục phát triển.} Nxe4 {Bắt Tốt trung tâm.} 8. O-O {Nhập thành, Vua an toàn.} Bxc3 9. d5 {Đẩy Tốt, đòi lại quân, mở đường tấn công.} *'
)
ON CONFLICT (id) DO NOTHING;

-- ── PRD-0004 Puzzle Fixture Course ────────────────────────────────────────────
-- Sample puzzle course seeded for demo, QA, and E2E testing.
-- Exercises: shapes, rich-text notes, correct/mistake variations, custom FEN.
-- Run after migrations 040–043 (lesson authoring fields + puzzle_attempts).

INSERT INTO public.courses (
  id, creator_id, title, description, price, level, language, status
) VALUES (
  '00000000-0000-0000-0001-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'Bài tập chiến thuật — PRD-0004 Fixture',
  'Khóa học mẫu dùng cho kiểm thử E2E và demo tính năng Puzzle Rewind.',
  0,
  'beginner',
  'vi',
  'published'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.chapters (id, course_id, title, position)
  VALUES (
    '00000000-0000-0000-0001-000000000020',
    '00000000-0000-0000-0001-000000000010',
    'Chương 1 — Chiến thuật cơ bản',
    1
  )
  ON CONFLICT (id) DO NOTHING;

-- Puzzle 1: Mate-in-1 (Scholar's Mate)
-- Position: 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? — White plays 4.Qxf7#
-- Features: correct move annotation, arrow shape, rich-text note.
INSERT INTO public.lessons (
  id, chapter_id, title, type, position, free_preview,
  board_perspective, puzzle_player_side, starting_fen, pgn_data
) VALUES (
  '00000000-0000-0000-0001-000000000031',
  '00000000-0000-0000-0001-000000000020',
  'Chiếu hết ngay lập tức',
  'puzzle',
  1,
  true,
  'white',
  'white',
  'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
  '1. Qxf7# { [gambitly:v1]{"p":"correct","s":[{"kind":"arrow","from":"h5","to":"f7","color":"blue"}],"n":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Chiếu hết! Hậu đi vào f7 được bảo vệ bởi Tượng c4. Vua đen không có nơi nào để thoát."}]}]}} }'
)
ON CONFLICT (id) DO NOTHING;

-- Puzzle 2: Mate-in-2 with mistake variation
-- Main: 1.Re8+ Rxe8 2.Rxe8# — Mistake: 1.Ra8?? Rxa8 (loses rook)
-- Features: correct main line, mistake variation with note, arrow shape.
INSERT INTO public.lessons (
  id, chapter_id, title, type, position, free_preview,
  board_perspective, puzzle_player_side, pgn_data
) VALUES (
  '00000000-0000-0000-0001-000000000032',
  '00000000-0000-0000-0001-000000000020',
  'Chiếu hết hai nước — bẫy Xe hậu',
  'puzzle',
  2,
  true,
  'white',
  'white',
  '1. Re8+ { [gambitly:v1]{"p":"correct","s":[{"kind":"arrow","from":"e1","to":"e8","color":"green"}]} } (1. Ra8?? { [gambitly:v1]{"p":"mistake","n":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Sai rồi! Đưa Xe vào a8 chỉ để mất Xe — không có chiếu hết ngay sau đó."}]}]}} } 1... Rxa8) 1... Rxe8 2. Rxe8# { [gambitly:v1]{"p":"correct"} }'
)
ON CONFLICT (id) DO NOTHING;

-- Puzzle 3: Tactical fork — correct variation + mistake branch
-- Features: correct main line, correct alternative, mistake branch.
INSERT INTO public.lessons (
  id, chapter_id, title, type, position, free_preview,
  board_perspective, puzzle_player_side, pgn_data
) VALUES (
  '00000000-0000-0000-0001-000000000033',
  '00000000-0000-0000-0001-000000000020',
  'Nĩa Mã chiến thuật',
  'puzzle',
  3,
  false,
  'white',
  'white',
  '1. Nd5 { [gambitly:v1]{"p":"correct","s":[{"kind":"circle","square":"d5","color":"green"},{"kind":"circle","square":"c7","color":"yellow"}],"n":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Mã nhảy vào d5 — tạo mối đe dọa nĩa vào c7, tấn công cả hai Xe đen!"}]}]}} } (1. Nxe5?? { [gambitly:v1]{"p":"mistake","n":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Bắt Tốt ngay không đúng — bỏ lỡ nĩa chiến thuật mạnh mẽ hơn ở d5."}]}]}} } 1... Nc6) 1... Ke7 2. Nxc7 { [gambitly:v1]{"p":"correct"} } 2... Ra7 3. Nb5 { [gambitly:v1]{"p":"correct"} }'
)
ON CONFLICT (id) DO NOTHING;

-- Puzzle 4: Instructive mistake — obvious greedy capture loses; quiet move wins
-- Features: demonstrates purpose=correct for the non-obvious quiet move.
INSERT INTO public.lessons (
  id, chapter_id, title, type, position, free_preview,
  board_perspective, puzzle_player_side, pgn_data
) VALUES (
  '00000000-0000-0000-0001-000000000034',
  '00000000-0000-0000-0001-000000000020',
  'Nước bình tĩnh — bẫy tâm lý',
  'puzzle',
  4,
  false,
  'white',
  'white',
  '1. Rd8+ { [gambitly:v1]{"p":"correct","s":[{"kind":"arrow","from":"d1","to":"d8","color":"green"}],"n":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Nước bình tĩnh! Xe vào d8 buộc Vua đen ra chỗ trống, sau đó Hậu chiếu hết."}]}]}} } (1. Qxd7+? { [gambitly:v1]{"p":"mistake","n":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Bắt Hậu ngay là sai — Vua đen thoát được và ván cờ kéo dài mà không thắng ngay."}]}]}} } 1... Kxd7) 1... Kf7 2. Qe6+ { [gambitly:v1]{"p":"correct"} } 2... Kf8 3. Qf7# { [gambitly:v1]{"p":"correct"} }'
)
ON CONFLICT (id) DO NOTHING;

-- Puzzle 5: Custom-FEN endgame — K+P vs K opposition study
-- Exercises starting_fen field (Slice 6). White to move and win.
-- Features: custom starting_fen, shapes on opposition squares, rich-text note.
INSERT INTO public.lessons (
  id, chapter_id, title, type, position, free_preview,
  board_perspective, puzzle_player_side, starting_fen, pgn_data
) VALUES (
  '00000000-0000-0000-0001-000000000035',
  '00000000-0000-0000-0001-000000000020',
  'Tàn cuộc: Vua và Tốt — nghiên cứu đối lập',
  'puzzle',
  5,
  false,
  'white',
  'white',
  '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1',
  '1. Ke7 { [gambitly:v1]{"p":"correct","s":[{"kind":"circle","square":"e7","color":"green"},{"kind":"circle","square":"e8","color":"yellow"}],"n":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Đối lập trực tiếp! Vua trắng chiếm ô e7, đẩy Vua đen ra và dẫn đường cho Tốt phong cấp."}]}]}} } (1. e6? { [gambitly:v1]{"p":"mistake","n":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Đẩy Tốt ngay là sai — sau Ke7 của Đen, Tốt bị chặn và ván cờ hòa!"}]}]}} } 1... Ke7) 1... Ke8 2. e6 { [gambitly:v1]{"p":"correct"} } 2... Kd8 3. e7+ { [gambitly:v1]{"p":"correct"} } 3... Kc7 4. e8=Q { [gambitly:v1]{"p":"correct"} }'
)
ON CONFLICT (id) DO NOTHING;
