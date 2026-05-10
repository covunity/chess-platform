# ADR-0004 — Variation Tree for Guided Chess Lessons

- **Status:** Proposed (revised 2026-05-10 after design review)
- **Date:** 2026-05-10
- **PRD:** `docs/prd/0003-variation-tree.md`
- **Unlocks:** D-07 (Phase 1 lock that forbade variation tree in guided mode)
- **Related decisions:** D-08 (annotation `{ }` syntax), D-09 (per-lesson perspective), D-10 (wrong-move snap-back), D-11 (hint via square highlight), D-12 (forward-only — relaxed inside the active branch but learner still cannot freely scrub)

## Context

Phase 1 shipped guided mode as **forward-only linear PGN**. The full set of constraints sits in `GuidedChessPlayer.tsx` + `parsePgn.ts`:

- `parsePgn` strips `{ }` annotations, then calls `chess.loadPgn(stripped)` and reads `chess.history({ verbose: true })`. Output is a flat `PgnMove[]` indexed by ply.
- `GuidedChessPlayer` advances a single `playedPlies` counter. Wrong destination → red square + 1s timeout. Hint highlights the next expected square pair. Opponent auto-plays after 600ms when `playedPlies % 2 !== learnerColor`.
- `LessonEditor` chess tab stores the lesson as a single `pgn_data text` column on `lessons` (migration 003), plus `board_perspective`. The textarea has a 5000-char cap.
- 44 player tests + 24 editor tests — all pass against the linear contract.

This works for endgame studies, tactic lessons, and beginner content. It does **not** work for the platform's competitor-class use case: opening repertoires. Chessable, Lichess Studies, ChessBase, and Chess Tempo all model lessons as PGN trees — main line plus alternative responses for whatever Black might play. Without variations:

- A creator who wants to teach the Italian Game cannot teach the **response to** 4...d6 vs 4...Nf6 vs 4...Bg4. Only one line ships.
- The "what if Black plays differently?" question — the entire pedagogical point of opening study — cannot be answered in-app.
- Creators have to ship multiple separate lessons, one per opponent reply, breaking the linear lesson sidebar.

D-07 (`Guided mode is linear PGN only — no variation tree in Phase 1`) was a deliberate scope cap, not a permanent decision. Phase 2 lifts it.

### What we explored

- **Two-mode toggle on the lesson editor**: creator picks linear or branching at lesson-creation time. *Rejected* — creates two parallel codepaths in player + editor, requires a `mode` column, and forces creators to commit upfront. Industry surveys show no one ships this; tree is always a superset.
- **Tree-only with a flat `moves(parent_id)` table**: each PGN node becomes one row, stored in a separate `lesson_moves` table. *Rejected for Phase 1* — adds a 50–500-row table per lesson, requires recursive CTE for read paths, complicates the editor (creators are used to PGN textareas, not graph builders), and forces a migration of existing `pgn_data`. Postpone if/when we need server-side variation analytics.
- **Tree-as-PGN string**: keep `lesson.pgn_data text`, lean on `chess.js`'s native `loadPgn` which already parses `(...)` SAN comments per the PGN standard. Variations live in the same column; database stays untouched. Editor remains a textarea (creators paste from ChessBase / Lichess study export). Player walks the parsed tree at runtime.

We pick option 3.

## Decision

**Variations live inside the existing `lessons.pgn_data` PGN string. We rewrite `parsePgn` to return a tree (`PgnNode`), and `GuidedChessPlayer` walks that tree with a `currentNodeId` cursor. No DB schema changes for Phase 2 ship.**

### Locked decisions

