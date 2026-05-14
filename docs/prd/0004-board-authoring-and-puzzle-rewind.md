# PRD-0004: Board-Direct Authoring, Visual Annotations & Puzzle Rewind

> Status: **Shipped** · Owner: TBD · Created: 2026-05-14 · Branch: `claude/write-project-prd-vHXxe`
> Phase: **Phase 2.1** — activates `lesson_type = 'puzzle'` (still placeholder per `LessonEditor.tsx:468`)
> Builds on: PRD-0003 (variation tree, shipped 2026-05-10) · ADR-0004 (V-01..V-18)
> Likely ADRs spun out: board-library migration · state-management adoption · shape & rich-note storage
> Source brief: external artifact `1aca7d2e-57a5-43b0-ba0a-4c8a8b9d6b45` — adapted to project.

---

## 1. Problem Statement

Today a creator authoring a chess lesson opens `LessonEditor` → Chess tab and types **PGN text** into a 50 000-char `<textarea>` (`creator/lessonEditor.tabChess`). The right-side pane parses the PGN and renders a static preview board plus a `VariationList`. For the platform's strongest commercial use case — opening repertoires (PRD-0003 §1) — this works, but it locks out three audience-defining capabilities:

1. **Creators who don't write PGN.** Coaches who teach at the board (most chess teachers in Vietnam) cannot author here; they fall back to recording video lessons which lose the interactive differentiator.
2. **Visual coaching.** A real chess lesson is annotated with **arrows** ("White will jump the knight to d5") and **circle markers** ("watch the f7 square"). Our annotation today is a single string in PGN `{ ... }` comments — text only — rendered as `--ink-3` italic below the SAN row. There is no surface for shapes, no colour vocabulary, no way for the learner to see a coach's arrow on the board.
3. **Puzzle mode is unimplemented.** `lesson_type='puzzle'` exists in the enum (migration `003_courses_chapters_lessons.sql:4`), is counted by `coursesApi.ts:138` for the paywall, and is rendered with a `📋` icon in three pages — but the editor tab is a placeholder reading `t('creator.lessonEditor.puzzleComingSoon')` (`LessonEditor.tsx:468`). Learners who reach a puzzle lesson see nothing usable. CLAUDE.md §5 currently defines `puzzle` only as "bookmark-based review — replays a chess lesson from beginning", which is the *Practice* surface, not an authored puzzle.

The variation tree from PRD-0003 already gives us the right *data shape* (a tree of `PgnNode`). What's missing is (a) a way to **build** that tree without typing, (b) **visual annotations** attached to nodes, and (c) a player mode that treats specific branches as **mistakes vs. correct continuations** for puzzles.

## 2. Solution

Land three vertically-aligned capabilities, each behind its own slice, sharing one data model:

1. **Board-direct authoring** in `LessonEditor`. The creator sees **only the board surface** when they open a chess lesson — make moves by clicking or dragging pieces, no PGN string visible anywhere. Every move appends a node to the same tree the PGN parser already produces. PGN remains the **storage format** in `lessons.pgn_data` (serialised on save, parsed on load) but is **never shown** in the default UI. A separate **Advanced** toggle (per-user setting, off by default) reveals a read/write PGN view for power users who want to paste a Lichess Studies / ChessBase export or copy the PGN out — that surface round-trips: board → PGN serialise; PGN → tree parse (existing `parsePgn`).
2. **Shapes & rich notes per node**: arrows (4 colours) and circle markers (4 colours), drawn with right-click / right-click-drag while authoring, attached to the *currently selected node* (not to a board position). Per-node `note` upgrades from a plain `annotation: string` to a structured rich-text JSON (paragraph + bold/italic, no images in Phase 2.1). Both render on the player board in lesson and puzzle modes.
3. **Puzzle Rewind**: a new player mode that activates when `lesson.type = 'puzzle'`. The learner plays only their assigned side; the opponent auto-plays. Variations marked `purpose = 'correct'` are accepted as alternative solutions; variations marked `purpose = 'mistake'` animate the move, surface the creator's note for ~1.5 s, then auto-undo to teach the lesson. Random off-tree moves snap back red (D-10 unchanged). Progressive hints unlock after 2 and 3 wrong attempts at the same node.

D-07 is already lifted. D-08 (PGN `{ }` annotations) is extended — annotations still serialise into PGN comments, but the comment body is JSON. D-10 stays for off-tree moves. D-11 evolves — chessboard.js native highlight is supplemented (not replaced) by the new arrow/circle layer. D-12 (forward-only) stays for both lesson and puzzle play; the new **viewer** mode (passive playback for `type='chess'` lessons when the creator marks them non-interactive) gains its own back/forward arrow controls but is opt-in and is **not** the default for chess lessons.

UI strings vietnamese-first via existing `creator.lessonEditor.*` / `guidedPlayer.*` namespaces. Design-system tokens only; no new shape-colour tokens — Chessground's default green/red/yellow/blue brushes are used as-is (see ADR-0005).

## 3. User Stories

### Creator — board-direct authoring (P1)

