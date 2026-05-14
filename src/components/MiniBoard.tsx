import ChessgroundView from './ChessBoard/ChessgroundView'

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

interface MiniBoardProps {
  fen?: string
  size?: number
  perspective?: 'white' | 'black'
}

export default function MiniBoard({ fen = STARTING_FEN, size = 120, perspective = 'white' }: MiniBoardProps) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        overflow: 'hidden',
        border: '1px solid var(--border-strong)',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      <ChessgroundView
        fen={fen}
        orientation={perspective}
        viewOnly
        size={size}
      />
    </div>
  )
}
