import ChessgroundView from './ChessgroundView'

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
}: ChessBoardProps) {
  const lastMoveSquares: [string, string] | null = lastMove
    ? [rowColToSquare(lastMove.from[0], lastMove.from[1]), rowColToSquare(lastMove.to[0], lastMove.to[1])]
    : null

  return (
    <div
      role="img"
      aria-label={`Chess board — ${perspective} perspective`}
      style={{ width: size, userSelect: 'none', border: '2px solid var(--ink-1)' }}
    >
      <ChessgroundView
        fen={fen}
        orientation={perspective}
        lastMove={lastMoveSquares}
        viewOnly
        size={size}
      />
    </div>
  )
}
