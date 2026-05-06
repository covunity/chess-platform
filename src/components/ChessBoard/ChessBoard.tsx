
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

// Unicode chess pieces by piece type and color
const PIECE_UNICODE: Record<string, string> = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

function parseFen(fen: string): (string | null)[][] {
  const board: (string | null)[][] = Array.from({ length: 8 }, () =>
    Array(8).fill(null)
  );
  const rows = fen.split(" ")[0].split("/");
  for (let r = 0; r < 8; r++) {
    let col = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) {
        col += parseInt(ch, 10);
      } else {
        board[r][col] = ch;
        col++;
      }
    }
  }
  return board;
}

export default function ChessBoard({
  fen,
  perspective = "white",
  lastMove,
  size = 320,
  showCoords: _showCoords = true,
}: ChessBoardProps) {
  const board = parseFen(fen);
  const squareSize = size / 8;

  // Build row/col order based on perspective
  const rows = perspective === "white" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const cols = perspective === "white" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

  function isLastMove(r: number, c: number): boolean {
    if (!lastMove) return false;
    return (
      (lastMove.from[0] === r && lastMove.from[1] === c) ||
      (lastMove.to[0] === r && lastMove.to[1] === c)
    );
  }

  return (
    <table
      role="table"
      aria-label={`Chess board — ${perspective} perspective`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderCollapse: "collapse",
        tableLayout: "fixed",
        border: "2px solid var(--ink-1)",
        userSelect: "none",
      }}
    >
      <tbody>
        {rows.map((r) => (
          <tr key={r}>
            {cols.map((c) => {
              const isLight = (r + c) % 2 === 0;
              const piece = board[r][c];
              const highlighted = isLastMove(r, c);

              let bg = isLight ? "var(--board-light)" : "var(--board-dark)";
              if (highlighted) bg = "var(--board-move)";

              return (
                <td
                  key={c}
                  role="cell"
                  data-last-move={highlighted ? "true" : undefined}
                  data-square={`${String.fromCharCode(97 + c)}${8 - r}`}
                  style={{
                    width: `${squareSize}px`,
                    height: `${squareSize}px`,
                    background: bg,
                    textAlign: "center",
                    verticalAlign: "middle",
                    fontSize: `${squareSize * 0.7}px`,
                    lineHeight: 1,
                    cursor: "default",
                  }}
                >
                  {piece ? PIECE_UNICODE[piece] ?? "" : ""}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
