import { describe, it, expect } from 'vitest'
import { splitMultiGamePgn, extractGameTitle, extractStartingFen } from './pgnSplitter'
import fs from 'fs'
import path from 'path'

describe('pgnSplitter', () => {
  it('handles empty input gracefully', () => {
    expect(splitMultiGamePgn('')).toEqual([])
    expect(splitMultiGamePgn('   ')).toEqual([])
  })

  it('parses a single game PGN', () => {
    const pgn = `[Event "Casual Game"]
[Site "Local"]
[White "Player1"]
[Black "Player2"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0`

    const games = splitMultiGamePgn(pgn)
    expect(games.length).toBe(1)
    expect(games[0].title).toBe('Casual Game')
    expect(games[0].pgn).toContain('1. e4 e5')
  })

  it('extracts ChapterName as highest priority for title', () => {
    const pgn = `[Event "Study Event"]
[ChapterName "Khai cuộc Ruy Lopez"]
[White "Kasparov"]
[Black "Deep Blue"]

1. e4 e5 2. Nf3 *`

    expect(extractGameTitle(pgn, 1)).toBe('Khai cuộc Ruy Lopez')
  })

  it('extracts starting FEN if present', () => {
    const pgn = `[Event "Puzzle"]
[FEN "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"]

3. Bc4 Bc5 *`

    expect(extractStartingFen(pgn)).toBe('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3')
  })

  it('parses multi-game PGN file like DOC Document.pgn', () => {
    const docPgnPath = path.resolve(__dirname, '../../DOC Document.pgn')
    if (fs.existsSync(docPgnPath)) {
      const fileContent = fs.readFileSync(docPgnPath, 'utf-8')
      const games = splitMultiGamePgn(fileContent)

      expect(games.length).toBeGreaterThanOrEqual(8)
      expect(games[0].title).toBe('Giới Thiệu')
      expect(games[1].title).toBe('Ván 1: Plaskett - J. Polgar (Hastings 1988)')
      expect(games[2].title).toBe('Ván 2: Hebden - Fedorowicz (Lewisham 1981)')
      expect(games[3].title).toBe('ván 3 Plaskett - Tiviakov (Dhaka 1997)')
      expect(games[4].title).toBe('Ván 4: Hodgson - Rowson (Rotherham 1997)')
    }
  })
})
