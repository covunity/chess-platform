import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
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
  updateCourse,
  canPublishCourse,
  publishCourse,
  unpublishCourse,
} from '../../lib/creatorApi'
import type { Chapter, CourseLevel, CourseStatus, Lesson, LessonType, PublishReadiness } from '../../lib/creatorApi'
import LessonEditor from '../../components/LessonEditor/LessonEditor'
import { useAuth } from '../../context/AuthContext'
import { useAccountTiers } from '../../lib/accountTiers'
import { Video, ChessKnight, Puzzle, Eye } from 'lucide-react'

function LessonTypeIcon({ type, size = 15 }: { type: LessonType; size?: number }) {
  const props = { size, strokeWidth: 2, 'aria-hidden': true as const }
  if (type === 'video') return <Video {...props} />
  if (type === 'chess') return <ChessKnight {...props} />
  return <Puzzle {...props} />
}

interface NewLessonDialogProps {
  onCancel: () => void
  onCreate: (type: LessonType, title: string) => void
  t: (k: string) => string
}

function NewLessonDialog({ onCancel, onCreate, t }: NewLessonDialogProps) {
  const [selectedType, setSelectedType] = useState<LessonType>('video')
  const [title, setTitle] = useState('')

  const types: { type: LessonType; labelKey: string }[] = [
    { type: 'video',  labelKey: 'creator.courseEdit.typeVideo' },
    { type: 'chess',  labelKey: 'creator.courseEdit.typeChess' },
    // Puzzle lessons are temporarily hidden — stakeholder doesn't want the
    // feature exposed yet. The backend, editor tab, and player wiring all
    // remain intact so existing puzzle lessons keep working and the option
    // can be re-enabled by un-commenting this entry.
    // { type: 'puzzle', labelKey: 'creator.courseEdit.typePuzzle' },
  ]

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(20,22,26,0.4)', zIndex: 60 }}
      role="dialog"
      aria-modal="true"
    >
      <div data-testid="new-lesson-dialog" className="card" style={{ width: 400, padding: 24 }}>
        <p className="font-semibold text-(--ink-1) mb-4" style={{ fontSize: 15 }}>
          {t('creator.courseEdit.newLesson.title')}
        </p>

        <p className="text-xs font-medium uppercase tracking-wider text-(--ink-3) mb-2">
          {t('creator.courseEdit.newLesson.typeLabel')}
        </p>
        <div className="flex gap-2 mb-5">
          {types.map(({ type, labelKey }) => (
            <button
              key={type}
              type="button"
              data-testid={`lesson-type-${type}`}
              onClick={() => setSelectedType(type)}
              className="flex-1 flex flex-col items-center gap-1 py-3 rounded-(--r-md) border transition-colors"
              style={{
                borderColor: selectedType === type ? 'var(--accent)' : 'var(--border-strong)',
                background: selectedType === type ? 'var(--accent-soft)' : 'var(--surface)',
                color: selectedType === type ? 'var(--accent-ink)' : 'var(--ink-2)',
              }}
            >
              <LessonTypeIcon type={type} size={20} />
              <span style={{ fontSize: 12, fontWeight: 500 }}>{t(labelKey)}</span>
            </button>
          ))}
        </div>

        <label className="block text-xs font-medium text-(--ink-2) mb-1">
          {t('creator.courseEdit.newLesson.titleLabel')}
          <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>
        </label>
        <input
          data-testid="new-lesson-title"
          className="input w-full mb-5"
          placeholder={t('creator.courseEdit.lessonPlaceholder')}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && title.trim()) onCreate(selectedType, title.trim())
          }}
          autoFocus
        />

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            {t('creator.courseEdit.cancel')}
          </button>
          <button
            type="button"
            data-testid="new-lesson-create-btn"
            className="btn btn-primary btn-sm"
            disabled={!title.trim()}
            onClick={() => { if (title.trim()) onCreate(selectedType, title.trim()) }}
          >
            {t('creator.courseEdit.newLesson.create')}
          </button>
        </div>
      </div>
    </div>
  )
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
        <p className="text-sm text-(--ink-1) font-medium mb-6">{title}</p>
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
  onOpenEditor: (l: Lesson) => void
  t: (k: string) => string
}

