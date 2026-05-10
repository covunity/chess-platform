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
