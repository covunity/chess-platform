# ADR-0005 — Migrate board library from react-chessboard to Chessground

- **Status:** Accepted
- **Date:** 2026-05-14
- **Slice:** PRD-0004 / Issue #190 (Chessground swap)

## Context

Phase 1 + PRD-0003 ship the chess board through `react-chessboard ^5.10.0`. The
codebase uses it for drag-and-drop piece moves (lesson + puzzle players, future
authoring surface), the existing `PromotionPicker` overlay, last-move highlight,
selected-square highlight, and board orientation (white/black perspective).

PRD-0004 adds capabilities the artifact (Chessable / Lichess Studies reference)
treats as core to chess pedagogy:

- 4 distinct arrow colours + 4 distinct circle marker colours, drawn by creators
  with right-click and right-click-drag.
- A modifier-key vocabulary chess players already know — Shift / Alt / Ctrl swap
  colours.
- Touch-device shape drawing (Chessground unifies mouse + touch via its internal
  `MouchEvent` abstraction; exact gesture is upstream's choice).
- `viewOnly` mode for the new viewer-mode lesson surface.
- Shapes as part of the lesson data model — per-node, round-trip through PGN
  comments.

`react-chessboard` exposes none of this. Two paths:

**Path A — stay on react-chessboard, hand-roll an SVG overlay layer.** Build a
`ShapeOverlay.tsx` aligned to the 8×8 grid, a `BoardEventLayer.tsx` to capture
right-click + modifier keys (react-chessboard does not expose square-level mouse
events), a touch-gesture state machine, and our own promotion-picker collision
handling around drawn shapes. Estimated ~300–500 lines of code we'd own and
debug, repeating work that already exists, in production, at lichess.org.

**Path B — migrate to Chessground.** Lichess's open-source board library — the
same library Lichess Studies and other reference platforms use. Native support
for all five capabilities above out of the box, with the modifier-key
vocabulary chess players already expect.

## Decision

We migrate the board library from `react-chessboard` to **Chessground**.

Concretely:

- Add `chessground` to `package.json`. Remove `react-chessboard`.
- Wrap Chessground's imperative API in a thin React component
  `src/components/ChessBoard/ChessgroundView.tsx` (~50–100 LOC; final size depends
  on diff-handling edge cases). The component owns the Chessground instance via
  `useEffect` and diffs props on each render. Props mirror the operations our
  codebase actually uses: `fen`, `orientation`, `lastMove`, `viewOnly`,
  `movable`, `drawable`, `selected`, plus callbacks `onMove`, `onShapesChange`,
  `onSquareSelect`, `onPromotion`.
- Replace exactly three call sites: `src/components/ChessBoard/ChessBoard.tsx`,
  `src/components/MiniBoard.tsx`, and the `InteractiveBoard` subcomponent of
  `src/components/GuidedChessPlayer/GuidedChessPlayer.tsx`.
- **Theme.** Ship Chessground's default brown theme stylesheets
  (`chessground.base.css` + `chessground.brown.css`) verbatim. Ship Chessground's
  default brush colours (green/red/yellow/blue — colourblind-tested by upstream)
  verbatim. No `--board-dark` / `--board-light` overrides in this scope; design
  has not invested in custom board chroma, and matching the Lichess look is
  itself a reasonable brand choice for a chess platform. Custom theming
  (board + pieces + brushes) is deferred to Phase 3 if a learner-facing theme
  picker is ever scoped.
- **Pieces.** Chessground's default Cburnett set. Swappable via CSS layer if
  Phase 3 adds piece-set preference.
- **Promotion.** Chessground 9.2 ships **no built-in promotion picker** (verified
  against the `chessground@9.2.1` type definitions — the `promoted` field on
  `Piece` is a board-state marker for crazyhouse, not a UI hook). Promotion is
  therefore application-level: `ChessgroundView` detects pawn moves landing on
  the back rank inside its `onMove` handler, presents the existing
  `PromotionPicker.tsx` UI, and applies the chosen piece back to Chessground via
  the `api.setPieces` call. The picker itself does not change.
- **Drawable.** Enabled in the editor (`drawable.enabled = true` so right-click
  + modifier keys + touch all work natively); disabled in players, but
  `drawable.autoShapes` is populated from `currentNode.shapes` so creator-
  authored shapes render as read-only annotations during playback.

### Rejected: Path A (overlay on react-chessboard)

- ~300–500 lines of right-click capture + SVG arrow rendering + touch gesture
  state we don't want to own. Chessground has those debugged in production.
- The right-click + modifier-key vocabulary is what chess players already know
  from Lichess and Chess.com. Reinventing it risks subtle UX deviations users
  notice immediately.
- We'd ship the equivalent of Chessground's stylesheet eventually anyway, the
  first time we hit a feature gap our overlay can't bridge cleanly (e.g.,
  promotion picker collisions with a drawn arrow).

