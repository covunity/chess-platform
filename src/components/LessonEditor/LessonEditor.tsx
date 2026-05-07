import { useState, useEffect, useCallback } from "react";
import ChessBoard from "../ChessBoard/ChessBoard";
import { parsePgn } from "../../utils/parsePgn";
import type { PgnParseResult } from "../../utils/parsePgn";
import VideoLessonEditor from "./VideoLessonEditor";
import type { VideoStatus } from "../../lib/creatorApi";
import type { VideoProviderName } from "../../lib/video/types";

export type LessonType = 'video' | 'chess' | 'puzzle';

export interface Lesson {
  id: string;
  title: string;
  pgn_data: string;
  board_perspective: "white" | "black";
  is_free_preview: boolean;
  type?: LessonType;
  duration_seconds?: number;
  video_provider?: VideoProviderName | null;
  video_provider_id?: string | null;
  video_status?: VideoStatus;
  video_filename?: string | null;
  video_size_bytes?: number | null;
}

export interface LessonEditorProps {
  lesson: Lesson;
  onSave: (data: Pick<Lesson, "pgn_data" | "board_perspective" | "is_free_preview" | "title">) => void;
  chapterLessons?: Array<{ id: string; title: string; type: LessonType }>;
  onSelectLesson?: (id: string) => void;
  onSubmitForReview?: () => void;
  showSidebar?: boolean;
  saveLabel?: string;
}

const LESSON_TYPE_ICON: Record<LessonType, string> = {
  video: '▶',
  chess: '♟',
  puzzle: '📋',
};

const LESSON_TABS: Array<{ value: LessonType; label: string }> = [
  { value: 'video', label: 'Video' },
  { value: 'chess', label: 'Chess lesson' },
  { value: 'puzzle', label: 'Puzzle' },
];

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

