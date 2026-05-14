/**
 * PuzzleEditorPanel — PRD-0004 Slice 9a (issue #196)
 *
 * Editor surface for puzzle-type lessons:
 * - playerSide picker (white/black) → writes lessons.puzzle_player_side
 * - Per-node purpose selector (none / correct / mistake) in node detail panel
 * - Wraps BoardAuthoringSurface for board-direct authoring
 */

import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import BoardAuthoringSurface from './BoardAuthoring/BoardAuthoringSurface'
import type { TreeStore } from './treeStore'

export interface PuzzleEditorPanelProps {
  store: TreeStore
  playerSide: 'white' | 'black' | null
  onPlayerSideChange: (side: 'white' | 'black') => void
  perspective?: 'white' | 'black'
  size?: number
}

export default function PuzzleEditorPanel({
  store,
  playerSide,
  onPlayerSideChange,
  perspective = 'white',
  size = 340,
}: PuzzleEditorPanelProps) {
  const { t } = useTranslation()

  const state = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState
  )

  const { currentNodeId } = state

  // Build nodeMap to find current node
  function buildNodeMap(root: import('../../utils/parsePgn').PgnNode): Map<string, import('../../utils/parsePgn').PgnNode> {
    const map = new Map<string, import('../../utils/parsePgn').PgnNode>()
    function walk(node: import('../../utils/parsePgn').PgnNode) {
      map.set(node.id, node)
      for (const child of node.children) walk(child)
    }
    walk(root)
    return map
  }

  const nodeMap = buildNodeMap(state.tree)
  const currentNode = nodeMap.get(currentNodeId) ?? state.tree
  const isRoot = currentNodeId === 'root'
  const currentPurpose = isRoot ? null : (currentNode.purpose ?? null)

  function handlePurposeChange(purpose: 'correct' | 'mistake' | null) {
    store.getState().setPurpose(currentNodeId, purpose)
  }

  const sideButtonStyle = (selected: boolean): React.CSSProperties => ({
    flex: 1,
    height: 36,
    border: `1px solid var(--border)`,
    borderRadius: 'var(--r-sm)',
    background: selected ? 'var(--ink-1)' : 'var(--surface)',
    color: selected ? 'var(--ink-on-accent)' : 'var(--ink-1)',
    fontWeight: 500,
    fontSize: 13,
    cursor: 'pointer',
  })

  return (
    <div
      data-testid="puzzle-editor-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {/* Player side picker */}
      <div>
        <span className="label">
          {t('creator.lessonEditor.puzzlePlayerSideLabel')}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            data-testid="puzzle-player-side-white"
            aria-pressed={playerSide === 'white'}
            style={sideButtonStyle(playerSide === 'white')}
            onClick={() => onPlayerSideChange('white')}
          >
            {t('creator.lessonEditor.perspectiveWhite')}
          </button>
          <button
            type="button"
            data-testid="puzzle-player-side-black"
            aria-pressed={playerSide === 'black'}
            style={sideButtonStyle(playerSide === 'black')}
            onClick={() => onPlayerSideChange('black')}
          >
            {t('creator.lessonEditor.perspectiveBlack')}
          </button>
        </div>
      </div>

      {/* Board authoring surface */}
      <BoardAuthoringSurface
        store={store}
        perspective={perspective}
        size={size}
      />

      {/* Per-node purpose selector — shown only when a move node is selected */}
      {!isRoot && (
        <div
          data-testid="node-purpose-panel"
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-sm)',
            padding: 12,
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--ink-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            {t('creator.lessonEditor.puzzlePurposeNone')}
          </div>
          <div
            role="radiogroup"
            aria-label={t('creator.lessonEditor.puzzlePlayerSideLabel')}
            style={{ display: 'flex', gap: 8 }}
          >
            {/* None */}
            <button
              type="button"
              role="radio"
              data-testid="node-purpose-none"
              aria-checked={currentPurpose === null}
              style={{
                padding: '4px 12px',
                borderRadius: 999,
                border: '1px solid var(--border)',
                background: currentPurpose === null ? 'var(--ink-1)' : 'var(--surface)',
                color: currentPurpose === null ? 'var(--ink-on-accent)' : 'var(--ink-2)',
                fontSize: 12.5,
                fontWeight: 500,
                cursor: 'pointer',
              }}
              onClick={() => handlePurposeChange(null)}
            >
              {t('creator.lessonEditor.puzzlePurposeNone')}
            </button>

            {/* Correct */}
            <button
              type="button"
              role="radio"
              data-testid="node-purpose-correct"
              aria-checked={currentPurpose === 'correct'}
              style={{
                padding: '4px 12px',
                borderRadius: 999,
                border: '1px solid var(--border)',
                background: currentPurpose === 'correct' ? 'var(--ink-1)' : 'var(--surface)',
                color: currentPurpose === 'correct' ? 'var(--ink-on-accent)' : 'var(--ink-2)',
                fontSize: 12.5,
                fontWeight: 500,
                cursor: 'pointer',
              }}
              onClick={() => handlePurposeChange('correct')}
            >
              {t('creator.lessonEditor.puzzlePurposeCorrect')}
            </button>

            {/* Mistake */}
            <button
              type="button"
              role="radio"
              data-testid="node-purpose-mistake"
              aria-checked={currentPurpose === 'mistake'}
              style={{
                padding: '4px 12px',
                borderRadius: 999,
                border: '1px solid var(--border)',
                background: currentPurpose === 'mistake' ? 'var(--ink-1)' : 'var(--surface)',
                color: currentPurpose === 'mistake' ? 'var(--ink-on-accent)' : 'var(--ink-2)',
                fontSize: 12.5,
                fontWeight: 500,
                cursor: 'pointer',
              }}
              onClick={() => handlePurposeChange('mistake')}
            >
              {t('creator.lessonEditor.puzzlePurposeMistake')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
