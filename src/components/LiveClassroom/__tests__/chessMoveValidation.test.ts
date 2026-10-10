import { describe, it, expect } from 'vitest'
import { Chess } from 'chess.js'

describe('LiveBoard move validation & game lifecycle', () => {
  it('validates legal opening moves and updates FEN', () => {
    const chess = new Chess()
    const move = chess.move({ from: 'e2', to: 'e4' })
    expect(move).not.toBeNull()
    expect(move?.san).toBe('e4')
    expect(chess.turn()).toBe('b')
  })

  it('rejects illegal moves', () => {
    const chess = new Chess()
    expect(() => chess.move({ from: 'e2', to: 'e5' })).toThrow()
  })

  it('handles pawn promotion properly', () => {
    // White pawn on e7 ready to promote on e8
    const promoFen = '8/4P3/8/8/8/8/8/k6K w - - 0 1'
    const chess = new Chess(promoFen)
    const move = chess.move({ from: 'e7', to: 'e8', promotion: 'q' })
    expect(move).not.toBeNull()
    expect(move?.promotion).toBe('q')
    expect(move?.san).toBe('e8=Q')
  })

  it('detects checkmate and generates valid PGN for game review', () => {
    // Scholar's Mate
    const chess = new Chess()
    chess.move('e4')
    chess.move('e5')
    chess.move('Bc4')
    chess.move('Nc6')
    chess.move('Qh5')
    chess.move('Nf6')
    const finalMove = chess.move('Qxf7#')

    expect(finalMove).not.toBeNull()
    expect(chess.isCheckmate()).toBe(true)
    expect(chess.isGameOver()).toBe(true)

    const pgn = chess.pgn()
    expect(pgn).toContain('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#')
  })
})
