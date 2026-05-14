/**
 * treeStore — PRD-0004 Slice 5a
 *
 * Zustand store for chess lesson tree authoring.
 * State: { tree: PgnNode, currentNodeId: string, dirty: boolean }
 * Scope: editor-only. The player reads from parsePgn once (read-only).
 */

import { createStore } from 'zustand/vanilla'
import { Chess } from 'chess.js'
import type { PgnNode, Shape, RichTextDoc } from '../../utils/parsePgn'

// ── Node ID hashing (same algorithm as parsePgn — V-16) ───────────────────────

function fnv1a32(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h ^ s.charCodeAt(i), 16777619)) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function makeNodeId(parentId: string | null, from: string, to: string, promotion = ''): string {
  return fnv1a32(`${parentId ?? 'root'}/${from}${to}${promotion}`)
}

// ── Root sentinel factory ─────────────────────────────────────────────────────

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function createRootNode(fen: string = START_FEN): PgnNode {
  return {
    id: 'root',
    san: '',
    from: '',
    to: '',
    promotion: undefined,
    fen,
    moveNumber: 0,
    side: 'w',
    annotation: undefined,
    parentId: null,
    children: [],
    depthFromRoot: 0,
    note: null,
    shapes: [],
    purpose: null,
  }
}

// ── Store types ───────────────────────────────────────────────────────────────

export interface TreeState {
  tree: PgnNode
  currentNodeId: string
  dirty: boolean

  // Actions
  applyMove: (from: string, to: string, promotion?: string) => void
  setCurrentNode: (nodeId: string) => void
  replaceTree: (root: PgnNode) => void
  /** Set a custom starting FEN — resets the tree to a new root at that position. */
  setStartingFen: (fen: string) => void

  // Placeholder actions (wired in later slices)
  setShapes: (nodeId: string, shapes: Shape[]) => void
  setNote: (nodeId: string, note: RichTextDoc | null) => void
  setPurpose: (nodeId: string, purpose: 'correct' | 'mistake' | null) => void
  deleteSubtree: (nodeId: string) => void
  promoteVariation: (nodeId: string) => void
}

// ── nodeMap helper ────────────────────────────────────────────────────────────

/** Build a flat Map<id, PgnNode> from a tree rooted at `root`. */
function buildNodeMap(root: PgnNode): Map<string, PgnNode> {
  const map = new Map<string, PgnNode>()
  function walk(node: PgnNode) {
    map.set(node.id, node)
    for (const child of node.children) walk(child)
  }
  walk(root)
  return map
}

// ── Store factory ─────────────────────────────────────────────────────────────

export function createTreeStore() {
  return createStore<TreeState>()((set, get) => ({
    tree: createRootNode(),
    currentNodeId: 'root',
    dirty: false,

    applyMove(from: string, to: string, promotion?: string) {
      const state = get()
      const nodeMap = buildNodeMap(state.tree)
      const currentNode = nodeMap.get(state.currentNodeId)
      if (!currentNode) return

      // Check if this exact move already exists as a child
      const existing = currentNode.children.find(
        (c) => c.from === from && c.to === to && (c.promotion ?? '') === (promotion ?? '')
      )
      if (existing) {
        // Navigate to existing node without adding a duplicate
        set({ currentNodeId: existing.id, dirty: true })
        return
      }

      // Validate the move with chess.js using the current position FEN
      const chess = new Chess(currentNode.fen)
      let moveResult: ReturnType<Chess['move']>
      try {
        const moveInput = promotion
          ? { from, to, promotion: promotion as 'q' | 'r' | 'b' | 'n' }
          : { from, to }
        moveResult = chess.move(moveInput)
      } catch {
        // Invalid move — ignore
        return
      }

      const depth = currentNode.depthFromRoot + 1
      const promo = moveResult.promotion as string | undefined
      const id = makeNodeId(currentNode.id, moveResult.from, moveResult.to, promo ?? '')
      const fen = chess.fen()
      const fenSide = fen.split(' ')[1] as 'w' | 'b'
      const sideMoved: 'w' | 'b' = fenSide === 'w' ? 'b' : 'w'

      const newNode: PgnNode = {
        id,
        san: moveResult.san,
        from: moveResult.from,
        to: moveResult.to,
        promotion: promo,
        fen,
        moveNumber: Math.ceil(depth / 2),
        side: sideMoved,
        annotation: undefined,
        parentId: currentNode.id,
        children: [],
        depthFromRoot: depth,
        note: null,
        shapes: [],
        purpose: null,
      }

      // Mutate the tree by adding the new node to the current node's children.
      // We do an immutable clone of the path from root to currentNode,
      // but for simplicity (editor-only, no need for React rendering immutability
      // at this layer), we directly mutate and trigger a re-render via set().
      currentNode.children.push(newNode)

      set({ tree: { ...state.tree }, currentNodeId: id, dirty: true })
    },

    setCurrentNode(nodeId: string) {
      set({ currentNodeId: nodeId })
    },

    replaceTree(root: PgnNode) {
      set({ tree: root, currentNodeId: 'root', dirty: false })
    },

    setStartingFen(fen: string) {
      set({ tree: createRootNode(fen), currentNodeId: 'root', dirty: true })
    },

    // ── Placeholder actions ───────────────────────────────────────────────────

    setShapes(nodeId: string, shapes: Shape[]) {
      const state = get()
      const nodeMap = buildNodeMap(state.tree)
      const node = nodeMap.get(nodeId)
      if (!node) return
      node.shapes = shapes
      set({ tree: { ...state.tree }, dirty: true })
    },

    setNote(nodeId: string, note: RichTextDoc | null) {
      const state = get()
      const nodeMap = buildNodeMap(state.tree)
      const target = nodeMap.get(nodeId)
      if (!target) return
      target.note = note
      set({ tree: { ...state.tree }, dirty: true })
    },

    setPurpose(_nodeId: string, _purpose: 'correct' | 'mistake' | null) {
      // No-op placeholder — wired in slice 9a (#196)
    },

    deleteSubtree(_nodeId: string) {
      // No-op placeholder — wired in slice 5b (#200)
    },

    promoteVariation(_nodeId: string) {
      // No-op placeholder — wired in slice 5b (#200)
    },
  }))
}

/** Convenience hook-friendly re-export using React hooks */
export type TreeStore = ReturnType<typeof createTreeStore>
