import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  addBookmark,
  getBookmarks,
  deleteBookmark,
  getBookmarkForLesson,
  resolveBookmark,
} from './bookmarkApi'
import type { BookmarkRow } from './bookmarkApi'
import type { PgnParseResult, PgnNode } from '../utils/parsePgn'

// ---- resolveBookmark helpers ----

function makeNode(id: string, parentId: string | null, children: PgnNode[] = []): PgnNode {
  return {
    id,
    san: 'e4',
    from: 'e2',
    to: 'e4',
    promotion: undefined,
    fen: `fen-${id}`,
    moveNumber: 1,
    side: 'w',
    annotation: undefined,
    parentId,
    children,
    depthFromRoot: 1,
  }
}

function makeBookmark(overrides: Partial<BookmarkRow> = {}): BookmarkRow {
  return {
    id: 'bm1',
    user_id: 'u1',
    lesson_id: 'l1',
    pgn_snapshot: 'fen-node-b',
    node_id: null,
    played_plies: null,
    created_at: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

function makeParsed(nodes: PgnNode[]): PgnParseResult {
  const root = makeNode('root', null, nodes)
  root.san = ''
  const nodeMap = new Map<string, PgnNode>([['root', root]])
  for (const n of nodes) nodeMap.set(n.id, n)
  return {
    valid: true,
    root,
    totalNodes: nodes.length + 1,
    variationCount: 0,
    maxDepth: nodes.length,
    mainLine: nodes,
    nodeMap,
    moveCount: nodes.length,
    annotationCount: 0,
    fen: nodes[nodes.length - 1]?.fen ?? '',
    annotations: [],
  }
}

function makeClient(overrides: Record<string, unknown> = {}): SupabaseClient {
  const chain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  }
  return {
    from: vi.fn().mockReturnValue(chain),
  } as unknown as SupabaseClient
}

describe('resolveBookmark', () => {
  it('returns node via nodeMap when node_id is set and found (O(1) hit)', () => {
    const nodeB = makeNode('node-b', 'root')
    const parsed = makeParsed([nodeB])
    const bookmark = makeBookmark({ node_id: 'node-b' })

    // spy on nodeMap.get to confirm it is called (O(1) path, no walk)
    const getSpy = vi.spyOn(parsed.nodeMap, 'get')
    const result = resolveBookmark(parsed, bookmark)

    expect(result).not.toBeNull()
    expect(result!.nodeId).toBe('node-b')
    expect(result!.node).toBe(nodeB)
    expect(getSpy).toHaveBeenCalledWith('node-b')
  })

  it('walks children[0] × played_plies when node_id is NULL', () => {
    const nodeA = makeNode('node-a', 'root')
    const nodeB = makeNode('node-b', 'node-a')
    nodeA.children = [nodeB]
    const parsed = makeParsed([nodeA, nodeB])
    const bookmark = makeBookmark({ node_id: null, played_plies: 2 })

    const result = resolveBookmark(parsed, bookmark)

    expect(result).not.toBeNull()
    expect(result!.nodeId).toBe('node-b')
  })

  it('falls through to legacy ply-walk when node_id is stale (not in tree)', () => {
    const nodeA = makeNode('node-a', 'root')
    const nodeB = makeNode('node-b', 'node-a')
    nodeA.children = [nodeB]
    const parsed = makeParsed([nodeA, nodeB])
    const bookmark = makeBookmark({ node_id: 'stale-id-xyz', played_plies: 1 })

    const result = resolveBookmark(parsed, bookmark)

    // stale node_id falls through to ply-walk → depth 1 → node-a
    expect(result).not.toBeNull()
    expect(result!.nodeId).toBe('node-a')
  })
})

describe('addBookmark', () => {
  it('inserts a bookmark row and returns it', async () => {
    const mockBookmark = {
      id: 'bm1',
      user_id: 'u1',
      lesson_id: 'l1',
      pgn_snapshot: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
      node_id: 'node-abc',
      played_plies: 1,
      created_at: '2026-05-01T00:00:00Z',
    }

    const single = vi.fn().mockResolvedValue({ data: mockBookmark, error: null })
    const chain = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      single,
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const result = await addBookmark(client, {
      userId: 'u1',
      lessonId: 'l1',
      pgnSnapshot: mockBookmark.pgn_snapshot,
      nodeId: 'node-abc',
      playedPlies: 1,
    })

    expect(result.bookmark).toEqual(mockBookmark)
    expect(result.error).toBeNull()
    expect(chain.insert).toHaveBeenCalledWith({
      user_id: 'u1',
      lesson_id: 'l1',
      pgn_snapshot: mockBookmark.pgn_snapshot,
      node_id: 'node-abc',
      played_plies: 1,
    })
  })

  it('returns error when insert fails', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } })
    const chain = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      single,
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const result = await addBookmark(client, {
      userId: 'u1',
      lessonId: 'l1',
      pgnSnapshot: 'some-fen',
    })

    expect(result.bookmark).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error?.message).toBe('DB error')
  })
})