function LessonRow({ lesson, onDelete, onOpenEditor, t }: LessonRowProps) {
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
      className="flex items-center gap-2 border-b border-(--border) last:border-0 hover:bg-(--surface-2)"
    >
      <span style={{ color: 'var(--ink-3)', width: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LessonTypeIcon type={lesson.type} />
      </span>
      {editing ? (
        <input
          className="input flex-1"
          style={{ height: 28, fontSize: 13.5 }}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={handleBlur}
          autoFocus
        />
      ) : (
        <span
          className="flex-1 text-(--ink-2) cursor-pointer"
          style={{ fontSize: 13.5 }}
          onClick={() => onOpenEditor(lesson)}
          data-testid={`open-editor-${lesson.id}`}
        >
          {title}
        </span>
      )}
      {lesson.free_preview && (
        <span
          className="pill"
          style={{ fontSize: 10, height: 18, background: 'var(--accent-soft)', color: 'var(--accent-ink)', border: 'none' }}
        >
          <Eye size={10} style={{ marginRight: 2 }} />
          {t('creator.courseEdit.freePreview')}
        </span>
      )}
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
  onOpenNewLessonDialog: (chapterId: string) => void
  onDeleteLesson: (l: Lesson) => void
  onOpenEditor: (l: Lesson) => void
  t: (k: string) => string
}

function ChapterBlock({ chapter, onDeleteChapter, onOpenNewLessonDialog, onDeleteLesson, onOpenEditor, t }: ChapterBlockProps) {
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
        className="flex items-center gap-2 px-3 py-2 hover:bg-(--surface-3) group"
        style={{ cursor: 'grab' }}
      >
        <span className="text-(--ink-4) text-xs" style={{ userSelect: 'none' }}>⠷</span>
        {editing ? (
          <input
            className="input flex-1"
            style={{ height: 28, fontSize: 13.5, fontWeight: 600 }}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={handleBlur}
            autoFocus
          />
        ) : (
          <span
            className="flex-1 font-semibold text-(--ink-1) cursor-pointer"
            style={{ fontSize: 13.5 }}
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
          onOpenEditor={onOpenEditor}
          t={t}
        />
      ))}

      <button
        type="button"
        data-testid={`add-lesson-${chapter.id}`}
        className="btn btn-ghost btn-sm"
        style={{ marginLeft: 32, fontSize: 12, color: 'var(--accent-ink)', paddingLeft: 0 }}
        onClick={() => onOpenNewLessonDialog(chapter.id)}
      >
        {t('creator.courseEdit.addLesson')}
      </button>
    </div>
  )
}

const REASON_LABEL: Record<string, string> = {
  missing_title: 'creator.courseEdit.publish.reasonTitle',
  missing_description: 'creator.courseEdit.publish.reasonDescription',
  missing_thumbnail: 'creator.courseEdit.publish.reasonThumbnail',
  missing_price: 'creator.courseEdit.publish.reasonPrice',
  no_chapters: 'creator.courseEdit.publish.reasonChapters',
  no_lessons: 'creator.courseEdit.publish.reasonLessons',
}

const STATUS_DOT: Partial<Record<CourseStatus, string>> = {
  draft: 'var(--ink-4)',
  published: 'var(--success)',
}

interface PublishBarProps {
  courseId: string
  courseTitle: string
  status: CourseStatus
  readiness: PublishReadiness
  publishing: boolean
  onPublish: () => void
  onUnpublish: () => void
  onSaveLesson?: () => void
  onToggleFreePreview?: () => void
  isFreePreview?: boolean
  t: (k: string) => string
}

