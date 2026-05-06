import { useState, useEffect, useCallback } from "react";
import ChessBoard from "../ChessBoard/ChessBoard";
import { parsePgn } from "../../utils/parsePgn";
import type { PgnParseResult } from "../../utils/parsePgn";

export interface Lesson {
  id: string;
  title: string;
  pgn_data: string;
  board_perspective: "white" | "black";
  is_free_preview: boolean;
}

export interface LessonEditorProps {
  lesson: Lesson;
  onSave: (data: Pick<Lesson, "pgn_data" | "board_perspective" | "is_free_preview" | "title">) => void;
}

const MAX_PGN_CHARS = 5000;

const PLACEHOLDER_PGN = `1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5
4. c3 Nf6 {The mainline. Black contests the center immediately.}
5. d3 d6 {Instead of the classical 5.d4 break, modern theory has shifted toward d3, preparing a slow build with Nbd2, Re1, h3.}
6. Nbd2 a6
7. Bb3 O-O
8. h3 {Prophylactic — preventing ...Bg4.}`;

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export default function LessonEditor({ lesson, onSave }: LessonEditorProps) {
  const [title, setTitle] = useState(lesson.title);
  const [pgn, setPgn] = useState(lesson.pgn_data);
  const [perspective, setPerspective] = useState<"white" | "black">(lesson.board_perspective);
  const [isFreePreview, setIsFreePreview] = useState(lesson.is_free_preview);
  const [parseResult, setParseResult] = useState<PgnParseResult | null>(null);

  const parsePgnValue = useCallback((value: string) => {
    if (!value.trim()) {
      setParseResult(null);
      return;
    }
    const result = parsePgn(value);
    setParseResult(result);
  }, []);

  useEffect(() => {
    parsePgnValue(pgn);
  }, [pgn, parsePgnValue]);

  const handleSave = () => {
    onSave({ pgn_data: pgn, board_perspective: perspective, is_free_preview: isFreePreview, title });
  };

  const currentFen = parseResult?.valid && parseResult.moves.length > 0
    ? parseResult.fen
    : STARTING_FEN;

  const lastMoveInfo = parseResult?.valid && parseResult.moves.length > 0
    ? parseResult.moves[parseResult.moves.length - 1]
    : null;

  // Convert algebraic from/to (e.g. "e2", "e4") to [row, col] in white perspective
  function sqToRowCol(sq: string): [number, number] {
    const col = sq.charCodeAt(0) - 97; // a=0
    const row = 8 - parseInt(sq[1], 10); // rank 8 = row 0
    return [row, col];
  }

  const lastMove = lastMoveInfo
    ? { from: sqToRowCol(lastMoveInfo.from), to: sqToRowCol(lastMoveInfo.to) }
    : undefined;

  // Find current annotation (for the last move)
  const currentAnnotation = lastMoveInfo
    ? parseResult?.annotations.find((a) => a.moveNumber === lastMoveInfo.moveNumber)
    : undefined;

  const moveCount = parseResult?.moveCount ?? 0;
  const annotationCount = parseResult?.annotationCount ?? 0;
  const totalMoveNumber = parseResult?.valid && lastMoveInfo
    ? parseResult.moves.indexOf(lastMoveInfo) + 1
    : 0;

  const perspectiveButton = (val: "white" | "black", label: string) => (
    <button
      type="button"
      role="button"
      aria-pressed={perspective === val}
      onClick={() => setPerspective(val)}
      style={{
        flex: 1,
        height: 36,
        border: `1px solid var(--border)`,
        borderRadius: "var(--r-sm)",
        background: perspective === val ? "var(--ink-1)" : "var(--surface)",
        color: perspective === val ? "#fff" : "var(--ink-1)",
        fontWeight: 500,
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 380px",
        gap: 0,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md)",
        overflow: "hidden",
        minHeight: 560,
      }}
    >
      {/* Left: Editor form */}
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Lesson title */}
        <div>
          <label className="label" htmlFor="lesson-title">
            Lesson title
          </label>
          <input
            id="lesson-title"
            className="input"
            type="text"
            aria-label="Lesson title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* Perspective + Free preview row */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <span className="label">Board perspective</span>
            <div style={{ display: "flex", gap: 8 }}>
              {perspectiveButton("white", "White")}
              {perspectiveButton("black", "Black")}
            </div>
          </div>
          <div style={{ width: 180 }}>
            <span className="label">Free preview</span>
            <button
              type="button"
              role="button"
              aria-label="Free preview"
              aria-pressed={isFreePreview}
              onClick={() => setIsFreePreview((v) => !v)}
              style={{
                width: "100%",
                height: 36,
                border: "1px solid var(--border)",
                borderRadius: "var(--r-sm)",
                background: isFreePreview ? "var(--accent)" : "var(--surface)",
                color: isFreePreview ? "#fff" : "var(--ink-1)",
                fontWeight: 500,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {isFreePreview ? "On" : "Off"}
            </button>
          </div>
        </div>

        {/* PGN textarea */}
        <div style={{ flex: 1 }}>
          <label className="label" htmlFor="pgn-textarea">
            PGN (with annotations in <code>{"{}"}</code>)
          </label>
          <textarea
            id="pgn-textarea"
            className="input mono"
            aria-label="PGN"
            placeholder={PLACEHOLDER_PGN}
            value={pgn}
            onChange={(e) => setPgn(e.target.value)}
            style={{ height: 180, display: "block" }}
            maxLength={MAX_PGN_CHARS}
          />

          {/* Status row */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, alignItems: "center" }}>
            <div>
              {parseResult === null ? (
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Enter PGN above</span>
              ) : parseResult.valid ? (
                <span style={{ fontSize: 12, color: "var(--success)" }}>
                  ✓ PGN parsed · {moveCount} moves{" "}
                  {annotationCount > 0
                    ? `· ${annotationCount} annotation${annotationCount !== 1 ? "s" : ""}`
                    : "· 0 annotations"}
                </span>
              ) : (
                <span role="alert" style={{ fontSize: 12, color: "var(--danger)" }}>
                  {parseResult.error ?? "Invalid PGN"}
                </span>
              )}
            </div>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {formatNumber(pgn.length)} / {formatNumber(MAX_PGN_CHARS)} chars
            </span>
          </div>
        </div>
      </div>

      {/* Right: Live preview pane */}
      <div
        style={{
          background: "var(--surface-2)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          borderLeft: "1px solid var(--border)",
        }}
      >
        {/* Header row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-1)" }}>Live preview</span>
          {parseResult?.valid && moveCount > 0 && (
            <span
              style={{
                fontSize: 12,
                color: "var(--ink-3)",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 99,
                padding: "2px 10px",
              }}
            >
              Move {totalMoveNumber} of {moveCount}
            </span>
          )}
        </div>

        {/* Chess board */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <ChessBoard
            fen={currentFen}
            perspective={perspective}
            lastMove={lastMove}
            size={300}
          />
        </div>

        {/* Annotation card */}
        {currentAnnotation && lastMoveInfo && (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              padding: 12,
            }}
          >
            <div
              style={{
                fontFamily: "monospace",
                fontSize: 11.5,
                color: "var(--ink-3)",
                marginBottom: 4,
              }}
            >
              {lastMoveInfo.moveNumber}. {lastMoveInfo.san}
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 }}>
              {currentAnnotation.text}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ marginTop: "auto", display: "flex", gap: 8 }}>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={handleSave}
          >
            Save draft
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
          >
            Submit for review
          </button>
        </div>
      </div>
    </div>
  );
}