1. As a coach who doesn't write PGN, I want to open the lesson editor and see **only the board** (no PGN textarea, no notation strings), so that I can author a chess lesson without ever encountering notation I don't read.
2. As a creator, I want to drag a piece from one square to another to author a move, so that authoring matches how I demonstrate at a physical board.
3. As an **advanced creator**, I want to flip a setting that reveals a PGN view (read-write, side panel or modal) where I can paste a Lichess Studies export or copy the PGN out for backup, so that I can interop with other chess tools. The setting is **off by default** and stored per-user (`users.editor_advanced` boolean) so most creators never see PGN.
4. As a creator, when I author a pawn move to the back rank, I want a promotion-piece picker, so that I can choose Q/R/B/N without rewriting the PGN.
5. As a creator, I want to set a **custom starting position** by either pasting a FEN string or arranging pieces in a board-editor surface, so that I can teach an endgame study or a middlegame from a real game.
6. As a creator authoring a tree, I want to navigate to any existing node by clicking it in the variation list, then add a new move from that position to create a **variation**, so that I can teach alternative responses without rewriting from scratch.
7. As a creator, I want a **delete node** action (deletes the node and all its descendants) and a **promote to main line** action (moves a side variation to `children[0]`), so that I can refactor a tree I built in pieces.
8. As a creator, I want every board-authored change to update the underlying PGN textarea in real time (visible in the PGN tab), so that I can copy the PGN out for backup or sharing.
9. As a creator, I want unsaved changes to survive a tab swap, refresh-prompt confirmation, and the auto-save behaviour the editor already has, so that I don't lose work.

### Creator — visual annotations (P2)

10. As a creator with a node selected, I want to right-click a square to toggle a green circle marker, so that I can highlight a key square ("watch f7").
11. As a creator, I want to right-click-drag from one square to another to draw a green arrow, so that I can show a planned move or a threat.
12. As a creator holding **Shift** while right-click-dragging, I want a red arrow; holding **Alt**, a yellow arrow; holding **Ctrl**, a blue arrow, so that I can colour-code threats vs. plans.
13. As a creator, when I right-click the same square or draw the same arrow a second time, it should be **removed** (toggle behaviour), so that I can undo a shape without an undo button.
14. As a creator, shapes attach to the currently selected **node** (not the current FEN), so that they reappear whenever the lesson plays through that node — including when the learner takes the same node via a different parent path.
15. As a creator, I want to type a per-node **note** in a side panel with basic rich-text controls (bold, italic, paragraph), so that I can explain "Why this move?" in more than one sentence.
16. As a creator, all node-level shapes and notes save into `lessons.pgn_data` as structured PGN comments, so that PGN export still round-trips (a creator can copy the PGN, paste it back, and get the same lesson).
17. As a creator, I want a quick **preview as learner** toggle that hides the editor chrome and plays the lesson exactly as a learner would see it (lesson or puzzle mode based on `lesson.type`), so that I can verify before submitting for review.

### Creator — puzzle authoring (P3)

18. As a creator authoring a puzzle (`lesson.type = 'puzzle'`), I want to declare which side the learner plays (`playerSide: 'white' | 'black'`), so that the player knows which moves to expect from them.
19. As a creator, I want to mark a variation node as `purpose = 'correct'` (an acceptable alternative solution) or `purpose = 'mistake'` (an intentional misplay to teach against), so that the puzzle player handles them differently.
20. As a creator, I want a node marked `purpose = 'mistake'` to require a non-empty note, so that the learner sees a coaching explanation when they fall into the mistake branch.
21. As a creator switching a lesson from `type='chess'` to `type='puzzle'` and back, I want all node data (moves, shapes, notes) preserved, so that I can experiment with the format without re-authoring.

### Learner — chess lesson (existing, evolved) (P4)

22. As a learner playing a chess lesson, I want to see the creator's arrows and circle markers on the board for the current node, so that I receive the same visual coaching the creator drew.
23. As a learner, I want the creator's rich-text note for the current node rendered in a side panel (where the existing move-log annotation already sits), so that I can read the explanation in full.
24. As a learner, when I leave a lesson mid-way, I want to return and resume at the exact node I left, so that I don't have to replay from the start every session.
25. As a learner with a Phase 1 plain-text annotation, I want it to still render correctly, so that legacy lessons don't visually regress on annotation upgrade.

### Learner — puzzle (P5)

26. As a learner opening a puzzle lesson, I want to see a "Lượt của bạn" prompt indicating the player side, and the opponent's first move already played if the puzzle starts on the opponent's turn, so that I can immediately make my move.
27. As a learner, when I play the **main-line correct move**, I want the move to play and the opponent to auto-respond after a short delay, so that I progress through the puzzle.
28. As a learner, when I play a move that matches a variation marked `purpose = 'correct'`, I want it to be accepted exactly like the main line, so that I learn there can be more than one good answer.
29. As a learner, when I play a move that matches a variation marked `purpose = 'mistake'`, I want the piece to move to the new square, a creator-authored note to show for ~1.5 s, and then the move to undo back to my decision point, so that I learn *why* it was wrong without being kicked out of the puzzle.
30. As a learner, when I play any other move (not in the tree at all), I want the existing snap-back + red square (~1 s) (D-10), so that the player tells me "no, try again" without judgement.
31. As a learner stuck at a decision node, after my **second wrong attempt** I want the origin square of the main-line move highlighted, so that I know which piece to consider.
32. As a learner still stuck, after my **third wrong attempt** I want a faint arrow from origin to destination of the main-line move, so that I can see the solution but still play it myself.
33. As a learner solving a puzzle, I want my completion to record the number of wrong attempts and time taken, so that my progress (and a possible "best attempt" stat) shows on my dashboard later.
34. As a learner who already solved a puzzle, I want to see my **best wrong-attempt count** when I revisit, so that I have a reason to retry for a clean run.
35. As a learner finishing a puzzle by reaching the last main-line move, I want a "Hoàn thành" panel with optional retry, so that I have a clear finish line.

### Learner — passive lesson viewer (P6, opt-in)

36. As a learner playing a **non-interactive** lesson (creator opted into "watch mode"), I want forward/back arrow buttons and ←/→ keyboard navigation through the move tree, so that I can study the lesson at my pace without having to play the moves.
37. As a learner in viewer mode, I want the board in `viewOnly` state (no drag, no hover-highlights) and shapes/notes to render exactly as in interactive mode, so that the experience is a watchable presentation.

