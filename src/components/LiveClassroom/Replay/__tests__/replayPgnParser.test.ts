import { describe, it, expect } from 'vitest'
import {
  parseGamePgnForReplay,
  START_FEN,
} from '../replayPgnParser'

describe('replayPgnParser', () => {
  it('handles null, undefined, empty, and whitespace PGN gracefully', () => {
    const res1 = parseGamePgnForReplay(null)
    expect(res1.valid).toBe(false)
    expect(res1.error).toContain('Biên bản ván đấu trống')
    expect(res1.moves).toHaveLength(0)

    const res2 = parseGamePgnForReplay(undefined)
    expect(res2.valid).toBe(false)
    expect(res2.error).toContain('Biên bản ván đấu trống')

    const res3 = parseGamePgnForReplay('')
    expect(res3.valid).toBe(false)
    expect(res3.error).toContain('Biên bản ván đấu trống')

    const res4 = parseGamePgnForReplay('   \n  \t ')
    expect(res4.valid).toBe(false)
    expect(res4.error).toContain('Biên bản ván đấu trống')
  })

  it('handles PGN with only headers and no moves', () => {
    const headerOnlyPgn = '[Event "Session Game"]\n[Site "Live Classroom"]\n[Result "*"]\n*'
    const res = parseGamePgnForReplay(headerOnlyPgn)
    expect(res.valid).toBe(false)
    expect(res.error).toContain('không chứa nước đi hợp lệ')
    expect(res.moves).toHaveLength(0)
  })

  it('handles malformed / corrupted PGN syntax', () => {
    const malformed = '1. ??? e4 invalid_syntax !!!'
    const res = parseGamePgnForReplay(malformed)
    expect(res.valid).toBe(false)
    expect(res.error).toContain('không hợp lệ')
    expect(res.moves).toHaveLength(0)
  })

  it('handles illegal chess moves in PGN', () => {
    // White cannot play e5 on move 1
    const illegalPgn = '1. e5 Nc6'
    const res = parseGamePgnForReplay(illegalPgn)
    expect(res.valid).toBe(false)
    expect(res.error).toContain('không hợp lệ')
    expect(res.moves).toHaveLength(0)
  })

  it('correctly parses a standard PGN sequence with multiple moves', () => {
    const pgn = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 1-0'
    const res = parseGamePgnForReplay(pgn)

    expect(res.valid).toBe(true)
    expect(res.error).toBeNull()
    expect(res.startingFen).toBe(START_FEN)
    expect(res.moves).toHaveLength(8)

    // Check first move
    expect(res.moves[0]).toMatchObject({
      index: 0,
      ply: 1,
      moveNumber: 1,
      color: 'w',
      san: 'e4',
      from: 'e2',
      to: 'e4',
    })
    expect(res.moves[0].beforeFen).toBe(START_FEN)
    expect(res.moves[0].fen).toContain('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')

    // Check second move
    expect(res.moves[1]).toMatchObject({
      index: 1,
      ply: 2,
      moveNumber: 1,
      color: 'b',
      san: 'e5',
      from: 'e7',
      to: 'e5',
    })

    // Check third move
    expect(res.moves[2]).toMatchObject({
      index: 2,
      ply: 3,
      moveNumber: 2,
      color: 'w',
      san: 'Nf3',
      from: 'g1',
      to: 'f3',
    })

    // Check grouped move pairs
    expect(res.movePairs).toHaveLength(4)
    expect(res.movePairs[0].moveNumber).toBe(1)
    expect(res.movePairs[0].white?.san).toBe('e4')
    expect(res.movePairs[0].black?.san).toBe('e5')

    expect(res.movePairs[1].moveNumber).toBe(2)
    expect(res.movePairs[1].white?.san).toBe('Nf3')
    expect(res.movePairs[1].black?.san).toBe('Nc6')

    expect(res.movePairs[3].moveNumber).toBe(4)
    expect(res.movePairs[3].white?.san).toBe('Ba4')
    expect(res.movePairs[3].black?.san).toBe('Nf6')
  })

  it('correctly parses custom starting FEN positions', () => {
    const customFen = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2'
    const pgn = '2. Nf3 d6 3. d4 cxd4'
    const res = parseGamePgnForReplay(pgn, customFen)

    expect(res.valid).toBe(true)
    expect(res.error).toBeNull()
    expect(res.startingFen).toBe(customFen)
    expect(res.moves).toHaveLength(4)
    expect(res.moves[0].moveNumber).toBe(2)
    expect(res.moves[0].san).toBe('Nf3')
    expect(res.moves[1].san).toBe('d6')
  })
})
