import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import RichNoteEditor from '../RichNoteEditor/RichNoteEditor'
import type { TreeStore } from './treeStore'
import type { PgnNode, RichTextDoc } from '../../utils/parsePgn'

function buildNodeMap(root: PgnNode): Map<string, PgnNode> {
  const map = new Map<string, PgnNode>()
  function walk(node: PgnNode) {
    map.set(node.id, node)
    for (const child of node.children) walk(child)
  }
  walk(root)
  return map
}

function isEmptyDoc(doc: RichTextDoc): boolean {
  for (const para of doc.content) {
    for (const span of para.content ?? []) {
      if (span.text && span.text.length > 0) return false
    }
  }
  return true
}

export default function VariationPanel({ store }: { store: TreeStore }) {
  const { t } = useTranslation()
  const allowVariations = import.meta.env.VITE_ALLOW_VARIATIONS === 'true'

  const { tree, currentNodeId } = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState
  )

  const nodeMap = buildNodeMap(tree)
  const currentNode = nodeMap.get(currentNodeId) ?? tree
  const hasAnyMoves = tree.children.length > 0
  const moveCount = nodeMap.size - 1

  const STANDARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  const hasCustomStartingFen = tree.fen !== STANDARD_FEN

  function renderVariationNode(node: PgnNode, depth: number): ReactNode[] {
    const rows: ReactNode[] = []
    const isCurrentNode = node.id === currentNodeId
    const hasMultipleResponses = node.children.length > 1
    const hasNote = !!node.note

    rows.push(
      <div
        key={node.id}
        data-testid={`variation-node-${node.id}`}
        role="button"
        tabIndex={0}
        onClick={() => store.getState().setCurrentNode(node.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') store.getState().setCurrentNode(node.id)
        }}
        style={{
          paddingLeft: depth * 16 + 8,
          paddingTop: 4,
          paddingBottom: 4,
          paddingRight: 8,
          cursor: 'pointer',
          fontSize: 12.5,
          background: isCurrentNode ? 'var(--surface-3)' : 'transparent',
          color: depth === 1 ? 'var(--ink-1)' : 'var(--ink-2)',
          borderRadius: 'var(--r-sm)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          userSelect: 'none' as const,
        }}
      >
        {depth > 1 && (
          <span style={{ color: 'var(--ink-3)', fontSize: 11, flexShrink: 0 }}>{'('}</span>
        )}
        <span style={{ color: 'var(--ink-3)', minWidth: 30, fontSize: 11, flexShrink: 0 }}>
          {node.moveNumber}{node.side === 'w' ? '.' : '...'}
        </span>
        <span style={{ fontWeight: isCurrentNode ? 600 : 400 }}>{node.san}</span>
        {hasNote && (
          <span
            aria-label="Có ghi chú"
            style={{ fontSize: 10, color: 'var(--ink-3)', flexShrink: 0 }}
          >
            ✎
          </span>
        )}
        {depth > 1 && (
          <span style={{ color: 'var(--ink-3)', fontSize: 11, flexShrink: 0 }}>{')'}</span>
        )}
        {allowVariations && hasMultipleResponses && (
          <span
            data-testid="opponent-branch-warning"
            title={`${node.children.length} nhánh phụ`}
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              color: 'var(--amber-9, #b45309)',
              background: 'var(--amber-2, #fef3c7)',
              borderRadius: 'var(--r-sm)',
              padding: '1px 5px',
              flexShrink: 0,
            }}
          >
            +{node.children.length - 1} nhánh
          </span>
        )}
      </div>
    )

    for (const child of node.children) rows.push(...renderVariationNode(child, depth + 1))
    return rows
  }

  const isRoot = currentNodeId === 'root'
  const currentNote = isRoot ? null : (currentNode.note ?? null)

  const handleNoteChange = (doc: RichTextDoc) => {
    if (!isRoot) store.getState().setNote(currentNodeId, isEmptyDoc(doc) ? null : doc)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Moves section header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--ink-3)',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.1em',
          }}
        >
          {t('creator.lessonEditor.variationListHeading')}
        </span>
        {hasCustomStartingFen && (
          <span
            data-testid="variation-list-custom-fen"
            style={{
              fontSize: 9,
              fontFamily: 'var(--font-mono, monospace)',
              color: 'var(--ink-3)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-sm)',
              padding: '1px 5px',
            }}
            title={tree.fen}
          >
            FEN
          </span>
        )}
        {hasAnyMoves && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              color: 'var(--ink-3)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 99,
              padding: '1px 8px',
              flexShrink: 0,
            }}
          >
            {moveCount} nước
          </span>
        )}
      </div>

      {/* Variation list — grows to fill available height */}
      <div
        data-testid="variation-list"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '6px 0',
          minHeight: 0,
        }}
      >
        {hasAnyMoves ? (
          tree.children.flatMap((child) => renderVariationNode(child, 1))
        ) : (
          <div
            style={{
              padding: '40px 20px',
              textAlign: 'center' as const,
              fontSize: 12.5,
              color: 'var(--ink-3)',
              fontStyle: 'italic',
              lineHeight: 1.6,
            }}
          >
            {t('creator.lessonEditor.variationListEmpty', {
              defaultValue: 'Kéo quân cờ để bắt đầu soạn bài',
            })}
          </div>
        )}
      </div>

      {/* Note section — pinned to bottom */}
      <div
        data-testid="note-panel"
        style={{
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '12px 16px 16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--ink-3)',
              textTransform: 'uppercase' as const,
              letterSpacing: '0.1em',
            }}
          >
            {t('creator.lessonEditor.notePanelLabel', { defaultValue: 'Ghi chú' })}
          </span>
          {!isRoot && currentNote && (
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--ink-1)',
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
          )}
        </div>
        {isRoot && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--ink-3)',
              fontStyle: 'italic',
            }}
          >
            {t('creator.lessonEditor.notePanelRootHint', {
              defaultValue: 'Chọn một nước để thêm ghi chú',
            })}
          </div>
        )}
        <RichNoteEditor
          key={currentNodeId}
          value={currentNote}
          onChange={handleNoteChange}
          disabled={isRoot}
          placeholder={t('creator.lessonEditor.notePanelPlaceholder', {
            defaultValue: 'Nhập ghi chú cho nước này...',
          })}
        />
      </div>
    </div>
  )
}