### Admin / cross-cutting (P7)

38. As an admin reviewing a submitted chess or puzzle lesson, I want the same preview UI the creator sees (board + variation list + shapes + notes + puzzle role markers), so that I can review without a separate admin tool.
39. As an admin, I want a creator's invalid PGN, missing note on a `purpose='mistake'` node, or missing `playerSide` on a puzzle to **block submit-for-review**, so that I never receive an unfinished lesson.

## 4. Implementation Decisions

### 4.1 Storage — PGN remains the source of truth

- `lessons.pgn_data` (text) keeps its role as the canonical store. **No new column on `lessons`** for shapes/notes/puzzle metadata in Phase 2.1.
- Shapes, rich-text notes, and per-node `purpose` ride inside the existing PGN `{ ... }` comment slots that `parsePgn` already attaches to nodes. Comment body becomes a small structured payload (JSON-in-PGN-comment) with a discriminator prefix so legacy plain-text annotations are still recognised — see §4.5.
- `lesson.type` (existing `lesson_type` enum: `video | chess | puzzle`) is the only field that distinguishes interactive lesson, puzzle, and viewer modes. **Viewer mode** is *not* a fourth enum value — it is a per-lesson boolean (new column `is_view_only boolean default false`) on `type='chess'` lessons.
- **Puzzle metadata** (`playerSide`) lives in a new column on `lessons`: `puzzle_player_side text check (puzzle_player_side in ('white','black')) null`. NULL for non-puzzle lessons; required (via app-layer validation) for `type='puzzle'`. Justified as a top-level column rather than burying it in PGN tag pairs because the player needs it before parsing PGN to decide whether to auto-play the first move.
- Starting position: `lessons.starting_fen text null` — when set, replaces `STARTING_FEN` in player + editor. Validated server-side via a Postgres `CHECK` on regexp shape; full chess-legality validation stays client-side (chess.js).

### 4.2 Data model — extend `PgnNode`, don't replace it

The current `PgnNode` (parsePgn.ts:21–34) gains three optional fields. The parser learns to read them out of `{ ... }` comments; the serialiser (new — see §4.4) learns to write them back.

- `note: RichTextDoc | null` — replaces the existing `annotation: string | undefined`. Legacy plain-string comments deserialise to a single-paragraph `RichTextDoc`. JSON shape mirrors a minimal subset of ProseMirror schema (`{ type: 'doc', content: [{type: 'paragraph', content: [{type:'text', text, marks?: [{type:'bold'|'italic'}]}]}] }`).
- `shapes: Shape[]` — `Shape = { kind: 'circle', square: 'a1'..'h8', color: 'green'|'red'|'yellow'|'blue' } | { kind: 'arrow', from: 'a1'..'h8', to: 'a1'..'h8', color: 'green'|'red'|'yellow'|'blue' }`. Defaults to `[]`.
- `purpose: 'correct' | 'mistake' | null` — `null` on the main line and on most variations (treated as `correct` in puzzle mode); explicit `'correct'` makes an authored alternative solution; explicit `'mistake'` marks an instructive misplay. Only meaningful when the containing lesson is a puzzle.

`PgnParseResult` gains:
- `hasShapes: boolean` (any node has a non-empty `shapes`)
- `mistakeNodes: PgnNode[]` (so the editor can quickly flag missing notes)

Node-id hashing (V-16) is unchanged — IDs still hash on `(parentId, from, to, promotion)`. Shapes/notes/purpose are *content* of the node, not identity.

### 4.3 Modules

