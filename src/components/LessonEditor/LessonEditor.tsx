import { useState, useEffect } from "react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { parsePgn } from "../../utils/parsePgn";
import { serializePgn } from "../../utils/serializePgn";
import { createTreeStore } from "./treeStore";
import BoardAuthoringSurface from "./BoardAuthoring/BoardAuthoringSurface";

import VariationPanel from "./VariationPanel";
import ImportFromPgnModal from "./AdvancedPgnPanel/ImportFromPgnModal";
import PuzzleEditorPanel from "./PuzzleEditorPanel";
import VideoLessonEditor from "./VideoLessonEditor";
import BunnyVideoPlayer from "../BunnyVideoPlayer";
import VideoView from "../VideoView";
import { getVideoPlaybackInfo } from "../../lib/lessonPlayerApi";
import { supabase } from "../../lib/supabase";
import type { VideoStatus } from "../../lib/creatorApi";
import type { VideoProviderName } from "../../lib/video/types";

export type LessonType = 'video' | 'chess' | 'puzzle';

export interface Lesson {
  id: string;
  title: string;
  pgn_data: string;
  board_perspective: "white" | "black";
  is_free_preview: boolean;
  type: LessonType;
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
  /** When true the lesson auto-creates a paired Rewind sibling lesson. Chess type only. */
  has_rewind_mode?: boolean;
  /** When set, this lesson IS the auto-managed Rewind sibling of the referenced source. */
  rewind_source_id?: string | null;
  /** Title of the source lesson — only used for the read-only banner on rewind siblings. */
  rewind_source_title?: string | null;
}

