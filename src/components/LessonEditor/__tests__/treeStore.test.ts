/**
 * treeStore tests — PRD-0004 Slice 5a
 * Follows TDD: one test → RED → minimal impl → GREEN → repeat.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { parsePgn } from '../../../utils/parsePgn'
import { serializePgn } from '../../../utils/serializePgn'

// We import via the public module path. If the store doesn't exist yet, this fails (RED).
import { createTreeStore } from '../treeStore'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function freshStore() {
  return createTreeStore()
}

describe('treeStore', () => {
  describe('initial state', () => {
    it('starts with an empty root tree', () => {
      const store = freshStore()
      const state = store.getState()
      expect(state.tree.id).toBe('root')
      expect(state.tree.children).toHaveLength(0)
    })

    it('starts with currentNodeId = root', () => {
      const store = freshStore()
      expect(store.getState().currentNodeId).toBe('root')
    })

    it('starts not dirty', () => {
      const store = freshStore()
      expect(store.getState().dirty).toBe(false)
    })
  })

  describe('applyMove', () => {
    it('creates a child node when applyMove is called from root', () => {
      const store = freshStore()
      store.getState().applyMove('e2', 'e4')
      const state = store.getState()
      expect(state.tree.children).toHaveLength(1)
      expect(state.tree.children[0].san).toBe('e4')
    })

    it('sets currentNodeId to the new node after applyMove', () => {
      const store = freshStore()
      store.getState().applyMove('e2', 'e4')
      const state = store.getState()
      const nodeId = state.tree.children[0].id
      expect(state.currentNodeId).toBe(nodeId)
    })

    it('marks store dirty after applyMove', () => {
      const store = freshStore()
      store.getState().applyMove('e2', 'e4')
      expect(store.getState().dirty).toBe(true)
    })

    it('creates a linear chain for sequential moves', () => {
      const store = freshStore()
      store.getState().applyMove('e2', 'e4')
      store.getState().applyMove('e7', 'e5')
      const state = store.getState()
      const e4 = state.tree.children[0]
      expect(e4.children).toHaveLength(1)
      expect(e4.children[0].san).toBe('e5')
    })

    it('creates a sibling variation when a different move is played from the same position', () => {
      const store = freshStore()
      // Play e4, navigate back to root, play d4 → d4 should be sibling of e4
      store.getState().applyMove('e2', 'e4')
      store.getState().setCurrentNode('root')
      store.getState().applyMove('d2', 'd4')
      const state = store.getState()
      expect(state.tree.children).toHaveLength(2)
      const sans = state.tree.children.map((c) => c.san)
      expect(sans).toContain('e4')
      expect(sans).toContain('d4')
    })

    it('does not create a duplicate node if the same move is repeated', () => {
      const store = freshStore()
      store.getState().applyMove('e2', 'e4')
      store.getState().setCurrentNode('root')
      store.getState().applyMove('e2', 'e4')
      // Should reuse the existing node, not add a duplicate
      expect(store.getState().tree.children).toHaveLength(1)
    })

    it('handles promotion moves by storing the promotion piece', () => {
      // King + pawn vs King: 8/4P3/8/8/8/8/8/8 w - - 0 1 (white pawn on e7, can promote to e8)
      const store = freshStore()
      const parsed = parsePgn('[FEN "8/4P3/8/8/8/8/k6K/8 w - - 0 1"] 1. e8=Q+')
      store.getState().replaceTree(parsed.root!)
      store.getState().setCurrentNode('root')
      store.getState().applyMove('e7', 'e8', 'q')
      const state = store.getState()
      // There should be the existing node + the new promotion node (or reuse)
      // The e8=Q node should have promotion = 'q'
      const promNode = state.tree.children.find((c) => c.promotion === 'q')
      expect(promNode).toBeDefined()
      expect(promNode?.promotion).toBe('q')
    })
  })

  describe('setCurrentNode', () => {
    it('updates currentNodeId to the specified node', () => {
      const store = freshStore()
      store.getState().applyMove('e2', 'e4')
      const e4Id = store.getState().tree.children[0].id
      store.getState().setCurrentNode('root')
      expect(store.getState().currentNodeId).toBe('root')
      store.getState().setCurrentNode(e4Id)
      expect(store.getState().currentNodeId).toBe(e4Id)
    })
  })

  describe('replaceTree', () => {
    it('replaces the tree with a parsed PGN root node', () => {
      const store = freshStore()
      const parsed = parsePgn('1. e4 e5 2. Nf3 Nc6')
      store.getState().replaceTree(parsed.root!)
      const state = store.getState()
      expect(state.tree.children[0].san).toBe('e4')
    })

    it('resets currentNodeId to root after replaceTree', () => {
      const store = freshStore()
      store.getState().applyMove('e2', 'e4')
      const parsed = parsePgn('1. d4 d5')
      store.getState().replaceTree(parsed.root!)
      expect(store.getState().currentNodeId).toBe('root')
    })

    it('clears dirty flag after replaceTree', () => {
      const store = freshStore()
      store.getState().applyMove('e2', 'e4')
      expect(store.getState().dirty).toBe(true)
      const parsed = parsePgn('1. d4 d5')
      store.getState().replaceTree(parsed.root!)
      expect(store.getState().dirty).toBe(false)
    })
  })

  describe('round-trip serialization', () => {
    it('serializePgn of the tree after applyMove produces a valid PGN', () => {
      const store = freshStore()
      store.getState().applyMove('e2', 'e4')
      store.getState().applyMove('e7', 'e5')
      const pgn = serializePgn(store.getState().tree)
      const parsed = parsePgn(pgn)
      expect(parsed.valid).toBe(true)
      expect(parsed.mainLine[0].san).toBe('e4')
      expect(parsed.mainLine[1].san).toBe('e5')
    })

    it('round-trips a branching tree via serializePgn → parsePgn', () => {
      const store = freshStore()
      store.getState().applyMove('e2', 'e4')
      store.getState().setCurrentNode('root')
      store.getState().applyMove('d2', 'd4')
      const pgn = serializePgn(store.getState().tree)
      const parsed = parsePgn(pgn)
      expect(parsed.valid).toBe(true)
      // Should have 2 root-level alternatives: e4 and d4
      const rootSans = parsed.root!.children.map((c) => c.san)
      expect(rootSans).toContain('e4')
      expect(rootSans).toContain('d4')
    })
  })

  describe('setStartingFen', () => {
    it('updates the tree root fen to the given starting FEN', () => {
      const store = freshStore()
      const customFen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
      store.getState().setStartingFen(customFen)
      expect(store.getState().tree.fen).toBe(customFen)
    })

    it('clears existing children when starting FEN changes', () => {
      const store = freshStore()
      store.getState().applyMove('e2', 'e4')
      const customFen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
      store.getState().setStartingFen(customFen)
      expect(store.getState().tree.children).toHaveLength(0)
    })

    it('resets currentNodeId to root when starting FEN changes', () => {
      const store = freshStore()
      store.getState().applyMove('e2', 'e4')
      const e4Id = store.getState().tree.children[0].id
      store.getState().setCurrentNode(e4Id)
      const customFen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
      store.getState().setStartingFen(customFen)
      expect(store.getState().currentNodeId).toBe('root')
    })

    it('marks store dirty after setStartingFen', () => {
      const store = freshStore()
      const customFen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
      store.getState().setStartingFen(customFen)
      expect(store.getState().dirty).toBe(true)
    })
  })

  describe('setShapes', () => {
    it('persists shapes on the specified node', () => {
      const store = freshStore()
      store.getState().applyMove('e2', 'e4')
      const e4Id = store.getState().tree.children[0].id
      const shapes = [{ kind: 'circle' as const, square: 'e4', color: 'green' as const }]
      store.getState().setShapes(e4Id, shapes)
      expect(store.getState().tree.children[0].shapes).toEqual(shapes)
    })

    it('marks store dirty after setShapes', () => {
      const store = freshStore()
      store.getState().applyMove('e2', 'e4')
      const e4Id = store.getState().tree.children[0].id
      const parsed = parsePgn('1. e4')
      store.getState().replaceTree(parsed.root!)
      expect(store.getState().dirty).toBe(false)
      store.getState().setShapes(e4Id, [{ kind: 'circle', square: 'e4', color: 'red' }])
      expect(store.getState().dirty).toBe(true)
    })

    it('replaces shapes on a node when called again', () => {
      const store = freshStore()
      store.getState().applyMove('e2', 'e4')
      const e4Id = store.getState().tree.children[0].id
      store.getState().setShapes(e4Id, [{ kind: 'circle', square: 'e4', color: 'green' }])
      store.getState().setShapes(e4Id, [{ kind: 'arrow', from: 'e4', to: 'e5', color: 'red' }])
      expect(store.getState().tree.children[0].shapes).toHaveLength(1)
      expect(store.getState().tree.children[0].shapes[0]).toMatchObject({ kind: 'arrow', color: 'red' })
    })

    it('round-trips shapes through serializePgn + parsePgn', () => {
      const store = freshStore()
      store.getState().applyMove('e2', 'e4')
      const e4Id = store.getState().tree.children[0].id
      const shapes = [{ kind: 'arrow' as const, from: 'e2', to: 'e4', color: 'green' as const }]
      store.getState().setShapes(e4Id, shapes)
      const pgn = serializePgn(store.getState().tree)
      const parsed = parsePgn(pgn)
      const e4Node = parsed.root!.children[0]
      expect(e4Node.shapes).toEqual(shapes)
    })
  })

  describe('placeholder no-op actions', () => {
    it('setShapes is callable without throwing', () => {
      const store = freshStore()
      expect(() => store.getState().setShapes('root', [])).not.toThrow()
    })

    it('setNote is callable without throwing', () => {
      const store = freshStore()
      expect(() =>
        store.getState().setNote('root', {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
        })
      ).not.toThrow()
    })

    it('setPurpose is callable without throwing', () => {
      const store = freshStore()
      expect(() => store.getState().setPurpose('root', 'correct')).not.toThrow()
    })

    it('deleteSubtree is callable without throwing', () => {
      const store = freshStore()
      expect(() => store.getState().deleteSubtree('root')).not.toThrow()
    })

    it('promoteVariation is callable without throwing', () => {
      const store = freshStore()
      expect(() => store.getState().promoteVariation('root')).not.toThrow()
    })
  })
})