| Code | Decision |
|------|----------|
| **V-01** | Variation data is **encoded in PGN itself** using the standard `(...)` syntax. No `mode` column on `lessons`, no separate `lesson_moves` table, no DB migration in this scope. |
| **V-02** | `parsePgn` is rewritten to produce a `PgnNode` tree: each node holds `{ id, san, from, to, promotion, fen, moveNumber, side, annotation, children: PgnNode[], parentId }`. The first child of every node is the **main line** by convention; subsequent children are alternatives in PGN appearance order. `promotion` is `'q'|'r'|'b'|'n'|null` — non-null only when the move is a pawn promotion. |
| **V-03** | Linear PGN parses to a tree of degree 1 — one root, each node has at most one child. The legacy linear contract (`moves: PgnMove[]`) is preserved as a derived view (`mainLine: PgnNode[]`) for backwards compatibility with the editor's preview pane and existing tests. |
| **V-04** | The PGN textarea remains the single authoring surface in Phase 2. Creators paste tree PGN exported from ChessBase / Lichess / SCID; the editor parses, previews, and validates it. **No graphical tree-builder** in Phase 2 — that's Phase 3 if creator demand justifies it. |
| **V-05** | The editor's right-side preview pane gets a **collapsible variation list** below the board. Each variation node shows its SAN + indent depth; clicking a node updates the preview FEN + last-move highlight. Annotations on variation nodes render the same as on main-line nodes. |
| **V-06** | `GuidedChessPlayer` navigates by `currentNodeId` instead of `playedPlies`. The cursor walks `currentNode.children[0]` (main-line child) by default. When the learner plays a move that matches **any** child of the current node, that child becomes current. When the move matches no child, it's a wrong move (snap-back, red square — D-10 semantics preserved). |
| **V-07** | **Hint** highlights `currentNode.children[0]` (the main-line continuation). When multiple children exist, an inline pill below the board reads `+N variation${N>1?'s':''}` so the learner knows the lesson teaches alternatives, but hint always points to the main line. |
| **V-08** | When the opponent (auto-played side) is on move at a node with multiple children, the player picks `children[0]` — main line. The editor surfaces a `Coach: opponent will play X` reminder so creators understand alternatives are taught only when the **learner** has the choice. |
| **V-09** | **Completion** fires `onComplete` when the learner reaches a leaf node along **any** path. Reaching a leaf via a side variation counts as completion, not "stuck". This is the pedagogical contract: the lesson teaches "if Black plays X, here's how to continue" — completing the X line completes the lesson. |
| **V-10** | The bookmark contract (`onBookmark(playedPlies, currentFen, totalPlies)` from Phase 1) is widened to `onBookmark(currentNodeId, currentFen, depth, totalDepth)`. `bookmarks` table gains a nullable `node_id text` column (migration in this PRD). Existing bookmarks (`node_id IS NULL`) still resolve to the linear ply path for back-compat. |
| **V-11** | `LessonEditor` shows a **variation summary line** in the PGN status row: `✓ Đã phân tích PGN · N nước (M nhánh phụ, độ sâu tối đa K)`. M = count of non-main-line nodes, K = max depth from root. |
| **V-12** | `MAX_PGN_CHARS` is raised from 5000 to **50000** to accommodate realistic repertoire trees. 20000 is too low — a Najdorf or Italian Game export from Lichess Studies / ChessBase commonly lands in the 30–80k range once annotations are included. The textarea `maxLength` attribute and any future server-side validation use the same constant. Trees that exceed 50k are deferred to a Phase 2.1 follow-up that can move large `pgn_data` blobs to a Supabase Storage object referenced by URL — no architectural change to the tree model, only the storage path. |
| **V-13** | Wrong-move detection matches on the tuple `(from, to, promotion)`, not SAN. This avoids `Ngf3` / `Nf3` disambiguation drift between creator-typed SAN and parser-emitted SAN, and crucially handles **under-promotion variations** — a creator can author `e8=N!` as the main line and `e8=Q?` as a side variation; both share `(e7, e8)` and are disambiguated only by the promotion piece. When `from→to` matches multiple children with different promotion pieces, the player MUST surface a promotion picker (Q/R/B/N) before committing the move. |
| **V-14** | The "back" button stays forbidden (D-12). Variation **does not** mean scrubbing — once the learner picks a child node, they can't undo to take a different branch. Reset (existing dialog) is the only way to retry. This keeps the spaced-repetition pressure that motivates D-12. |
| **V-15** | i18n: variation-specific strings (`Có {{n}} biến`, `Đối thủ sẽ đi {{san}}`, `Chú thích biến`) live under the existing `guidedPlayer.*` namespace added in the i18n PR. No new top-level namespace. |
| **V-16** | Node IDs hash on `(parentId, from, to, promotion)`, **not** on SAN. SAN normalisation by `chess.js` (e.g. dropping unnecessary disambiguation, capitalising castling) would silently invalidate bookmark IDs even when the move is unchanged. Hashing on geometric move coordinates is parser-output-stable and exactly aligns with V-13's match key. Hash function: `sha256((parentId || '') + '/' + from + to + (promotion || '')).slice(0, 16)`. |
| **V-17** | The PGN-to-tree parser is a **custom recursive-descent tokenizer that tracks `(...)` paren depth** — not `chess.js loadPgn`. Empirically `chess.js` (all versions through current) parses only the main line and discards content inside parentheses; relying on it would force a rewrite mid-slice. We use `chess.js` only for per-node FEN computation by replaying the path from root. The tokenizer reuses the `(...)` handling already proven in `extractAnnotations`. |
| **V-18** | Leaf-completion (V-09) fires regardless of which side is to move at the leaf. A leaf with the **learner** to move (i.e. the lesson ends mid-move-pair) still fires `onComplete` — creators authoring such trees are explicitly choosing to end the lesson there. UI does not show a "your turn" prompt at a leaf, just the completion check. |

