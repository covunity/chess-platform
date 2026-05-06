import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import {
  listChapters,
  createChapter,
  updateChapter,
  deleteChapter,
  createLesson,
  updateLesson,
  deleteLesson,
} from '../../lib/creatorApi'
import type { Chapter, Lesson, LessonType } from '../../lib/creatorApi'
import LessonEditor from '../../components/LessonEditor/LessonEditor'

const LESSON_TYPE_ICON: Record<LessonType, string> = {
  video: '▶',
  chess: '♟',
  puzzle: '📋',
}

interface ConfirmDialogProps {
  testid: string
  confirmTestid: string
  title: string
  onCancel: () => void
  onConfirm: () => void
}

function ConfirmDialog({ testid, confirmTestid, title, onCancel, onConfirm }: ConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(20,22,26,0.4)', zIndex: 60 }}
      role="dialog"
      aria-modal="true"
    >
      <div data-testid={testid} className="card" style={{ width: 380, padding: 24 }}>
        <p className="text-sm text-[--ink-1] font-medium mb-6">{title}</p>
        <div className="flex justify-end gap-3">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Hủy</button>
          <button
            type="button"
            data-testid={confirmTestid}
            className="btn btn-sm"
            style={{ background: 'var(--danger)', color: '#fff' }}
            onClick={onConfirm}
          >
            Xóa
          </button>
        </div>
      </div>
    </div>
  )
}

interface LessonRowProps {
  lesson: Lesson
  onDelete: (l: Lesson) => void
  onToggleFreePreview: (l: Lesson) => void
  onOpenEditor: (l: Lesson) => void
  t: (k: string) => string
}

function LessonRow({ lesson, onDelete, onToggleFreePreview, onOpenEditor, t }: LessonRowProps) {
  const [title, setTitle] = useState(lesson.title)
  const [editing, setEditing] = useState(false)

  async function handleBlur() {
    setEditing(false)
    if (title !== lesson.title) {
      await updateLesson(supabase, lesson.id, { title })
    }
  }

  return (
    <div
      style={{ paddingLeft: 32, paddingRight: 12, paddingTop: 8, paddingBottom: 8 }}
      className="flex items-center gap-2 border-b border-[--border] last:border-0 hover:bg-[--surface-2]"
    >
      <span style={{ fontSize: 12, color: 'var(--ink-3)', width: 16, textAlign: 'center' }}>
        {LESSON_TYPE_ICON[lesson.type]}
      </span>
      {editing ? (
        <input
          className="input flex-1"
          style={{ height: 28, fontSize: 12.5 }}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={handleBlur}
          autoFocus
        />
      ) : (
        <span
          className="flex-1 text-[--ink-2] cursor-pointer"
          style={{ fontSize: 12.5 }}
          onClick={() => onOpenEditor(lesson)}
          data-testid={`open-editor-${lesson.id}`}
        >
          {title}
        </span>
      )}
      <button
        type="button"
        data-testid={`free-preview-${lesson.id}`}
        className="pill"
        style={{
          fontSize: 11,
          height: 20,
          background: lesson.free_preview ? 'var(--accent-soft)' : undefined,
          color: lesson.free_preview ? 'var(--accent-ink)' : undefined,
          cursor: 'pointer',
          border: 'none',
        }}
        onClick={() => onToggleFreePreview(lesson)}
        title={t('creator.courseEdit.freePreview')}
      >
        {t('creator.courseEdit.freePreview')}
      </button>
      <button
        type="button"
        data-testid={`delete-lesson-${lesson.id}`}
        className="btn btn-ghost btn-sm"
        style={{ fontSize: 12, padding: '0 6px', height: 24, color: 'var(--ink-4)' }}
        onClick={() => onDelete(lesson)}
        aria-label={t('creator.courseEdit.deleteLesson')}
      >
        ×
      </button>
    </div>
  )
}

interface ChapterBlockProps {
  chapter: Chapter
  onDeleteChapter: (ch: Chapter) => void
  onCreateLesson: (chapterId: string) => void
  onDeleteLesson: (l: Lesson) => void
  onToggleFreePreview: (l: Lesson) => void
  onOpenEditor: (l: Lesson) => void
  t: (k: string) => string
}

