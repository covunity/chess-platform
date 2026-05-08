# PRD-0001 issue drafts

10 vertical slices từ `docs/prd/0001-enterprise-account-tiers.md`, sẵn sàng để publish lên GitHub Issues khi `gh` CLI hoặc MCP github tools available.

## Publishing

Khi access trở lại, chạy script sau (từ root repo):

```bash
for f in docs/prd/0001-issues/0*.md; do
  title=$(head -1 "$f" | sed 's/^# Issue [0-9a-z]* — //')
  body=$(tail -n +2 "$f")
  gh issue create --title "$title" --body "$body" --label "needs-triage"
done
```

Publish theo thứ tự dependency (số trong filename):
01 → 02a → 02b → 03, 04, 05 (parallel) → 06 → 07 → 08 → 09.

Sau khi publish 02a, sửa "Blocked by" trong issue 02b/03/04/05/06 tham chiếu issue number thật trên GitHub.

## Slice graph

```
01 (ADR + CLAUDE.md)
02a (schema) ──┬── 03 (admin change tier)
               ├── 04 (chapter limit)
               ├── 05 (fee snapshot)
               └── 02b (TS + badge) ── 06 (applications schema) ── 07 (combined form individual) ── 08 (enterprise tiers — closes #80) ── 09 (upgrade path)
```

## Acceptance for the whole PRD

Khi cả 10 slice merged:
- 4 tier có sẵn, admin chỉnh fee/limit qua DB.
- Anon đăng ký tier nào cũng được (kèm field tier-specific).
- Admin queue đủ tier + metadata.
- Chapter limit + order fee snapshot enforce.
- Issue #80 closed.
- Tier upgrade path active cho creator individual.