| Module | New / Modified | Surface |
|---|---|---|
| `BoardAuthoringSurface` | **New** (`src/components/LessonEditor/BoardAuthoring/`) | Interactive board (via `ChessgroundView`) + variation list + node detail panel. The **default and only authoring surface** for non-advanced creators — replaces the current PGN textarea outright. Drives `ChessgroundView` in **edit mode**: `drawable.enabled = true` so right-click/right-click-drag with Shift/Alt/Ctrl produces shapes natively; `movable.color = 'both'` so creator can move any piece; `onShapesChange` and `onMove` callbacks dispatch into `treeStore`. The PGN textarea is no longer the primary surface (gated behind the Advanced toggle, §4.10). |
| `BoardEditor` (FEN/position setup) | **New** (`src/components/LessonEditor/BoardEditor/`) | Piece palette + click-to-place + FEN paste-in + side-to-move + castling rights checkboxes. Returns a validated FEN. |
| `RichNoteEditor` | **New** (`src/components/RichNoteEditor/`) | Thin wrapper over **TipTap** (decision below) configured to the doc/paragraph/bold/italic subset of §4.2. |
| `parsePgn` | **Modified** (`src/utils/parsePgn.ts`) | Comment body recognises JSON payload, otherwise treats as legacy plain-text annotation. Emits `shapes`, `note`, `purpose`, plus new aggregate fields. |
| `serializePgn` | **New** (`src/utils/serializePgn.ts`) | Walks a tree back into a PGN string (main line + `(...)` variations + `{ ... }` comments embedding JSON payload). Round-trips: `parse(serialize(tree)) ≡ tree`. |
| `treeStore` | **New** (`src/components/LessonEditor/treeStore.ts`) | Zustand store holding `{ tree, currentNodeId, dirty, applyMove, deleteSubtree, promoteVariation, setShapes, setNote, setPurpose, undo, redo }`. CLAUDE.md §2 trigger met: ≥ 4 unrelated components (board, variation list, note editor, shape toolbar, hidden PGN view) coordinate on the same tree. |
| `ChessgroundView` | **New** (`src/components/ChessBoard/ChessgroundView.tsx`) | Thin React wrapper over Chessground. Props: `fen`, `orientation`, `lastMove`, `selected`, `viewOnly`, `drawable` (enabled + autoShapes for read-only nodes), `movable` (drag-permissions for the active side), and event callbacks (`onMove`, `onShapesChange`, `onSquareSelect`, `onPromotion`). Owns a Chessground instance via `useEffect` diff. **Replaces** every current `<Chessboard>` (`react-chessboard`) call site: `ChessBoard.tsx`, `MiniBoard.tsx`, `GuidedChessPlayer`'s `InteractiveBoard`. Native arrows/circles, modifier-key vocabulary, touch drawing, and `viewOnly` come from Chessground; we add no overlay code. |
| `GuidedChessPlayer` | **Modified** | Splits into 3 modes by `mode: 'lesson' \| 'puzzle' \| 'viewer'`. Lesson mode unchanged behaviour. Puzzle mode adds purpose-aware candidate routing + mistake animation + progressive hint counter. Viewer mode disables drag and adds back/forward controls. |
| `PuzzleAttemptRecorder` | **New** (`src/lib/puzzleAttemptApi.ts`) | Records `wrong_attempts`, `duration_seconds`, `completed_at` to a new `puzzle_attempts` table; updates a learner's `best_wrong_attempts` for the lesson. |
| `LessonProgressResumeApi` | **Modified** (`src/lib/lessonPlayerApi.ts`) | New `last_viewed_node_id` column on `lesson_progress`; debounced 2 s save during play; restored on load. |
| `LessonEditor` | **Modified** | Adds "Bảng" tab; routes puzzle-type lessons to the new `PuzzleEditorPanel`; surface-level wiring only — most logic moves into the modules above. |
| `PuzzleEditorPanel` | **New** | `playerSide` picker + per-variation `purpose` selector + missing-note warnings. |
| `AdvancedPgnPanel` | **New** (`src/components/LessonEditor/AdvancedPgnPanel/`) | Read/write PGN textarea, gated by `users.editor_advanced`. Off by default. Same `parsePgn` / `serializePgn` round-trip as the board surface. Surfaces a one-line "Tab này dành cho người dùng nâng cao" hint. |
| `validateLessonForReview` | **New** (`src/lib/lessonValidation.ts`) | Pure function: given a parsed tree + lesson row, returns `string[]` of i18n keys for blockers (no `playerSide`, mistake without note, etc.). Called by editor before "Submit for review". |

### 4.4 Round-trip serialisation

PGN textarea ↔ tree must round-trip without lossy edits. Decisions:

- The hidden PGN string written by `serializePgn` is normalised: SAN from `chess.js`, single space between tokens, comments in `{ … }` immediately after the move they annotate, variations as `( … )` after the parent move.
- For each node, a `{ … }` comment is emitted if and only if `note ≠ null` **or** `shapes.length > 0` **or** `purpose ≠ null`. Comment body is `[gambitly:v1]` prefix followed by a compact JSON literal `{"n":<note>,"s":[...],"p":"correct"|"mistake"}` with omitted keys when fields are unset. The prefix lets `parsePgn` distinguish a structured comment from a legacy free-text annotation; legacy comments deserialise as `{note: {doc with single paragraph of the original text}, shapes: [], purpose: null}`.
- A user who types prose into the PGN textarea inside `{ ... }` (the Phase-1 way) still works: the parser treats unprefixed comments as legacy text.

### 4.5 Database changes

- **Migration `040_lesson_authoring_fields.sql`**:
  - `ALTER TABLE lessons ADD COLUMN starting_fen text NULL` (CHECK regexp for FEN shape).
  - `ALTER TABLE lessons ADD COLUMN puzzle_player_side text NULL CHECK (puzzle_player_side IN ('white','black'))`.
  - `ALTER TABLE lessons ADD COLUMN is_view_only boolean NOT NULL DEFAULT false`.
- **Migration `041_lesson_progress_last_node.sql`**:
  - `ALTER TABLE lesson_progress ADD COLUMN last_viewed_node_id text NULL`.
- **Migration `042_puzzle_attempts.sql`** (new table):
  - `puzzle_attempts (user_id uuid, lesson_id uuid, wrong_attempts int, duration_seconds int, completed_at timestamptz, primary key (user_id, lesson_id, completed_at))`.
  - View `puzzle_best_attempt` derives `min(wrong_attempts)` per `(user_id, lesson_id)` for the learner dashboard.
  - RLS: learner can SELECT own rows; INSERT own rows; admin SELECT all.
- **Migration `043_users_editor_advanced.sql`**:
  - `ALTER TABLE users ADD COLUMN editor_advanced boolean NOT NULL DEFAULT false`.
  - Per-user flag controlling whether the PGN view in `LessonEditor` is reachable (§4.10).
- **No** change to `lessons.pgn_data` shape (still text), `bookmarks`, `account_tiers`, or `orders`.

### 4.6 Library decisions

