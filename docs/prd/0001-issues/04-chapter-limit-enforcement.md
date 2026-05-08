# Issue 04 — Chapter limit enforcement (DB trigger + UI counter)

**Labels**: `needs-triage`, `enhancement`, `database`, `frontend`
**Type**: AFK

## Parent

PRD: `docs/prd/0001-enterprise-account-tiers.md` §5.6, US5.2, US5.3

## What to build

Enforce `account_tiers.max_chapters_per_course` ở 2 lớp: DB trigger backstop + UI counter cho UX. Demoable: business creator (max 30) thử thêm chapter thứ 31 → UI disable nút + tooltip; nếu bypass UI thì DB raise.

End-to-end deliverable:
- Migration `020_chapter_limit_trigger.sql`:
  - Function `enforce_chapter_limit()` BEFORE INSERT trên `chapters`:
    - Lookup `creator_id` từ `courses` của `NEW.course_id`.
    - Lookup `max_chapters_per_course` từ creator's tier.
    - Count chapters hiện tại với `course_id = NEW.course_id`.
    - Nếu count ≥ max → RAISE EXCEPTION `chapter_limit_exceeded` với detail (current/max).
  - Trigger gắn vào `chapters` BEFORE INSERT.
- `src/lib/creatorApi.ts`: `createChapter` pre-check (count chapters + so sánh với tier max), throw error với i18n key `errors.chapterLimitReached` trước khi gọi insert.
- `src/pages/creator/CourseEditorPage.tsx` (hoặc nơi list chapters):
  - Hiển thị "X / Y chương đã dùng" header.
  - Button "Thêm chương" disable khi `X >= Y`, tooltip i18n giải thích.
- i18n: `creator.chapters.counter`, `creator.chapters.limitReachedTooltip`, `errors.chapterLimitReached`.
- SQL test `scripts/test-chapter-limit.sql`: insert chapters cho từng tier đến vượt limit, expect raise.
- Unit test cho UI disable logic.

## Acceptance criteria

- [ ] CourseEditor hiện counter "X/Y chương" cho mọi creator.
- [ ] Nút "Thêm chương" disable khi đạt Y, tooltip hiển thị.
- [ ] Bypass UI (gọi insert trực tiếp) → DB raise `chapter_limit_exceeded`.
- [ ] SQL test pass cho 4 tier (individual=10, business=30, athlete=15, training_center=50).
- [ ] Counter cập nhật real-time sau khi thêm/xoá chapter.

## Blocked by

- Issue 02a
