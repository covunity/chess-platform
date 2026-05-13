import { Chessboard } from 'react-chessboard'

export interface LastMove {
  from: [number, number]; // [row, col] 0-indexed from top in white perspective
  to: [number, number];
}

export interface ChessBoardProps {
  fen: string;
  perspective?: "white" | "black";
  lastMove?: LastMove;
  size?: number;
  showCoords?: boolean;
}

function rowColToSquare(row: number, col: number): string {
  return `${String.fromCharCode(97 + col)}${8 - row}`
}

export default function ChessBoard({
  fen,
  perspective = "white",
  lastMove,
  size = 320,
  showCoords = false,
}: ChessBoardProps) {
  const squareStyles: Record<string, React.CSSProperties> = {}

  if (lastMove) {
    const from = rowColToSquare(lastMove.from[0], lastMove.from[1])
    const to = rowColToSquare(lastMove.to[0], lastMove.to[1])
    squareStyles[from] = { backgroundColor: 'var(--board-move)' }
    squareStyles[to] = { backgroundColor: 'var(--board-move)' }
  }

  return (
    <div
      role="img"
      aria-label={`Chess board — ${perspective} perspective`}
      style={{ width: size, userSelect: 'none', border: '2px solid var(--ink-1)' }}
    >
      <Chessboard
        options={{
          position: fen,
          boardOrientation: perspective,
          boardStyle: { width: size },
          darkSquareStyle: { backgroundColor: 'var(--board-dark)' },
          lightSquareStyle: { backgroundColor: 'var(--board-light)' },
          squareStyles,
          allowDragging: false,
          showNotation: showCoords,
        }}
      />
    </div>
  )
}
