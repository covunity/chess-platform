import { Chess } from 'chess.js'

const PIECE_UNICODE: Record<string, string> = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
}

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

interface MiniBoardProps {
  fen?: string
  size?: number
  perspective?: 'white' | 'black'
}

export default function MiniBoard({ fen = STARTING_FEN, size = 120, perspective = 'white' }: MiniBoardProps) {
  const squareSize = size / 8

  let chess: Chess
  try {
    chess = new Chess(fen)
  } catch {
    chess = new Chess()
  }

  const ranks = perspective === 'white' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8]
  const files = perspective === 'white'
    ? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    : ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']

  return (
    <div
      aria-hidden="true"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(8, ${squareSize}px)`,
        gridTemplateRows: `repeat(8, ${squareSize}px)`,
        width: size,
        height: size,
        borderRadius: 4,
        overflow: 'hidden',
        border: '1px solid var(--border-strong)',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {ranks.map(rank =>
        files.map(file => {
          const square = `${file}${rank}` as Parameters<Chess['get']>[0]
          const fileIndex = file.charCodeAt(0) - 97
          const isLight = (fileIndex + rank) % 2 === 1
          const piece = chess.get(square)
          const symbol = piece
            ? PIECE_UNICODE[piece.color === 'w' ? piece.type.toUpperCase() : piece.type.toLowerCase()]
            : ''
          return (
            <div
              key={square}
              style={{
                background: isLight ? 'var(--board-light)' : 'var(--board-dark)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: squareSize * 0.72,
                lineHeight: 1,
                color: piece?.color === 'w' ? '#FAFAF7' : '#222',
              }}
            >
              {symbol}
            </div>
          )
        })
      )}
    </div>
  )
}
