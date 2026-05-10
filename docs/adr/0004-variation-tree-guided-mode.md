# ADR-0004 — Variation Tree for Guided Chess Lessons

- **Status:** Accepted (merged 2026-05-10)
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
- The “what if Black plays differently?” question — the entire pedagogical point of opening study — cannot be answered in-app.
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
| **V-09** | **Completion** fires `onComplete` when the learner reaches a leaf node along **any** path. Reaching a leaf via a side variation counts as completion, not “stuck”. This is the pedagogical contract: the lesson teaches “if Black plays X, here's how to continue” — completing the X line completes the lesson. |
| **V-10** | The bookmark contract (`onBookmark(playedPlies, currentFen, totalPlies)` from Phase 1) is widened to `onBookmark(currentNodeId, currentFen, depth, totalDepth)`. `bookmarks` table gains a nullable `node_id text` column (migration in this PRD). Existing bookmarks (`node_id IS NULL`) still resolve to the linear ply path for back-compat. |
| **V-11** | `LessonEditor` shows a **variation summary line** in the PGN status row: `✓ Đã phân tích PGN · N nước (M nhánh phụ, độ sâu tối đa K)`. M = count of non-main-line nodes, K = max depth from root. |
| **V-12** | `MAX_PGN_CHARS` is raised from 5000 to **50000** to accommodate realistic repertoire trees. 20000 is too low — a Najdorf or Italian Game export from Lichess Studies / ChessBase commonly lands in the 30–80k range once annotations are included. The textarea `maxLength` attribute and any future server-side validation use the same constant. Trees that exceed 50k are deferred to a Phase 2.1 follow-up that can move large `pgn_data` blobs to a Supabase Storage object referenced by URL — no architectural change to the tree model, only the storage path. |
| **V-13** | Wrong-move detection matches on the tuple `(from, to, promotion)`, not SAN. This avoids `Ngf3` / `Nf3` disambiguation drift between creator-typed SAN and parser-emitted SAN, and crucially handles **under-promotion variations** — a creator can author `e8=N!` as the main line and `e8=Q?` as a side variation; both share `(e7, e8)` and are disambiguated only by the promotion piece. When `from→to` matches multiple children with different promotion pieces, the player MUST surface a promotion picker (Q/R/B/N) before committing the move. |
| **V-14** | The “back” button stays forbidden (D-12). Variation **does not** mean scrubbing — once the learner picks a child node, they can't undo to take a different branch. Reset (existing dialog) is the only way to retry. This keeps the spaced-repetition pressure that motivates D-12. |
| **V-15** | i18n: variation-specific strings (`Có {{n}} biến`, `Đối thủ sẽ đi {{san}}`, `Chú thích biến`) live under the existing `guidedPlayer.*` namespace added in the i18n PR. No new top-level namespace. |
| **V-16** | Node IDs hash on `(parentId, from, to, promotion)`, **not** on SAN. SAN normalisation by `chess.js` (e.g. dropping unnecessary disambiguation, capitalising castling) would silently invalidate bookmark IDs even when the move is unchanged. Hashing on geometric move coordinates is parser-output-stable and exactly aligns with V-13's match key. Hash function: `sha256((parentId || '') + '/' + from + to + (promotion || '')).slice(0, 16)`. |
| **V-17** | The PGN-to-tree parser is a **custom recursive-descent tokenizer that tracks `(...)` paren depth** — not `chess.js loadPgn`. Empirically `chess.js` (all versions through current) parses only the main line and discards content inside parentheses; relying on it would force a rewrite mid-slice. We use `chess.js` only for per-node FEN computation by replaying the path from root. The tokenizer reuses the `(...)` handling already proven in `extractAnnotations`. |
| **V-18** | Leaf-completion (V-09) fires regardless of which side is to move at the leaf. A leaf with the **learner** to move (i.e. the lesson ends mid-move-pair) still fires `onComplete` — creators authoring such trees are explicitly choosing to end the lesson there. UI does not show a “your turn” prompt at a leaf, just the completion check. |