- **Board library — migrate to Chessground.** Current code is on `react-chessboard ^5.10.0`, used only for drag-and-drop + piece graphics. The artifact's full feature set (4-colour arrows + circle markers, right-click + Shift/Alt/Ctrl modifier vocabulary, `viewOnly` mode, native touch drawing) maps **one-to-one** onto Chessground's built-in surface — Chessground is the library Lichess Studies uses, which is the artifact's reference platform. Hand-rolling these on top of `react-chessboard` would mean ~300–500 lines of SVG-overlay + right-click capture + modifier-key state machine + touch-gesture code that already exists, debugged, in Chessground.
  - Migration is small: the board is referenced from exactly three places (`ChessBoard.tsx`, `MiniBoard.tsx`, `GuidedChessPlayer`'s `InteractiveBoard`). We write one thin React wrapper (`ChessgroundView`, §4.3 — ~50 lines, `useEffect`-driven imperative diff onto the Chessground instance) and replace each call site. `react-chessboard` is removed from `package.json`.
  - CSS: ship Chessground's default brown theme (`chessground.base.css` + `chessground.brown.css`) and default brush colours (green/red/yellow/blue) verbatim. No custom `--board-dark` / `--board-light` overrides in this scope; design has not invested in custom board chroma, and matching the Lichess look is itself a reasonable brand choice. Custom theming (board + pieces + brushes) is deferred to Phase 3 if a learner-facing theme picker is ever scoped.
  - Promotion: reuse the existing `PromotionPicker.tsx` UI — Chessground's `promotion` callback drives it.
  - This lands in Slice 0 alongside the migrations and ADRs. **ADR-0005** captures the migration rationale (was previously the "overlay-vs-migrate" trade-off; now records the decision and the rejected overlay path so future readers see why).
- **State management — Zustand**. CLAUDE.md §2 explicitly lists "chess board state needs to be shared across multiple unrelated components" as the trigger for introducing a library, and prefers Zustand. This PRD's `treeStore` is exactly that trigger. Write `docs/adr/0006-zustand-for-editor-state.md` explaining the scope (editor-only; lesson player and puzzle player stay on local state because their tree is read-only once parsed).
- **Rich-text editor — TipTap**. Smaller bundle than Lexical for our 4-mark feature surface; first-class React bindings; the editor schema we need (doc/paragraph/text + bold/italic) is the TipTap "starter kit" minus everything we don't ship. No ADR — choice is reversible; documented in §4.3 only.

### 4.7 Player flow — puzzle mode

`GuidedChessPlayer` with `mode='puzzle'` does the following at every learner move:

1. Compute candidate children of `currentNode` matching `(from, to, promotion)` (V-13 mechanism, reused).
2. **No candidate** → existing wrong-move snap-back (D-10). Increment `wrongAttemptsAt[currentNodeId]`. If counter ≥ 2 and `hintLevel < 1`, set `hintLevel = 1` (origin square highlight on the *main-line* `children[0]`). If counter ≥ 3, set `hintLevel = 2` (faint arrow from origin to destination).
3. **Candidate with `purpose === 'mistake'`** → animate the move (set `currentNodeId` to that child, board updates), display the node's note in an overlay banner for `1500 ms`, then revert `currentNodeId` back to the parent. **Do not** count this as a wrong attempt for the hint counter (the creator authored it as a teachable moment, not a mistake-to-punish). Surface a `data-testid="puzzle-mistake-banner"` for tests.
4. **Candidate with `purpose === 'correct'` OR on main line** → accept, advance, auto-play opponent's main-line response after `OPPONENT_DELAY_MS` (existing constant). Reset `wrongAttemptsAt[parentId]` and `hintLevel`.
5. **Leaf reached on the main line OR a `correct` variation** → `onComplete` fires once, record `puzzle_attempts` row with `wrong_attempts = sum of wrongAttemptsAt`, `duration_seconds = elapsed`. (Reaching a leaf on a `mistake` branch cannot happen because we always revert.)

Hint level is local state, not persisted (a new session restarts at `hintLevel = 0`).

### 4.8 i18n

New keys under existing namespaces. Vietnamese strings inline.

| Key | vi |
|---|---|
| `creator.lessonEditor.tabBoardAuthoring` | `Bảng` |
| `creator.lessonEditor.tabPgnAdvanced` | `PGN (nâng cao)` |
| `creator.lessonEditor.advancedTabHint` | `Tab này dành cho người dùng nâng cao — sửa trực tiếp PGN` |
| `creator.lessonEditor.importFromPgn` | `Nhập từ PGN` |
| `creator.lessonEditor.importFromPgnModalTitle` | `Dán PGN từ Lichess hoặc ChessBase` |
| `profile.editorAdvancedToggleLabel` | `Trình soạn nâng cao (hiện tab PGN)` |
| `profile.editorAdvancedToggleHelp` | `Hiển thị tab PGN bên cạnh bàn cờ khi soạn bài học. Tắt nếu bạn chỉ muốn soạn trên bàn cờ.` |
| `creator.lessonEditor.startingPositionLabel` | `Vị trí bắt đầu` |
| `creator.lessonEditor.startingPositionFromFen` | `Dán FEN` |
| `creator.lessonEditor.startingPositionFromEditor` | `Chỉnh bàn cờ` |
| `creator.lessonEditor.shapeToolbarHint` | `Chuột phải: vẽ vòng tròn · Kéo chuột phải: vẽ mũi tên · Shift/Alt/Ctrl đổi màu` |
| `creator.lessonEditor.deleteSubtree` | `Xóa nước này và các nhánh con` |
| `creator.lessonEditor.promoteVariation` | `Đưa nhánh này thành chính` |
| `creator.lessonEditor.puzzlePlayerSideLabel` | `Học viên chơi quân` |
| `creator.lessonEditor.puzzlePurposeCorrect` | `Đáp án đúng` |
| `creator.lessonEditor.puzzlePurposeMistake` | `Sai lầm dạy học` |
| `creator.lessonEditor.mistakeMissingNoteWarning` | `Nước sai lầm cần có ghi chú giải thích` |
| `creator.lessonEditor.previewAsLearner` | `Xem như học viên` |
| `guidedPlayer.puzzleYourTurn` | `Lượt của bạn — bạn chơi {{side}}` |
| `guidedPlayer.puzzleMistakeBanner` | `Đó là sai lầm — quay lại nước trước` |
| `guidedPlayer.puzzleCompleteTitle` | `Hoàn thành!` |
| `guidedPlayer.puzzleCompleteWrongAttempts` | `Số lần sai: {{count}}` |
| `guidedPlayer.puzzleCompleteBest` | `Lần tốt nhất: {{count}} sai` |
| `guidedPlayer.viewerNextMove` | `Nước sau` |
| `guidedPlayer.viewerPrevMove` | `Nước trước` |

`en.json` keys are added but English shipping is out of scope per D-02.

### 4.10 Advanced PGN access — hidden by default

The PGN textarea is **not** a tab in the editor by default. Default creator UX in the chess lesson editor is exactly one surface: the board.

- A user-scoped boolean `users.editor_advanced` (default `false`) gates the PGN view.
- Toggle lives in **Profile / Settings** under "Trình soạn nâng cao" — not inside the editor itself, to keep editor chrome minimal.
- When `editor_advanced = true`, the editor renders a second tab "PGN" next to "Bảng". The PGN tab is read/write, uses the same `parsePgn` / `serializePgn` round-trip, and shows a hint line: "Tab này dành cho người dùng nâng cao — sửa trực tiếp PGN."
- Import-from-PGN as a one-shot action (paste, parse, dismiss) is exposed as a **separate** menu item "Nhập từ PGN" available to **all** creators (advanced or not) — it pops a modal, pastes, parses, replaces the current tree on confirm, then closes. Closing the modal never leaves the creator on a PGN screen.
- The Advanced toggle changes only editor chrome — no schema or PGN-data difference between advanced and non-advanced users.

### 4.9 Public-side surfaces (no scope creep)

- `CourseDetailPage.tsx:435` already treats `chess` and `puzzle` identically for lesson-type icons; no change needed.
- `LearnerDashboardPage` will eventually surface "best wrong attempts" once the dashboard PRD takes that on. **Out of scope here** — this PRD only writes the `puzzle_attempts` row.
- `PracticePage` (bookmark-based review) is **unchanged**. Puzzles and Practice are distinct concepts (D-12, CLAUDE.md §5); this PRD keeps them apart.

## 5. Testing Decisions

### 5.1 What makes a good test for this work

Test the **public, observable behaviour** of each module — what a creator or learner sees and what the database ends up storing — not the internal state machine of the editor or the shape of intermediate React hooks. Two prior-art examples in this codebase:

- `src/utils/__tests__/parsePgn.test.ts` (PRD-0003) tests parser **outputs** against fixture PGNs, not the recursive-descent tokenizer's internal stack. We follow that pattern for `serializePgn` and the extended `parsePgn`.
- `src/components/GuidedChessPlayer/__tests__/*` tests via `@testing-library/react` — simulate clicks/drags and assert board state + emitted callbacks. We extend with right-click events for shape capture and a new puzzle-mode suite that drives a fixture puzzle through correct/mistake/wrong paths.

What we do **not** test: the Zustand store in isolation (test it through the editor's UI), TipTap's text-editing behaviour (it's a library), Chessground's `cg-shapes` SVG output pixel-by-pixel (assert shape data presence on the node, not pixel coordinates — Chessground owns the rendering).

### 5.2 Modules with dedicated test files

| Module | Test file | Headline assertions |
|---|---|---|
| `parsePgn` (extended) | `src/utils/__tests__/parsePgn.test.ts` (extend) | Structured-comment payload round-trips; legacy plain-text comment still becomes `note` with one paragraph; `purpose='mistake'` flows out and back in; mistake-node aggregate is correct. |
| `serializePgn` | `src/utils/__tests__/serializePgn.test.ts` (new) | `parse(serialize(tree)) ≡ tree` over a fixture suite of ≥ 8 trees (linear, single variation, nested variations, with notes, with shapes, with mistakes, with custom starting FEN, full repertoire). |
| `BoardAuthoringSurface` | `__tests__/BoardAuthoringSurface.test.tsx` (new) | Click + drag to play a move appends a node; right-click toggles a circle; right-click-drag with Shift draws a red arrow; delete-subtree removes node + descendants; promote-variation reorders `children`. |
| `BoardEditor` | `__tests__/BoardEditor.test.tsx` (new) | Drag king to e1 + paste partial FEN + toggle castling-rights produces a valid FEN; invalid arrangements (two white kings, king in check from same side) show error. |
| `RichNoteEditor` | `__tests__/RichNoteEditor.test.tsx` (new) | Bold/italic toggle, paragraph split, serialise to the RichTextDoc shape; deserialise legacy plain string. |
| `GuidedChessPlayer` (puzzle mode) | `__tests__/GuidedChessPlayer.puzzle.test.tsx` (new) | Main-line correct → advance; `purpose='correct'` variation → advance; `purpose='mistake'` → banner appears, board reverts in 1500 ms (use fake timers); off-tree → snap-back (existing); hint level escalates at 2nd and 3rd wrong; completion records a `puzzle_attempts` row via mocked API. |
| `GuidedChessPlayer` (viewer mode) | `__tests__/GuidedChessPlayer.viewer.test.tsx` (new) | Board is `viewOnly` (drag does nothing); ←/→ keys navigate one ply; "Nước sau" button on a leaf is disabled; shapes/notes render identically to lesson mode. |
| `validateLessonForReview` | `__tests__/lessonValidation.test.ts` (new) | Puzzle without `playerSide` → blocker; mistake node without note → blocker; well-formed lesson → no blockers; backwards-compat: legacy chess lesson with no shapes → no blockers. |
| `puzzleAttemptApi` | `puzzleAttemptApi.test.ts` (new) | Insert against an in-memory Supabase mock; idempotent re-record on completion. |
| `LessonProgressResumeApi` | `lessonPlayerApi.test.ts` (extend) | Save debounced 2 s; restore returns correct `last_viewed_node_id`. |

We extend the existing `parsePgn` fixture suite (`src/utils/__fixtures__/pgn/`) with 4 new files: a puzzle with mistakes, a lesson with shapes, a custom-FEN endgame, and a lesson with rich-text notes containing all supported marks.

### 5.3 Manual / E2E coverage

One Playwright spec under `e2e/`: creator authors a puzzle (drag a move, mark a mistake, write a note, save), learner opens it, plays the wrong move once (hint off), again (origin highlight), again (arrow), then the correct main-line move, and sees the completion banner. This guards the full vertical and is the only feature this complex that we'd want regression coverage for end-to-end.

### 5.4 What we explicitly do NOT cover with tests

- The TipTap editor's own text-input behaviour.
- Chessground's `cg-shapes` SVG render at the pixel level (just that `currentNode.shapes` data is correct + a smoke-test that Chessground produced shape elements — Chessground itself is upstream-tested).
- The Zustand store outside the editor's rendered tree.

## 6. Out of Scope

Carried over from PRD-0003 §3 plus newly explicit deferrals:

- ❌ Spaced-repetition scheduling on puzzles (FSRS). Phase 3 — needs a separate PRD.
- ❌ Engine integration (Stockfish suggestions, eval bar, "your move was the engine's 2nd choice"). Phase 3.
- ❌ Voice-over recording per node. Phase 3.
- ❌ Per-lesson timer / "beat the clock" puzzle variant. Phase 3.
- ❌ Image upload in rich-text notes. Phase 3 — needs Storage policy + size cap.
- ❌ Custom piece sets beyond Cburnett (Chessground's default). Phase 3 — would be a creator/learner preference setting.
- ❌ Public Creator profile (D-16).
- ❌ Server-side PGN validation (Phase 1 chose client-side parser as source of truth). Stays client-only.
- ❌ A graphical tree-builder for *non-board* tree edits (e.g., a flowchart view). Editor offers board + PGN; no third surface.
- ❌ Multiple-correct-answer puzzles where the learner must find **all** good moves before continuing (current model: any one accepted `purpose='correct'` or main-line move advances).
- ❌ Animated arrows / drawing replays. Shapes are static per node.
- ❌ Export PGN with embedded shapes/notes to a format other tools can read (our `[gambitly:v1]` prefix is intentionally non-standard).
- ❌ Lessons authored by multiple creators (collaborative editing). Single-author only.

## 7. Further Notes

### 7.1 Backwards compatibility

- Every Phase-1 and PRD-0003 lesson must continue to play with **zero data migration**. The parser change is additive (structured comments) and the unstructured comment path is preserved. The `node.annotation` (string) → `node.note` (RichTextDoc) field rename is wrapped in a deprecation shim that exposes both during Phase 2.1; remove the shim after one minor release.
- Existing `bookmarks.node_id` keeps working (V-16 ID hash unchanged).
- Existing E2E specs touching the chess lesson player must pass unchanged with `mode='lesson'`.

### 7.2 CLAUDE.md updates this PRD will produce

After ship:

- §5 "Lesson types" — update `puzzle` description from "bookmark-based review" to the new puzzle-rewind definition; move bookmark-based review under a separate "Practice" entry (already exists in the codebase as `PracticePage` but undocumented).
- §6 — add new D-21 through D-25 row for the decisions above (board-direct authoring co-exists with PGN; shapes attached to nodes; instructive-mistake semantics; viewer mode is opt-in per lesson; Zustand introduced for editor only).
- §8 "Chess Board — Critical Implementation Notes" — note that the board library is Chessground (per ADR-0005); shapes are rendered natively by Chessground's `cg-shapes` SVG, not by an in-repo overlay; document the right-click + modifier-key vocabulary so anyone working on the player knows not to capture right-click for context menus on the board area.

### 7.3 Công việc phát sinh (incidental work)

Work this PRD requires that is **not itself part of the new feature**:

1. **ADR-0005**: migrate board library from `react-chessboard` to `chessground`. Records the migration decision, the rejected SVG-overlay alternative, and the CSS-token bridging approach. ~1 page; ships in slice 0.
2. **ADR-0006**: Zustand for editor state. ~1 page; ships in slice 0.
3. **Migration 040 / 041 / 042 / 043**: schema additions (§4.5). Includes RLS for `puzzle_attempts`.
3a. **Chessground CSS integration.** Pull `chessground/assets/chessground.base.css` + `chessground.brown.css` verbatim. Use Chessground's default brushes (green/red/yellow/blue) for the four learner shape colours — no custom `--shape-*` tokens needed. Custom theming deferred to Phase 3.
3b. **Remove `react-chessboard`** from `package.json` after slice 0 lands. Add `chessground` (+ `@types`/types as needed).
4. **Backfill of `lesson_progress.last_viewed_node_id`**: not strictly needed (column is nullable; learners just get a fresh start), but a one-off script can populate from `bookmarks.node_id` for power users.
5. **Type generation**: regenerate `src/types/supabase.ts` after migrations (`npm run db:types`).
6. **Right-click suppression**: Chessground already suppresses the OS context menu inside the board region when `drawable.enabled = true`. No app-level `oncontextmenu` handler needed; the only caveat is to **not** stack a wrapper that re-enables the browser default on the board container.
7. **Touch-device parity**: Chessground has native touch support for drag-and-drop and drawing (long-press → drag for shapes). For Phase 2.1 we still display a **"desktop recommended" advisory** on the creator editor because the rich-note editor (TipTap) is desktop-first; the board portion itself is touch-capable. Phase 3 revisits the rich-note editor for mobile.
8. **Sample puzzle fixture course**: one course with 5 puzzles (mate-in-1, mate-in-2, tactical fork, instructive mistake, custom-FEN endgame) committed alongside the seed data, used as fodder for E2E + manual review and as a first-week onboarding example for creators.
9. **`creator.lessonEditor.puzzleComingSoon` string + the dead-end placeholder**: delete (it is the marker for the gap this PRD closes).
9a. **Remove the current PGN textarea** from the default chess-lesson editor flow. The textarea moves into `AdvancedPgnPanel` (slice 6) and is reachable only when `users.editor_advanced = true`. Existing tests asserting on the textarea presence (e.g., `LessonEditor.test.tsx` checking `creator.lessonEditor.pgnPlaceholder`) get rewritten or moved into the advanced-mode suite.
10. **`PaywallSheet.puzzle_count` rendering**: already counted in `coursesApi.ts:138`; verify the paywall copy still reads correctly when puzzle_count > 0 (likely fine — no code change).
11. **i18n review**: ensure all new keys land in `vi.json` first per D-02; English-only contributors gated by reviewer checklist.

### 7.4 Slice plan (suggested, finalised on triage)

| # | Slice | Depends on |
|---|---|---|
| 0 | **ADRs + migrations + Chessground swap.** Land ADR-0005 (Chessground migration), ADR-0006 (Zustand), migrations 040/041/042/043. Ship `ChessgroundView` wrapper + replace the three `react-chessboard` call sites (`ChessBoard.tsx`, `MiniBoard.tsx`, `GuidedChessPlayer` `InteractiveBoard`) with zero feature change — existing tests must pass. Remove `react-chessboard` from `package.json`. This is the **prerequisite** for shapes; nothing else lands until it is green. | — |
| 1 | **`parsePgn` extension + `serializePgn`.** Structured comments, fixtures, round-trip tests. Behind no flag — both parsers run on the same data, structured comments are simply ignored by the player until slice 3. | 0 |
| 2 | **`treeStore` + `BoardAuthoringSurface` + `BoardEditor` + `RichNoteEditor` + Import-from-PGN modal.** Board surface becomes the **only** surface visible in `LessonEditor` for `type='chess'`. Existing PGN textarea is removed from the default UI. Import-from-PGN modal is reachable from a button. | 1 |
| 3 | **Shape wiring through Chessground.** `BoardAuthoringSurface` enables `drawable` + `onShapesChange` → `treeStore.setShapes`. `GuidedChessPlayer` (lesson + puzzle + viewer) reads node shapes and passes them to `ChessgroundView` as `drawable.autoShapes` (read-only). Lesson-mode players see arrows/circles immediately. No SVG/overlay code in our repo. | 2 |
| 4 | **`GuidedChessPlayer` puzzle mode + `PuzzleEditorPanel` + `puzzleAttemptApi`.** Activates `type='puzzle'`; deletes `puzzleComingSoon` placeholder. | 2, 3 |
| 5 | **Viewer mode (`is_view_only`) + resume (`last_viewed_node_id`).** Lower priority; could slip a milestone without blocking puzzles. | 3 |
| 6 | **Advanced toggle + `AdvancedPgnPanel`.** Migration 043 (`users.editor_advanced`); Profile setting UI; PGN tab rendered only when flag is true. Decouples power-user PGN from the default creator flow. | 2 |
| 7 | **Sample puzzle fixture + E2E spec + CLAUDE.md updates.** Closes the PRD. | 4, 6 |

Total: 7 slices, ~3 weeks if delivered serially. Slice 0 unblocks 1–6; 4 is the user-visible "puzzle mode shipped" milestone; 6 closes the "creators must never see PGN" requirement.

## 8. Open Questions

1. **Rich text engine.** TipTap chosen in §4.6; final call before slice 2.
2. **Mistake-banner timing.** 1.5 s from artifact. Field-test with a creator before locking in; consider a per-node override field if 1.5 s is too short for longer notes.
3. **Hint thresholds.** 2 / 3 wrong attempts from artifact. Worth A/B-ing post-launch.
4. **Puzzle "give up".** Should the learner be able to surrender and see the solution at any point, or only via the progressive hint path? Default: yes, add a `Xem đáp án` button after the 3rd wrong attempt that plays the main line to completion without recording a clean run.
5. **`puzzle_attempts` retention.** Keep all rows or aggregate after 90 days? Tilt: keep all for Phase 2.1, revisit if storage costs surface.
6. ~~**Shape colour vocabulary.** Artifact spec'd green/red/yellow/blue.~~ **Resolved 2026-05-14**: ship Chessground's default brushes (green/red/yellow/blue, colourblind-tested by upstream) verbatim. No custom `--shape-*` tokens. See ADR-0005.
7. **Viewer mode entry point.** Per-lesson boolean (chosen, §4.5) or a course-wide setting? Lesson-level is more flexible; course-level is simpler to toggle. Tentative: lesson-level, can promote to course-level later as a default for new lessons.

## 9. Success Metrics

After 30 days of public release:

- ≥ 30 % of new chess lessons authored use the board surface (measured by editor telemetry tag attached on save; tag absent on PGN-tab saves).
- ≥ 20 published puzzles in the live DB.
- ≥ 70 % of learners who start a puzzle complete it (any wrong-attempt count).
- Median wrong-attempts per puzzle completion: target 1–3 (signal that hint thresholds are calibrated).
- Zero data-loss incidents from PGN ↔ tree round-trips reported to support.
- No regression in chess-lesson completion rate vs the 30 days before release.