export interface LessonEditorProps {
  lesson: Lesson;
  onSave: (data: Pick<Lesson, "type" | "pgn_data" | "board_perspective" | "is_free_preview" | "title" | "description" | "has_rewind_mode">) => void;
  chapterLessons?: Array<{ id: string; title: string; type: LessonType }>;
  onSelectLesson?: (id: string) => void;
  showSidebar?: boolean;
  saveLabel?: string;
  saveRef?: RefObject<(() => void) | null>;
  /** When true, shows the PGN (advanced) tab alongside the board surface. */
  editorAdvanced?: boolean;
  /** Called when the user confirms removing the rewind sibling during a chess→video type switch. */
  onRemoveRewindSibling?: () => Promise<void>;
  /** Called whenever hasRewindMode changes inside the editor. */
  onRewindModeChange?: (v: boolean) => void;
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

export default function LessonEditor({ lesson, onSave, chapterLessons, onSelectLesson, showSidebar = true, saveRef, onRemoveRewindSibling, onRewindModeChange }: LessonEditorProps) {
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
  const [hasRewindMode, setHasRewindMode] = useState(lesson.has_rewind_mode ?? false);
  const updateRewindMode = (v: boolean) => { setHasRewindMode(v); onRewindModeChange?.(v); };
  // True when this lesson row is the auto-managed Rewind sibling of another
  // source lesson — the editor switches to a read-only banner because the
  // content is kept in sync by the DB trigger from the source side.
  const isRewindSibling = !!lesson.rewind_source_id;
  // Import-from-PGN modal open state
  const [importModalOpen, setImportModalOpen] = useState(false);
  // Board editor (starting position) open state — lifted here so the toolbar can trigger it
  const [boardEditorOpen, setBoardEditorOpen] = useState(false);

  // ── treeStore for board-direct authoring (chess lessons) ─────────────────
  const [treeStore] = useState(() => createTreeStore());
  // Initialize on mount: load pgn_data into treeStore if present
  useEffect(() => {
    if (lesson.pgn_data && lesson.pgn_data.trim()) {
      const parsed = parsePgn(lesson.pgn_data);
      if (parsed.valid && parsed.root) {
        treeStore.getState().replaceTree(parsed.root);
      }
    } else if (lesson.starting_fen) {
      // No pgn_data but a custom starting_fen is set — seed the tree from it
      treeStore.getState().setStartingFen(lesson.starting_fen);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id]);
  const [activeTab, setActiveTab] = useState<LessonType>(lesson.type ?? 'chess');
  const [pendingTabSwitch, setPendingTabSwitch] = useState<LessonType | null>(null);
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

  const [isVideoUploading, setIsVideoUploading] = useState(false);
  const [showUploadWarnOnSave, setShowUploadWarnOnSave] = useState(false);

  // Preview panel state for video lessons
  const [_previewInfo, setPreviewInfo] = useState<{ videoId: string; videoStatus: string; url: string; format: 'mp4' | 'hls'; embedUrl?: string | null } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Derived: treat as null when the video identity has changed since the preview was fetched
  const previewInfo = _previewInfo?.videoId === videoLesson.id && _previewInfo?.videoStatus === videoLesson.video_status
    ? _previewInfo
    : null;

  const handlePreviewPlay = async () => {
    if (previewLoading) return;
    setPreviewLoading(true);
    const { url, format, embedUrl, error } = await getVideoPlaybackInfo(supabase, videoLesson.id);
    setPreviewLoading(false);
    if (error || !url) return;
    setPreviewInfo({ videoId: videoLesson.id, videoStatus: videoLesson.video_status, url, format, embedUrl });
  };

  const handleSave = () => {
    if (isVideoUploading) {
      setShowUploadWarnOnSave(true);
      setTimeout(() => setShowUploadWarnOnSave(false), 4000);
      return;
    }
    // For chess lessons, serialize the treeStore back to PGN; for others use the pgn state
    const isChessLesson = (activeTab === 'chess');
    let pgnToSave = pgn;
    if (isChessLesson) {
      const treeState = treeStore.getState();
      const rootFen = treeState.tree.fen;
      const STANDARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      // Pass startingFen only when it differs from the standard starting position
      const startingFen = rootFen !== STANDARD_FEN ? rootFen : undefined;
      pgnToSave = serializePgn(treeState.tree, startingFen);
    }
    onSave({ type: activeTab, pgn_data: pgnToSave, board_perspective: perspective, is_free_preview: lesson.is_free_preview, title, description: description || null, has_rewind_mode: hasRewindMode });
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
        {/* Row 1: lesson type tabs (left) + title input (right) */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {(lesson.type === 'puzzle'
              ? [...VISIBLE_LESSON_TAB_VALUES, 'puzzle' as LessonType]
              : VISIBLE_LESSON_TAB_VALUES
            ).map((value) => (
              <button
                key={value}
                type="button"
                data-testid={`lesson-type-tab-${value}`}
                aria-pressed={activeTab === value}
                onClick={() => {
                  if (value !== 'chess' && activeTab === 'chess' && hasRewindMode) {
                    setPendingTabSwitch(value);
                  } else {
                    setActiveTab(value);
                  }
                }}
                style={{
                  padding: "6px 14px",
                  borderRadius: 999,
                  border: "1px solid var(--border)",
                  background: activeTab === value ? "var(--ink-1)" : "var(--surface)",
                  color: activeTab === value ? "var(--on-ink-1)" : "var(--ink-2)",
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {tabLabels[value]}
              </button>
            ))}
          </div>
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
        </div>

        {activeTab === "chess" ? (
          <>
            {/* Row 2: board toolbar — chess settings + actions.
                Hidden for rewind siblings (they show a read-only banner instead). */}
            {!isRewindSibling && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* Action buttons — rect style to distinguish from pill tabs */}
                <button
                  type="button"
                  data-testid="board-authoring-starting-position-btn"
                  onClick={() => setBoardEditorOpen(true)}
                  style={{
                    padding: '3px 10px',
                    fontSize: 12,
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-sm)',
                    background: 'var(--surface)',
                    color: 'var(--ink-2)',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {t('creator.lessonEditor.startingPositionLabel', { defaultValue: 'Vị trí bắt đầu' })}
                </button>
                <button
                  type="button"
                  data-testid="import-from-pgn-btn"
                  onClick={() => setImportModalOpen(true)}
                  style={{
                    padding: '3px 10px',
                    fontSize: 12,
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-sm)',
                    background: 'var(--surface)',
                    color: 'var(--ink-2)',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {t('creator.lessonEditor.importFromPgn')}
                </button>

                {/* Spacer */}
                <div style={{ flex: 1 }} />

                {/* Perspective segmented control */}
                {(["white", "black"] as const).map((val, i) => (
                  <button
                    key={val}
                    type="button"
                    aria-pressed={perspective === val}
                    onClick={() => setPerspective(val)}
                    style={{
                      height: 26,
                      padding: '0 8px',
                      border: '1px solid var(--border)',
                      borderRadius: i === 0 ? 'var(--r-sm) 0 0 var(--r-sm)' : '0 var(--r-sm) var(--r-sm) 0',
                      marginLeft: i === 1 ? -1 : 0,
                      background: perspective === val ? 'var(--ink-1)' : 'var(--surface)',
                      color: perspective === val ? 'var(--on-ink-1)' : 'var(--ink-1)',
                      fontWeight: 500,
                      fontSize: 12,
                      cursor: 'pointer',
                      position: 'relative' as const,
                      zIndex: perspective === val ? 1 : 0,
                      flexShrink: 0,
                    }}
                  >
                    {val === 'white' ? t('creator.lessonEditor.perspectiveWhite') : t('creator.lessonEditor.perspectiveBlack')}
                  </button>
                ))}
              </div>
            )}

            {isRewindSibling ? (
              <div
                data-testid="rewind-sibling-banner"
                style={{
                  background: 'var(--accent-soft)',
                  border: '1px solid var(--accent-border)',
                  borderRadius: 'var(--r-md)',
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--accent-ink)' }}>
                  {t('creator.lessonEditor.rewindSiblingHeading')}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
                  {lesson.rewind_source_title
                    ? t('creator.lessonEditor.rewindSiblingBodyWithSource', { source: lesson.rewind_source_title })
                    : t('creator.lessonEditor.rewindSiblingBody')}
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <BoardAuthoringSurface
                    store={treeStore}
                    perspective={perspective}
                    size={460}
                    boardEditorOpen={boardEditorOpen}
                    onBoardEditorOpenChange={setBoardEditorOpen}
                  />
                </div>

                {importModalOpen && (
                  <ImportFromPgnModal
                    store={treeStore}
                    onClose={() => setImportModalOpen(false)}
                  />
                )}
              </>
            )}
          </>
        ) : activeTab === "video" ? (
          <>
            <div>
              <label className="label" htmlFor="lesson-description">
                {t('creator.lessonEditor.lessonDescription')}
              </label>
              <textarea
                id="lesson-description"
                className="input"
                style={{ resize: 'vertical', minHeight: 150 }}
                aria-label={t('creator.lessonEditor.lessonDescription')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <VideoLessonEditor
              key={lesson.id}
              lesson={videoLesson}
              onLessonChange={(patch) => setVideoLesson((prev) => ({ ...prev, ...patch }))}
              onIsUploadingChange={setIsVideoUploading}
            />
          </>
        ) : activeTab === "puzzle" ? (
          <>
            {/* Perspective selector for puzzle lessons */}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
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
                    color: perspective === val ? "var(--on-ink-1)" : "var(--ink-1)",
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
              store={treeStore}
              playerSide={puzzlePlayerSide}
              onPlayerSideChange={(side) => setPuzzlePlayerSide(side)}
              perspective={perspective}
              size={460}
            />
          </>
        ) : null}

        {/* Action buttons — shown when parent does not supply a saveRef */}
        {!saveRef && (
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            {showUploadWarnOnSave && (
              <div role="alert" data-testid="save-while-uploading-warning" style={{
                fontSize: 12, color: 'var(--warning)', padding: '4px 0'
              }}>
                ⚠ Video đang upload, vui lòng chờ trước khi lưu.
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleSave}
              >
                {t('creator.lessonEditor.saveDraft')}
              </button>
            </div>
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
              onClick={videoLesson.video_status === "ready" && !previewInfo && !previewLoading ? handlePreviewPlay : undefined}
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
                cursor: videoLesson.video_status === "ready" && !previewInfo && !previewLoading ? "pointer" : "default",
              }}
            >
              {previewInfo ? (
                previewInfo.embedUrl ? (
                  <BunnyVideoPlayer embedUrl={previewInfo.embedUrl} style={{ width: '100%', height: '100%' }} />
                ) : (
                  <VideoView url={previewInfo.url} format={previewInfo.format} controls style={{ width: '100%', height: '100%' }} />
                )
              ) : previewLoading ? (
                <div
                  data-testid="video-preview-loading"
                  style={{
                    width: 36,
                    height: 36,
                    border: '4px solid rgba(255,255,255,0.2)',
                    borderTopColor: 'rgba(255,255,255,0.9)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>
        ) : (
          /* Chess / Puzzle: Variation list + Note panel */
          <VariationPanel store={treeStore} />
        )}
      </div>

      {/* Rewind-sibling removal confirmation dialog */}
      {pendingTabSwitch !== null && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ background: 'rgba(20,22,26,0.4)', zIndex: 60 }}
          role="dialog"
          aria-modal="true"
        >
          <div className="card" style={{ width: 380, padding: 24 }}>
            <p className="text-sm font-medium mb-6" style={{ color: 'var(--ink-1)' }}>
              {t('creator.lessonEditor.rewindRemoveOnTypeSwitch')}
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPendingTabSwitch(null)}
              >
                Hủy
              </button>
              <button
                type="button"
                data-testid="rewind-remove-confirm"
                className="btn btn-sm"
                style={{ background: 'var(--danger)', color: '#fff' }}
                onClick={async () => {
                  const target = pendingTabSwitch;
                  setPendingTabSwitch(null);
                  await onRemoveRewindSibling?.();
                  updateRewindMode(false);
                  setActiveTab(target);
                }}
              >
                {t('creator.lessonEditor.rewindRemoveConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}