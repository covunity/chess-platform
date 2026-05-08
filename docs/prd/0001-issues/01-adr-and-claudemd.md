# Issue 01 — ADR-0002 + CLAUDE.md update for enterprise account tiers

**Labels**: `needs-triage`, `documentation`
**Type**: AFK

## Parent

PRD: `docs/prd/0001-enterprise-account-tiers.md`

## What to build

Transcribe các quyết định kiến trúc đã chốt (E-01 → E-20 trong PRD) thành ADR-0002. Cập nhật `CLAUDE.md` để loại "Sub-tier business accounts" khỏi danh sách Phase 2 deferred và thêm khái niệm `account_tier` vào domain section.

End-to-end deliverable:
- File mới `docs/adr/0002-enterprise-account-tiers.md` theo style ADR-0001 (Context / Decision / Consequences / Alternatives considered).
- `CLAUDE.md` §4 thêm bảng `account_tiers`; §5 mô tả tier as orthogonal dimension; §7 gỡ "Sub-tier business accounts" khỏi Phase 2 deferred list; §6 thêm các decision E-01..E-20.

## Acceptance criteria

- [ ] `docs/adr/0002-enterprise-account-tiers.md` tồn tại, reference PRD-0001 và Issue #80.
- [ ] ADR có 4 section: Context, Decision, Consequences, Alternatives considered.
- [ ] ADR ghi rõ 4 tier code, default tier = `individual`, admin-lock invariant.
- [ ] `CLAUDE.md` §7 không còn "Sub-tier business accounts" trong deferred list.
- [ ] `CLAUDE.md` §4 thêm cột/bảng nói về `account_tier` riêng biệt với `role`.
- [ ] `CLAUDE.md` §6 (Key Design Decisions) thêm các dòng E-01..E-20.

## Blocked by

None — can start immediately