### Tree shape (TypeScript)

```ts
interface PgnNode {
  id: string                          // sha256((parentId||'') + '/' + from + to + (promotion||'')).slice(0,16) — V-16
  san: string                         // 'e4', 'Nf3', 'O-O', 'e8=Q', etc. (display only — not used for matching)
  from: string                        // 'e2'
  to: string                          // 'e4'
  promotion: 'q'|'r'|'b'|'n'|null     // V-13: only non-null for pawn promotions
  fen: string                         // FEN after this move
  moveNumber: number                  // 1-indexed full-move number
  side: 'w' | 'b'                     // who played this move
  annotation: string | null           // text from { } following this move
  parentId: string | null
  children: PgnNode[]                 // children[0] = main-line continuation
  depthFromRoot: number               // 0 for root, used by bookmark depth + completion checks
}

interface PgnParseResult {
  valid: boolean
  root: PgnNode | null                // null when invalid; sentinel root has no san/from/to (children[0] is move 1)
  totalNodes: number
  variationCount: number              // total non-main-line nodes (sum over all branches)
  maxDepth: number                    // longest path from root to any leaf
  annotations: number                 // total annotation count across the tree
  mainLine: PgnNode[]                 // derived: walk children[0] from root, for editor preview & legacy callers
  nodeMap: Map<string, PgnNode>       // id → node, built once at parse time; consumed by player + bookmark adapter
  error?: string
}
```

### Player state machine

```
State: { currentNodeId: string }                    // the node the learner just played
Initial: { currentNodeId: root.id }                 // root is the starting position (no move played yet)

On learner click (square pair from→to):
  let candidates = currentNode.children.filter(c => c.from === from && c.to === to)
  if (candidates.length === 0) {
    show wrongMove(from)                            // D-10 preserved
  } else if (candidates.length === 1) {
    commit(candidates[0])
  } else {
    // V-13: ambiguity = under-promotion variations sharing (from,to)
    showPromotionPicker(candidates.map(c => c.promotion))
    // on pick: commit(candidates.find(c => c.promotion === picked))
  }

function commit(next):
  setState({ currentNodeId: next.id })
  if (next.children.length === 0) onComplete()     // V-09 + V-18: fires regardless of side-to-move at leaf
  if (next.children[0]?.side opposite of learnerColor) auto-play next.children[0] after 600ms (V-08)

On Hint:
  next = currentNode.children[0]                    // V-07
  show hintSquares(next.from, next.to)

On Reset:
  setState({ currentNodeId: root.id })              // V-14: only way back
```

