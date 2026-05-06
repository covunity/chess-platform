import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import {
  getCourseDetail,
  checkUserEnrollment,
} from '../lib/coursesApi'
import type { CourseDetail, CourseDetailLesson, CourseDetailChapter } from '../lib/coursesApi'
import { useAuth } from '../context/AuthContext'
import ChessBoard from '../components/ChessBoard/ChessBoard'

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function formatPrice(price: number): string {
  if (price === 0) return 'Miễn phí'
  if (price >= 1000) return `${Math.round(price / 1000)}k ₫`
  return `${price} ₫`
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (mins >= 60) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return `${h}:${m.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`
  return `${hours.toFixed(1)}h`
}

function getPromoDays(promoEndsAt: string): number {
  const end = new Date(promoEndsAt)
  const now = new Date()
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
}

function StarRow({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 1 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <span
          key={i}
          style={{
            fontSize: size,
            color: i <= Math.round(rating) ? 'oklch(0.7 0.16 80)' : 'var(--border-strong)',
          }}
        >
          ★
        </span>
      ))}
    </span>
  )
}

function LessonTypeIcon({ type }: { type: CourseDetailLesson['type'] }) {
  if (type === 'video') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    )
  }
  if (type === 'chess') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="8" y="2" width="8" height="4" rx="1" />
        <path d="M12 6v4M9 10h6M7 14h10M5 18h14M4 22h16" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LessonRow({
  lesson,
  isEnrolled,
  onPreview,
  onLock,
}: {
  lesson: CourseDetailLesson
  isEnrolled: boolean
  onPreview: (lesson: CourseDetailLesson) => void
  onLock: (lesson: CourseDetailLesson) => void
}) {
  const { t } = useTranslation()
  const canPlay = lesson.free_preview || isEnrolled

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 20px 10px 48px',
        borderTop: '1px solid var(--border)',
        cursor: canPlay || !isEnrolled ? 'pointer' : 'default',
      }}
      onClick={() => {
        if (lesson.free_preview) onPreview(lesson)
        else if (!isEnrolled) onLock(lesson)
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: 'var(--surface-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--ink-3)',
          flexShrink: 0,
        }}
      >
        <LessonTypeIcon type={lesson.type} />
      </div>
      <span style={{ fontSize: 13.5, color: 'var(--ink-1)', flex: 1 }}>{lesson.title}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {lesson.free_preview && (
          <button
            type="button"
            data-testid={`free-preview-pill-${lesson.id}`}
            onClick={e => { e.stopPropagation(); onPreview(lesson) }}
            className="pill pill-success"
            style={{ cursor: 'pointer', border: 'none' }}
          >
            {t('courseDetail.freePreviewPill')}
          </button>
        )}
        {lesson.duration_seconds > 0 && (
          <span style={{ fontSize: 12, color: 'var(--ink-3)', minWidth: 40, textAlign: 'right' }}>
            {formatDuration(lesson.duration_seconds)}
          </span>
        )}
        {!lesson.free_preview && !isEnrolled && (
          <button
            type="button"
            data-testid={`lock-icon-${lesson.id}`}
            onClick={e => { e.stopPropagation(); onLock(lesson) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}
            aria-label="locked"
          >
            <LockIcon />
          </button>
        )}
      </div>
    </div>
  )
}

function ChapterAccordion({
  chapter,
  index,
  expanded,
  onToggle,
  isEnrolled,
  onPreview,
  onLock,
}: {
  chapter: CourseDetailChapter
  index: number
  expanded: boolean
  onToggle: () => void
  isEnrolled: boolean
  onPreview: (lesson: CourseDetailLesson) => void
  onLock: (lesson: CourseDetailLesson) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <button
        type="button"
        data-testid={`chapter-header-${chapter.id}`}
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          background: expanded ? 'var(--surface-2)' : 'var(--surface)',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <ChevronIcon open={expanded} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>
            {t('courseDetail.chapterLabel', { n: index + 1, title: chapter.title })}
          </span>
        </div>
        <span style={{ fontSize: 12, color: 'var(--ink-3)', flexShrink: 0 }}>
          {t('courseDetail.lessonsCount', { count: chapter.lessons.length })}
        </span>
      </button>
      {expanded && chapter.lessons.map(lesson => (
        <LessonRow
          key={lesson.id}
          lesson={lesson}
          isEnrolled={isEnrolled}
          onPreview={onPreview}
          onLock={onLock}
        />
      ))}
    </div>
  )
}