describe('getBookmarks', () => {
  it('returns bookmarks with lesson/course info', async () => {
    const rawRows = [
      {
        id: 'bm1',
        user_id: 'u1',
        lesson_id: 'l1',
        pgn_snapshot: 'some-fen',
        created_at: '2026-05-01T00:00:00Z',
        lessons: {
          id: 'l1',
          title: 'The Opening',
          chapters: {
            course_id: 'c1',
            courses: { id: 'c1', title: 'Italian Game Mastery' },
          },
        },
      },
    ]

    const order = vi.fn().mockResolvedValue({ data: rawRows, error: null })
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order,
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const result = await getBookmarks(client, 'u1')

    expect(result.error).toBeNull()
    expect(result.bookmarks).toHaveLength(1)
    expect(result.bookmarks![0].id).toBe('bm1')
    expect(result.bookmarks![0].lesson_title).toBe('The Opening')
    expect(result.bookmarks![0].course_title).toBe('Italian Game Mastery')
    expect(result.bookmarks![0].course_id).toBe('c1')
  })

  it('returns empty array when user has no bookmarks', async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null })
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order,
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const result = await getBookmarks(client, 'u1')

    expect(result.error).toBeNull()
    expect(result.bookmarks).toEqual([])
  })

  it('returns error on DB failure', async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { message: 'connection error' } })
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order,
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const result = await getBookmarks(client, 'u1')

    expect(result.bookmarks).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
  })
})

describe('deleteBookmark', () => {
  it('deletes a bookmark and returns no error', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const chain = {
      delete: vi.fn().mockReturnThis(),
      eq,
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const result = await deleteBookmark(client, 'bm1')

    expect(result.error).toBeNull()
    expect(eq).toHaveBeenCalledWith('id', 'bm1')
  })

  it('returns error when delete fails', async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: 'not found' } })
    const chain = {
      delete: vi.fn().mockReturnThis(),
      eq,
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const result = await deleteBookmark(client, 'bm1')

    expect(result.error).toBeInstanceOf(Error)
    expect(result.error?.message).toBe('not found')
  })
})

describe('getBookmarkForLesson', () => {
  it('returns the bookmark when one exists for this user+lesson', async () => {
    const mockBookmark = {
      id: 'bm1',
      user_id: 'u1',
      lesson_id: 'l1',
      pgn_snapshot: 'some-fen',
      created_at: '2026-05-01T00:00:00Z',
    }

    const maybeSingle = vi.fn().mockResolvedValue({ data: mockBookmark, error: null })
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle,
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const result = await getBookmarkForLesson(client, { userId: 'u1', lessonId: 'l1' })

    expect(result.bookmark).toEqual(mockBookmark)
    expect(result.error).toBeNull()
  })

  it('returns null bookmark when not bookmarked', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle,
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const result = await getBookmarkForLesson(client, { userId: 'u1', lessonId: 'l1' })

    expect(result.bookmark).toBeNull()
    expect(result.error).toBeNull()
  })
})
