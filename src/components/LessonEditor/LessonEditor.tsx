import { useState, useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { parsePgn } from "../../utils/parsePgn";
import { serializePgn } from "../../utils/serializePgn";
import { createTreeStore } from "./treeStore";
import BoardAuthoringSurface from "./BoardAuthoring/BoardAuthoringSurface";
import AdvancedPgnPanel from "./AdvancedPgnPanel/AdvancedPgnPanel";
import VariationPanel from "./VariationPanel";
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
  /** When true the lesson exposes a Study (default) ↔ Rewind toggle to learners. Chess type only. */
  has_rewind_mode?: boolean;
}

export interface LessonEditorProps {
  lesson: Lesson;
  onSave: (data: Pick<Lesson, "pgn_data" | "board_perspective" | "is_free_preview" | "title" | "description" | "has_rewind_mode">) => void;
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

// Puzzle is feature-hidden for the moment (stakeholder decision). The tab
// only appears for lessons already saved as type='puzzle' so creators can
// still finish or remove an existing one; otherwise the option is suppressed.
// Re-enable globally by adding 'puzzle' back to this list.
const VISIBLE_LESSON_TAB_VALUES: LessonType[] = ['video', 'chess'];

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
  const [hasRewindMode, setHasRewindMode] = useState(lesson.has_rewind_mode ?? false);
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
    onSave({ pgn_data: pgnToSave, board_perspective: perspective, is_free_preview: isFreePreview, title, description: description || null, has_rewind_mode: hasRewindMode });
  };

  useEffect(() => {
    if (saveRef) saveRef.current = handleSave
  });

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
      <div style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: 10, overflowY: "auto" }}>
        {/* Lesson type tabs */}
        <div style={{ display: "flex", gap: 6 }}>
          {(lesson.type === 'puzzle'
            ? [...VISIBLE_LESSON_TAB_VALUES, 'puzzle' as LessonType]
            : VISIBLE_LESSON_TAB_VALUES
          ).map((value) => (
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
            {/* Compact metadata bar: title + perspective toggle + view-only in one row */}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                id="lesson-title"
                className="input"
                type="text"
                style={{ flex: 1, height: 34 }}
                placeholder={t('creator.lessonEditor.lessonTitle')}
                aria-label={t('creator.lessonEditor.lessonTitle')}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              {/* Perspective segmented control */}
              {(["white", "black"] as const).map((val, i) => (
                <button
                  key={val}
                  type="button"
                  aria-pressed={perspective === val}
                  onClick={() => setPerspective(val)}
                  style={{
                    height: 34,
                    padding: "0 10px",
                    border: "1px solid var(--border)",
                    borderRadius: i === 0 ? "var(--r-sm) 0 0 var(--r-sm)" : "0 var(--r-sm) var(--r-sm) 0",
                    marginLeft: i === 1 ? -1 : 0,
                    background: perspective === val ? "var(--ink-1)" : "var(--surface)",
                    color: perspective === val ? "var(--ink-on-accent)" : "var(--ink-1)",
                    fontWeight: 500,
                    fontSize: 12.5,
                    cursor: "pointer",
                    position: "relative" as const,
                    zIndex: perspective === val ? 1 : 0,
                    flexShrink: 0,
                  }}
                >
                  {val === "white" ? t('creator.lessonEditor.perspectiveWhite') : t('creator.lessonEditor.perspectiveBlack')}
                </button>
              ))}
              {/* View-only toggle */}
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 12.5,
                  color: "var(--ink-2)",
                  cursor: "pointer",
                  flexShrink: 0,
                  whiteSpace: "nowrap" as const,
                  paddingLeft: 4,
                }}
              >
                <input
                  data-testid="lesson-has-rewind-mode-checkbox"
                  type="checkbox"
                  checked={hasRewindMode}
                  onChange={(e) => setHasRewindMode(e.target.checked)}
                  style={{ cursor: "pointer" }}
                />
                {t('creator.lessonEditor.hasRewindModeLabel')}
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
                size={460}
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
            {/* Compact metadata bar: title + perspective */}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                id="lesson-title"
                className="input"
                type="text"
                style={{ flex: 1, height: 34 }}
                placeholder={t('creator.lessonEditor.lessonTitle')}
                aria-label={t('creator.lessonEditor.lessonTitle')}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              {(["white", "black"] as const).map((val, i) => (
                <button
                  key={val}
                  type="button"
                  aria-pressed={perspective === val}
                  onClick={() => setPerspective(val)}
                  style={{
                    height: 34,
                    padding: "0 10px",
                    border: "1px solid var(--border)",
                    borderRadius: i === 0 ? "var(--r-sm) 0 0 var(--r-sm)" : "0 var(--r-sm) var(--r-sm) 0",
                    marginLeft: i === 1 ? -1 : 0,
                    background: perspective === val ? "var(--ink-1)" : "var(--surface)",
                    color: perspective === val ? "var(--ink-on-accent)" : "var(--ink-1)",
                    fontWeight: 500,
                    fontSize: 12.5,
                    cursor: "pointer",
                    position: "relative" as const,
                    zIndex: perspective === val ? 1 : 0,
                    flexShrink: 0,
                  }}
                >
                  {val === "white" ? t('creator.lessonEditor.perspectiveWhite') : t('creator.lessonEditor.perspectiveBlack')}
                </button>
              ))}
            </div>

            <PuzzleEditorPanel
              store={treeStoreRef.current}
              playerSide={puzzlePlayerSide}
              onPlayerSideChange={(side) => setPuzzlePlayerSide(side)}
              perspective={perspective}
              size={460}
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

      {/* Right: Variation & Notes panel (chess/puzzle) or video preview */}
      <div
        data-testid="lesson-preview-pane"
        style={{
          background: "var(--surface-2)",
          borderLeft: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {activeTab === "video" ? (
          /* Video preview */
          <div
            style={{
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              overflowY: "auto",
              height: "100%",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                {t('creator.lessonEditor.previewHeading')}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--ink-3)",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 99,
                  padding: "1px 8px",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {t('creator.lessonEditor.previewRuntime', { duration: formatDuration(videoLesson.duration_seconds) })}
              </span>
            </div>
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
                  background: videoLesson.video_status === "ready" ? "rgba(255,255,255,0.95)" : "var(--surface-2)",
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
          </div>
        ) : (
          /* Chess / Puzzle: Variation list + Note panel */
          <VariationPanel store={treeStoreRef.current} />
        )}
      </div>
    </div>
  );
}