function RatingsHistogram({ course }: { course: CourseDetail }) {
  const { t } = useTranslation()
  const reviews = course.reviews
  const starCounts = [5, 4, 3, 2, 1].map(star => ({
    star,
    count: reviews.filter(r => r.rating === star).length,
  }))
  const total = reviews.length

  return (
    <div
      className="card"
      style={{
        padding: 24,
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: 32,
        alignItems: 'center',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          data-testid="rating-avg-display"
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 56,
            lineHeight: 1,
            color: 'var(--ink-1)',
          }}
        >
          {course.rating_avg > 0 ? course.rating_avg.toFixed(1) : '—'}
        </div>
        <StarRow rating={course.rating_avg} />
        <div
          data-testid="rating-count-display"
          style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}
        >
          {t('courseDetail.reviewsCount', { count: course.rating_count })}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {starCounts.map(({ star, count }) => {
          const pct = total > 0 ? Math.round((count / total) * 100) : 0
          return (
            <div key={star} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, width: 18, textAlign: 'right', color: 'var(--ink-2)' }}>{star}★</span>
              <div
                style={{
                  flex: 1,
                  height: 6,
                  background: 'var(--surface-2)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: 'var(--ink-1)',
                    borderRadius: 3,
                  }}
                />
              </div>
              <span style={{ fontSize: 12, color: 'var(--ink-3)', width: 30, textAlign: 'right' }}>
                {pct}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ReviewCard({ review }: { review: CourseDetail['reviews'][number] }) {
  const initials = review.reviewer_name
    ? review.reviewer_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '?'
  const date = new Date(review.created_at).toLocaleDateString('vi-VN', { year: 'numeric', month: 'long' })

  return (
    <div className="card" style={{ padding: 20, display: 'flex', gap: 14 }}>
      <div
        className="avatar"
        style={{
          background: 'oklch(0.88 0.06 60)',
          color: 'var(--ink-1)',
          fontSize: 12,
          fontWeight: 600,
          flexShrink: 0,
          alignSelf: 'flex-start',
        }}
      >
        {initials}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>{review.reviewer_name ?? '—'}</span>
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{date}</span>
        </div>
        <StarRow rating={review.rating} size={12} />
        {review.title && (
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>{review.title}</p>
        )}
        {review.body && (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>{review.body}</p>
        )}
      </div>
    </div>
  )
}

function PreviewModal({
  lesson,
  onClose,
}: {
  lesson: CourseDetailLesson
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="preview-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,17,20,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: 560, padding: 32, position: 'relative' }}
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          data-testid="close-preview-modal"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'none',
            border: 'none',
            fontSize: 20,
            cursor: 'pointer',
            color: 'var(--ink-3)',
          }}
        >
          {t('courseDetail.closeBtn')}
        </button>
        <h3
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 22,
            marginBottom: 16,
            color: 'var(--ink-1)',
          }}
        >
          {lesson.title}
        </h3>
        {lesson.type === 'chess' || lesson.type === 'puzzle' ? (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <ChessBoard fen={INITIAL_FEN} size={300} showCoords={false} />
          </div>
        ) : (
          <div
            style={{
              aspectRatio: '16/9',
              background: '#0f1114',
              borderRadius: 'var(--r-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink-4)',
              fontSize: 13,
            }}
          >
            Video preview
          </div>
        )}
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('courseDetail.closePreview')}
          </button>
        </div>
      </div>
    </div>
  )
}

