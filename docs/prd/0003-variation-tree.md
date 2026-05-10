# PRD-0003: Variation Tree for Guided Chess Lessons

> Status: Draft · Owner: @haunguyen1064 · Created: 2026-05-10 · Branch: `claude/variation-tree-design`
> Phase: **Phase 2** — unlocks D-07 (Phase 1 lock that forbade variations in guided mode)
> ADR: `docs/adr/0004-variation-tree-guided-mode.md`
> Builds on: i18n PR `#154` (translation namespace `guidedPlayer.*` already in place)

---

## 1. Background & Problem

Guided mode (lesson `type = 'chess'`) is the platform's chess differentiator and one of the four legs of the core loop (`Create → Review → Purchase → Learn`). Phase 1 locked it to **forward-only linear PGN** (D-07, D-12) to ship the MVP on time.

That ship has sailed. The linear contract works for endgame studies and tactic puzzles, but it does **not** support the platform's largest commercial use case: **opening repertoires**. Every reference platform in the genre (Chessable, Lichess Studies, ChessBase, Chess Tempo) treats lessons as PGN trees. Without variations, a creator teaching the Italian Game cannot teach the **response** to 4...d6 vs 4...Nf6 vs 4...Bg4. They have to ship multiple parallel "lessons" or accept that learners only see one black response.

PRD-0003 lifts D-07 by extending the existing `GuidedChessPlayer` + `parsePgn` to walk a tree, **without** rewriting the data model. Variations live in the existing `lessons.pgn_data text` column using PGN's standard `(...)` syntax. See ADR-0004 for the full data model rationale and rejected alternatives.

### What's already in place