function PublishBar({ courseId, courseTitle, status, readiness, publishing, onPublish, onUnpublish, onSaveLesson, onToggleFreePreview, isFreePreview, t }: PublishBarProps) {
  const barStyle: React.CSSProperties = {
    padding: '8px 20px',
    background: 'var(--surface)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  }

  const left = (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <span
        className="font-medium text-(--ink-1) truncate"
        style={{ fontSize: 13 }}
      >
        {courseTitle}
      </span>
      <div className="flex items-center gap-1.5 shrink-0">
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_DOT[status] ?? 'var(--ink-4)' }} />
        <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>
          {t('creator.studio.status.' + status)}
        </span>
      </div>
    </div>
  )

  const freePreviewBtn = onToggleFreePreview && (
    <button
      type="button"
      data-testid="free-preview-toggle"
      className="btn btn-sm"
      onClick={onToggleFreePreview}
      style={{
        fontSize: 12,
        gap: 4,
        display: 'inline-flex',
        alignItems: 'center',
        background: isFreePreview ? 'var(--accent-soft)' : 'var(--surface-2)',
        color: isFreePreview ? 'var(--accent-ink)' : 'var(--ink-2)',
        border: `1px solid ${isFreePreview ? 'var(--accent-border)' : 'var(--border)'}`,
      }}
    >
      <Eye size={13} />
      {isFreePreview ? `✓ ${t('creator.courseEdit.freePreview')}` : t('creator.courseEdit.freePreview')}
    </button>
  )

  if (status === 'published') {
    return (
      <div data-testid="publish-bar" className="flex items-center gap-3" style={barStyle}>
        {left}
        {onSaveLesson && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onSaveLesson}>
            {t('creator.courseEdit.saveLesson')}
          </button>
        )}
        {freePreviewBtn}
        <Link
          to={`/courses/${courseId}`}
          data-testid="view-public-page"
          className="btn btn-ghost btn-sm"
        >
          {t('creator.courseEdit.viewPublicPage')}
        </Link>
        <button type="button" data-testid="unpublish-btn" className="btn btn-secondary btn-sm" onClick={onUnpublish} disabled={publishing}>
          {t('creator.courseEdit.publish.unpublish')}
        </button>
      </div>
    )
  }

  return (
    <div data-testid="publish-bar" className="flex items-center gap-3" style={barStyle}>
      {left}
      {onSaveLesson && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onSaveLesson}>
          {t('creator.courseEdit.saveLesson')}
        </button>
      )}
      {freePreviewBtn}
      <div className="relative group">
        <button
          type="button"
          data-testid="publish-btn"
          className="btn btn-accent btn-sm"
          onClick={onPublish}
          disabled={!readiness.ready || publishing}
        >
          {t('creator.courseEdit.publish.publish')}
        </button>
        {!readiness.ready && readiness.reasons.length > 0 && (
          <div
            className="card absolute top-full mt-2 right-0 hidden group-hover:block"
            style={{ width: 240, padding: '10px 14px', zIndex: 20 }}
          >
            <p className="text-xs font-semibold text-(--ink-1) mb-2">
              {t('creator.courseEdit.publish.tooltipTitle')}
            </p>
            <ul className="space-y-1">
              {readiness.reasons.map(r => (
                <li key={r} className="text-xs text-(--ink-2) flex items-start gap-1.5">
                  <span style={{ color: 'var(--danger)', marginTop: 1 }}>✕</span>
                  {t(REASON_LABEL[r] ?? r)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

function LessonEditorSkeleton({ lessonType }: { lessonType?: LessonType }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 380px',
      height: '100%',
      background: 'var(--surface)',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <div className="skeleton" style={{ width: 72, height: 28, borderRadius: 6 }} />
          <div className="skeleton" style={{ width: 72, height: 28, borderRadius: 6 }} />
        </div>
        <div className="skeleton" style={{ width: '100%', height: 36, borderRadius: 6 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="skeleton" style={{ width: 96, height: 26, borderRadius: 6 }} />
          <div className="skeleton" style={{ width: 96, height: 26, borderRadius: 6 }} />
        </div>
        {lessonType === 'video'
          ? <div className="skeleton" style={{ width: '100%', aspectRatio: '16/9', borderRadius: 8 }} />
          : <div className="skeleton" style={{ width: '100%', flex: 1, minHeight: 280, borderRadius: 8 }} />
        }
      </div>
      <div style={{
        borderLeft: '1px solid var(--border)',
        background: 'var(--surface-2)',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        <div className="skeleton" style={{ width: '40%', height: 11, borderRadius: 4 }} />
        {lessonType === 'video'
          ? <div className="skeleton" style={{ width: '100%', aspectRatio: '16/9', borderRadius: 8 }} />
          : <div className="skeleton" style={{ width: '100%', aspectRatio: '1/1', borderRadius: 8, maxHeight: 340 }} />
        }
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
          <div className="skeleton" style={{ width: '80%', height: 12, borderRadius: 4 }} />
          <div className="skeleton" style={{ width: '60%', height: 12, borderRadius: 4 }} />
          <div className="skeleton" style={{ width: '70%', height: 12, borderRadius: 4 }} />
          <div className="skeleton" style={{ width: '50%', height: 12, borderRadius: 4 }} />
        </div>
      </div>
    </div>
  )
}

export default function CourseEditPage() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const { getTier } = useAccountTiers()
  const { courseId } = useParams<{ courseId: string }>()
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)
  const [courseStatus, setCourseStatus] = useState<CourseStatus>('draft')
  const [readiness, setReadiness] = useState<PublishReadiness>({ ready: false, reasons: [] })
  const [publishing, setPublishing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const saveLessonRef = useRef<(() => void) | null>(null)
  const lessonTransitionRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [confirmDeleteChapter, setConfirmDeleteChapter] = useState<Chapter | null>(null)
  const [confirmDeleteLesson, setConfirmDeleteLesson] = useState<Lesson | null>(null)
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null)
  const [displayedLesson, setDisplayedLesson] = useState<Lesson | null>(null)
  const [isLessonTransitioning, setIsLessonTransitioning] = useState(false)
  const [newLessonChapterId, setNewLessonChapterId] = useState<string | null>(null)

  const [courseTitle, setCourseTitle] = useState('')
  const [courseDescription, setCourseDescription] = useState('')
  const [courseThumbnailUrl, setCourseThumbnailUrl] = useState<string | null>(null)
  const [coursePrice, setCoursePrice] = useState(0)
  const [courseLevel, setCourseLevel] = useState<CourseLevel>('beginner')
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null)
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null)
  const [savingCourseInfo, setSavingCourseInfo] = useState(false)
  const [showCourseInfo, setShowCourseInfo] = useState(false)

  useEffect(() => {
    if (courseId) localStorage.setItem('lastEditedCourseId', courseId)
  }, [courseId])

  const refreshReadiness = useCallback(async () => {
    if (!courseId) return
    const result = await canPublishCourse(supabase, courseId)
    setReadiness(result)
  }, [courseId])

  const switchLesson = useCallback((lesson: Lesson) => {
    if (lessonTransitionRef.current) clearTimeout(lessonTransitionRef.current)
    setSelectedLesson(lesson)
    setShowCourseInfo(false)
    setIsLessonTransitioning(true)
    lessonTransitionRef.current = setTimeout(() => {
      setDisplayedLesson(lesson)
      setIsLessonTransitioning(false)
    }, 100)
  }, [])

  useEffect(() => {
    return () => { if (lessonTransitionRef.current) clearTimeout(lessonTransitionRef.current) }
  }, [])

  useEffect(() => {
    if (!courseId) return
    Promise.all([
      listChapters(supabase, courseId),
      supabase.from('courses').select('title, description, thumbnail_url, price, level, status').eq('id', courseId).single(),
    ]).then(([chaptersResult, courseResult]) => {
      setChapters(chaptersResult.chapters)
      if (courseResult.data) {
        const c = courseResult.data
        setCourseStatus(c.status as CourseStatus)
        setCourseTitle(c.title ?? '')
        setCourseDescription(c.description ?? '')
        setCourseThumbnailUrl(c.thumbnail_url ?? null)
        setThumbnailPreview(c.thumbnail_url ?? null)
        setCoursePrice(c.price ?? 0)
        setCourseLevel((c.level ?? 'beginner') as CourseLevel)
      }
      setLoading(false)
      const firstLesson = chaptersResult.chapters.flatMap(ch => ch.lessons ?? [])[0]
      if (firstLesson) { setSelectedLesson(firstLesson); setDisplayedLesson(firstLesson) }
    })
  }, [courseId])

  useEffect(() => {
    if (courseStatus !== 'draft' || !courseId) return
    let cancelled = false
    canPublishCourse(supabase, courseId).then(result => {
      if (!cancelled) setReadiness(result)
    })
    return () => { cancelled = true }
  }, [courseStatus, courseId])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function handlePublish() {
    if (!courseId) return
    setPublishing(true)
    const { error } = await publishCourse(supabase, courseId)
    if (!error) {
      setCourseStatus('published')
      showToast(t('creator.courseEdit.publish.toastPublished'))
    }
    setPublishing(false)
  }

  async function handleUnpublish() {
    if (!courseId) return
    setPublishing(true)
    const { error } = await unpublishCourse(supabase, courseId)
    if (!error) {
      setCourseStatus('draft')
      await refreshReadiness()
      showToast(t('creator.courseEdit.publish.toastUnpublished'))
    }
    setPublishing(false)
  }

  async function handleSaveCourseInfo() {
    if (!courseId) return
    setSavingCourseInfo(true)
    let thumbnail_url = courseThumbnailUrl
    if (thumbnailFile) {
      const ext = thumbnailFile.name.split('.').pop()
      const path = `${courseId}/cover.${ext}`
      const { data } = await supabase.storage.from('thumbnails').upload(path, thumbnailFile, { upsert: true })
      if (data) {
        const { data: urlData } = supabase.storage.from('thumbnails').getPublicUrl(path)
        thumbnail_url = urlData.publicUrl
        setCourseThumbnailUrl(thumbnail_url)
        setThumbnailFile(null)
      }
    }
    await updateCourse(supabase, courseId, {
      title: courseTitle,
      description: courseDescription || undefined,
      thumbnail_url: thumbnail_url ?? undefined,
      price: coursePrice,
      level: courseLevel,
    })
    setSavingCourseInfo(false)
    showToast(t('creator.courseEdit.courseInfo.saved'))
    refreshReadiness()
  }

  async function handleAddChapter() {
    if (!courseId) return
    const position = chapters.length
    const { chapter } = await createChapter(supabase, courseId, {
      title: `${t('creator.courseEdit.chapterPlaceholder')} ${position + 1}`,
      position,
    })
    if (chapter) {
      setChapters(prev => [...prev, { ...chapter, lessons: [] }])
      await refreshReadiness()
    }
  }

  async function handleDeleteChapterConfirm() {
    if (!confirmDeleteChapter) return
    await deleteChapter(supabase, confirmDeleteChapter.id)
    setChapters(prev => prev.filter(ch => ch.id !== confirmDeleteChapter.id))
    setConfirmDeleteChapter(null)
    await refreshReadiness()
  }

  async function handleAddLesson(chapterId: string, type: LessonType, title: string) {
    const chapter = chapters.find(ch => ch.id === chapterId)
    if (!chapter) return
    const position = (chapter.lessons ?? []).length
    const { lesson, error } = await createLesson(supabase, chapterId, {
      title,
      type,
      position,
      free_preview: false,
    })
    if (error?.message === 'errors.lessonLimitReached') {
      showToast(t('errors.lessonLimitReached'))
      setNewLessonChapterId(null)
      return
    }
    if (lesson) {
      setChapters(prev => prev.map(ch =>
        ch.id === chapterId
          ? { ...ch, lessons: [...(ch.lessons ?? []), lesson] }
          : ch
      ))
      await refreshReadiness()
    }
    setNewLessonChapterId(null)
  }

  async function handleDeleteLessonConfirm() {
    if (!confirmDeleteLesson) return
    await deleteLesson(supabase, confirmDeleteLesson.id)
    setChapters(prev => prev.map(ch => ({
      ...ch,
      lessons: (ch.lessons ?? []).filter(l => l.id !== confirmDeleteLesson.id),
    })))
    setConfirmDeleteLesson(null)
    await refreshReadiness()
  }

  async function handleToggleFreePreview(lesson: Lesson) {
    const newValue = !lesson.free_preview
    setChapters(prev => prev.map(ch => ({
      ...ch,
      lessons: (ch.lessons ?? []).map(l => l.id === lesson.id ? { ...l, free_preview: newValue } : l),
    })))
    setSelectedLesson(prev => prev?.id === lesson.id ? { ...prev, free_preview: newValue } : prev)
    await updateLesson(supabase, lesson.id, { free_preview: newValue })
  }

  async function handleSaveLesson(data: { type: LessonType; pgn_data: string; board_perspective: 'white' | 'black'; is_free_preview: boolean; title: string; description?: string | null; has_rewind_mode?: boolean }) {
    if (!selectedLesson) return
    const hasRewindMode = data.has_rewind_mode ?? false
    // Rewind sibling rows are content-managed by the DB trigger from their
    // source. Pushing pgn / perspective / etc. from a sibling save would lose
    // the source's intent — only title + free_preview are safe to forward.
    const isSibling = !!selectedLesson.rewind_source_id
    if (isSibling) {
      await updateLesson(supabase, selectedLesson.id, {
        free_preview: data.is_free_preview,
        title: data.title,
      })
      showToast(t('creator.courseEdit.saveLessonToast'))
      setChapters(prev => prev.map(ch => ({
        ...ch,
        lessons: (ch.lessons ?? []).map(l =>
          l.id === selectedLesson.id
            ? { ...l, free_preview: data.is_free_preview, title: data.title }
            : l
        ),
      })))
      await refreshReadiness()
      return
    }
    const { error: updateErr } = await updateLesson(supabase, selectedLesson.id, {
      type: data.type,
      pgn_data: data.pgn_data,
      board_perspective: data.board_perspective,
      free_preview: data.is_free_preview,
      title: data.title,
      description: data.description ?? null,
      has_rewind_mode: hasRewindMode,
    })
    if (updateErr?.message === 'errors.lessonLimitReached') {
      // Sibling-create from has_rewind_mode=true hit the per-course lesson cap.
      showToast(t('errors.lessonLimitReached'))
      return
    }
    showToast(t('creator.courseEdit.saveLessonToast'))
    setChapters(prev => prev.map(ch => ({
      ...ch,
      lessons: (ch.lessons ?? []).map(l =>
        l.id === selectedLesson.id
          ? { ...l, type: data.type, pgn_data: data.pgn_data, board_perspective: data.board_perspective, free_preview: data.is_free_preview, title: data.title, description: data.description ?? null, has_rewind_mode: hasRewindMode }
          : l
      ),
    })))
    await refreshReadiness()
  }

  async function handleRemoveRewindSibling() {
    if (!selectedLesson) return
    const sibling = chapters
      .flatMap(ch => ch.lessons ?? [])
      .find(l => l.rewind_source_id === selectedLesson.id)
    if (!sibling) return
    await deleteLesson(supabase, sibling.id)
    setChapters(prev => prev.map(ch => ({
      ...ch,
      lessons: (ch.lessons ?? []).filter(l => l.id !== sibling.id),
    })))
  }

  const selectedChapterLessons = selectedLesson
    ? (chapters.find(ch => ch.id === selectedLesson.chapter_id)?.lessons ?? [])
        .map(l => ({ id: l.id, title: l.title, type: l.type }))
    : []

  return (
    <div className="flex relative" style={{ height: 'calc(100vh - 4rem)' }}>
      {/* Curriculum Sidebar */}
      <aside
        data-testid="curriculum-sidebar"
        style={{ width: 260, background: 'var(--surface-2)', borderRight: '1px solid var(--border)', flexShrink: 0 }}
        className="flex flex-col"
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <button
            type="button"
            onClick={() => { setSelectedLesson(null); setDisplayedLesson(null); setShowCourseInfo(true) }}
            className="group"
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '8px 10px',
              borderRadius: 'var(--r-sm)',
              border: '1px solid',
              borderColor: showCourseInfo && !selectedLesson ? 'var(--accent-border)' : 'var(--border)',
              cursor: 'pointer',
              fontSize: 13.5,
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: showCourseInfo && !selectedLesson ? 'var(--accent-soft)' : 'var(--surface)',
              color: showCourseInfo && !selectedLesson ? 'var(--accent-ink)' : 'var(--ink-2)',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, opacity: 0.7 }}>
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            {t('creator.courseEdit.courseInfo.link')}
          </button>
        </div>

        <div style={{ padding: '12px 16px 8px' }}>
          <p
            className="uppercase font-medium tracking-widest text-(--ink-3)"
            style={{ fontSize: 10, letterSpacing: '0.1em' }}
          >
            {t('creator.courseEdit.curriculum')}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-xs text-(--ink-3) px-4 py-2">…</p>
          ) : (
            chapters.map(chapter => (
              <ChapterBlock
                key={chapter.id}
                chapter={chapter}
                onDeleteChapter={ch => setConfirmDeleteChapter(ch)}
                onOpenNewLessonDialog={chapterId => setNewLessonChapterId(chapterId)}
                onDeleteLesson={l => setConfirmDeleteLesson(l)}
                onOpenEditor={l => switchLesson(l)}
                t={t}
              />
            ))
          )}
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          {(() => {
            const maxChapters = profile?.account_tier_id
              ? (getTier(profile.account_tier_id)?.max_chapters_per_course ?? null)
              : null
            const atLimit = maxChapters != null && chapters.length >= maxChapters
            return (
              <>
                {maxChapters != null && (
                  <p
                    data-testid="chapter-counter"
                    className="text-xs text-(--ink-3) mb-1"
                    style={{ fontSize: 11 }}
                  >
                    {t('creator.courseEdit.chapterCounter', { current: chapters.length, max: maxChapters })}
                  </p>
                )}
                <div className="relative group inline-block">
                  <button
                    type="button"
                    data-testid="add-chapter-btn"
                    className="btn btn-ghost btn-sm"
                    style={{
                      color: atLimit ? 'var(--ink-4)' : 'var(--accent-ink)',
                      paddingLeft: 0,
                      cursor: atLimit ? 'not-allowed' : undefined,
                      opacity: atLimit ? 0.5 : undefined,
                    }}
                    disabled={atLimit}
                    onClick={handleAddChapter}
                  >
                    {t('creator.courseEdit.addChapter')}
                  </button>
                  {atLimit && maxChapters != null && (
                    <div
                      className="card absolute bottom-full mb-2 left-0 hidden group-hover:block"
                      style={{ width: 220, padding: '8px 12px', zIndex: 20, pointerEvents: 'none' }}
                    >
                      <p className="text-xs text-(--ink-2)">
                        {t('creator.courseEdit.chapterLimitReachedTooltip', { max: maxChapters })}
                      </p>
                    </div>
                  )}
                </div>
              </>
            )
          })()}
        </div>

      </aside>

      {/* Main editor pane */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Publish bar — top-right */}
        {!loading && courseId && (
          <PublishBar
            courseId={courseId}
            courseTitle={courseTitle}
            status={courseStatus}
            readiness={readiness}
            publishing={publishing}
            onPublish={handlePublish}
            onUnpublish={handleUnpublish}
            onSaveLesson={selectedLesson ? () => saveLessonRef.current?.() : undefined}
            onToggleFreePreview={selectedLesson ? () => handleToggleFreePreview(selectedLesson) : undefined}
            isFreePreview={selectedLesson?.free_preview ?? false}
            t={t}
          />
        )}
        {isLessonTransitioning ? (
          <LessonEditorSkeleton lessonType={selectedLesson?.type} />
        ) : displayedLesson ? (
          <div
            key={displayedLesson.id}
            className="lesson-panel-enter"
            style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
          >
            <LessonEditor
              lesson={{
                id: displayedLesson.id,
                title: displayedLesson.title,
                pgn_data: displayedLesson.pgn_data ?? '',
                board_perspective: displayedLesson.board_perspective ?? 'white',
                is_free_preview: displayedLesson.free_preview,
                type: displayedLesson.type,
                has_rewind_mode: displayedLesson.has_rewind_mode ?? false,
                rewind_source_id: displayedLesson.rewind_source_id ?? null,
                rewind_source_title: displayedLesson.rewind_source_id
                  ? chapters
                      .flatMap(ch => ch.lessons ?? [])
                      .find(l => l.id === displayedLesson.rewind_source_id)?.title ?? null
                  : null,
                // Video fields — must be forwarded so VideoLessonEditor shows the
                // existing video instead of defaulting to the idle/empty state.
                video_status: displayedLesson.video_status,
                video_provider: displayedLesson.video_provider,
                video_provider_id: displayedLesson.video_provider_id,
                video_filename: displayedLesson.video_filename,
                video_size_bytes: displayedLesson.video_size_bytes,
                duration_seconds: displayedLesson.duration_seconds,
              }}
              chapterLessons={selectedChapterLessons}
              onSelectLesson={id => {
                const lesson = chapters
                  .flatMap(ch => ch.lessons ?? [])
                  .find(l => l.id === id)
                if (lesson) switchLesson(lesson)
              }}
              onSave={handleSaveLesson}
              onRemoveRewindSibling={handleRemoveRewindSibling}
              showSidebar={false}
              saveRef={saveLessonRef}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto" style={{ padding: '32px 40px' }}>
          <div className="card" style={{ maxWidth: 680, margin: '0 auto', padding: '32px 36px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 4 }}>
              {t('creator.courseEdit.courseInfo.heading')}
            </h2>

            {/* Title */}
            <div>
              <label className="label" htmlFor="ci-title">{t('creator.courseEdit.courseInfo.labelTitle')}</label>
              <input id="ci-title" className="input" value={courseTitle} onChange={e => setCourseTitle(e.target.value)} />
            </div>

            {/* Description */}
            <div>
              <label className="label" htmlFor="ci-desc">{t('creator.courseEdit.courseInfo.labelDescription')}</label>
              <textarea
                id="ci-desc"
                className="input"
                value={courseDescription}
                onChange={e => setCourseDescription(e.target.value)}
                style={{ height: 100, display: 'block' }}
              />
            </div>

            {/* Thumbnail */}
            <div>
              <label className="label">{t('creator.courseEdit.courseInfo.labelThumbnail')}</label>
              <div
                style={{
                  width: '100%',
                  aspectRatio: '16/10',
                  maxHeight: 200,
                  border: '1px dashed var(--border-strong)',
                  borderRadius: 'var(--r-md)',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  position: 'relative',
                  background: thumbnailPreview ? undefined : 'var(--surface-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onClick={() => document.getElementById('ci-thumb-input')?.click()}
              >
                {thumbnailPreview
                  ? <img src={thumbnailPreview} alt="thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{t('creator.courseEdit.courseInfo.thumbnailHint')}</span>
                }
                {thumbnailPreview && (
                  <div style={{ position: 'absolute', bottom: 8, right: 8, background: 'rgba(20,22,26,0.7)', color: '#fff', fontSize: 11.5, padding: '3px 10px', borderRadius: 99 }}>
                    {t('creator.courseEdit.courseInfo.thumbnailChange')}
                  </div>
                )}
              </div>
              <input
                id="ci-thumb-input"
                type="file"
                accept="image/jpeg,image/png"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setThumbnailFile(file)
                  setThumbnailPreview(URL.createObjectURL(file))
                }}
              />
            </div>

            {/* Price + Level row */}
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <label className="label" htmlFor="ci-price">{t('creator.courseEdit.courseInfo.labelPrice')}</label>
                <input
                  id="ci-price"
                  className="input"
                  type="number"
                  min={0}
                  value={coursePrice}
                  onChange={e => setCoursePrice(Number(e.target.value))}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="label" htmlFor="ci-level">{t('creator.courseEdit.courseInfo.labelLevel')}</label>
                <select
                  id="ci-level"
                  className="input"
                  value={courseLevel}
                  onChange={e => setCourseLevel(e.target.value as CourseLevel)}
                >
                  <option value="beginner">{t('creator.newCourse.levelBeginner')}</option>
                  <option value="intermediate">{t('creator.newCourse.levelIntermediate')}</option>
                  <option value="advanced">{t('creator.newCourse.levelAdvanced')}</option>
                </select>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-accent"
              style={{ alignSelf: 'flex-start' }}
              disabled={savingCourseInfo}
              onClick={handleSaveCourseInfo}
            >
              {savingCourseInfo ? '…' : t('creator.courseEdit.courseInfo.save')}
            </button>
          </div>
          </div>
        )}
      </main>

      {/* Toast notification */}
      {toast && (
        <div
          data-testid="toast"
          className="toast toast-success"
        >
          {toast}
        </div>
      )}

      {/* New lesson dialog */}
      {newLessonChapterId && (
        <NewLessonDialog
          onCancel={() => setNewLessonChapterId(null)}
          onCreate={(type, title) => handleAddLesson(newLessonChapterId, type, title)}
          t={t}
        />
      )}

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