## Consequences

### Positive

- Native arrows, circles, modifier keys, touch drawing, and `viewOnly` — all
  included with the upstream library.
- Three call sites means the migration footprint is bounded; the wrapper
  isolates Chessground's imperative API from the rest of the codebase.
- Brand consistency with Lichess + Chessable: players land on a board that
  "looks like chess" the moment they open a lesson.
- **Smaller bundle.** Chessground's published tarball is 95 kB unpacked vs
  `react-chessboard` 387 kB (which bundles its own picker UI + helpers).
  Gzipped browser-bundle delta is meaningfully positive — estimate ~10–30 kB
  savings on the client. Verified once the migration lands.

### Negative / risks

- **Imperative wrapper.** `useEffect` diffs are fragile if a prop is mutated
  outside React. We treat `ChessgroundView` props as plain values and re-create
  arrays/objects on each render where needed. Bugs here surface as a stale
  board view; existing player tests catch the common cases.
- **Default brown theme** changes the board look from whatever the current
  users see. We accept this — the current board styling carries no user-
  research investment behind it.
- **CSS specificity.** Chessground stylesheets are global and use `cg-*`
  selectors. Future components that reuse these class prefixes will collide.
  Documented in CLAUDE.md §8.
- **No React-idiomatic API.** Contributors may try to mutate the Chessground
  instance directly instead of going through props. The wrapper is the only
  blessed surface — enforced by lint/code-review, not by the type system.

## Trigger to revisit

Switch off Chessground only when **all three** of these hold:

1. Chessground upstream goes stale — no commits or releases for 12+ months,
   practical sign that bug fixes won't come.
2. A maintained React-native chess-board library ships native arrow/marker
   support with the same right-click + Shift/Alt/Ctrl vocabulary chess players
   already expect from Lichess + Chess.com.
3. The cost of moving off Chessground (re-test all 3 call sites + CSS rewrite +
   shape data adapter) is plausibly less than the cost of a quarter of upkeep.

In practice this is unlikely before Phase 3.

## Out of scope

This ADR does **not** cover:

- **Piece-set picker.** Only Chessground's default Cburnett ships in Phase 2.1;
  a Phase 3 preference would scope its own work.
- **Learner-facing board-theme picker.** Brown theme only; revisit in Phase 3
  if scoped.
- **Mobile gesture customisation for shape drawing.** We ship Chessground's
  defaults; if a usability gap surfaces post-launch, Phase 3 can override.
- **Engine-style live arrows** (Stockfish best-move overlay). Stockfish
  integration is Phase 2+, not this ADR.
- **Custom brush colours.** Chessground's default green/red/yellow/blue ship
  verbatim; PRD-0004 §8 open question 6 is resolved on this basis.

## Implementation references

- PRD-0004 §4.6 (`docs/prd/0004-board-authoring-and-puzzle-rewind.md`)
- Slice issue: #190
- Wrapper module: `src/components/ChessBoard/ChessgroundView.tsx` (slice 3)
- Migrated call sites: `src/components/ChessBoard/ChessBoard.tsx`,
  `src/components/MiniBoard.tsx`,
  `src/components/GuidedChessPlayer/GuidedChessPlayer.tsx`
- Chessground source + docs: <https://github.com/lichess-org/chessground>

## Updates to CLAUDE.md (apply when slice #190 lands)

- §2 row "Chess": replace `chessboard.js (CDN)` with
  `chessground (npm board renderer)`. `chess.js` stays as the engine.
- §8 add: board library is Chessground. Right-click + Shift/Alt/Ctrl on the
  board area is reserved for shape drawing — do not add a context-menu handler
  on the board container.
- §6 gets a new D-row in slice 12 (issue #199) referencing this ADR.
