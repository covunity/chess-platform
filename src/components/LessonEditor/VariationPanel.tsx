import { useSyncExternalStore, useState, useEffect } from 'react'
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

function countSubtreeNodes(node: PgnNode): number {
  let n = 1
  for (const c of node.children) n += countSubtreeNodes(c)
  return n
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

  // Context menu state (right-click on a variation node)
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string
    x: number
    y: number
    isMain: boolean
  } | null>(null)

  // Confirm delete dialog state
  const [deleteConfirm, setDeleteConfirm] = useState<{
    nodeId: string
    subtreeSize: number
  } | null>(null)

  // Close context menu on outside mousedown
  useEffect(() => {
    if (!contextMenu) return
    function handleOutside() { setContextMenu(null) }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [contextMenu])

  function renderVariationNode(node: PgnNode, depth: number, siblingIndex: number): ReactNode[] {
    const rows: ReactNode[] = []
    const isCurrentNode = node.id === currentNodeId
    const hasMultipleResponses = node.children.length > 1
    const hasNote = !!node.note
    const isMain = siblingIndex === 0

    rows.push(
      <div
        key={node.id}
        data-testid={`variation-node-${node.id}`}
        role="button"
        tabIndex={0}
        onClick={() => store.getState().setCurrentNode(node.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          setContextMenu({ nodeId: node.id, x: e.clientX, y: e.clientY, isMain })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            store.getState().setCurrentNode(node.id)
          } else if (e.key === 'Delete') {
            e.preventDefault()
            setDeleteConfirm({ nodeId: node.id, subtreeSize: countSubtreeNodes(node) })
          }
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
        {hasMultipleResponses && (
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

    for (let i = 0; i < node.children.length; i++) {
      rows.push(...renderVariationNode(node.children[i], depth + 1, i))
    }
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
          tree.children.flatMap((child, idx) => renderVariationNode(child, 1, idx))
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

      {/* Context menu — right-click on a variation node */}
      {contextMenu && (
        <div
          data-testid="variation-context-menu"
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-sm)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            zIndex: 1000,
            minWidth: 200,
            padding: '4px 0',
          }}
        >
          <button
            type="button"
            data-testid="ctx-promote-btn"
            disabled={contextMenu.isMain}
            onClick={() => {
              store.getState().promoteVariation(contextMenu.nodeId)
              setContextMenu(null)
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '7px 14px',
              fontSize: 13,
              border: 'none',
              background: 'transparent',
              cursor: contextMenu.isMain ? 'not-allowed' : 'pointer',
              color: contextMenu.isMain ? 'var(--ink-3)' : 'var(--ink-1)',
            }}
          >
            {t('creator.lessonEditor.promoteVariation')}
          </button>
          <button
            type="button"
            data-testid="ctx-delete-btn"
            onClick={() => {
              const node = nodeMap.get(contextMenu.nodeId)
              if (!node) return
              setDeleteConfirm({ nodeId: contextMenu.nodeId, subtreeSize: countSubtreeNodes(node) })
              setContextMenu(null)
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '7px 14px',
              fontSize: 13,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--danger)',
            }}
          >
            {t('creator.lessonEditor.deleteSubtree')}
          </button>
        </div>
      )}

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