function ChapterBlock({ chapter, onDeleteChapter, onCreateLesson, onDeleteLesson, onToggleFreePreview, onOpenEditor, t }: ChapterBlockProps) {
  const [title, setTitle] = useState(chapter.title)
  const [editing, setEditing] = useState(false)

  async function handleBlur() {
    setEditing(false)
    if (title !== chapter.title) {
      await updateChapter(supabase, chapter.id, { title })
    }
  }

  return (
    <div className="mb-1">
      <div
        className="flex items-center gap-2 px-3 py-2 hover:bg-[--surface-3] group"
        style={{ cursor: 'grab' }}
      >
        <span className="text-[--ink-4] text-xs" style={{ userSelect: 'none' }}>⠷</span>
        {editing ? (
          <input
            className="input flex-1"
            style={{ height: 28, fontSize: 12.5, fontWeight: 600 }}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={handleBlur}
            autoFocus
          />
        ) : (
          <span
            className="flex-1 font-semibold text-[--ink-1] cursor-pointer"
            style={{ fontSize: 12.5 }}
            onClick={() => setEditing(true)}
          >
            {title}
          </span>
        )}
        <button
          type="button"
          data-testid={`delete-chapter-${chapter.id}`}
          className="btn btn-ghost btn-sm opacity-0 group-hover:opacity-100"
          style={{ fontSize: 12, padding: '0 6px', height: 24, color: 'var(--danger)' }}
          onClick={() => onDeleteChapter(chapter)}
          aria-label={t('creator.courseEdit.deleteChapter')}
        >
          ×
        </button>
      </div>

      {/* Lessons */}
      {(chapter.lessons ?? []).map(lesson => (
        <LessonRow
          key={lesson.id}
          lesson={lesson}
          onDelete={onDeleteLesson}
          onToggleFreePreview={onToggleFreePreview}
          onOpenEditor={onOpenEditor}
          t={t}
        />
      ))}

      <button
        type="button"
        data-testid={`add-lesson-${chapter.id}`}
        className="btn btn-ghost btn-sm"
        style={{ marginLeft: 32, fontSize: 12, color: 'var(--accent-ink)', paddingLeft: 0 }}
        onClick={() => onCreateLesson(chapter.id)}
      >
        {t('creator.courseEdit.addLesson')}
      </button>
    </div>
  )
}