function formatDuration(seconds: number | undefined | null): string {
  if (!seconds || seconds <= 0) return "—:—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function LessonEditor({ lesson, onSave, chapterLessons, onSelectLesson, onSubmitForReview, showSidebar = true, saveLabel = "Save draft" }: LessonEditorProps) {
  const [title, setTitle] = useState(lesson.title);
  const [pgn, setPgn] = useState(lesson.pgn_data);
  const [perspective, setPerspective] = useState<"white" | "black">(lesson.board_perspective);
  const [isFreePreview, setIsFreePreview] = useState(lesson.is_free_preview);
  const [parseResult, setParseResult] = useState<PgnParseResult | null>(null);
  const [activeTab, setActiveTab] = useState<LessonType>(lesson.type ?? 'chess');
  const [videoLesson, setVideoLesson] = useState(() => ({
    id: lesson.id,
    is_free_preview: lesson.is_free_preview,
    duration_seconds: lesson.duration_seconds,
    video_provider: lesson.video_provider ?? null,
    video_provider_id: lesson.video_provider_id ?? null,
    video_status: lesson.video_status ?? 'idle' as VideoStatus,
    video_filename: lesson.video_filename ?? null,
    video_size_bytes: lesson.video_size_bytes ?? null,
  }));

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

  function sqToRowCol(sq: string): [number, number] {
    const col = sq.charCodeAt(0) - 97;
    const row = 8 - parseInt(sq[1], 10);
    return [row, col];
  }

  const lastMove = lastMoveInfo
    ? { from: sqToRowCol(lastMoveInfo.from), to: sqToRowCol(lastMoveInfo.to) }
    : undefined;

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
        color: perspective === val ? "var(--ink-on-accent)" : "var(--ink-1)",
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
        gridTemplateColumns: showSidebar ? "260px 1fr 380px" : "1fr 380px",
        gap: 0,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md)",
        overflow: "hidden",
        minHeight: 560,
      }}
    >
      {/* Sidebar: lesson list for current chapter */}
      {showSidebar && (
        <div
          data-testid="lesson-editor-sidebar"
          style={{
            background: "var(--surface-2)",
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "16px 16px 8px", borderBottom: "1px solid var(--border)" }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "var(--ink-3)",
                textTransform: "uppercase" as const,
                letterSpacing: "0.1em",
              }}
            >
              Lessons
            </span>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {(chapterLessons ?? []).map((l) => (
              <button
                key={l.id}
                type="button"
                data-testid={`sidebar-lesson-${l.id}`}
                onClick={() => onSelectLesson?.(l.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 16px",
                  background: l.id === lesson.id ? "var(--surface-3)" : "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--border)",
                  cursor: "pointer",
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  fontSize: 12.5,
                  color: l.id === lesson.id ? "var(--ink-1)" : "var(--ink-2)",
                }}
              >
                <span style={{ width: 16, textAlign: "center", color: "var(--ink-3)", flexShrink: 0 }}>
                  {LESSON_TYPE_ICON[l.type]}
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {l.title}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Center: Editor form */}
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Lesson type tabs */}
        <div style={{ display: "flex", gap: 6 }}>
          {LESSON_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              data-testid={`lesson-type-tab-${tab.value}`}
              aria-pressed={activeTab === tab.value}
              onClick={() => setActiveTab(tab.value)}
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: activeTab === tab.value ? "var(--ink-1)" : "var(--surface)",
                color: activeTab === tab.value ? "var(--ink-on-accent)" : "var(--ink-2)",
                fontSize: 12.5,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "chess" ? (
          <>
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
                    color: isFreePreview ? "var(--ink-on-accent)" : "var(--ink-1)",
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
          </>
        ) : activeTab === "video" ? (
          <>
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

            <VideoLessonEditor
              key={lesson.id}
              lesson={videoLesson}
              isFreePreview={isFreePreview}
              onFreePreviewChange={setIsFreePreview}
              onLessonChange={(patch) => setVideoLesson((prev) => ({ ...prev, ...patch }))}
            />
          </>
        ) : (
          <div
            data-testid={`lesson-type-placeholder-${activeTab}`}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ink-3)",
              fontSize: 13,
              border: "1px dashed var(--border)",
              borderRadius: "var(--r-sm)",
              padding: 32,
            }}
          >
            Puzzle editor coming soon
          </div>
        )}
      </div>

      {/* Right: Live preview pane */}
      <div
        data-testid="lesson-preview-pane"
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
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-1)" }}>Preview</span>
          {activeTab === "video" ? (
            <span
              style={{
                fontSize: 12,
                color: "var(--ink-3)",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 99,
                padding: "2px 10px",
                fontFamily: "var(--font-mono)",
              }}
            >
              {formatDuration(videoLesson.duration_seconds)} runtime
            </span>
          ) : parseResult?.valid && moveCount > 0 ? (
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
          ) : null}
        </div>

        {activeTab === "video" ? (
          /* Video mock player frame */
          <div
            data-testid="video-preview-frame"
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: "16 / 9",
              borderRadius: "var(--r-md)",
              overflow: "hidden",
              background: videoLesson.video_status === "ready" ? "#0F1114" : "var(--surface-3)",
              border: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background:
                  videoLesson.video_status === "ready"
                    ? "rgba(255,255,255,0.95)"
                    : "var(--surface-2)",
                color: "var(--ink-1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
                opacity: videoLesson.video_status === "ready" ? 1 : 0.6,
              }}
              aria-hidden
            >
              ▶
            </div>
            {videoLesson.video_status !== "ready" && (
              <div
                style={{
                  position: "absolute",
                  bottom: 12,
                  left: 12,
                  right: 12,
                  fontSize: 12,
                  color: "var(--ink-3)",
                  textAlign: "center",
                }}
              >
                {videoLesson.video_status === "uploading"
                  ? "Đang tải video lên…"
                  : videoLesson.video_status === "processing"
                    ? "Đang xử lý video…"
                    : "Chưa có video"}
              </div>
            )}
          </div>
        ) : (
          <>
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
          </>
        )}

        {/* Action buttons */}
        <div style={{ marginTop: "auto", display: "flex", gap: 8 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleSave}
          >
            {saveLabel}
          </button>
          {onSubmitForReview && (
            <button
              type="button"
              data-testid="lesson-editor-submit-review-btn"
              className="btn btn-accent btn-sm"
              onClick={onSubmitForReview}
            >
              Submit for review
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
