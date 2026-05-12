import { Chess } from "chess.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Backward-compat flat annotation (derived from mainLine nodes). */
export interface PgnAnnotation {
  moveNumber: number;
  text: string;
}

/** Backward-compat flat move shape (PgnNode is a superset). */
export interface PgnMove {
  san: string;
  from: string;
  to: string;
  fen: string;
  moveNumber: number;
}

/** Tree node representing a single move. root is a virtual sentinel node. */
export interface PgnNode {
  id: string;
  san: string;
  from: string;
  to: string;
  promotion: string | undefined;
  fen: string;
  moveNumber: number;
  side: "w" | "b";
  annotation: string | undefined;
  parentId: string | null;
  children: PgnNode[];
  depthFromRoot: number;
}

export interface PgnParseResult {
  valid: boolean;
  // ── Tree fields (Slice 1A) ─────────────────────────────────────────────────
  root: PgnNode | null;
  totalNodes: number;
  variationCount: number;
  maxDepth: number;
  mainLine: PgnNode[];
  nodeMap: Map<string, PgnNode>;
  moveCount: number;
  annotationCount: number;
  fen: string;
  annotations: PgnAnnotation[];
  error?: string;
}

// ── Node ID hashing ───────────────────────────────────────────────────────────

// FNV-1a 32-bit — deterministic, synchronous, collision-resistant for small trees.
function fnv1a32(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function makeNodeId(
  parentId: string | null,
  from: string,
  to: string,
  promotion = ""
): string {
  return fnv1a32(`${parentId ?? "root"}/${from}${to}${promotion}`);
}

// ── Constants ─────────────────────────────────────────────────────────────────

const START_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// ── Tokenizer ─────────────────────────────────────────────────────────────────

type TokenType =
  | "TAG"
  | "MOVE_NUMBER"
  | "SAN"
  | "ANNOTATION"
  | "NAG"
  | "VARIATION_START"
  | "VARIATION_END"
  | "RESULT";

interface Token {
  type: TokenType;
  value: string;
}

const RESULT_RE = /^(1-0|0-1|1\/2-1\/2|\*)$/;
const MOVE_NUMBER_RE = /^\d+\.+$/;
const NAG_RE = /^\$\d+$/;

function tokenize(pgn: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < pgn.length) {
    const ch = pgn[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Tag pair [TagName "value"]
    if (ch === "[") {
      const end = pgn.indexOf("]", i);
      if (end === -1) { i++; continue; }
      tokens.push({ type: "TAG", value: pgn.slice(i, end + 1) });
      i = end + 1;
      continue;
    }

    // Annotation { text }
    if (ch === "{") {
      const end = pgn.indexOf("}", i);
      if (end === -1) { i++; continue; }
      tokens.push({ type: "ANNOTATION", value: pgn.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }

    // Variation delimiters
    if (ch === "(") {
      tokens.push({ type: "VARIATION_START", value: "(" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "VARIATION_END", value: ")" });
      i++;
      continue;
    }

    // ; line comment
    if (ch === ";") {
      while (i < pgn.length && pgn[i] !== "\n") i++;
      continue;
    }

    // % escaped line (PGN spec escape mechanism)
    if (ch === "%" && (i === 0 || pgn[i - 1] === "\n")) {
      while (i < pgn.length && pgn[i] !== "\n") i++;
      continue;
    }

    // Word token (move number, SAN, NAG, result)
    if (!/[\s[\]{}();%]/.test(ch)) {
      let j = i;
      while (j < pgn.length && !/[\s[\]{}();%]/.test(pgn[j])) j++;
      const word = pgn.slice(i, j);
      i = j;

      if (RESULT_RE.test(word)) {
        tokens.push({ type: "RESULT", value: word });
      } else if (MOVE_NUMBER_RE.test(word)) {
        tokens.push({ type: "MOVE_NUMBER", value: word });
      } else if (NAG_RE.test(word)) {
        tokens.push({ type: "NAG", value: word });
      } else {
        // Handle "1...c5" / "2.e4" — move number glued to SAN without a space
        const glued = word.match(/^(\d+\.+)([A-Za-z].*)$/);
        if (glued) {
          tokens.push({ type: "MOVE_NUMBER", value: glued[1] });
          const san = glued[2].replace(/[!?]+$/, "");
          tokens.push({ type: "SAN", value: san });
        } else {
          // Strip move annotation suffixes (!!, ??, !?, ?!, !, ?) from SAN
          const san = word.replace(/[!?]+$/, "");
          tokens.push({ type: "SAN", value: san });
        }
      }
      continue;
    }

    i++;
  }

  return tokens;
}

// ── Tree builder ──────────────────────────────────────────────────────────────

function createRootNode(): PgnNode {
  return {
    id: "root",
    san: "",
    from: "",
    to: "",
    promotion: undefined,
    fen: START_FEN,
    moveNumber: 0,
    side: "w",
    annotation: undefined,
    parentId: null,
    children: [],
    depthFromRoot: 0,
  };
}

interface ParseStats {
  totalNodes: number;
  maxDepth: number;
}

function skipVariation(tokens: Token[], idx: { val: number }): void {
  let depth = 1;
  while (idx.val < tokens.length && depth > 0) {
    if (tokens[idx.val].type === "VARIATION_START") depth++;
    else if (tokens[idx.val].type === "VARIATION_END") depth--;
    idx.val++;
  }
}

/**
 * Recursively parse one variation (main line or alternative) into the tree.
 * `currentParent` = node from whose position we add children.
 * `chess` = chess.js instance already at `currentParent.fen`.
 */
function parseVariation(
  tokens: Token[],
  idx: { val: number },
  currentParent: PgnNode,
  chess: Chess,
  nodeMap: Map<string, PgnNode>,
  stats: ParseStats
): void {
  // We mutate `currentParent` as a local cursor; use a local var to avoid
  // reassigning the parameter (keeps TypeScript happy).
  let parent = currentParent;

  while (idx.val < tokens.length) {
    const tok = tokens[idx.val];

    if (
      tok.type === "TAG" ||
      tok.type === "MOVE_NUMBER" ||
      tok.type === "NAG"
    ) {
      idx.val++;
      continue;
    }

    if (tok.type === "RESULT") {
      idx.val++;
      return;
    }

    if (tok.type === "VARIATION_END") {
      idx.val++;
      return;
    }

    if (tok.type === "ANNOTATION") {
      idx.val++;
      parent.annotation = tok.value;
      continue;
    }

    if (tok.type === "VARIATION_START") {
      idx.val++; // consume '('
      // Variation branches from `parent`'s parent's position
      if (parent.parentId === null) {
        // No prior move — skip orphan variation
        skipVariation(tokens, idx);
        continue;
      }
      const varParent = nodeMap.get(parent.parentId)!;
      const varFen = varParent.id === "root" ? START_FEN : varParent.fen;
      const varChess = new Chess(varFen);
      parseVariation(tokens, idx, varParent, varChess, nodeMap, stats);
      continue;
    }

    if (tok.type === "SAN") {
      idx.val++;
      let moveResult: ReturnType<Chess["move"]>;
      try {
        moveResult = chess.move(tok.value);
      } catch {
        throw new Error(`Invalid move: "${tok.value}"`);
      }

      const depth = parent.depthFromRoot + 1;
      const promotion = moveResult.promotion as string | undefined;
      const id = makeNodeId(parent.id, moveResult.from, moveResult.to, promotion ?? "");

      if (nodeMap.has(id)) {
        throw new Error(
          `Duplicate node ID detected: ${id} (move ${tok.value} at depth ${depth})`
        );
      }

      const fen = chess.fen();
      const fenSide = fen.split(" ")[1] as "w" | "b";
      const sideMoved: "w" | "b" = fenSide === "w" ? "b" : "w";

      const node: PgnNode = {
        id,
        san: moveResult.san,
        from: moveResult.from,
        to: moveResult.to,
        promotion,
        fen,
        moveNumber: Math.ceil(depth / 2),
        side: sideMoved,
        annotation: undefined,
        parentId: parent.id,
        children: [],
        depthFromRoot: depth,
      };

      parent.children.push(node);
      nodeMap.set(id, node);
      stats.totalNodes++;
      if (depth > stats.maxDepth) stats.maxDepth = depth;

      parent = node;
      continue;
    }

    idx.val++; // unknown token — skip
  }
}

// ── Derived view helpers ──────────────────────────────────────────────────────

function computeMainLine(root: PgnNode): PgnNode[] {
  const line: PgnNode[] = [];
  let node = root.children[0];
  while (node) {
    line.push(node);
    node = node.children[0];
  }
  return line;
}

function computeAnnotations(mainLine: PgnNode[]): PgnAnnotation[] {
  return mainLine
    .filter((n) => n.annotation !== undefined)
    .map((n) => ({ moveNumber: n.moveNumber, text: n.annotation! }));
}

function countAnnotationsInTree(nodeMap: Map<string, PgnNode>): number {
  let count = 0;
  for (const node of nodeMap.values()) {
    if (node.annotation !== undefined) count++;
  }
  return count;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function parsePgn(pgn: string): PgnParseResult {
  const empty: PgnParseResult = {
    valid: false,
    root: null,
    totalNodes: 0,
    variationCount: 0,
    maxDepth: 0,
    mainLine: [],
    nodeMap: new Map(),
    moveCount: 0,
    annotationCount: 0,
    fen: "",
    annotations: [],
  };

  if (!pgn || !pgn.trim()) {
    return { ...empty, error: "PGN is empty" };
  }

  let tokens: Token[];
  try {
    tokens = tokenize(pgn);
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) };
  }

  const root = createRootNode();
  const nodeMap = new Map<string, PgnNode>([["root", root]]);
  const stats: ParseStats = { totalNodes: 1, maxDepth: 0 }; // 1 for root

  try {
    const idx = { val: 0 };
    parseVariation(tokens, idx, root, new Chess(), nodeMap, stats);
  } catch (e) {
    return {
      ...empty,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  if (root.children.length === 0) {
    return { ...empty, error: "No valid moves found in PGN" };
  }

  const mainLine = computeMainLine(root);
  const variationCount = stats.totalNodes - mainLine.length - 1; // subtract root + main-line nodes
  const annotations = computeAnnotations(mainLine);
  const annotationCount = countAnnotationsInTree(nodeMap);
  const lastFen = mainLine.length > 0 ? mainLine[mainLine.length - 1].fen : "";

  return {
    valid: true,
    root,
    totalNodes: stats.totalNodes,
    variationCount,
    maxDepth: stats.maxDepth,
    mainLine,
    nodeMap,
    moveCount: mainLine.length,
    annotationCount,
    fen: lastFen,
    annotations,
  };
}
