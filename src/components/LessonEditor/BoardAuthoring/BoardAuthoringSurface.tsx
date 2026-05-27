/**
 * BoardAuthoringSurface — PRD-0004 Slice 5a
 *
 * Board-direct authoring surface for chess lessons. Replaces the PGN textarea
 * in LessonEditor for lesson.type === 'chess'. The creator drags/clicks pieces
 * to build the variation tree; the tree is serialised to pgn_data on save.
 */

import { useSyncExternalStore, useCallback, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Chess } from 'chess.js'
import ChessgroundView from '../../ChessBoard/ChessgroundView'
import PromotionPicker from '../../GuidedChessPlayer/PromotionPicker'
import type { PromotionPiece } from '../../GuidedChessPlayer/PromotionPicker'
import BoardEditor from '../BoardEditor/BoardEditor'
import type { TreeStore } from '../treeStore'
import type { PgnNode, Shape } from '../../../utils/parsePgn'
import type { DrawShape } from 'chessground/draw'

function shapesToDrawShapes(shapes: Shape[]): DrawShape[] {
  return shapes.map((s) =>
    s.kind === 'arrow'
      ? { orig: s.from as DrawShape['orig'], dest: s.to as DrawShape['orig'], brush: s.color }
      : { orig: s.square as DrawShape['orig'], brush: s.color }
  )
}

export interface BoardAuthoringSurfaceProps {
  store: TreeStore
  perspective?: 'white' | 'black'
  size?: number
}

/** Compute legal destinations for each piece from a FEN (for Chessground dests prop). */
function computeDests(fen: string): Map<string, string[]> {
  try {
    const chess = new Chess(fen)
    const dests = new Map<string, string[]>()
    for (const move of chess.moves({ verbose: true })) {
      const existing = dests.get(move.from)
      if (existing) {
        existing.push(move.to)
      } else {
        dests.set(move.from, [move.to])
      }
    }
    return dests
  } catch {
    return new Map()
  }
}

/** Check if a pawn move is a promotion (pawn reaching rank 1 or 8). */
function isPromotionMove(fen: string, from: string, to: string): boolean {
  try {
    const chess = new Chess(fen)
    const piece = chess.get(from as Parameters<Chess['get']>[0])
    if (!piece || piece.type !== 'p') return false
    const toRank = to[1]
    return toRank === '8' || toRank === '1'
  } catch {
    return false
  }
}

export default function BoardAuthoringSurface({
  store,
  perspective = 'white',
  size = 400,
}: BoardAuthoringSurfaceProps) {
  const { t } = useTranslation()

  // Subscribe to the Zustand vanilla store
  const state = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState
  )

  const { tree, currentNodeId } = state

  // Promotion state: pending promotion from/to squares
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null)

  // Board editor open/close state
  const [boardEditorOpen, setBoardEditorOpen] = useState(false)

  // Build nodeMap from tree for O(1) lookup
  function buildNodeMap(root: PgnNode): Map<string, PgnNode> {
    const map = new Map<string, PgnNode>()
    function walk(node: PgnNode) {
      map.set(node.id, node)
      for (const child of node.children) walk(child)
    }
    walk(root)
    return map
  }

  const nodeMap = buildNodeMap(tree)
  const currentNode = nodeMap.get(currentNodeId) ?? tree

  // Current FEN from the currently selected node
  const currentFen = currentNode.fen

  // Legal destinations for the current position — drives Chessground piece drag
  const dests = useMemo(() => computeDests(currentFen), [currentFen])

  // Last move squares
  const lastMove = currentNode.parentId !== null
    ? ([currentNode.from, currentNode.to] as [string, string])
    : null

  // ── Move handler ──────────────────────────────────────────────────────────

  const handleMove = useCallback((from: string, to: string): boolean => {
    const fen = store.getState().tree
      ? (() => {
          const nm = new Map<string, PgnNode>()
          function w(n: PgnNode) { nm.set(n.id, n); for (const c of n.children) w(c) }
          w(store.getState().tree)
          return nm.get(store.getState().currentNodeId)?.fen ?? store.getState().tree.fen
        })()
      : store.getState().tree.fen

    if (isPromotionMove(fen, from, to)) {
      setPendingPromotion({ from, to })
      return false
    }

    store.getState().applyMove(from, to)
    return true
  }, [store])

  const handlePromotionPick = (piece: PromotionPiece) => {
    if (!pendingPromotion) return
    store.getState().applyMove(pendingPromotion.from, pendingPromotion.to, piece)
    setPendingPromotion(null)
  }

  return (
    <div
      data-testid="board-authoring-surface"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Starting position button */}
      <div>
        <button
          type="button"
          data-testid="board-authoring-starting-position-btn"
          onClick={() => setBoardEditorOpen(true)}
          style={{
            padding: '5px 12px',
            fontSize: 12,
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-sm)',
            background: 'var(--surface)',
            color: 'var(--ink-2)',
            cursor: 'pointer',
          }}
        >
          {t('creator.lessonEditor.startingPositionLabel', { defaultValue: 'Vị trí bắt đầu' })}
        </button>
      </div>

      {/* Board editor — shown when open */}
      {boardEditorOpen && (
        <BoardEditor
          store={store}
          onClose={() => setBoardEditorOpen(false)}
        />
      )}

      {/* Board */}
      <div data-testid="board-authoring-board">
        <ChessgroundView
          fen={currentFen}
          orientation={perspective}
          size={size}
          lastMove={lastMove}
          movable="both"
          dests={dests}
          viewOnly={false}
          drawable={{ enabled: true, autoShapes: shapesToDrawShapes(currentNode.shapes) }}
          onMove={handleMove}
          onShapesChange={(cgShapes) => {
            const shapes = cgShapes.map((s) =>
              s.dest
                ? { kind: 'arrow' as const, from: s.orig, to: s.dest, color: (s.brush ?? 'green') as 'green' | 'red' | 'yellow' | 'blue' }
                : { kind: 'circle' as const, square: s.orig, color: (s.brush ?? 'green') as 'green' | 'red' | 'yellow' | 'blue' }
            )
            store.getState().setShapes(currentNodeId, shapes)
          }}
          ariaLabel={t('creator.lessonEditor.boardAuthoringAriaLabel', {
            defaultValue: 'Chess board — edit mode',
          })}
        />
      </div>

      {/* Shape toolbar hint */}
      <div
        data-testid="shape-toolbar-hint"
        style={{
          fontSize: 11,
          color: 'var(--ink-3)',
          textAlign: 'center' as const,
          padding: '2px 0',
        }}
      >
        {t('creator.lessonEditor.shapeToolbarHint')}
      </div>

      {/* Promotion picker dialog */}
      {pendingPromotion && (
        <PromotionPicker
          offered={['q', 'r', 'b', 'n']}
          onPick={handlePromotionPick}
          onDismiss={() => setPendingPromotion(null)}
        />
      )}

    </div>
  )
}