### Bookmark migration

```sql
-- Migration 0XX: add node_id to bookmarks
ALTER TABLE public.bookmarks
  ADD COLUMN IF NOT EXISTS node_id text;

-- node_id IS NULL → legacy linear bookmark (resolved by ply count, V-10)
-- node_id IS NOT NULL → walk from root.id following the stored path
```

### What does NOT change

- `lessons.pgn_data text` — same column, same row size budget bumped from 5000 to 20000.
- `lessons.board_perspective` — unchanged.
- `lessons.type = 'chess'` — unchanged.
- Wrong-move snap-back UX, hint highlight UX, opponent 600ms delay, reset dialog, coach note pane — all preserved.
- Free-preview flag, lesson sidebar, lesson type tabs — unchanged.

## Consequences

### Positive

- **Zero schema migration to ship variations** for the lesson content itself. Migration only on `bookmarks` (one nullable column).
- **Linear lessons keep working unchanged.** `parsePgn('1. e4 e5 2. Nf3 …')` produces a degree-1 tree; `mainLine` matches the legacy `moves[]` array exactly. Existing `LessonEditor` preview pane reads `mainLine` and is untouched until V-11 adds the variation summary.
- **Authoring leverages existing creator tooling.** Creators export PGN trees from ChessBase / Lichess / SCID and paste — no new editor surface to learn.
- **Player UX is a strict superset.** A learner taking a single course can encounter both linear and branching lessons without context-switching; the branching only manifests when they play an unexpected (but valid-as-alternative) move.
- **Hints stay simple** — always point to main line, even in trees, so the lesson has an opinion about what's "best".

### Negative

- **PGN textarea still has a finite cap.** 50000 chars (V-12) covers realistic repertoire trees from Lichess Studies and ChessBase but a heavily-annotated full-coverage opening book (Najdorf with 6 sub-systems + prose) can still exceed it. Trees that hit the cap are a Phase 2.1 follow-up: spill to a Supabase Storage object referenced from `lessons.pgn_data_url`. The tree model itself does not change — only the storage path.
- **Tree node IDs are content-derived (V-16 hash on `parentId + from + to + promotion`).** Editing a node mid-tree (e.g. swapping `Nf3` for `Bc4` at move 3) invalidates IDs of all downstream nodes on that branch. Mitigation: `resolveBookmark` (PRD-0003 §5.5) falls through to legacy ply-walk when the stored `node_id` is not found, landing the learner at the closest valid main-line position.
- **Custom tokenizer means we own a PGN parser.** V-17 commits to the recursive-descent tokenizer rather than relying on `chess.js`. Edge cases — NAGs (`$1`), nested `{ }` inside `(...)`, escape sequences in tags — are now our problem. Mitigation: parser ships with a fixture suite of 10+ real-world PGNs from Lichess Studies + ChessBase before Slice 1 lands.
- **Test count balloons.** Tree navigation has many shapes: multi-child branches, nested variations, opponent at branch point, promotion picker, leaf-on-learner-turn vs leaf-on-opponent-turn, reset from deep branch, bookmark restore after tree edit. Honest estimate: +60 player tests, +25 parser tests, +10 editor tests over the Phase 1 baseline.
- **Editor preview only shows main line by default.** Creators with deep trees need the V-05 collapsible variation panel to see what they authored — adds editor surface area.
- **Branching at opponent's turn is silently ignored by the player.** V-08 forces opponent to play `children[0]`, so alternatives authored at opponent-move nodes never reach the learner. Creators teaching "what if Black plays X vs Y vs Z" must structure those as **alternatives at the learner's move** in a follow-up node, or ship separate lessons. Mitigation: V-05 editor panel surfaces a `Đối thủ sẽ đi {san}` warning at every opponent-move branch so creators see the constraint while authoring.

