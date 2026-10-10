import { Chess } from 'chess.js'

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export interface ReplayMove {
  index: number // 0-indexed position in move list
  ply: number // 1-indexed ply count
  moveNumber: number // Move number from FEN (e.g. 1, 2, 3...)
  color: 'w' | 'b'
  san: string // e.g. "e4", "Nf3", "O-O"
  from: string // e.g. "e2"
  to: string // e.g. "e4"
  fen: string // Board FEN after this move
  beforeFen: string // Board FEN before this move
  captured?: string
  promotion?: string
}

export interface ReplayMovePair {
  moveNumber: number
  white?: ReplayMove
  black?: ReplayMove
}

export interface ParseReplayResult {
  valid: boolean
  error: string | null
  startingFen: string
  moves: ReplayMove[]
  movePairs: ReplayMovePair[]
}

/**
 * Parses a persisted PGN string for a live game and extracts its step-by-step
 * FEN sequence, moves, and notation pairs for read-only replay.
 */
export function parseGamePgnForReplay(
  pgn: string | null | undefined,
  customStartingFen?: string | null
): ParseReplayResult {
  const initialFen = (customStartingFen && customStartingFen.trim().length > 0)
    ? customStartingFen.trim()
    : START_FEN

  // 1. Guard against empty, null, or whitespace-only PGN
  if (!pgn || pgn.trim().length === 0) {
    return {
      valid: false,
      error: 'Biên bản ván đấu trống — không có nước đi nào để phát lại.',
      startingFen: initialFen,
      moves: [],
      movePairs: [],
    }
  }

  const trimmedPgn = pgn.trim()

  try {
    const chess = new Chess(initialFen)

    // Prepare PGN text with custom FEN header if starting from non-standard position
    let pgnToLoad = trimmedPgn
    if (initialFen !== START_FEN && !trimmedPgn.includes('[FEN ') && !trimmedPgn.includes('[SetUp ')) {
      pgnToLoad = `[SetUp "1"]\n[FEN "${initialFen}"]\n\n${trimmedPgn}`
    }

    chess.loadPgn(pgnToLoad)

    const verboseHistory = chess.history({ verbose: true })

    if (verboseHistory.length === 0) {
      return {
        valid: false,
        error: 'Biên bản ván đấu không chứa nước đi hợp lệ nào.',
        startingFen: initialFen,
        moves: [],
        movePairs: [],
      }
    }

    const startingFen = initialFen

    const moves: ReplayMove[] = verboseHistory.map((histMove, idx) => {
      // Determine move number from the FEN before the move
      const fenParts = (histMove.before || '').split(' ')
      const moveNumberFromFen = parseInt(fenParts[5] || '1', 10)
      const ply = idx + 1

      return {
        index: idx,
        ply,
        moveNumber: isNaN(moveNumberFromFen) ? Math.floor(idx / 2) + 1 : moveNumberFromFen,
        color: histMove.color,
        san: histMove.san,
        from: histMove.from,
        to: histMove.to,
        fen: histMove.after,
        beforeFen: histMove.before,
        captured: histMove.captured,
        promotion: histMove.promotion,
      }
    })

    // Group moves into pairs (White & Black) by moveNumber
    const pairsMap = new Map<number, ReplayMovePair>()
    for (const m of moves) {
      let pair = pairsMap.get(m.moveNumber)
      if (!pair) {
        pair = { moveNumber: m.moveNumber }
        pairsMap.set(m.moveNumber, pair)
      }
      if (m.color === 'w') {
        pair.white = m
      } else {
        pair.black = m
      }
    }

    const movePairs = Array.from(pairsMap.values()).sort((a, b) => a.moveNumber - b.moveNumber)

    return {
      valid: true,
      error: null,
      startingFen,
      moves,
      movePairs,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      valid: false,
      error: `Biên bản ván đấu không hợp lệ: ${message}`,
      startingFen: initialFen,
      moves: [],
      movePairs: [],
    }
  }
}
