/**
 * serializePgn — PRD-0004 Slice 4
 *
 * Walks a PgnNode tree → PGN string:
 * - Main line in algebraic notation
 * - Variations as (...) brackets AFTER the move they're an alternative to
 * - Structured {[gambitly:v1]...} comments for rich note/shapes/purpose
 * - Plain-text {...} for simple single-paragraph notes
 * - [FEN "..."] tag when startingFen is non-null and non-default
 *
 * Round-trip: parsePgn(serializePgn(root)) ≡ original tree (same SANs,
 * shapes, notes, purposes).
 *
 * PGN structure example:
 *   1. e4 e5 (1...c5 2. Nf3) 2. Nf3
 * Tree:
 *   root → e4 → [e5 → Nf3,  c5 → Nf3]
 *
 * Algorithm: write each node's SAN + comment, then write its SIBLINGS as
 * variation brackets, then recurse into the main-line child.
 */

import type { PgnNode, RichTextDoc } from "./parsePgn";

const DEFAULT_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const GAMBITLY_PREFIX = "[gambitly:v1]";

// ── Helpers ───────────────────────────────────────────────────────────────────

function flattenNote(note: RichTextDoc): string {
  return note.content
    .map((para) => (para.content ?? []).map((s) => s.text).join(""))
    .join("\n");
}

function isRichNote(note: RichTextDoc): boolean {
  if (note.content.length > 1) return true;
  for (const para of note.content) {
    for (const span of para.content ?? []) {
      if (span.marks && span.marks.length > 0) return true;
    }
  }
  return false;
}

function nodeComment(node: PgnNode): string {
  const { note, shapes, purpose } = node;
  const hasShapes = shapes.length > 0;
  const hasPurpose = purpose !== null;

  if (note === null && !hasShapes && !hasPurpose) return "";

  if (hasPurpose || hasShapes || (note !== null && isRichNote(note))) {
    const payload: Record<string, unknown> = {};
    if (note !== null) payload.n = note;
    if (hasShapes) payload.s = shapes;
    if (hasPurpose) payload.p = purpose;
    return `{${GAMBITLY_PREFIX}${JSON.stringify(payload)}}`;
  }

  if (note !== null) {
    return `{${flattenNote(note)}}`;
  }

  return "";
}

function moveNumberStr(node: PgnNode, forceBlackNumber: boolean): string {
  if (node.side === "w") return `${node.moveNumber}. `;
  if (forceBlackNumber) return `${node.moveNumber}... `;
  return "";
}

// ── Core recursive serialiser ─────────────────────────────────────────────────
//
// Conceptual model:
//   serializeFrom(node, siblings, forceNumber, parts)
//     1. write moveNum(node, forceNumber) + node.san
//     2. write node's comment
//     3. write "(" + serializeFrom(sib, [], true) + ")" for each sibling
//     4. recurse: serializeFrom(node.children[0], node.children[1..], forceAfter, parts)
//
// "siblings" are the ALTERNATIVE moves (children[1..] of node.parent).
// They are passed down so we can emit them AFTER the main move.

function serializeFrom(
  node: PgnNode,
  siblings: PgnNode[],
  forceNumber: boolean,
  parts: string[]
): void {
  // Step 1: move number + SAN
  parts.push(moveNumberStr(node, forceNumber));
  parts.push(node.san);

  // Step 2: comment
  const comment = nodeComment(node);
  if (comment) {
    parts.push(` ${comment}`);
  }

  // Step 3: sibling variations
  for (const sib of siblings) {
    parts.push(" (");
    serializeFrom(sib, [], true, parts);
    parts.push(")");
  }

  // Step 4: recurse into main-line child
  if (node.children.length === 0) return;

  const [mainChild, ...altChildren] = node.children;
  const forceChildNumber = comment.length > 0 || siblings.length > 0;

  parts.push(" ");
  serializeFrom(mainChild, altChildren, forceChildNumber, parts);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Serialise a PgnNode tree to a PGN string.
 *
 * @param root - The root sentinel node (id === "root") from parsePgn.
 * @param startingFen - When non-null and non-default, emits [FEN "..."] tag.
 */
export function serializePgn(root: PgnNode, startingFen?: string | null): string {
  if (root.children.length === 0) return "";

  const parts: string[] = [];

  if (startingFen && startingFen !== DEFAULT_FEN) {
    parts.push(`[FEN "${startingFen}"]\n`);
  }

  const [firstChild, ...rootAlts] = root.children;
  serializeFrom(firstChild, rootAlts, true, parts);

  return parts.join("").trim();
}
