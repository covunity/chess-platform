import { Chess } from "chess.js";

export interface PgnAnnotation {
  moveNumber: number;
  text: string;
}

export interface PgnMove {
  san: string;
  from: string;
  to: string;
  fen: string;
  moveNumber: number;
}

export interface PgnParseResult {
  valid: boolean;
  moveCount: number;
  annotationCount: number;
  fen: string;
  moves: PgnMove[];
  annotations: PgnAnnotation[];
  error?: string;
}

const ANNOTATION_REGEX = /\{([^}]*)\}/g;

function stripAnnotationsForParsing(pgn: string): string {
  return pgn.replace(ANNOTATION_REGEX, "").replace(/\s+/g, " ").trim();
}

function extractAnnotations(pgn: string): Array<{ text: string; afterPlyIndex: number }> {
  const annotations: Array<{ text: string; afterPlyIndex: number }> = [];
  // We need to figure out which ply each annotation follows.
  // We'll scan through the PGN token by token.
  const tokenRegex = /(\d+\.)|(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)|(\{[^}]*\})/g;
  let plyIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(pgn)) !== null) {
    if (match[2]) {
      // move token
      plyIndex++;
    } else if (match[3]) {
      // annotation token
      const text = match[3].slice(1, -1).trim();
      annotations.push({ text, afterPlyIndex: plyIndex });
    }
  }
  return annotations;
}

export function parsePgn(pgn: string): PgnParseResult {
  const empty: PgnParseResult = {
    valid: false,
    moveCount: 0,
    annotationCount: 0,
    fen: "",
    moves: [],
    annotations: [],
  };

  if (!pgn || !pgn.trim()) {
    return { ...empty, error: "PGN is empty" };
  }

  const cleanPgn = stripAnnotationsForParsing(pgn);
  const rawAnnotations = extractAnnotations(pgn);

  const chess = new Chess();

  try {
    chess.loadPgn(cleanPgn);
  } catch (err) {
    return {
      ...empty,
      error: err instanceof Error ? err.message : "Invalid PGN",
    };
  }

  const history = chess.history({ verbose: true });

  if (history.length === 0) {
    return { ...empty, error: "No valid moves found in PGN" };
  }

  // Build move list with FEN at each position
  const tempChess = new Chess();
  const moves: PgnMove[] = [];

  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    tempChess.move(h.san);
    moves.push({
      san: h.san,
      from: h.from,
      to: h.to,
      fen: tempChess.fen(),
      moveNumber: Math.floor(i / 2) + 1,
    });
  }

  // Map raw annotations (afterPlyIndex) to move numbers
  const annotations: PgnAnnotation[] = rawAnnotations.map((a) => ({
    moveNumber: Math.ceil(a.afterPlyIndex / 2),
    text: a.text,
  }));

  return {
    valid: true,
    moveCount: history.length,
    annotationCount: rawAnnotations.length,
    fen: chess.fen(),
    moves,
    annotations,
    error: undefined,
  };
}