export default function CourseEditPage() {
  const { t } = useTranslation()
  const { courseId } = useParams<{ courseId: string }>()
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)

  const [confirmDeleteChapter, setConfirmDeleteChapter] = useState<Chapter | null>(null)
  const [confirmDeleteLesson, setConfirmDeleteLesson] = useState<Lesson | null>(null)
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null)

  useEffect(() => {
    if (!courseId) return
    listChapters(supabase, courseId).then(({ chapters: ch }) => {
      setChapters(ch)
      setLoading(false)
    })
  }, [courseId])

  async function handleAddChapter() {
    if (!courseId) return
    const position = chapters.length
    const { chapter } = await createChapter(supabase, courseId, {
      title: `${t('creator.courseEdit.chapterPlaceholder')} ${position + 1}`,
      position,
    })
    if (chapter) setChapters(prev => [...prev, { ...chapter, lessons: [] }])
  }

  async function handleDeleteChapterConfirm() {
    if (!confirmDeleteChapter) return
    await deleteChapter(supabase, confirmDeleteChapter.id)
    setChapters(prev => prev.filter(ch => ch.id !== confirmDeleteChapter.id))
    setConfirmDeleteChapter(null)
  }

  async function handleAddLesson(chapterId: string) {
    const chapter = chapters.find(ch => ch.id === chapterId)
    if (!chapter) return
    const position = (chapter.lessons ?? []).length
    const { lesson } = await createLesson(supabase, chapterId, {
      title: `${t('creator.courseEdit.lessonPlaceholder')} ${position + 1}`,
      type: 'video',
      position,
      free_preview: false,
    })
    if (lesson) {
      setChapters(prev => prev.map(ch =>
        ch.id === chapterId
          ? { ...ch, lessons: [...(ch.lessons ?? []), lesson] }
          : ch
      ))
    }
  }

  async function handleDeleteLessonConfirm() {
    if (!confirmDeleteLesson) return
    await deleteLesson(supabase, confirmDeleteLesson.id)
    setChapters(prev => prev.map(ch => ({
      ...ch,
      lessons: (ch.lessons ?? []).filter(l => l.id !== confirmDeleteLesson.id),
    })))
    setConfirmDeleteLesson(null)
  }

  async function handleToggleFreePreview(lesson: Lesson) {
    const updated = await updateLesson(supabase, lesson.id, { free_preview: !lesson.free_preview })
    if (updated.lesson) {
      setChapters(prev => prev.map(ch => ({
        ...ch,
        lessons: (ch.lessons ?? []).map(l => l.id === lesson.id ? { ...l, free_preview: !lesson.free_preview } : l),
      })))
    }
  }

  async function handleSaveLesson(data: { pgn_data: string; board_perspective: 'white' | 'black'; is_free_preview: boolean; title: string }) {
    if (!selectedLesson) return
    await updateLesson(supabase, selectedLesson.id, {
      pgn_data: data.pgn_data,
      board_perspective: data.board_perspective,
      free_preview: data.is_free_preview,
      title: data.title,
    })
    setChapters(prev => prev.map(ch => ({
      ...ch,
      lessons: (ch.lessons ?? []).map(l =>
        l.id === selectedLesson.id
          ? { ...l, pgn_data: data.pgn_data, board_perspective: data.board_perspective, free_preview: data.is_free_preview, title: data.title }
          : l
      ),
    })))
  }

  const selectedChapterLessons = selectedLesson
    ? (chapters.find(ch => ch.id === selectedLesson.chapter_id)?.lessons ?? [])
        .map(l => ({ id: l.id, title: l.title, type: l.type }))
    : []

  return (
    <div className="flex min-h-screen">
      {/* Curriculum Sidebar */}
      <aside
        data-testid="curriculum-sidebar"
        style={{ width: 260, background: 'var(--surface-2)', borderRight: '1px solid var(--border)', flexShrink: 0 }}
        className="flex flex-col"
      >
        <div style={{ padding: '20px 16px 12px' }}>
          <p
            className="uppercase font-medium tracking-widest text-[--ink-3]"
            style={{ fontSize: 10, letterSpacing: '0.1em' }}
          >
            {t('creator.courseEdit.curriculum')}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-xs text-[--ink-3] px-4 py-2">…</p>
          ) : (
            chapters.map(chapter => (
              <ChapterBlock
                key={chapter.id}
                chapter={chapter}
                onDeleteChapter={ch => setConfirmDeleteChapter(ch)}
                onCreateLesson={handleAddLesson}
                onDeleteLesson={l => setConfirmDeleteLesson(l)}
                onToggleFreePreview={handleToggleFreePreview}
                onOpenEditor={l => setSelectedLesson(l)}
                t={t}
              />
            ))
          )}
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <button
            type="button"
            data-testid="add-chapter-btn"
            className="btn btn-ghost btn-sm"
            style={{ color: 'var(--accent-ink)', paddingLeft: 0 }}
            onClick={handleAddChapter}
          >
            {t('creator.courseEdit.addChapter')}
          </button>
        </div>
      </aside>

      {/* Main editor pane */}
      <main className="flex-1 p-8 overflow-y-auto">
        {selectedLesson ? (
          <LessonEditor
            lesson={{
              id: selectedLesson.id,
              title: selectedLesson.title,
              pgn_data: selectedLesson.pgn_data ?? '',
              board_perspective: selectedLesson.board_perspective ?? 'white',
              is_free_preview: selectedLesson.free_preview,
              type: selectedLesson.type,
            }}
            chapterLessons={selectedChapterLessons}
            onSelectLesson={id => {
              const lesson = chapters
                .flatMap(ch => ch.lessons ?? [])
                .find(l => l.id === id)
              if (lesson) setSelectedLesson(lesson)
            }}
            onSave={handleSaveLesson}
          />
        ) : (
          <p className="text-[--ink-3] text-sm">
            {t('admin.comingSoon')}
          </p>
        )}
      </main>

      {/* Confirm delete chapter dialog */}
      {confirmDeleteChapter && (
        <ConfirmDialog
          testid="confirm-delete-chapter-dialog"
          confirmTestid="confirm-delete-chapter-btn"
          title={t('creator.courseEdit.deleteChapterConfirm')}
          onCancel={() => setConfirmDeleteChapter(null)}
          onConfirm={handleDeleteChapterConfirm}
        />
      )}

      {/* Confirm delete lesson dialog */}
      {confirmDeleteLesson && (
        <ConfirmDialog
          testid="confirm-delete-lesson-dialog"
          confirmTestid="confirm-delete-lesson-btn"
          title={t('creator.courseEdit.deleteLessonConfirm')}
          onCancel={() => setConfirmDeleteLesson(null)}
          onConfirm={handleDeleteLessonConfirm}
        />
      )}
    </div>
  )
}