function LockPrompt({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="lock-prompt"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,17,20,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: 400, padding: 32, textAlign: 'center' }}
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          data-testid="close-lock-prompt"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'none',
            border: 'none',
            fontSize: 20,
            cursor: 'pointer',
            color: 'var(--ink-3)',
          }}
        >
          {t('courseDetail.closeBtn')}
        </button>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
        <h3
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 22,
            marginBottom: 8,
            color: 'var(--ink-1)',
          }}
        >
          {t('courseDetail.lockPromptTitle')}
        </h3>
        <p style={{ fontSize: 14, color: 'var(--ink-2)', marginBottom: 24 }}>
          {t('courseDetail.lockPromptBody')}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <Link to="/login" className="btn btn-secondary">
            {t('courseDetail.lockPromptLogin')}
          </Link>
          <button type="button" className="btn btn-accent" onClick={onClose}>
            {t('courseDetail.purchase')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CourseDetailPage() {
  const { courseId } = useParams<{ courseId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t } = useTranslation()

  const [course, setCourse] = useState<CourseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [isEnrolled, setIsEnrolled] = useState(false)
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set())
  const [previewLesson, setPreviewLesson] = useState<CourseDetailLesson | null>(null)
  const [lockPromptOpen, setLockPromptOpen] = useState(false)

  useEffect(() => {
    if (!courseId) return
    setLoading(true)
    getCourseDetail(supabase, courseId).then(({ course: data }) => {
      setCourse(data)
      if (data && data.chapters.length > 0) {
        setExpandedChapters(new Set([data.chapters[0].id]))
      }
      setLoading(false)
    })
  }, [courseId])

  useEffect(() => {
    if (!user || !courseId) return
    checkUserEnrollment(supabase, courseId, user.id).then(enrolled => {
      setIsEnrolled(enrolled)
    })
  }, [user, courseId])

  function toggleChapter(chapterId: string) {
    setExpandedChapters(prev => {
      const next = new Set(prev)
      if (next.has(chapterId)) next.delete(chapterId)
      else next.add(chapterId)
      return next
    })
  }

  function handleCTAClick() {
    if (isEnrolled && course) {
      const firstLesson = course.chapters[0]?.lessons[0]
      if (firstLesson) navigate(`/learn/${courseId}/${firstLesson.id}`)
    }
  }

  if (loading) {
    return (
      <div data-testid="course-detail-skeleton" style={{ padding: '80px 56px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 60 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[240, 60, 180, 40, 80].map((w, i) => (
                <div key={i} style={{ height: i === 0 ? 56 : 18, background: 'var(--surface-2)', borderRadius: 6, width: `${w}px` }} />
              ))}
            </div>
            <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-lg)', height: 400 }} />
          </div>
        </div>
      </div>
    )
  }

  if (!course) {
    return (
      <div
        data-testid="course-not-found"
        style={{ padding: '80px 56px', textAlign: 'center' }}
      >
        <p style={{ fontFamily: 'var(--font-serif)', fontSize: 28, color: 'var(--ink-1)' }}>
          {t('courseDetail.notFound')}
        </p>
        <Link to="/" className="btn btn-secondary" style={{ marginTop: 16, display: 'inline-block' }}>
          {t('notFound.cta')}
        </Link>
      </div>
    )
  }

  const ctaLabel = isEnrolled
    ? t('courseDetail.continueLearning')
    : course.price === 0
      ? t('courseDetail.enrollFree')
      : t('courseDetail.purchase')

  const totalChapters = course.chapters.length
  const totalLessons = course.lessons_count

  return (
    <main>
      {/* ── Hero strip ─────────────────────────────────────────────────────── */}
      <section
        style={{
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          padding: '32px 56px',
        }}
      >
        <div
          style={{
            maxWidth: 1280,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: '1.4fr 1fr',
            gap: 60,
            alignItems: 'start',
          }}
        >
          {/* Left column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Breadcrumb */}
            <nav style={{ fontSize: 12, color: 'var(--ink-3)', display: 'flex', gap: 6, alignItems: 'center' }}>
              <Link to="/" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>
                {t('courseDetail.breadcrumb')}
              </Link>
              <span>›</span>
              {course.tags.length > 0 && (
                <>
                  <span style={{ color: 'var(--ink-3)' }}>{course.tags[0]}</span>
                  <span>›</span>
                </>
              )}
              <span style={{ color: 'var(--ink-2)' }}>{course.title}</span>
            </nav>

            {/* Pills */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {course.tags.map(tag => (
                <span key={tag} className="pill pill-accent">{tag}</span>
              ))}
              <span className="pill">{course.level}</span>
            </div>

            {/* Title */}
            <h1
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 48,
                lineHeight: 1.05,
                letterSpacing: '-0.025em',
                color: 'var(--ink-1)',
                margin: 0,
              }}
            >
              {course.title}
            </h1>

            {/* Description */}
            {course.description && (
              <p style={{ fontSize: 16, color: 'var(--ink-2)', lineHeight: 1.55, maxWidth: 600, margin: 0 }}>
                {course.description}
              </p>
            )}

            {/* Creator + meta row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div
                className="avatar"
                style={{
                  width: 40,
                  height: 40,
                  background: 'oklch(0.85 0.07 200)',
                  color: 'var(--ink-1)',
                  fontSize: 14,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {course.creator_name ? course.creator_name.split(' ').pop()?.[0] ?? 'C' : 'C'}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>{course.creator_name}</div>
                {course.creator_bio && (
                  <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{course.creator_bio}</div>
                )}
              </div>
              <div style={{ width: 1, height: 32, background: 'var(--border-strong)' }} />
              <div data-testid="hero-rating" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <StarRow rating={course.rating_avg} size={13} />
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>
                  {course.rating_avg > 0 ? course.rating_avg.toFixed(1) : '—'}
                </span>
                <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                  ({t('courseDetail.ratingsCount', { count: course.rating_count })})
                </span>
              </div>
              <div style={{ width: 1, height: 32, background: 'var(--border-strong)' }} />
              <div data-testid="hero-enrollment" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                  {t('courseDetail.studentsCount', { count: course.enrollment_count.toLocaleString() })}
                </span>
              </div>
            </div>

            {/* Stats row */}
            <div style={{ display: 'flex', gap: 24 }}>
              {[
                { testId: 'stat-lessons', value: totalLessons, label: t('courseDetail.statLessons') },
                { testId: 'stat-runtime', value: formatHours(course.hours_total), label: t('courseDetail.statRuntime') },
                { testId: 'stat-annotations', value: course.pgn_annotations_count, label: t('courseDetail.statAnnotations') },
                { testId: 'stat-puzzles', value: course.puzzle_count, label: t('courseDetail.statPuzzles') },
              ].map(stat => (
                <div key={stat.testId} data-testid={stat.testId} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontFamily: 'var(--font-serif)', fontSize: 22, lineHeight: 1, color: 'var(--ink-1)' }}>
                    {stat.value}
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{stat.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right column — Buy card */}
          <div className="card" style={{ boxShadow: 'var(--sh-2)', alignSelf: 'start' }}>
            {/* Thumbnail / board preview */}
            <div
              style={{
                aspectRatio: '16/10',
                background: 'var(--surface-2)',
                borderRadius: 'var(--r-lg) var(--r-lg) 0 0',
                overflow: 'hidden',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ChessBoard fen={INITIAL_FEN} size={260} showCoords={false} />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(0,0,0,0.32)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    background: '#fff',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--ink-1)">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </div>
                {course.free_preview_count > 0 && (
                  <span style={{ fontSize: 12, color: '#fff', fontWeight: 500 }}>
                    {t('courseDetail.watchPreview', { duration: '8:24' })}
                  </span>
                )}
              </div>
            </div>

            {/* Body */}
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Price row */}
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <span
                  data-testid="buy-card-price"
                  style={{ fontFamily: 'var(--font-serif)', fontSize: 36, color: 'var(--ink-1)' }}
                >
                  {formatPrice(course.price)}
                </span>
                {course.original_price && course.original_price > course.price && (
                  <span
                    data-testid="buy-card-original-price"
                    style={{ fontSize: 13, color: 'var(--ink-3)', textDecoration: 'line-through' }}
                  >
                    {formatPrice(course.original_price)}
                  </span>
                )}
              </div>

              {/* Promo line */}
              {course.promo_ends_at && (
                <p style={{ fontSize: 12, color: 'var(--success)', fontWeight: 500, margin: 0 }}>
                  {t('courseDetail.launchPrice', { days: getPromoDays(course.promo_ends_at) })}
                </p>
              )}

              {/* CTA */}
              <button
                type="button"
                className="btn btn-accent btn-lg"
                style={{ width: '100%' }}
                onClick={handleCTAClick}
              >
                {ctaLabel}
              </button>

              {/* Wishlist */}
              <button type="button" className="btn btn-secondary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
                {t('courseDetail.addWishlist')}
              </button>

              {/* Divider */}
              <div style={{ height: 1, background: 'var(--border)' }} />

              {/* Feature list */}
              {[
                { title: t('courseDetail.lifetimeAccess'), sub: t('courseDetail.lifetimeAccessSub') },
                { title: t('courseDetail.freePreviews'), sub: t('courseDetail.freePreviewsSub', { count: course.free_preview_count }) },
                { title: t('courseDetail.audioLang'), sub: t('courseDetail.audioLangSub') },
              ].map(feat => (
                <div key={feat.title} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--success)', marginTop: 2 }}><CheckIcon size={13} /></span>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>{feat.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{feat.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Curriculum + Reviews + Sidebar ─────────────────────────────────── */}
      <section style={{ padding: '48px 56px 80px' }}>
        <div
          style={{
            maxWidth: 1280,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: '1.5fr 1fr',
            gap: 56,
            alignItems: 'start',
          }}
        >
          {/* Left — Curriculum + Reviews */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
            {/* Curriculum heading */}
            <div>
              <h2
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: 28,
                  color: 'var(--ink-1)',
                  margin: '0 0 4px',
                }}
              >
                {t('courseDetail.curriculum')}
              </h2>
              <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>
                {t('courseDetail.curriculumMeta', {
                  chapters: totalChapters,
                  lessons: totalLessons,
                  hours: formatHours(course.hours_total),
                })}
              </p>
            </div>

            {/* Chapter accordion list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {course.chapters.map((chapter, idx) => (
                <ChapterAccordion
                  key={chapter.id}
                  chapter={chapter}
                  index={idx}
                  expanded={expandedChapters.has(chapter.id)}
                  onToggle={() => toggleChapter(chapter.id)}
                  isEnrolled={isEnrolled}
                  onPreview={setPreviewLesson}
                  onLock={() => setLockPromptOpen(true)}
                />
              ))}
            </div>

            {/* Reviews section */}
            <div>
              <h2
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: 28,
                  color: 'var(--ink-1)',
                  margin: '0 0 20px',
                }}
              >
                {t('courseDetail.studentReviews')}
              </h2>
              <RatingsHistogram course={course} />
              {course.reviews.length > 0 && (
                <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {course.reviews.map(review => (
                    <ReviewCard key={review.id} review={review} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right — Sidebar cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 80 }}>
            {/* What you'll learn */}
            {course.what_you_learn.length > 0 && (
              <div className="card" style={{ padding: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)', margin: '0 0 14px' }}>
                  {t('courseDetail.whatYouLearn')}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {course.what_you_learn.map((point, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }}><CheckIcon size={12} /></span>
                      <span style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>{point}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Prerequisites */}
            {course.prerequisites && (
              <div className="card" style={{ padding: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)', margin: '0 0 10px' }}>
                  {t('courseDetail.prerequisites')}
                </h3>
                <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: 0 }}>
                  {course.prerequisites}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {previewLesson && (
        <PreviewModal lesson={previewLesson} onClose={() => setPreviewLesson(null)} />
      )}
      {lockPromptOpen && (
        <LockPrompt onClose={() => setLockPromptOpen(false)} />
      )}
    </main>
  )
}
