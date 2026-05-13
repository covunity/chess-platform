/**
 * Test mock for react-chessboard.
 * Renders plain divs with data-square attributes and Unicode pieces so tests
 * can interact with squares the same way as before the library migration.
 * CSS variable values in squareStyles are translated back to data-* attributes
 * so tests can assert data-last-move, data-hint, data-wrong-move, data-selected.
 */
import React from 'react'

const PIECE_UNICODE: Record<string, string> = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
}

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function parseFen(fen: string): Record<string, string> {
  const position: Record<string, string> = {}
  const rows = fen.split(' ')[0].split('/')
  for (let r = 0; r < 8; r++) {
    let col = 0
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) {
        col += parseInt(ch, 10)
      } else {
        position[`${String.fromCharCode(97 + col)}${8 - r}`] = ch
        col++
      }
    }
  }
  return position
}

function squareDataAttr(style?: React.CSSProperties): Record<string, string> {
  const bg = style?.backgroundColor
  if (bg === 'var(--board-move)') return { 'data-last-move': 'true' }
  if (bg === 'var(--board-highlight)') return { 'data-hint': 'true' }
  if (bg === 'var(--board-selected)') return { 'data-selected': 'true' }
  if (bg === 'var(--board-error)') return { 'data-wrong-move': 'true' }
  return {}
}

type SquareClickArgs = { square: string; piece: { pieceType: string } | null }

interface ChessboardOptions {
  position?: string
  boardOrientation?: 'white' | 'black'
  squareStyles?: Record<string, React.CSSProperties>
  onSquareClick?: (args: SquareClickArgs) => void
  [key: string]: unknown
}

export function Chessboard({ options = {} }: { options?: ChessboardOptions }) {
  const {
    position = STARTING_FEN,
    boardOrientation = 'white',
    squareStyles = {},
    onSquareClick,
  } = options

  const fenStr = typeof position === 'string' ? position : STARTING_FEN
  const pieces = parseFen(fenStr)

  const files: string[] = boardOrientation === 'white'
    ? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    : ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']
  const ranks: number[] = boardOrientation === 'white'
    ? [8, 7, 6, 5, 4, 3, 2, 1]
    : [1, 2, 3, 4, 5, 6, 7, 8]

  return (
    <div>
      {ranks.flatMap(rank =>
        files.map(file => {
          const square = `${file}${rank}`
          const piece = pieces[square]
          const style = squareStyles[square] ?? {}
          const dataAttrs = squareDataAttr(style)
          return (
            <div
              key={square}
              data-square={square}
              style={style}
              {...dataAttrs}
              onClick={() => onSquareClick?.({ square, piece: piece ? { pieceType: piece } : null })}
            >
              {piece ? (PIECE_UNICODE[piece] ?? '') : ''}
            </div>
          )
        })
      )}
    </div>
  )
}
