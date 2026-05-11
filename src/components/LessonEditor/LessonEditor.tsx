import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import ChessBoard from "../ChessBoard/ChessBoard";
import { parsePgn } from "../../utils/parsePgn";
import type { PgnParseResult, PgnNode } from "../../utils/parsePgn";
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

const LESSON_TAB_VALUES: LessonType[] = ['video', 'chess', 'puzzle'];

const MAX_PGN_CHARS = 50000; // V-12, up from 5000

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

export default function LessonEditor({ lesson, onSave, chapterLessons, onSelectLesson, onSubmitForReview, showSidebar = true, saveLabel }: LessonEditorProps) {
  const { t } = useTranslation();
  const resolvedSaveLabel = saveLabel ?? t('creator.lessonEditor.saveDraft');
  const tabLabels: Record<LessonType, string> = {
    video: t('creator.lessonEditor.tabVideo'),
    chess: t('creator.lessonEditor.tabChess'),
    puzzle: t('creator.lessonEditor.tabPuzzle'),
  };
  const [title, setTitle] = useState(lesson.title);
  const [pgn, setPgn] = useState(lesson.pgn_data);
  const [perspective, setPerspective] = useState<"white" | "black">(lesson.board_perspective);
  const [isFreePreview, setIsFreePreview] = useState(lesson.is_free_preview);
  const [debouncedParseResult, setDebouncedParseResult] = useState<PgnParseResult | null>(null);
  const parseResult = pgn.trim() ? debouncedParseResult : null;
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
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

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!pgn.trim()) return;
    debounceRef.current = setTimeout(() => {
      setDebouncedParseResult(parsePgn(pgn));
      setHighlightedNodeId(null);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [pgn]);

  const handleSave = () => {
    onSave({ pgn_data: pgn, board_perspective: perspective, is_free_preview: isFreePreview, title });
  };

  // Preview node: highlighted (click in variation list) or last main-line node
  const previewNode = useMemo<PgnNode | null>(() => {
    if (!parseResult?.valid) return null;
    if (highlightedNodeId) return parseResult.nodeMap.get(highlightedNodeId) ?? null;
    return parseResult.mainLine.length > 0
      ? parseResult.mainLine[parseResult.mainLine.length - 1]
      : null;
  }, [parseResult, highlightedNodeId]);

  function sqToRowCol(sq: string): [number, number] {
    const col = sq.charCodeAt(0) - 97;
    const row = 8 - parseInt(sq[1], 10);
    return [row, col];
  }

  const currentFen = previewNode?.fen ?? STARTING_FEN;
  const lastMoveInfo = previewNode;

  const lastMove = lastMoveInfo
    ? { from: sqToRowCol(lastMoveInfo.from), to: sqToRowCol(lastMoveInfo.to) }
    : undefined;

  const currentAnnotation = lastMoveInfo?.annotation ?? null;

  const moveCount = parseResult?.moveCount ?? 0;
  const annotationCount = parseResult?.annotationCount ?? 0;
  const variationCount = parseResult?.variationCount ?? 0;
  const maxDepth = parseResult?.maxDepth ?? 0;
  const totalMoveNumber = previewNode?.depthFromRoot ?? 0;
  const mainLineSet = useMemo(() => new Set(parseResult?.mainLine?.map(n => n.id) ?? []), [parseResult]);
  const learnerSide: "w" | "b" = perspective === 'white' ? 'w' : 'b';

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
              {t('creator.lessonEditor.sidebarHeading')}
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
          {LESSON_TAB_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              data-testid={`lesson-type-tab-${value}`}
              aria-pressed={activeTab === value}
              onClick={() => setActiveTab(value)}
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: activeTab === value ? "var(--ink-1)" : "var(--surface)",
                color: activeTab === value ? "var(--ink-on-accent)" : "var(--ink-2)",
                fontSize: 12.5,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {tabLabels[value]}
            </button>
          ))}
        </div>

        {activeTab === "chess" ? (
          <>
            {/* Lesson title */}
            <div>
              <label className="label" htmlFor="lesson-title">
                {t('creator.lessonEditor.lessonTitle')}
              </label>
              <input
                id="lesson-title"
                className="input"
                type="text"
                aria-label={t('creator.lessonEditor.lessonTitle')}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* Perspective + Free preview row */}
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <span className="label">{t('creator.lessonEditor.boardPerspective')}</span>
                <div style={{ display: "flex", gap: 8 }}>
                  {perspectiveButton("white", t('creator.lessonEditor.perspectiveWhite'))}
                  {perspectiveButton("black", t('creator.lessonEditor.perspectiveBlack'))}
                </div>
              </div>
              <div style={{ width: 180 }}>
                <span className="label">{t('creator.lessonEditor.freePreview')}</span>
                <button
                  type="button"
                  role="button"
                  aria-label={t('creator.lessonEditor.freePreview')}
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
                  {isFreePreview ? t('creator.lessonEditor.freePreviewOn') : t('creator.lessonEditor.freePreviewOff')}
                </button>
              </div>
            </div>

            {/* PGN textarea */}
            <div style={{ flex: 1 }}>
              <label className="label" htmlFor="pgn-textarea">
                {t('creator.lessonEditor.pgnLabel')} <code>{"{}"}</code>{t('creator.lessonEditor.pgnLabelSuffix')}
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
                    <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                      {t('creator.lessonEditor.pgnPlaceholderEnter')}
                    </span>
                  ) : parseResult.valid ? (
                    <span style={{ fontSize: 12, color: "var(--success)" }}>
                      {t('creator.lessonEditor.pgnParsedMoves', { count: moveCount })}{" "}
                      {t('creator.lessonEditor.pgnAnnotationsCount', { count: annotationCount })}
                      {variationCount > 0 && (
                        <span data-testid="variation-summary" style={{ color: "var(--ink-2)" }}>
                          {" "}{t('creator.lessonEditor.pgnVariationSummary', { variations: variationCount, depth: maxDepth })}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span role="alert" style={{ fontSize: 12, color: "var(--danger)" }}>
                      {parseResult.error ?? t('creator.lessonEditor.pgnInvalid')}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {t('creator.lessonEditor.pgnCharCount', { used: formatNumber(pgn.length), max: formatNumber(MAX_PGN_CHARS) })}
                </span>
              </div>
            </div>

            {/* Variation tree panel — only shown when PGN has branching */}
            {variationCount > 0 && parseResult?.root && (() => {
              function renderVarNode(node: PgnNode): React.ReactNode[] {
                const rows: React.ReactNode[] = [];
                const isMain = mainLineSet.has(node.id);
                rows.push(
                  <div
                    key={node.id}
                    data-testid={`variation-node-${node.id}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setHighlightedNodeId(node.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setHighlightedNodeId(node.id); }}
                    style={{
                      paddingLeft: node.depthFromRoot * 16,
                      paddingTop: 2,
                      paddingBottom: 2,
                      cursor: 'pointer',
                      color: isMain ? 'var(--ink-1)' : 'var(--ink-2)',
                      fontSize: 12,
                      background: highlightedNodeId === node.id ? 'var(--surface-3)' : 'transparent',
                      borderRadius: 'var(--r-sm)',
                    }}
                  >
                    {!isMain && '( '}
                    {node.moveNumber}{node.side === 'w' ? '.' : '...'}{node.san}
                    {!isMain && ' )'}
                    {node.annotation && (
                      <span style={{ color: 'var(--ink-3)', fontStyle: 'italic', marginLeft: 4 }}>
                        {node.annotation}
                      </span>
                    )}
                  </div>
                );
                if (node.children.length > 1 && node.children[0].side !== learnerSide) {
                  rows.push(
                    <div
                      key={`warn-${node.id}`}
                      data-testid="opponent-branch-warning"
                      style={{ paddingLeft: (node.depthFromRoot + 1) * 16, fontSize: 11, color: 'var(--warn)', paddingTop: 1 }}
                    >
                      {t('creator.lessonEditor.opponentBranchWarning', { san: node.children[0].san })}
                    </div>
                  );
                }
                for (const child of node.children) {
                  rows.push(...renderVarNode(child));
                }
                return rows;
              }
              return (
                <div
                  data-testid="variation-list"
                  style={{
                    marginTop: 8,
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-sm)',
                    padding: 8,
                    maxHeight: 200,
                    overflowY: 'auto',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>
                    {t('creator.lessonEditor.variationListHeading')} · {t('creator.lessonEditor.variationListClickHint')}
                  </div>
                  {parseResult.root.children.flatMap(child => renderVarNode(child))}
                </div>
              );
            })()}
          </>
        ) : activeTab === "video" ? (
          <>
            {/* Lesson title */}
            <div>
              <label className="label" htmlFor="lesson-title">
                {t('creator.lessonEditor.lessonTitle')}
              </label>
              <input
                id="lesson-title"
                className="input"
                type="text"
                aria-label={t('creator.lessonEditor.lessonTitle')}
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
            {t('creator.lessonEditor.puzzleComingSoon')}
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
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-1)" }}>
            {t('creator.lessonEditor.previewHeading')}
          </span>
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
              {t('creator.lessonEditor.previewRuntime', { duration: formatDuration(videoLesson.duration_seconds) })}
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
              {t('creator.lessonEditor.previewMoveCounter', { current: totalMoveNumber, total: moveCount })}
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
                  ? t('creator.lessonEditor.videoUploading')
                  : videoLesson.video_status === "processing"
                    ? t('creator.lessonEditor.videoProcessing')
                    : t('creator.lessonEditor.videoEmpty')}
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
                  {currentAnnotation}
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
            {resolvedSaveLabel}
          </button>
          {onSubmitForReview && (
            <button
              type="button"
              data-testid="lesson-editor-submit-review-btn"
              className="btn btn-accent btn-sm"
              onClick={onSubmitForReview}
            >
              {t('creator.lessonEditor.submitForReview')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