- `LessonEditor.tsx` chess tab + live preview (i18n PR #154 vietnamized it).
- `GuidedChessPlayer.tsx` with forward-only state machine, hint/flip/reset, opponent auto-play, bookmark via `B` (i18n PR #154 vietnamized it).
- `parsePgn.ts` — strips annotations, calls `chess.loadPgn`, returns flat `PgnMove[]` (this is what we rewrite).
- `bookmarks` table (Phase 1) — currently keyed on `(user_id, lesson_id)` with `played_plies` + `current_fen` columns. Needs one nullable column added.
- 44 player tests + 24 editor tests — all green, will be extended.
- chess.js + chessboard.js dependencies — already shipped, may need version verification (see §10 risks).

## 2. Goals

- **G1.** A creator can paste a PGN tree (main line + `(...)` alternatives) into the existing PGN textarea, see a parsed-tree summary in the status row, and preview both main line and any clicked variation node on the live board.
- **G2.** A learner playing a guided lesson can choose any move that matches **any** child of the current node — the player advances down that branch. Wrong move (no matching child) → existing snap-back UX (D-10).
- **G3.** Hint always points to the **main line** continuation (`children[0]`), with an inline pill `+N biến` when alternatives exist so the learner knows the lesson covers them.
- **G4.** Opponent auto-play picks `children[0]` when the auto-played side is on move at a branching node — alternatives only matter when the **learner** has the choice.
- **G5.** Reaching a leaf node along **any** path counts as `onComplete`. Side-variation completion is a valid lesson completion.
- **G6.** Bookmarks survive lesson edits as long as the path-from-root remains valid. New `bookmarks.node_id` column; legacy bookmarks (`node_id IS NULL`) keep working via ply-count resolution.
- **G7.** Linear lessons (no `(...)` in PGN) work **identically** to Phase 1 — the new tree code path collapses to a degree-1 tree and behaves the same way.
- **G8.** All UX strings vietnamese via i18n (existing `guidedPlayer.*` namespace).

## 3. Non-goals (Phase 2 scope)

- ❌ **Two-mode toggle** on lesson creation (linear vs branching). Tree is a superset; the editor renders branching UI only when the parsed tree has `variationCount > 0`. ADR-0004 §Alternative A.
- ❌ **`lesson_moves` flat table.** No DB migration on `lessons`. ADR-0004 §Alternative B.
- ❌ **Graphical tree builder.** Creators paste PGN exported from ChessBase / Lichess. ADR-0004 V-04.
- ❌ **Engine-suggested variations / Stockfish integration.** Separate PRD; this is the prerequisite, not the integration.
- ❌ **Spaced-repetition scheduling on bookmarks** (FSRS). Separate PRD; the new `node_id` column enables it.
- ❌ **Server-side variation analytics** (most-failed nodes, completion-by-line). Out of scope; would require flat `lesson_moves` table per ADR-0004 §B.
- ❌ **Backward navigation / "undo move" inside an active lesson.** D-12 stays — the only way to retry a different branch is Reset.
- ❌ **PGN export / download** from the editor.
- ❌ **Variations in puzzle lessons.** Puzzle is bookmark-based review (D-12, CLAUDE.md §5); variations apply only to `type = 'chess'` lessons.
- ❌ **NAG glyphs (`!?`, `?!`, `??`)** beyond raw text passthrough in annotations. We display SAN as-typed; we do not render `$1`, `$3`, etc. as glyphs.

## 4. Personas & User Stories

### P1 — Creator authoring a repertoire lesson

- **US1.1**: Open existing chess lesson editor, paste a PGN tree exported from Lichess Studies (Italian Game with 4 black responses). The status row reads `✓ Đã phân tích PGN · 18 nước (12 nhánh phụ, độ sâu tối đa 8)`.
- **US1.2**: Below the live board, see a collapsible variation list. Main line is expanded by default; sub-variations show as nested indented rows with their SAN + annotation. Clicking any node updates the board FEN to that position and highlights the move.
- **US1.3**: For each branching node, see a "Coach: opponent will play X" hint when the auto-played side is at the branch point — explains V-08.
- **US1.4**: Save lesson as draft. The PGN textarea retains the full tree string up to the new 20000-char cap. The status row continues to update on every keystroke.
- **US1.5**: Submit for review. Admin reviews using the same preview pane; no admin-side UI changes needed.

### P2 — Learner playing a branching lesson

- **US2.1**: Open lesson, see board at start position, "Lượt của bạn" prompt as before.
- **US2.2**: Play the main-line move (`e4`) — board advances, opponent auto-plays `e5` after 600ms. Identical to linear behaviour.
- **US2.3**: At move 4, instead of the main line `Bc5`, play the alternative `d6` (which the creator authored as a variation). Player accepts it, advances down the variation branch, opponent auto-plays the main response in that branch.
- **US2.4**: Play a move that matches **no** child (e.g. `a3` at move 4). Snap-back, red square 1s — D-10 unchanged.
- **US2.5**: At a branching node, click `Hint`. The main-line continuation highlights yellow (D-11 unchanged). An inline pill `+2 biến` appears below the board, telling the learner the lesson teaches alternatives even though hint shows main line.
- **US2.6**: Reach the leaf of a variation (not the main line). `onComplete` fires, lesson list checks the lesson off. The learner did not need to traverse all branches.
- **US2.7**: Press `B` mid-lesson at a variation node → bookmark stored with `node_id`. Returning to the bookmark from `/practice` resumes at exactly that node.

### P3 — Learner with a Phase 1 (legacy) bookmark

- **US3.1**: Pre-existing bookmark (created when `node_id` column didn't exist) resolves by walking `played_plies` from root through `children[0]` (always main line). Same position the learner saw before the migration.
- **US3.2**: Re-bookmarking the same position writes the new `node_id` so future resume is path-aware.

## 5. Functional Spec

### 5.1 PGN parser (`src/utils/parsePgn.ts`)

Rewritten signature:

```ts
export interface PgnNode {
  id: string                       // hash of (parentId, san) chain
  san: string
  from: string
  to: string
  fen: string
  moveNumber: number
  side: 'w' | 'b'
  annotation: string | null
  parentId: string | null
  children: PgnNode[]              // [0] = main line continuation
}

export interface PgnParseResult {
  valid: boolean
  root: PgnNode | null             // sentinel root with no san; children[0] = first move
  totalNodes: number
  variationCount: number           // count of non-main-line nodes
  maxDepth: number
  annotations: number
  mainLine: PgnNode[]              // walk children[0] from root for editor preview & legacy callers
  error?: string
}

export function parsePgn(pgn: string): PgnParseResult
```

Implementation notes:
- Try `chess.js` `loadPgn` with `(...)` support first (Slice 1 verifies which version we have).
- If chess.js does not expose the tree, fall back to a recursive-descent tokenizer that tracks `(...)` paren depth — same approach the existing `extractAnnotations` regex uses but recursive. Token shape unchanged: move tokens advance the cursor; `(` pushes the current node onto a stack as a branch point; `)` pops back to the branch point.
- For each move token, compute the post-move FEN by reapplying the path-from-root on a fresh `Chess()` instance. This is O(depth) per node; fine for trees ≤ a few hundred nodes.
- `id` = `sha256((parentId || '') + '/' + san).slice(0, 16)`. Path-derived so identical opening prefixes share IDs across lessons (useful for analytics later).

### 5.2 GuidedChessPlayer (`src/components/GuidedChessPlayer/GuidedChessPlayer.tsx`)

State change:

```ts
// Before
const [playedPlies, setPlayedPlies] = useState(0)

// After
const [currentNodeId, setCurrentNodeId] = useState<string>(parsed.root!.id)
```

Derived view from `currentNodeId`:
- `currentNode` — looked up via a `Map<id, PgnNode>` built once per `parsed`.
- `currentFen` — `currentNode.fen` (root's FEN = STARTING_FEN).
- `lastMove` — `{ from: currentNode.from, to: currentNode.to }` if not root.
- `nextChildren` — `currentNode.children`.
- `mainChild` — `nextChildren[0] ?? null`.
- `awaitingOpponent` — `mainChild?.side !== learnerColor` (opponent's turn = auto-play).
- `learnerSideToMove` — `mainChild?.side === learnerColor` and not awaiting.

`handleSquareClick(square)`:
- If selectedSquare null → `setSelectedSquare(square)`.
- Else compute `(from, to) = (selected, square)`. Find `next = nextChildren.find(c => c.from === from && c.to === to)`.
- If found → `setCurrentNodeId(next.id)`.
- If not found → existing wrong-move flow (red square, 1000 ms timeout).

Hint:
- `hintSquares = mainChild ? { from: mainChild.from, to: mainChild.to } : null`.
- `variationCount = nextChildren.length - 1`. When > 0, render a pill below the board: `+{n} biến`.

Opponent auto-play:
- When `awaitingOpponent && mainChild`, `setTimeout(600, () => setCurrentNodeId(mainChild.id))`.
- Tree pick is always main line (V-08).

Reset dialog:
- `setCurrentNodeId(parsed.root!.id)` instead of `setPlayedPlies(0)`. Other state clears unchanged.

Completion:
- `useEffect` watches `currentNode.children.length === 0` (leaf reached). Fires `onComplete` once, gated by `completedFiredRef` like Phase 1.

Bookmark:
- `onBookmark` signature becomes `(nodeId, currentFen, depth, totalDepth)`. `depth = currentNode.depthFromRoot`, `totalDepth = parsed.maxDepth`. The legacy `(playedPlies, currentFen, totalPlies)` callers in `LessonPlayerPage` need a thin adapter that derives `playedPlies` = depth along main line; tracked in Slice 4.

Move log:
- Iterate the path-from-root to `currentNode`, render the SAN + move number in the same format as Phase 1 (`{n}. {white} {black}`).
- Annotations on the path render as a `<p>` per node (existing `move-log-annotation-{n}` testid kept).

### 5.3 LessonEditor (`src/components/LessonEditor/LessonEditor.tsx`)

Status row update (V-11):
- `creator.lessonEditor.pgnParsedMoves` becomes `✓ Đã phân tích PGN · {{count}} nước` (existing key, content unchanged).
- New key `creator.lessonEditor.pgnVariationSummary` = `({{variations}} nhánh phụ, độ sâu tối đa {{depth}})`. Rendered when `variationCount > 0`.
- Annotation count line unchanged.

Preview pane (V-05):
- Below the existing 300px ChessBoard, add a `VariationList` component:
  - Tree-walk render starting from `parsed.root`. Each non-root node = one row.
  - Indent depth = depth-from-root × 16 px.
  - Main-line nodes use `--ink-1`; alternative nodes use `--ink-2` and are prefixed with `(`/`)` markers.
  - Click → `setHighlightedNodeId(node.id)`. Highlighting drives `currentFen` + `lastMove` for the preview board.
  - Annotation renders as `--ink-3` italic below the SAN row.
- When `variationCount === 0`, the variation list is hidden entirely — linear creators see no new UI surface.
- `MAX_PGN_CHARS` const updated to 20000. Char counter copy unchanged (existing `pgnCharCount` key with `{{used}} / {{max}}` interpolation handles new max automatically).

### 5.4 Database

```sql
-- Migration 03X_bookmarks_node_id.sql

ALTER TABLE public.bookmarks
  ADD COLUMN IF NOT EXISTS node_id text;

-- node_id IS NULL → legacy linear bookmark, resolve via played_plies path through children[0]
-- node_id IS NOT NULL → walk from root looking for a node with id = node_id
COMMENT ON COLUMN public.bookmarks.node_id IS
  'PgnNode id (sha256(parent.id+/+san) prefix). NULL for pre-PRD-0003 linear bookmarks.';
```

No changes to `lessons.pgn_data`. The existing column type (`text`) handles 20000 chars trivially.

### 5.5 Bookmark resolution adapter

`src/lib/bookmarkApi.ts` gains:

```ts
export function resolveBookmark(
  parsed: PgnParseResult,
  bookmark: Bookmark
): { nodeId: string; node: PgnNode } | null {
  if (!parsed.valid || !parsed.root) return null
  if (bookmark.node_id) {
    const node = findNodeById(parsed.root, bookmark.node_id)
    if (node) return { nodeId: node.id, node }
    // node_id no longer exists (creator edited the tree) — fall through to legacy resolution
  }
  // Legacy: walk children[0] N times
  let n = parsed.root
  for (let i = 0; i < bookmark.played_plies; i++) {
    if (n.children.length === 0) break
    n = n.children[0]
  }
  return { nodeId: n.id, node: n }
}
```

### 5.6 i18n

New keys under existing `guidedPlayer.*` (vi + en):

| Key | vi | en |
|---|---|---|
| `guidedPlayer.variationCountPill` | `+{{n}} biến` | `+{{n}} variation` (en) / `+{{n}} variations` (en, n>1) |
| `guidedPlayer.opponentBranchHint` | `Đối thủ sẽ đi {{san}}` | `Opponent will play {{san}}` |
| `creator.lessonEditor.pgnVariationSummary` | `({{variations}} nhánh phụ, độ sâu tối đa {{depth}})` | `({{variations}} variations, max depth {{depth}})` |
| `creator.lessonEditor.variationListHeading` | `Cây nước đi` | `Move tree` |
| `creator.lessonEditor.variationListClickHint` | `Bấm vào nước đi để xem trước trên bàn cờ` | `Click a move to preview on the board` |

## 6. Data Model & Validation

- `lessons.pgn_data` — text, **bumped from 5000 to 20000 char client-side cap** (`MAX_PGN_CHARS` in editor + textarea `maxLength`). No DB constraint exists today; none added.
- `bookmarks.node_id` — `text NULL`. No FK (PgnNode IDs are content-derived, not persisted).
- Server-side validation for PGN remains absent (Phase 1 chose not to). Client-side parser is the source of truth; invalid PGN blocks lesson Save via the existing parse-result check (Phase 1 already does this for linear PGN).

## 7. UI / UX

Preserve every Phase 1 visual decision (D-10 red snap-back, D-11 yellow hint highlight, D-12 forward-only, design system tokens). Additions:

- **Variation pill** below the board on `GuidedChessPlayer`: `+{n} biến` in `--accent-soft` background, only when `nextChildren.length > 1`.
- **Opponent-branch coach hint** in editor preview: small `--ink-3` row below the board when the highlighted node has `> 1` children **and** the side-to-move is the opponent — reads `Đối thủ sẽ đi {san}`.
- **Variation list** in editor preview: collapsible, indent-by-depth, click-to-preview. Empty when no variations (linear lessons see no change).
- **Editor PGN status row** gains the `(N nhánh phụ, độ sâu tối đa K)` suffix when `variationCount > 0`.

No new colours, fonts, or icons. All strings translatable.

## 8. Slice Plan (vertical tracer-bullets)

Following the same pattern as PRD-0002. Each slice ships independently, behind no flag, with full tests + manual SQL where applicable.

| # | Slice | Issue | Blocked by |
|---|-------|-------|------------|
| 1 | **PGN tree parser** — rewrite `parsePgn.ts` to return `PgnNode` tree; preserve `mainLine` view for back-compat; new tests; legacy `moves[]` consumers updated to read `mainLine`. | TBD | — |
| 2 | **GuidedChessPlayer tree navigation** — `currentNodeId` state, child-match move handling, hint of main line, opponent auto-play picks main line; +variation pill. | TBD | #1 |
| 3 | **Editor variation list + status summary** — collapsible variation panel, click-to-preview, status row suffix; `MAX_PGN_CHARS` → 20000. | TBD | #1 |
| 4 | **Bookmark `node_id` migration + resolve adapter** — DB migration, `resolveBookmark` helper, `LessonPlayerPage` callers updated; legacy bookmarks keep resolving. | TBD | #1, #2 |
| 5 | **Author-side smoke + sample lesson** — paste a known Lichess study export, verify parse + preview; commit one sample course as fixture for tests. | TBD | #1, #3 |

Total: 5 slices, ~1 week if delivered serially. #1 unblocks everything.

## 9. Acceptance Criteria

- [ ] `parsePgn('1. e4 e5 2. Nf3')` returns `{ root, mainLine: [e4, e5, Nf3], variationCount: 0, maxDepth: 3 }` and the linear-PGN snapshot matches Phase 1 byte-for-byte.
- [ ] `parsePgn('1. e4 e5 (1...c5 2. Nf3) 2. Nf3')` returns `{ variationCount: 2, maxDepth: 3 }` with `root.children[0].children` containing both `e5` (main) and `c5` (variation) at the right indices.
- [ ] In `GuidedChessPlayer`, with the above tree, playing `e2-e4` advances; playing `e7-e5` advances down main line; playing `c7-c5` advances down variation; playing `a7-a6` triggers wrong-move snap-back.
- [ ] Hint at root highlights `e2-e4`. Variation pill `+0 biến` not shown (root has 1 child). At `e4`, hint highlights `e7-e5`; variation pill `+1 biến` is rendered.
- [ ] Reaching a leaf of the `c5` variation fires `onComplete` exactly once.
- [ ] Reset on a tree returns to root, clears wrong-move + hint state.
- [ ] Linear lessons (no `(...)`) behave identically to Phase 1 — all 44 existing player tests pass unchanged.
- [ ] LessonEditor with a tree shows `✓ Đã phân tích PGN · N nước (M nhánh phụ, độ sâu tối đa K)` and a click-to-preview variation list. With no variations, only `· N nước` shows and the variation list is absent.
- [ ] `MAX_PGN_CHARS = 20000` allows pasting a 50-move tree without truncation.
- [ ] Bookmark with `node_id IS NULL` (Phase 1 row) resolves to the same FEN it would have under Phase 1. Bookmark with `node_id` resolves to the exact node, even when the lesson tree has variations.
- [ ] All new strings render in vi and en via i18n; no English leaks into the vi user's screen.
- [ ] Full test suite green; no new test pyramid inversion (parser tests >> player tests >> editor tests).

## 10. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `chess.js` does not expose `(...)` variations through `loadPgn` in our pinned version. | Med | Med | Slice 1 first task: write a 5-line spike against current `chess.js`; if blocked, ship the recursive-descent tokenizer fallback. ADR-0004 §D documents both paths. |
| Node-id hash collision across two distinct nodes. | Low | Low | sha256 prefix of 16 chars = 2^64 keyspace per parent chain; collision needs two different SAN strings hashing same prefix from same parent — astronomically unlikely. Add an assertion in the parser that all node IDs in one tree are unique; throw on collision. |
| Creator pastes 100k-char tree. | Low | Low | `MAX_PGN_CHARS` enforced at textarea + parser. Status row shows `(20000/20000)`. Defer larger trees to Phase 3 (`lesson_moves` table or storage object). |
| Bookmark node ID becomes invalid after creator edits the tree mid-path. | Med | Low | `resolveBookmark` falls through to legacy ply-count resolution when node ID is not found. Learner ends up at the closest valid main-line position — same as a Phase 1 bookmark would have done. |
| Player completion (V-09) fires for trivial side-variations a creator added as throwaway lines. | Low | Low | This is intended pedagogical behaviour. If a creator does not want a side variation to count as completion, they should not author it as a variation — they should ship a separate lesson. |
| `variationCount` and `maxDepth` are slow for very deep trees. | Low | Low | Computed once at parse time, O(N) where N = totalNodes. Cached in `parsePgn` result. |
| `onBookmark` signature change breaks `LessonPlayerPage`. | Med | Low | Slice 4 includes the call-site update. Type system catches missing args at compile time. |

## 11. Decisions

All decisions are inherited from ADR-0004 (V-01 through V-15). No additional PRD-level decisions.

## 12. Open Questions

1. **chess.js variation API.** Spike in Slice 1 — current pinned version exposes variations via `loadPgn` flags? If not, custom tokenizer.
2. **Editor variation panel default state.** Expanded? Auto-collapse to depth 2? Defer to UX iteration after Slice 3 ships.
3. **Sample lesson fixture.** Which opening do we ship? Italian Game (matches Phase 1 placeholder PGN) is a safe default.

## 13. Success Metrics

After Phase 2 ships and is enabled:

- Number of published `type='chess'` lessons with `variationCount > 0` in the live database (target: > 30 % within 30 days of release, measured via a one-shot SQL query).
- Average `maxDepth` across published chess lessons (sanity check that creators are using variations meaningfully, not just depth-2 throwaways).
- No regression in lesson-completion rate (`enrollments.completed_at IS NOT NULL`) on existing linear lessons. Compare 30-day window before vs after release.
- Zero migration-related bookmark loss reports in support inbox.

## 14. Out of scope follow-ups (Phase 3)

- Engine integration (Stockfish): suggest variations to creators while authoring; show eval bar to learners.
- FSRS spaced-repetition on bookmarks: schedule reviews of bookmarked nodes.
- Server-side flat `lesson_moves` table for analytics.
- Graphical tree builder in the editor.
- PGN export / download from the editor.
