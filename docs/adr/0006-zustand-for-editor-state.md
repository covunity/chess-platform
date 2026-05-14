# ADR-0006 — Introduce Zustand for editor state (treeStore)

- **Status:** Accepted
- **Date:** 2026-05-14
- **Slice:** PRD-0004 / Issue #192 (treeStore + BoardAuthoringSurface)

## Context

CLAUDE.md §2 documents an explicit trigger for introducing a state-management
library:

> Chess board state needs to be shared across multiple unrelated components
> (e.g., syncing player position with a move list panel, an annotation sidebar,
> and a variation tree simultaneously)

PRD-0004 §4.3 introduces `BoardAuthoringSurface`, which is structurally exactly
that case. The variation tree (`PgnNode`) and `currentNodeId` need to stay in
sync across at least these unrelated children inside the editor:

1. The interactive board (`ChessgroundView` in edit mode) — produces
   `applyMove(from, to, promotion)` events.
2. The variation list — produces `setCurrentNode(id)` events; will produce
   `deleteSubtree(id)` and `promoteVariation(id)` once the edit-actions
   follow-up (#200) lands.
3. The note panel (`RichNoteEditor`, #194) — produces
   `setNote(currentNodeId, doc)` events; reads `currentNode.note`.
4. The shape toolbar / Chessground `onShapesChange` (#195) — produces
   `setShapes(currentNodeId, shapes)` events.
5. The puzzle editor panel (#196) — produces `setPurpose(currentNodeId, purpose)`
   events; reads `currentNode.purpose` for the radio selector.
6. The Advanced PGN tab (#198, opt-in per user) — produces
   `replaceTree(parsedTree)` events.

Today the codebase has no state library. All state is local `useState` plus
`AuthContext`. Phase-1 components were small enough that this was tractable;
PRD-0004 pushes the editor past the boundary.

Three options:

**A. Hoist state into `LessonEditor`.** Make `LessonEditor` own the tree + every
action handler, prop-drill into 5+ children. Becomes a god component; AC #5 of
the original #192 (right-click context menu) forces children to wire callbacks
back up through several layers; tests for individual children become harder
because they can no longer mount in isolation without a synthetic parent.

**B. Context API.** Wrap `BoardAuthoringSurface` in a `<TreeContext>`. Works,
but every shape edit re-renders every consumer of the context — the note panel
re-renders on a circle toggle, the variation list re-renders on a note edit.
Avoidable only by splitting into ~6 separate contexts (one per slice of state),
which is its own kind of complexity tax.

**C. Zustand.** Single store, selector-based subscriptions, no provider
boilerplate. Each subscriber re-renders only when its slice changes.

## Decision

We introduce **Zustand** (`zustand@^5`) as a focused dependency, used **only
inside the editor**.

Concretely:

- One store, `treeStore`, lives at
  `src/components/LessonEditor/treeStore.ts`.
- **Per-mount factory.** The store is created via a `createTreeStore()` factory
  inside `LessonEditor`'s `useMemo` — not a module-level singleton. Opening two
  editors (e.g., a creator with two browser tabs) must not share state. Children
  consume the store via a tiny `<TreeStoreContext>` for grandchildren that
  don't deserve a prop, or by direct prop pass for direct children.
- **API surface** (final shape, slice-by-slice):

  ```ts
  type TreeStore = {
    tree: PgnNode;            // root + children (V-02)
    currentNodeId: string;
    dirty: boolean;

    applyMove: (from, to, promotion?) => void;
    setCurrentNode: (nodeId) => void;
    replaceTree: (parsed: PgnParseResult) => void;

    // Wired by later slices, exposed as no-ops in #192 foundation:
    deleteSubtree: (nodeId) => void;       // #200
    promoteVariation: (nodeId) => void;    // #200
    setShapes: (nodeId, shapes) => void;   // #195
    setNote: (nodeId, doc) => void;        // #194
    setPurpose: (nodeId, purpose) => void; // #196

    undo: () => void;                      // optional in #192, with #200 otherwise
    redo: () => void;
  };
  ```

- **Player + viewer + puzzle modes** (`GuidedChessPlayer`) **stay on local
  `useState`**. Their input is `lesson.pgn_data`, parsed once into a read-only
  `PgnNode` tree at mount. Their state is just `currentNodeId` + transient
  per-session overlays (`wrongAttemptsAt`, `hintLevel`, `gaveUp`). Adding
  Zustand there would be over-engineering — none of the CLAUDE.md §2 triggers
  fire in the player.

### Rejected

- **A (hoist).** Pushes 5+ unrelated concerns into `LessonEditor`; couples
  child tests to a parent harness.
- **B (Context).** Re-render storm without 6+ context splits; the splits are
  themselves the maintenance burden Zustand removes.

## Consequences

### Positive

- Each subscriber re-renders only on its slice — selector-based subscriptions
  are the default Zustand idiom.
- Pure-function actions are testable without mounting the editor — store can
  be exercised in unit tests.
- Clean separation: editor uses Zustand, player uses local state. Future
  contributors get a clear pattern: "add Zustand to a surface only when
  CLAUDE.md §2 trigger fires for that surface".
- Bundle impact negligible (~1 kB gzipped). Editor route is creator-only and
  not on the learner-facing critical path.

### Negative / risks

- **Two state idioms in the codebase.** `useState` + `AuthContext` for everything
  player-side; Zustand for editor-side. Mitigation: this ADR is the explicit
  fence — the next surface that needs cross-component state gets its own store
  (e.g., a hypothetical `playerStore`), not an expansion of `treeStore`.
- **Per-mount factory is not the default Zustand pattern.** Most examples use
  module-level `create()`. We use a factory because the editor is a
  user-mountable surface, not a singleton. Will be verified in slice 5a by a
  test that mounts two `<LessonEditor>` instances and asserts their `tree`
  states are independent.
- **Devtools middleware** (`zustand/middleware`) adds bundle in dev only —
  gated behind `import.meta.env.DEV`.
- **Tree-mutation strategy.** `treeStore` holds a tree of `PgnNode` references
  with `parentId` strings and `children` arrays. Mutating actions use
  **`zustand/middleware/immer`** so each action body can mutate the tree (or
  the changed path) directly while Zustand produces a new immutable snapshot
  for subscribers. This avoids hand-rolled spread chains across
  `parentId` / `children` and keeps action code readable. Settled at ADR time
  rather than per-action.

## Trigger to revisit

Expand Zustand scope (or evaluate alternatives like Jotai, Valtio, Redux
Toolkit) only when **a new non-editor surface** triggers CLAUDE.md §2 — for
example:

- Player needs cross-page state. (Resume position is the closest existing
  candidate, but it is a single value bound at lesson-open and saved on
  debounce — local state still wins there.)
- A Phase-3 feature needs broadcast across non-related components — e.g., a
  live multi-tab study session, or a notification centre that updates badges
  across the chrome.

If the trigger fires, the conversation is "do we add a `playerStore` next to
`treeStore`, or do we adopt a single global pattern?" — not "Zustand vs X
again". Zustand is the chosen library; only its scope is up for review.

## Out of scope

This ADR does **not** cover:

- **`playerStore`.** Player, viewer, and puzzle modes stay on local `useState`
  with parsed-once read-only trees. A future store gets its own ADR if a
  player-side surface ever triggers CLAUDE.md §2.
- **Persistence to `localStorage` / `IndexedDB`.** `treeStore` is in-memory
  only. Lesson persistence happens via `lessons.pgn_data` on save; unsaved-draft
  autosave is not in PRD-0004 scope.
- **Undo / redo data structure depth.** The store exposes `undo` / `redo`
  actions; the history depth + capping strategy is implementation detail for
  slice #200 (edit actions).
- **Real-time / multi-user collaborative editing.** A second creator editing
  the same lesson concurrently is Phase 3 territory and would require a
  conflict-resolution layer above Zustand (or a different state model).
- **Global UI stores** (modals, toast queues, sidebar collapse). These remain
  on local `useState` + context until they themselves trigger §2.

## Implementation references

- PRD-0004 §4.3 (BoardAuthoringSurface module spec)
- Slice issue: #192 (foundation), with follow-ups #200 / #194 / #195 / #196
  extending the store actions.
- Store: `src/components/LessonEditor/treeStore.ts` (slice 5a)
- CLAUDE.md §2 "State management" trigger
- Zustand source + docs: <https://github.com/pmndrs/zustand>

## Updates to CLAUDE.md (apply when slice #192 lands)

- §2 "State management" — append: "PRD-0004 introduces Zustand for editor
  state only (`treeStore` in `src/components/LessonEditor/`). Player + viewer
  + puzzle modes remain on local `useState`. Add a new store for any
  *non-editor* surface that triggers the §2 conditions; do not expand
  `treeStore` to cover unrelated state. See ADR-0006."
- No tech-stack table change — Zustand is an internal-only dependency, not a
  layer on the architecture diagram.