### Neutral

- **No engine integration in this PRD.** Stockfish-as-coach (suggesting "the engine prefers this variation") is a separate ADR — variation tree is a prerequisite for it but not coupled.
- **Spaced repetition (FSRS)** can layer on top of node IDs from V-10. Out of scope here, but the bookmark migration enables it.

## Alternatives considered

### A. Two-mode toggle on lesson creation (linear vs branching)
- Pros: linear creators see zero new UI; can't accidentally author broken tree PGNs.
- Cons: `mode text` column on `lessons` (or `is_linear boolean`); two parser codepaths; creators have to commit upfront and migrate later if they change their mind; **no platform we surveyed ships this**.
- **Rejected.** Tree is a superset — degree-1 tree is linear. Hide tree UI when `variationCount === 0` to keep the linear creator's editor unchanged.

### B. Flat `lesson_moves` table
```
lesson_moves(id, lesson_id, parent_id, san, fen, annotation, position)
```
- Pros: server can query "find all lessons teaching the King's Indian Defence move 7"; supports server-side analytics on most-failed nodes.
- Cons: 1 lesson = 50–500 rows; requires recursive CTE on read; migration of existing `pgn_data` strings; editor must become a graph builder OR import-from-PGN-string anyway.
- **Rejected for Phase 2.** Defer to Phase 3 if/when analytics demand it. The migration path from V-01 to a flat-table model is straightforward (parse `pgn_data` → write rows) so no architectural lock-in.

### C. JSON tree column
```
ALTER TABLE lessons ADD COLUMN pgn_tree jsonb;
```
- Pros: structured query (`pgn_tree -> 'children' -> 0 ->> 'san'` works); no parse step on read.
- Cons: divergence from PGN as the lingua franca of chess; creators can't paste from external tools; we'd need an export-to-PGN step for sharing; bookmark IDs still need stable hashing across edits.
- **Rejected.** PGN is the standard interchange. Storing as PGN keeps round-tripping with ChessBase / Lichess trivial.

### D. Rely on `chess.js` `loadPgn` for variation parsing
- Initial design considered using `chess.js loadPgn` (with or without a `permissive` flag) to extract the tree directly.
- Empirical reality: `chess.js` parses only the main line and silently drops content inside `(...)`. The library's `history()` output is a flat array of the first traversed line; nested variations are not represented in any public API.
- **Rejected.** V-17 commits to the recursive-descent tokenizer as the primary parser path. `chess.js` is still used per-node to compute FEN by replaying the path from root — that role is unaffected. This removes the Slice 1 spike risk that the original draft carried.

## Open questions for PRD execution

1. **Editor UX for huge trees.** First 3 levels expanded, rest collapsed? Search-by-SAN? Defer to UX iteration after Slice 1 ships.
2. **PGN export.** When trees grow beyond textarea, do we add a "Download PGN" button? Likely yes, but post-Phase 2.
3. **Promotion picker styling.** Reuse existing chessboard.js modal patterns or a custom popover? Decided in Slice 2 alongside the picker implementation (V-13).

(Resolved during this revision: parser path → V-17; node-id hash basis → V-16; promotion handling → V-13; leaf semantics → V-18; MAX_PGN_CHARS sizing → V-12.)

## References

- Chessable's interactive course player: https://www.chessable.com/blog/how-to-create-a-course/
- Lichess Studies tree model: https://lichess.org/study (any opening study, view source)
- chess.js variation support: https://github.com/jhlywa/chess.js (changelog for `loadPgn` flags)
- PGN standard, section 8.2.5 "Recursive Annotation Variations": http://www.saremba.de/chessgml/standards/pgn/pgn-complete.htm
