import { useState, useEffect, useRef, useMemo } from "react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import ChessBoard from "../ChessBoard/ChessBoard";
import { parsePgn } from "../../utils/parsePgn";
import type { PgnParseResult, PgnNode } from "../../utils/parsePgn";
import { serializePgn } from "../../utils/serializePgn";
import { createTreeStore } from "./treeStore";
import BoardAuthoringSurface from "./BoardAuthoring/BoardAuthoringSurface";
import AdvancedPgnPanel from "./AdvancedPgnPanel/AdvancedPgnPanel";
import ImportFromPgnModal from "./AdvancedPgnPanel/ImportFromPgnModal";
import PuzzleEditorPanel from "./PuzzleEditorPanel";
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
  description?: string | null;
  /** Custom starting FEN for chess/puzzle lessons. When set, the board starts from this position. */
  starting_fen?: string | null;
  /** Puzzle lessons: which side the learner plays. */
  puzzle_player_side?: 'white' | 'black' | null;
  /** When true the lesson is view-only (no piece interaction) for learners. Chess type only. */
  is_view_only?: boolean;
}

export interface LessonEditorProps {
  lesson: Lesson;
  onSave: (data: Pick<Lesson, "pgn_data" | "board_perspective" | "is_free_preview" | "title" | "description" | "is_view_only">) => void;
  chapterLessons?: Array<{ id: string; title: string; type: LessonType }>;
  onSelectLesson?: (id: string) => void;
  onSubmitForReview?: () => void;
  showSidebar?: boolean;
  saveLabel?: string;
  saveRef?: RefObject<(() => void) | null>;
  /** When true, shows the PGN (advanced) tab alongside the board surface. */
  editorAdvanced?: boolean;
}

const LESSON_TYPE_ICON: Record<LessonType, string> = {
  video: '▶',
  chess: '♟',
  puzzle: '📋',
};

