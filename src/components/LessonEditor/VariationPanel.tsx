import { useSyncExternalStore, useState, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
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

  function isMainMove(node: PgnNode): boolean {
    if (!node.parentId) return true
    const parent = nodeMap.get(node.parentId)
    if (!parent) return true
    return parent.children[0]?.id === node.id
  }

  function renderMoveCell(node: PgnNode): ReactNode {
    const isCurrentNode = node.id === currentNodeId
    const hasNote = !!node.note
    const isMain = isMainMove(node)

    return (
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
          padding: '3px 6px',
          background: isCurrentNode ? 'var(--surface-3)' : 'transparent',
          borderRadius: 'var(--r-sm)',
          cursor: 'pointer',
          fontWeight: isCurrentNode ? 600 : 400,
          fontSize: 12.5,
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          userSelect: 'none' as const,
          color: 'var(--ink-1)',
          minWidth: 0,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.san}
        </span>
        {hasNote && (
          <span aria-label="Có ghi chú" style={{ fontSize: 10, color: 'var(--ink-3)', flexShrink: 0 }}>
            ✎
          </span>
        )}
      </div>
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
              gridTemplateColumns: '30px 1fr 1fr',
              alignItems: 'center',
              paddingInline: 8,
              paddingBlock: 1,
              gap: 2,
            }}
          >
            <span
              style={{
                color: 'var(--ink-3)',
                fontSize: 11,
                userSelect: 'none' as const,
                paddingLeft: 2,
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
              gridTemplateColumns: '30px 1fr 1fr',
              alignItems: 'center',
              paddingInline: 8,
              paddingBlock: 1,
              gap: 2,
            }}
          >
            <span
              style={{
                color: 'var(--ink-3)',
                fontSize: 11,
                userSelect: 'none' as const,
                paddingLeft: 2,
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
          <>
            {renderLine(tree.children[0])}
            {tree.children.slice(1).map(alt => renderVariationBlock(alt))}
          </>

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

      {/* Navigation buttons — full-width, same style as learner viewer */}
      <div className="guided-player-actions" style={{ padding: 0, gap: 0, background: 'var(--surface-2)' }}>
        <button
          type="button"
          data-testid="board-authoring-nav-begin"
          className="btn btn-secondary"
          style={{ flex: 1, padding: 0, height: 44, background: 'var(--surface-2)', borderRadius: 0, border: 'none', borderTop: '1px solid var(--border)' }}
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
          style={{ flex: 1, padding: 0, height: 44, background: 'var(--surface-2)', borderRadius: 0, border: 'none', borderTop: '1px solid var(--border)', borderLeft: '1px solid var(--border)' }}
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
          style={{ flex: 1, padding: 0, height: 44, background: 'var(--surface-2)', borderRadius: 0, border: 'none', borderTop: '1px solid var(--border)', borderLeft: '1px solid var(--border)' }}
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
          style={{ flex: 1, padding: 0, height: 44, background: 'var(--surface-2)', borderRadius: 0, border: 'none', borderTop: '1px solid var(--border)', borderLeft: '1px solid var(--border)' }}
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
