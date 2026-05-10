# PRD-0003: Variation Tree for Guided Chess Lessons

> Status: Draft · Owner: @haunguyen1064 · Created: 2026-05-10 · Revised: 2026-05-10 (post-design-review) · Branch: `claude/variation-tree-design`
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
  id: string                            // V-16: sha256((parentId||'') + '/' + from + to + (promotion||'')).slice(0,16)
  san: string                           // display only; not used for matching
  from: string
  to: string
  promotion: 'q'|'r'|'b'|'n'|null       // V-13: non-null only for pawn promotion moves
  fen: string
  moveNumber: number
  side: 'w' | 'b'
  annotation: string | null
  parentId: string | null
  children: PgnNode[]                   // [0] = main line continuation
  depthFromRoot: number                 // 0 for root
}

export interface PgnParseResult {
  valid: boolean
  root: PgnNode | null                  // sentinel root with no san/from/to; children[0] = first move
  totalNodes: number
  variationCount: number                // count of non-main-line nodes
  maxDepth: number
  annotations: number
  mainLine: PgnNode[]                   // walk children[0] from root for editor preview & legacy callers
  nodeMap: Map<string, PgnNode>         // built once at parse time; player + bookmark adapter share it
  error?: string
}

export function parsePgn(pgn: string): PgnParseResult
```

Implementation notes:
- **Parser is a custom recursive-descent tokenizer (V-17)** — not `chess.js loadPgn`. Empirically `chess.js` parses only the main line and discards `(...)` content, so it is unsuitable as the variation parser. The original "spike then maybe fallback" plan is replaced with a single primary path: tokenize the PGN string, advancing through move tokens; `(` pushes the current node as a branch point; `)` pops back to the branch point; `{ ... }` consumes annotations and attaches them to the most recently emitted move.
- `chess.js` is still used **per-node** to compute `fen` by replaying the path from root on a fresh `Chess()` instance. This is O(depth) per node; fine for trees ≤ a few hundred nodes. The replay is also where we extract `from`, `to`, and `promotion` for each move (chess.js `move()` returns `{ from, to, promotion?, san, ... }`).
- **Node ID (V-16)** = `sha256((parentId || '') + '/' + from + to + (promotion || '')).slice(0, 16)`. Hashing on geometric coordinates (not SAN) means parser-output normalisation cannot drift IDs — `Ngf3` vs `Nf3` SAN variants produce the same node ID because `(from, to, promotion)` is identical.
- **`nodeMap` is built once at parse time** and exposed on `PgnParseResult` so `GuidedChessPlayer` lookup is O(1) and `resolveBookmark` does not have to tree-walk on every restore.
- **Parser must handle**: NAG glyphs (`$1`, `$3` — emit raw text into annotation, no glyph render per non-goal §3), nested `{ }` inside `(...)`, escape sequences in PGN tag pairs, and recursive variations (a `(` inside another `(`). Ship a fixture suite of ≥ 10 real-world PGNs (Lichess Studies exports for Italian/Najdorf/KID, ChessBase example DBs) committed under `src/utils/__fixtures__/pgn/` before Slice 1 lands.

### 5.2 GuidedChessPlayer (`src/components/GuidedChessPlayer/GuidedChessPlayer.tsx`)

State change:

```ts
// Before
const [playedPlies, setPlayedPlies] = useState(0)

// After
const [currentNodeId, setCurrentNodeId] = useState<string>(parsed.root!.id)
```

Derived view from `currentNodeId`:
- `currentNode` — looked up via `parsed.nodeMap.get(currentNodeId)` (Map is built at parse time, §5.1).
- `currentFen` — `currentNode.fen` (root's FEN = STARTING_FEN).
- `lastMove` — `{ from: currentNode.from, to: currentNode.to }` if not root.
- `nextChildren` — `currentNode.children`.
- `mainChild` — `nextChildren[0] ?? null`.
- `awaitingOpponent` — `mainChild?.side !== learnerColor` (opponent's turn = auto-play).
- `learnerSideToMove` — `mainChild?.side === learnerColor` and not awaiting.

`handleSquareClick(square)` — match by `(from, to, promotion)` per V-13:
- If selectedSquare null → `setSelectedSquare(square)`.
- Else compute `(from, to) = (selected, square)`. Filter `candidates = nextChildren.filter(c => c.from === from && c.to === to)`.
- If `candidates.length === 0` → existing wrong-move flow (red square, 1000 ms timeout).
- If `candidates.length === 1` → `commit(candidates[0])`.
- If `candidates.length > 1` → all candidates differ only by `promotion`. Show `<PromotionPicker />` modal listing the offered pieces (Q/R/B/N from candidates' `promotion` fields). On pick → `commit(candidates.find(c => c.promotion === picked))`. On dismiss → no state change, learner can re-attempt.

`commit(next)`:
- `setCurrentNodeId(next.id)`.
- If `next.children.length === 0` → fire `onComplete` (V-09 + V-18: regardless of side-to-move at the leaf, gated by `completedFiredRef`).
- If `next.children[0]?.side` is opposite of `learnerColor` → schedule `setCurrentNodeId(next.children[0].id)` after 600 ms (V-08 main-line auto-play).

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

New: **branch warning surface** (consequence of V-08, see ADR Negative consequence §6).
- `currentNode` is on the opponent's turn AND `nextChildren.length > 1` is **not possible to encounter as a learner** because opponent auto-play picks `children[0]`, and the learner's next decision happens at the *next* node. So the player never shows opponent-side branching to the learner; this is a creator-time concern only and lives in `LessonEditor` preview (§5.3), not the player.

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
  - **Opponent-branch warning**: when a node has `> 1` children AND the side-to-move at that node is the opponent (i.e. the *learner* is not the one choosing), render an inline `--warn` row beneath the parent node: `⚠ Đối thủ sẽ chỉ đi {san of children[0]} — các nhánh phụ sẽ không hiển thị cho học viên`. Surfaces V-08's silent constraint at authoring time so creators don't ship dead branches.
- When `variationCount === 0`, the variation list is hidden entirely — linear creators see no new UI surface.
- **Performance**: parsing runs on every `pgn_data` keystroke today. With trees up to 50k chars + tree-walk render, debounce parse to 250 ms (`useDebouncedValue`) and memoise `VariationList` on `parsed.root` identity. Without this, deep-tree authoring stutters.
- `MAX_PGN_CHARS` const updated to **50000** (V-12). Char counter copy unchanged (existing `pgnCharCount` key with `{{used}} / {{max}}` interpolation handles new max automatically).

### 5.4 Database

```sql
-- Migration 03X_bookmarks_node_id.sql

ALTER TABLE public.bookmarks
  ADD COLUMN IF NOT EXISTS node_id text;

-- node_id IS NULL → legacy linear bookmark, resolve via played_plies path through children[0]
-- node_id IS NOT NULL → look up directly via parsed.nodeMap.get(node_id)
COMMENT ON COLUMN public.bookmarks.node_id IS
  'PgnNode id (V-16: sha256(parentId+/+from+to+promotion) prefix). NULL for pre-PRD-0003 linear bookmarks; backfilled by deploy script when possible.';

-- Optional one-shot backfill (run once, after deploy, idempotent):
-- For each existing bookmark, parse the lesson's current pgn_data, walk children[0] N=played_plies times,
-- and set node_id to that node's id. Skips rows where the lesson is unparseable or pgn_data has changed
-- (those keep node_id IS NULL and rely on legacy ply-walk resolution).
-- Implementation: server-side script in scripts/backfill_bookmark_node_ids.ts, NOT a SQL migration —
-- requires the JS parser. Safe to skip; main.ts startup does NOT depend on it.
```

No changes to `lessons.pgn_data` schema. The existing column type (`text`) handles 50000 chars trivially.

**Backfill policy.** The deploy script at `scripts/backfill_bookmark_node_ids.ts` is best-effort: it fills `node_id` for every Phase-1 bookmark whose lesson still parses linearly to a tree of degree 1. Bookmarks pointing to lessons that were already converted to branching PGN before the script runs are left as `node_id IS NULL` and resolve through the legacy ply-walk in §5.5 — guaranteeing back-compat. This narrows the window in which a creator could swap main/alt order in a re-published lesson and silently relocate a learner's bookmark.

### 5.5 Bookmark resolution adapter

`src/lib/bookmarkApi.ts` gains:

```ts
export function resolveBookmark(
  parsed: PgnParseResult,
  bookmark: Bookmark
): { nodeId: string; node: PgnNode } | null {
  if (!parsed.valid || !parsed.root) return null
  if (bookmark.node_id) {
    const node = parsed.nodeMap.get(bookmark.node_id)   // O(1) — Map built at parse time, §5.1
    if (node) return { nodeId: node.id, node }
    // node_id no longer exists (creator edited the tree mid-path) — fall through to legacy resolution
  }
  // Legacy: walk children[0] N times. Note this lands on the current main line, which may
  // differ from the node the learner saw if the creator swapped main/alt order. Mitigated by
  // the backfill script in §5.4 which writes node_id eagerly the first time.
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
| `creator.lessonEditor.opponentBranchWarning` | `⚠ Đối thủ sẽ chỉ đi {{san}} — các nhánh phụ sẽ không hiển thị cho học viên` | `⚠ Opponent will only play {{san}} — side variations here will not be shown to learners` |
| `guidedPlayer.promotionPickerTitle` | `Chọn quân phong cấp` | `Choose promotion piece` |

## 6. Data Model & Validation

- `lessons.pgn_data` — text, **bumped from 5000 to 50000 char client-side cap** (`MAX_PGN_CHARS` in editor + textarea `maxLength`). No DB constraint exists today; none added. Trees that exceed 50k are deferred to Phase 2.1 follow-up: introduce nullable `lessons.pgn_data_url` pointing at a Supabase Storage object; `LessonEditor` writes to whichever fits. Tree model is unchanged — only the storage path differs.
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
| 1 | **PGN tree parser (recursive-descent tokenizer)** — rewrite `parsePgn.ts` to return `PgnNode` tree per V-02/V-16/V-17; emit `(from, to, promotion)` per node; ship `nodeMap`; preserve `mainLine` view for back-compat. Includes fixture suite of ≥ 10 real-world PGNs (Italian, Najdorf, KID, Caro-Kann, KGD; Lichess + ChessBase exports) committed under `src/utils/__fixtures__/pgn/`. Legacy `moves[]` consumers updated to read `mainLine`. | TBD | — |
| 2 | **GuidedChessPlayer tree navigation** — `currentNodeId` state, `(from,to,promotion)` candidate match per V-13, **`<PromotionPicker />` modal** when multiple candidates differ only by promotion piece, hint of main line, opponent auto-play picks main line, +variation pill. Leaf-completion fires on any path per V-09 + V-18. | TBD | #1 |
| 3 | **Editor variation list + status summary + opponent-branch warning** — collapsible variation panel, click-to-preview, status row suffix; debounced parse (250 ms); inline `⚠ Đối thủ sẽ chỉ đi …` warning at opponent-side branch nodes (§5.3); `MAX_PGN_CHARS` → 50000. | TBD | #1 |
| 4 | **Bookmark `node_id` migration + resolve adapter + backfill script** — DB migration; `resolveBookmark` using `parsed.nodeMap`; `LessonPlayerPage` callers updated; `scripts/backfill_bookmark_node_ids.ts` for best-effort backfill of pre-PRD bookmarks; legacy `node_id IS NULL` rows still resolve. | TBD | #1, #2 |
| 5 | **Author-side smoke + sample lesson** — paste a known Lichess study export (Italian Game with 4 black responses), verify parse + preview + opponent-branch warning + completion via side variation; commit one sample course as fixture for tests. | TBD | #1, #3 |

Total: 5 slices, ~1.5 weeks if delivered serially (estimate revised up from 1 week to absorb the promotion picker, debounce work, fixture suite, and backfill script). #1 unblocks everything.

## 9. Acceptance Criteria

- [ ] `parsePgn('1. e4 e5 2. Nf3')` returns `{ root, mainLine: [e4, e5, Nf3], variationCount: 0, maxDepth: 3 }` and the linear-PGN snapshot matches Phase 1 byte-for-byte.
- [ ] `parsePgn('1. e4 e5 (1...c5 2. Nf3) 2. Nf3')` returns `{ variationCount: 2, maxDepth: 3 }` with `root.children[0].children` containing both `e5` (main) and `c5` (variation) at the right indices.
- [ ] **Promotion test (V-13).** `parsePgn` of a tree with `8. e8=Q (8. e8=N#)` produces two children of the move-7 node sharing `(e7, e8)` but with `promotion: 'q'` and `promotion: 'n'` respectively. In `GuidedChessPlayer`, dragging `e7→e8` opens the promotion picker; choosing N follows the variation, choosing Q follows the main line; choosing R or B (not in candidates) is a no-op (picker re-prompts or dismisses).
- [ ] In `GuidedChessPlayer`, with a basic tree, playing `e2-e4` advances; playing `e7-e5` advances down main line; playing `c7-c5` advances down variation; playing `a7-a6` triggers wrong-move snap-back.
- [ ] Hint at root highlights `e2-e4`. Variation pill `+0 biến` not shown (root has 1 child). At `e4`, hint highlights `e7-e5`; variation pill `+1 biến` is rendered.
- [ ] Reaching a leaf of the `c5` variation fires `onComplete` exactly once.
- [ ] **Leaf-on-learner-turn (V-18).** A tree whose deepest path ends on a node where the *next* side-to-move is the learner still fires `onComplete` (no "your turn" prompt at the leaf).
- [ ] Reset on a tree returns to root, clears wrong-move + hint state.
- [ ] Linear lessons (no `(...)`) behave identically to Phase 1 — all 44 existing player tests pass unchanged.
- [ ] LessonEditor with a tree shows `✓ Đã phân tích PGN · N nước (M nhánh phụ, độ sâu tối đa K)` and a click-to-preview variation list. With no variations, only `· N nước` shows and the variation list is absent.
- [ ] **Opponent-branch warning.** Editor tree containing two children at an opponent-move node renders the inline `⚠ Đối thủ sẽ chỉ đi {san}` row. With one child, the warning is absent.
- [ ] **Editor parse is debounced.** Typing into the textarea does not block input — measured input-to-render gap < 50 ms even on a 30k-char tree (parse runs at most every 250 ms).
- [ ] `MAX_PGN_CHARS = 50000` allows pasting a full Italian Game repertoire with 4 black responses + annotations without truncation. Status row counter renders `{{used}} / 50000`.
- [ ] **Node-id stability across SAN normalisation.** Editing a tree such that the parser emits `Nf3` instead of `Ngf3` (or vice versa) does NOT change `node.id` — IDs hash on `(from, to, promotion)`, not SAN. Bookmark with that `node_id` still resolves.
- [ ] Bookmark with `node_id IS NULL` (Phase 1 row) resolves to the same FEN it would have under Phase 1. Bookmark with `node_id` resolves via O(1) `nodeMap.get`, even when the lesson tree has variations.
- [ ] **Backfill script** runs idempotently against a seeded DB with 50 Phase 1 bookmarks and writes `node_id` for every parseable lesson. Re-running is a no-op.
- [ ] All new strings render in vi and en via i18n; no English leaks into the vi user's screen.
- [ ] Full test suite green; no new test pyramid inversion (parser tests >> player tests >> editor tests). Headline counts: +25 parser tests, +60 player tests, +10 editor tests over Phase 1 baseline.

## 10. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Custom tokenizer mishandles edge-case PGN (NAGs, nested `{ }` inside `(...)`, escape sequences in tag pairs). | Med | Med | Fixture suite of ≥ 10 real-world PGNs (Lichess Studies + ChessBase + a hand-crafted edge-case file) committed before Slice 1 lands. Parser is the source of truth, not `chess.js loadPgn` (V-17). |
| Promotion picker UX clashes with chessboard.js drag-and-drop interaction (e.g. drag fires before picker resolves). | Med | Med | Slice 2 implements picker as a controlled modal that pauses the player state machine until resolved. Picker dismissal = no state change, learner can re-attempt. Add 4+ tests covering Q/R/B/N picks plus dismiss path. |
| Creator pastes a > 50k tree (full Najdorf opening book). | Low | Med | `MAX_PGN_CHARS` enforced at textarea + parser; status row shows `(50000/50000)`. Phase 2.1 follow-up adds `lessons.pgn_data_url` for storage spillover — tree model unchanged. |
| Bookmark `node_id` becomes invalid after a creator edits the tree mid-path. | Med | Low | `resolveBookmark` falls through to legacy ply-walk when `nodeMap.get` returns undefined. Backfill script (§5.4) writes `node_id` eagerly the first time, so the failure mode only triggers on subsequent edits — not on the migration boundary. |
| Creator edits the PGN such that main line and variation swap order. | Med | Low | After backfill (§5.4), bookmarks have a stable `node_id` and survive the swap. For bookmarks that never got backfilled (`node_id IS NULL`), legacy ply-walk lands on the new main line — same behaviour Phase 1 would have shown after a similar edit. Documented as a creator-side edit risk, not a Phase 2 regression. |
| Node-id hash collision across two distinct nodes within one tree. | Low | Low | sha256 prefix of 16 chars = 2^64 keyspace per parent chain; collision needs two different `(from,to,promotion)` tuples hashing same prefix from same parent — astronomically unlikely. Parser asserts unique IDs and throws on collision (defensive). |
| Player completion (V-09 + V-18) fires for trivial side-variations a creator added as throwaway lines. | Low | Low | Intended pedagogical behaviour. If a creator does not want a side variation to count as completion, they should not author it as a variation. |
| Editor stutters on every keystroke when parsing 50k-char trees. | Med | Low | Debounce parse to 250 ms (`useDebouncedValue`) and memoise `VariationList` on `parsed.root` identity (§5.3). Acceptance criterion enforces input-to-render < 50 ms. |
| Branching at opponent-move nodes is silently ignored at runtime (V-08), creator wonders why their side variation never appears. | Med | Low | Editor preview surfaces inline `⚠ Đối thủ sẽ chỉ đi {san}` warning at every opponent-side branch (§5.3). Visible during authoring; the constraint is no longer silent. |
| `variationCount` and `maxDepth` are slow for very deep trees. | Low | Low | Computed once at parse time, O(N) where N = totalNodes. Cached on `PgnParseResult`. |
| `onBookmark` signature change breaks `LessonPlayerPage`. | Med | Low | Slice 4 includes the call-site update. Type system catches missing args at compile time. |

## 11. Decisions

All decisions are inherited from ADR-0004 (V-01 through V-18). No additional PRD-level decisions.

## 12. Open Questions

1. **Editor variation panel default state.** Expanded? Auto-collapse to depth 2? Defer to UX iteration after Slice 3 ships.
2. **Sample lesson fixture.** Which opening do we ship? Italian Game (matches Phase 1 placeholder PGN) is a safe default.
3. **Promotion picker styling.** Reuse existing modal patterns (`Dialog` from shadcn/ui) or a custom popover anchored to the destination square? Decided in Slice 2 alongside implementation.

(Resolved during the design-review revision: parser path → V-17; node-id basis → V-16; promotion handling → V-13 + Slice 2 picker; leaf semantics → V-18; PGN char cap → V-12.)

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