const LESSON_TAB_VALUES: LessonType[] = ['video', 'chess', 'puzzle'];

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function formatDuration(seconds: number | undefined | null): string {
  if (!seconds || seconds <= 0) return "—:—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function LessonEditor({ lesson, onSave, chapterLessons, onSelectLesson, onSubmitForReview, showSidebar = true, saveRef, editorAdvanced = false }: LessonEditorProps) {
  const { t } = useTranslation();
  const tabLabels: Record<LessonType, string> = {
    video: t('creator.lessonEditor.tabVideo'),
    chess: t('creator.lessonEditor.tabChess'),
    puzzle: t('creator.lessonEditor.tabPuzzle'),
  };
  const [title, setTitle] = useState(lesson.title);
  const [description, setDescription] = useState(lesson.description ?? '');
  const [pgn] = useState(lesson.pgn_data);
  const [perspective, setPerspective] = useState<"white" | "black">(lesson.board_perspective);
  const [isFreePreview] = useState(lesson.is_free_preview);
  const [isViewOnly, setIsViewOnly] = useState(lesson.is_view_only ?? false);
  const [debouncedParseResult, setDebouncedParseResult] = useState<PgnParseResult | null>(null);
  const parseResult = pgn.trim() ? debouncedParseResult : null;

  // Sub-tab for chess lesson: 'board' | 'pgn' (pgn only when editorAdvanced)
  const [chessSubTab, setChessSubTab] = useState<'board' | 'pgn'>('board');
  // Import-from-PGN modal open state
  const [importModalOpen, setImportModalOpen] = useState(false);

  // ── treeStore for board-direct authoring (chess lessons) ─────────────────
  const treeStoreRef = useRef(createTreeStore());
  // Initialize on mount: load pgn_data into treeStore if present
  useEffect(() => {
    if (lesson.pgn_data && lesson.pgn_data.trim()) {
      const parsed = parsePgn(lesson.pgn_data);
      if (parsed.valid && parsed.root) {
        treeStoreRef.current.getState().replaceTree(parsed.root);
      }
    } else if (lesson.starting_fen) {
      // No pgn_data but a custom starting_fen is set — seed the tree from it
      treeStoreRef.current.getState().setStartingFen(lesson.starting_fen);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id]);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<LessonType>(lesson.type ?? 'chess');
  const [puzzlePlayerSide, setPuzzlePlayerSide] = useState<'white' | 'black' | null>(
    lesson.puzzle_player_side ?? null
  );
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
    // For chess lessons, serialize the treeStore back to PGN; for others use the pgn state
    const isChessLesson = (activeTab === 'chess');
    let pgnToSave = pgn;
    if (isChessLesson) {
      const treeState = treeStoreRef.current.getState();
      const rootFen = treeState.tree.fen;
      const STANDARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      // Pass startingFen only when it differs from the standard starting position
      const startingFen = rootFen !== STANDARD_FEN ? rootFen : undefined;
      pgnToSave = serializePgn(treeState.tree, startingFen);
    }
    onSave({ pgn_data: pgnToSave, board_perspective: perspective, is_free_preview: isFreePreview, title, description: description || null, is_view_only: isViewOnly });
  };

  useEffect(() => {
    if (saveRef) saveRef.current = handleSave
  });

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
  const totalMoveNumber = previewNode?.depthFromRoot ?? 0;

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
        gridTemplateRows: "1fr",
        gap: 0,
        background: "var(--surface)",
        overflow: "hidden",
        height: "100%",
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
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
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

            {/* Perspective */}
            <div>
              <span className="label">{t('creator.lessonEditor.boardPerspective')}</span>
              <div style={{ display: "flex", gap: 8 }}>
                {perspectiveButton("white", t('creator.lessonEditor.perspectiveWhite'))}
                {perspectiveButton("black", t('creator.lessonEditor.perspectiveBlack'))}
              </div>
            </div>

            {/* View-only toggle — chess lessons only */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                id="lesson-is-view-only"
                data-testid="lesson-is-view-only-checkbox"
                type="checkbox"
                checked={isViewOnly}
                onChange={(e) => setIsViewOnly(e.target.checked)}
              />
              <label htmlFor="lesson-is-view-only" style={{ fontSize: 13, color: "var(--ink-2)", cursor: "pointer" }}>
                {t('creator.lessonEditor.isViewOnlyLabel')}
              </label>
            </div>

            {/* Authoring sub-tabs: Board | PGN (advanced) + Import-from-PGN button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Board sub-tab — always present */}
              <button
                type="button"
                data-testid="board-tab"
                aria-pressed={chessSubTab === 'board'}
                onClick={() => setChessSubTab('board')}
                style={{
                  padding: '4px 12px',
                  borderRadius: 999,
                  border: '1px solid var(--border)',
                  background: chessSubTab === 'board' ? 'var(--ink-1)' : 'var(--surface)',
                  color: chessSubTab === 'board' ? 'var(--ink-on-accent)' : 'var(--ink-2)',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {t('creator.lessonEditor.tabBoardAuthoring')}
              </button>

              {/* PGN (advanced) sub-tab — only when editorAdvanced */}
              {editorAdvanced && (
                <button
                  type="button"
                  data-testid="pgn-advanced-tab"
                  aria-pressed={chessSubTab === 'pgn'}
                  onClick={() => setChessSubTab('pgn')}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 999,
                    border: '1px solid var(--border)',
                    background: chessSubTab === 'pgn' ? 'var(--ink-1)' : 'var(--surface)',
                    color: chessSubTab === 'pgn' ? 'var(--ink-on-accent)' : 'var(--ink-2)',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  {t('creator.lessonEditor.tabPgnAdvanced')}
                </button>
              )}

              {/* Import-from-PGN button — available to ALL creators */}
              <button
                type="button"
                data-testid="import-from-pgn-btn"
                onClick={() => setImportModalOpen(true)}
                style={{
                  marginLeft: 'auto',
                  padding: '4px 12px',
                  borderRadius: 999,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--ink-2)',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {t('creator.lessonEditor.importFromPgn')}
              </button>
            </div>

            {/* Board authoring surface (default sub-tab) */}
            {chessSubTab === 'board' && (
              <BoardAuthoringSurface
                store={treeStoreRef.current}
                perspective={perspective}
                size={340}
              />
            )}

            {/* Advanced PGN panel (shown only when editorAdvanced + pgn sub-tab active) */}
            {editorAdvanced && chessSubTab === 'pgn' && (
              <AdvancedPgnPanel
                store={treeStoreRef.current}
              />
            )}

            {/* Import-from-PGN modal */}
            {importModalOpen && (
              <ImportFromPgnModal
                store={treeStoreRef.current}
                onClose={() => setImportModalOpen(false)}
              />
            )}
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

            <div>
              <label className="label" htmlFor="lesson-description">
                {t('creator.lessonEditor.lessonDescription')}
              </label>
              <textarea
                id="lesson-description"
                className="input"
                style={{ resize: 'vertical', minHeight: 80 }}
                aria-label={t('creator.lessonEditor.lessonDescription')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <VideoLessonEditor
              key={lesson.id}
              lesson={videoLesson}
              onLessonChange={(patch) => setVideoLesson((prev) => ({ ...prev, ...patch }))}
            />
          </>
        ) : activeTab === "puzzle" ? (
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

            <PuzzleEditorPanel
              store={treeStoreRef.current}
              playerSide={puzzlePlayerSide}
              onPlayerSideChange={(side) => setPuzzlePlayerSide(side)}
              perspective={perspective}
              size={340}
            />
          </>
        ) : null}

        {/* Action buttons — shown when parent does not supply a saveRef */}
        {!saveRef && (
          <div style={{ marginTop: "auto", display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleSave}
            >
              {t('creator.lessonEditor.saveDraft')}
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
          overflowY: "auto",
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

      </div>
    </div>
  );
}
