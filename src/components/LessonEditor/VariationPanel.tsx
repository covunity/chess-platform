import { useSyncExternalStore, useState, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronUp, X } from 'lucide-react'
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
  function blockHasText(content: RichTextDoc['content']): boolean {
    for (const block of content) {
      if (block.type === 'paragraph' || block.type === 'heading') {
        if ((block.content ?? []).some((s) => s.text.length > 0)) return true
      } else if (block.type === 'bulletList' || block.type === 'orderedList') {
        for (const item of block.content ?? []) {
          if ((item.content ?? []).some((p) =>
            (p.content ?? []).some((s) => s.text.length > 0)
          )) return true
        }
      }
    }
    return false
  }
  return !blockHasText(doc.content)
}

function countSubtreeNodes(node: PgnNode): number {
  let n = 1
  for (const c of node.children) n += countSubtreeNodes(c)
  return n
}

function iconBtnStyle(hovered: boolean): React.CSSProperties {
  return {
    visibility: hovered ? 'visible' : 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 16,
    height: 16,
    borderRadius: '50%',
    border: 'none',
    background: hovered ? 'var(--surface-2)' : 'transparent',
    color: 'var(--ink-3)',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  }
}

function MoveCell({
  node,
  isCurrentNode,
  isVariationStart,
  onSelect,
  onPromote,
  onDeleteRequest,
}: {
  node: PgnNode
  isCurrentNode: boolean
  isVariationStart: boolean
  onSelect: () => void
  onPromote: () => void
  onDeleteRequest: () => void
}) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const hasNote = !!node.note

  return (
    <div
      data-testid={`variation-node-${node.id}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect()
        else if (e.key === 'Delete') {
          e.preventDefault()
          onDeleteRequest()
        }
      }}
      style={{
        padding: '2px 4px',
        background: isCurrentNode ? 'var(--accent-soft)' : 'transparent',
        borderRadius: 'var(--r-sm)',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: 14,
        fontFamily: 'var(--font-mono)',
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        userSelect: 'none' as const,
        color: isCurrentNode ? 'var(--accent-ink)' : 'var(--ink-1)',
        minWidth: 0,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {node.san}
      </span>
      {hasNote && (
        <span aria-label="Có ghi chú" style={{ fontSize: 10, color: 'var(--ink-3)', flexShrink: 0 }}>
          ✎
        </span>
      )}
      {isVariationStart && (
        <button
          type="button"
          data-testid={`promote-move-btn-${node.id}`}
          aria-label={t('creator.lessonEditor.promoteVariation')}
          title={t('creator.lessonEditor.promoteVariation')}
          onClick={(e) => {
            e.stopPropagation()
            onPromote()
          }}
          style={iconBtnStyle(hovered)}
          onMouseEnter={(e) => {
            const btn = e.currentTarget
            btn.style.background = 'var(--accent-soft, #dbeafe)'
            btn.style.color = 'var(--accent, #3b82f6)'
          }}
          onMouseLeave={(e) => {
            const btn = e.currentTarget
            btn.style.background = 'var(--surface-2)'
            btn.style.color = 'var(--ink-3)'
          }}
        >
          <ChevronUp size={10} strokeWidth={2.5} aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        data-testid={`delete-move-btn-${node.id}`}
        aria-label={t('creator.lessonEditor.deleteSubtree')}
        title={t('creator.lessonEditor.deleteSubtree')}
        onClick={(e) => {
          e.stopPropagation()
          onDeleteRequest()
        }}
        style={iconBtnStyle(hovered)}
        onMouseEnter={(e) => {
          const btn = e.currentTarget
          btn.style.background = 'var(--danger, #ef4444)'
          btn.style.color = '#fff'
        }}
        onMouseLeave={(e) => {
          const btn = e.currentTarget
          btn.style.background = 'var(--surface-2)'
          btn.style.color = 'var(--ink-3)'
        }}
      >
        <X size={10} strokeWidth={2.5} aria-hidden="true" />
      </button>
    </div>
  )
}

export default function VariationPanel({ store }: { store: TreeStore }) {
  const { t } = useTranslation()

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

  // Confirm delete dialog state
  const [deleteConfirm, setDeleteConfirm] = useState<{
    nodeId: string
    subtreeSize: number
  } | null>(null)

  function isVariationStart(node: PgnNode): boolean {
    if (!node.parentId) return false
    const parent = nodeMap.get(node.parentId)
    if (!parent) return false
    return parent.children[0]?.id !== node.id
  }

  function renderMoveCell(node: PgnNode): ReactNode {
    return (
      <MoveCell
        key={node.id}
        node={node}
        isCurrentNode={node.id === currentNodeId}
        isVariationStart={isVariationStart(node)}
        onSelect={() => store.getState().setCurrentNode(node.id)}
        onPromote={() => store.getState().promoteVariation(node.id)}
        onDeleteRequest={() => setDeleteConfirm({ nodeId: node.id, subtreeSize: countSubtreeNodes(node) })}
      />
    )
  }

  function renderVariationBlock(startNode: PgnNode): ReactNode {
    return (
      <div
        key={`varblock-${startNode.id}`}
        style={{
          borderLeft: '2px solid var(--border)',
          marginLeft: 10,
          paddingLeft: 6,
          marginTop: 1,
          marginBottom: 1,
        }}
      >
        {renderLine(startNode)}
      </div>
    )
  }

  function renderLine(startNode: PgnNode | null): ReactNode[] {
    const rows: ReactNode[] = []
    let cursor: PgnNode | null = startNode

    while (cursor !== null) {
      const node = cursor

      if (node.side === 'w') {
        const wNode = node
        const bNode =
          wNode.children.length > 0 && wNode.children[0].side === 'b'
            ? wNode.children[0]
            : null

        rows.push(
          <div
            key={`row-${wNode.id}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '28px 1fr 1fr',
              alignItems: 'center',
              paddingBlock: 3,
              gap: 4,
            }}
          >
            <span
              style={{
                color: 'var(--ink-4)',
                fontSize: 13,
                fontFamily: 'var(--font-mono)',
                userSelect: 'none' as const,
              }}
            >
              {wNode.moveNumber}.
            </span>
            {renderMoveCell(wNode)}
            {bNode ? renderMoveCell(bNode) : <div />}
          </div>
        )

        for (let i = 1; i < wNode.children.length; i++) {
          rows.push(renderVariationBlock(wNode.children[i]))
        }

        if (bNode) {
          for (let i = 1; i < bNode.children.length; i++) {
            rows.push(renderVariationBlock(bNode.children[i]))
          }
          cursor = bNode.children[0] ?? null
        } else {
          cursor = null
        }
      } else {
        const bNode = node

        rows.push(
          <div
            key={`row-b-${bNode.id}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '28px 1fr 1fr',
              alignItems: 'center',
              paddingBlock: 3,
              gap: 4,
            }}
          >
            <span
              style={{
                color: 'var(--ink-4)',
                fontSize: 13,
                fontFamily: 'var(--font-mono)',
                userSelect: 'none' as const,
              }}
            >
              {bNode.moveNumber}...
            </span>
            <div />
            {renderMoveCell(bNode)}
          </div>
        )

        for (let i = 1; i < bNode.children.length; i++) {
          rows.push(renderVariationBlock(bNode.children[i]))
        }

        cursor = bNode.children[0] ?? null
      }
    }

    return rows
  }

  const mainLineEndId = useMemo(() => {
    let node: PgnNode = tree
    while (node.children.length > 0) node = node.children[0]
    return node.id === tree.id ? null : node.id
  }, [tree])
  const navAtRoot = currentNodeId === tree.id || !currentNode.parentId
  const navAtLeaf = currentNode.children.length === 0
  const navAtMainLineEnd = mainLineEndId !== null && currentNodeId === mainLineEndId

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
        background: 'var(--surface)',
      }}
    >
      {/* Moves section header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '20px 28px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--ink-3)',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.08em',
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
          padding: '8px 28px',
          minHeight: 0,
        }}
      >
        {hasAnyMoves ? (
          <>
            {renderLine(tree.children[0])}
            {tree.children.slice(1).map(alt => renderVariationBlock(alt))}
          </>

        ) : (
          <div
            style={{
              padding: '40px 0',
              textAlign: 'center' as const,
              fontSize: 14,
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

      {/* Confirm delete dialog */}
      {deleteConfirm && (
        <div
          data-testid="delete-confirm-dialog"
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.3)',
            zIndex: 1100,
          }}
        >
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              padding: '24px 28px',
              minWidth: 280,
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            }}
          >
            <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>
              {t('creator.lessonEditor.deleteSubtreeConfirm')}
            </p>
            <p style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 20 }}>
              {t('creator.lessonEditor.deleteSubtreeConfirmBody', { count: deleteConfirm.subtreeSize })}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                data-testid="delete-confirm-cancel"
                className="btn btn-secondary btn-sm"
                onClick={() => setDeleteConfirm(null)}
              >
                {t('common.cancel', { defaultValue: 'Hủy' })}
              </button>
              <button
                type="button"
                data-testid="delete-confirm-ok"
                className="btn btn-sm"
                style={{ background: 'var(--danger)', color: '#fff', border: 'none' }}
                onClick={() => {
                  store.getState().deleteSubtree(deleteConfirm.nodeId)
                  setDeleteConfirm(null)
                }}
              >
                {t('common.delete', { defaultValue: 'Xóa' })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Navigation buttons — identical to learner viewer mode */}
      <div className="guided-player-actions">
        <button
          type="button"
          data-testid="board-authoring-nav-begin"
          className="btn btn-secondary"
          style={{ flex: 1, padding: 0, background: 'var(--surface-2)' }}
          aria-label={t('guidedPlayer.viewerBeginMove')}
          title={t('guidedPlayer.viewerBeginMove')}
          disabled={navAtRoot}
          onClick={() => store.getState().setCurrentNode(tree.id)}
        >
          <ChevronsLeft size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="board-authoring-nav-prev"
          className="btn btn-secondary"
          style={{ flex: 1, padding: 0, background: 'var(--surface-2)' }}
          aria-label={t('guidedPlayer.viewerPrevMove')}
          title={t('guidedPlayer.viewerPrevMove')}
          disabled={navAtRoot}
          onClick={() => { if (currentNode.parentId) store.getState().setCurrentNode(currentNode.parentId) }}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="board-authoring-nav-next"
          className="btn btn-secondary"
          style={{ flex: 1, padding: 0, background: 'var(--surface-2)' }}
          aria-label={t('guidedPlayer.viewerNextMove')}
          title={t('guidedPlayer.viewerNextMove')}
          disabled={navAtLeaf}
          onClick={() => { const next = currentNode.children[0]; if (next) store.getState().setCurrentNode(next.id) }}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="board-authoring-nav-end"
          className="btn btn-secondary"
          style={{ flex: 1, padding: 0, background: 'var(--surface-2)' }}
          aria-label={t('guidedPlayer.viewerEndMove')}
          title={t('guidedPlayer.viewerEndMove')}
          disabled={navAtMainLineEnd || !mainLineEndId}
          onClick={() => { if (mainLineEndId) store.getState().setCurrentNode(mainLineEndId) }}
        >
          <ChevronsRight size={18} aria-hidden="true" />
        </button>
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
          padding: '16px 28px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--ink-3)',
              textTransform: 'uppercase' as const,
              letterSpacing: '0.08em',
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
          <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>
            {t('creator.lessonEditor.notePanelRootHint', { defaultValue: 'Chọn một nước để thêm ghi chú' })}
          </p>
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
