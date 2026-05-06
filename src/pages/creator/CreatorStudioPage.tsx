import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import {
  listCourses,
  deleteCourse,
  countCourseChildren,
  fetchCreatorKpis,
  fetchCoursesWithStats,
  listChapters,
  updateLesson,
  submitCourseForReview,
} from '../../lib/creatorApi'
import type { Course, CourseStatus, Chapter, Lesson, CreatorKpis, CourseStats } from '../../lib/creatorApi'
import { useAuth } from '../../context/AuthContext'
import LessonEditor from '../../components/LessonEditor/LessonEditor'

type StatusFilter = CourseStatus | 'all'

const STATUS_PILL: Record<CourseStatus, string> = {
  published: 'pill pill-success',
  pending_review: 'pill pill-warning',
  draft: 'pill',
}

const LESSON_TYPE_ICON: Record<string, string> = {
  video: '▶',
  chess: '♟',
  puzzle: '📋',
}

function formatStudents(n: number): string {
  return n.toLocaleString('en-US')
}

function formatCurrency(n: number): string {
  if (n === 0) return '—'
  if (n >= 1_000_000) {
    const val = n / 1_000_000
    return `${val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)}M ₫`
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}K ₫`
  return `${n.toLocaleString('en-US')} ₫`
}

function formatRating(n: number): string {
  return n % 1 === 0 ? n.toFixed(1) : n.toFixed(1)
}

function downloadCourseCsv(courses: Course[], stats: CourseStats[]) {
  const statsMap = Object.fromEntries(stats.map(s => [s.courseId, s]))
  const headers = ['Title', 'Status', 'Students', 'Revenue (VND)', 'Rating']
  const rows = courses.map(c => {
    const s = statsMap[c.id]
    return [
      c.title,
      c.status,
      String(s?.students ?? 0),
      String(s?.revenue ?? 0),
      s?.rating != null ? s.rating.toFixed(2) : '—',
    ]
  })
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'courses.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ── Sub-components ────────────────────────────────────────────────────────

interface DeleteDialogProps {
  course: Course
  chapters: number
  lessons: number
  onCancel: () => void
  onConfirm: () => void
  t: (k: string, opts?: Record<string, string | number>) => string
}

function DeleteDialog({ course, chapters, lessons, onCancel, onConfirm, t }: DeleteDialogProps) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(20,22,26,0.4)', zIndex: 50 }}
      role="dialog"
      aria-modal="true"
    >
      <div
        data-testid="delete-course-dialog"
        className="card"
        style={{ width: 440, padding: 28 }}
      >
        <h2 className="text-lg font-semibold text-(--ink-1) mb-3">{t('creator.deleteConfirm.title')}</h2>
        <p className="text-sm text-(--ink-2) mb-6">
          {t('creator.deleteConfirm.body', { chapters, lessons })}
        </p>
        <p className="text-xs text-(--ink-3) mb-6 font-medium">{course.title}</p>
        <div className="flex justify-end gap-3">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {t('creator.deleteConfirm.cancel')}
          </button>
          <button
            type="button"
            data-testid="delete-confirm-btn"
            className="btn"
            style={{ background: 'var(--danger)', color: '#fff' }}
            onClick={onConfirm}
          >
            {t('creator.deleteConfirm.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

interface KpiCardProps {
  label: string
  value: string
  detail: string
  testid: string
}

function KpiCard({ label, value, detail, testid }: KpiCardProps) {
  return (
    <div className="card flex-1" style={{ padding: 20 }} data-testid={testid}>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>{label}</p>
      <p style={{ fontFamily: 'var(--font-serif)', fontSize: 32, letterSpacing: '-0.02em', color: 'var(--ink-1)', lineHeight: 1 }}>
        {value}
      </p>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>{detail}</p>
    </div>
  )
}

interface KebabMenuProps {
  course: Course
  onDelete: (c: Course) => void
  t: (k: string) => string
}

function KebabMenu({ course, onDelete, t }: KebabMenuProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative" style={{ display: 'inline-block' }}>
      <button
        type="button"
        data-testid="kebab-btn"
        className="btn btn-ghost btn-sm"
        aria-label="actions"
        onClick={() => setOpen(o => !o)}
      >
        •••
      </button>
      {open && (
        <div
          className="card"
          style={{ position: 'absolute', right: 0, top: '100%', zIndex: 10, minWidth: 140, padding: '4px 0' }}
        >
          <Link
            to={`/creator/courses/${course.id}/edit`}
            className="block px-4 py-2 text-sm text-(--ink-1) hover:bg-(--surface-2)"
            onClick={() => setOpen(false)}
          >
            {t('creator.studio.table.kebabEdit')}
          </Link>
          <button
            type="button"
            data-testid={`kebab-delete-${course.id}`}
            className="block w-full text-left px-4 py-2 text-sm"
            style={{ color: 'var(--danger)' }}
            onClick={() => { setOpen(false); onDelete(course) }}
          >
            {t('creator.studio.table.kebabDelete')}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Inline Course Builder ─────────────────────────────────────────────────

interface CourseBuilderInlineProps {
  courseId: string
  courseTitle: string
  initialStatus: CourseStatus
}

function CourseBuilderInline({ courseId, courseTitle, initialStatus }: CourseBuilderInlineProps) {
  const { t } = useTranslation()
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null)
  const [courseStatus, setCourseStatus] = useState<CourseStatus>(initialStatus)

  useEffect(() => {
    listChapters(supabase, courseId).then(({ chapters: ch }) => {
      setChapters(ch)
      const firstLesson = ch.flatMap(c => c.lessons ?? [])[0]
      if (firstLesson) setSelectedLesson(firstLesson)
      setLoading(false)
    })
  }, [courseId])

  const allLessons = chapters.flatMap(ch =>
    (ch.lessons ?? []).map(l => ({ id: l.id, title: l.title, type: l.type }))
  )

  const lessonIndex = selectedLesson
    ? allLessons.findIndex(l => l.id === selectedLesson.id) + 1
    : null

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

  async function handleSubmitForReview() {
    await submitCourseForReview(supabase, courseId)
    setCourseStatus('pending_review')
  }

  return (
    <>
      <h2
        data-testid="builder-heading"
        style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink-1)', marginBottom: 12 }}
      >
        {t('creator.studio.builderHeading')}
        {selectedLesson && lessonIndex != null && (
          <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>
            {' · '}{t('creator.studio.builderEditing', { title: courseTitle })}
            {' · '}{t('creator.studio.builderLesson', { n: lessonIndex })}
          </span>
        )}
        {!selectedLesson && (
          <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>
            {' · '}{t('creator.studio.builderEditing', { title: courseTitle })}
          </span>
        )}
      </h2>

      <div
        data-testid="course-builder-block"
        className="card"
        style={{ height: 560, overflow: 'hidden', padding: 0, borderRadius: 'var(--r-lg)' }}
      >
        {loading ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>…</p>
          </div>
        ) : selectedLesson ? (
          <LessonEditor
            lesson={{
              id: selectedLesson.id,
              title: selectedLesson.title,
              pgn_data: selectedLesson.pgn_data ?? '',
              board_perspective: selectedLesson.board_perspective ?? 'white',
              is_free_preview: selectedLesson.free_preview,
              type: selectedLesson.type,
            }}
            chapterLessons={allLessons}
            onSelectLesson={id => {
              const lesson = chapters.flatMap(ch => ch.lessons ?? []).find(l => l.id === id)
              if (lesson) setSelectedLesson(lesson)
            }}
            onSave={handleSaveLesson}
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 380px', height: '100%' }}>
            {/* Curriculum sidebar — list chapters and lessons */}
            <div style={{ background: 'var(--surface-2)', borderRight: '1px solid var(--border)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '16px 16px 8px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {t('creator.courseEdit.curriculum')}
                </span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {chapters.map(ch => (
                  <div key={ch.id}>
                    <div style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', background: 'var(--surface-3)' }}>
                      {ch.title}
                    </div>
                    {(ch.lessons ?? []).map(l => (
                      <button
                        key={l.id}
                        type="button"
                        style={{ width: '100%', textAlign: 'left', padding: '8px 20px', fontSize: 12.5, color: 'var(--ink-2)', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', display: 'flex', gap: 8 }}
                        onClick={() => setSelectedLesson(l)}
                      >
                        <span style={{ color: 'var(--ink-3)', width: 16 }}>{LESSON_TYPE_ICON[l.type]}</span>
                        {l.title}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              {/* Footer with submit for review */}
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-secondary btn-sm" style={{ flex: 1 }}>
                  {t('creator.studio.builderSaveDraft')}
                </button>
                <button
                  type="button"
                  className="btn btn-accent btn-sm"
                  style={{ flex: 1 }}
                  disabled={courseStatus !== 'draft'}
                  onClick={handleSubmitForReview}
                >
                  {t('creator.studio.builderSubmitReview')}
                </button>
              </div>
            </div>

            {/* Center pane placeholder */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
              <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                {t('creator.studio.builderNoLessons')}
              </p>
            </div>

            {/* Right preview pane placeholder */}
            <div style={{ background: 'var(--surface-2)', borderLeft: '1px solid var(--border)' }} />
          </div>
        )}
      </div>
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────

export default function CreatorStudioPage() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const [courses, setCourses] = useState<Course[]>([])
  const [coursesLoaded, setCoursesLoaded] = useState(false)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null)
  const [childCounts, setChildCounts] = useState({ chapters: 0, lessons: 0 })
  const [kpis, setKpis] = useState<CreatorKpis>({ totalStudents: 0, grossRevenue: 0, totalPayout: 0, avgRating: 0, courseCount: 0 })
  const [courseStats, setCourseStats] = useState<CourseStats[]>([])
  const [allCourses, setAllCourses] = useState<Course[]>([])

  const loading = !coursesLoaded

  useEffect(() => {
    if (!profile?.id) return
    const opts = filter !== 'all' ? { status: filter as CourseStatus } : {}
    listCourses(supabase, profile.id, opts).then(({ courses: c }) => {
      setCourses(c)
      setCoursesLoaded(true)
    })
  }, [profile?.id, filter])

  // Load all courses (unfiltered) for builder block + stats
  useEffect(() => {
    if (!profile?.id) return
    listCourses(supabase, profile.id).then(({ courses: c }) => {
      setAllCourses(c)
    })
  }, [profile?.id])

  // Load KPIs
  useEffect(() => {
    if (!profile?.id) return
    fetchCreatorKpis(supabase, profile.id).then(k => setKpis(k))
  }, [profile?.id])

  // Load per-course stats whenever allCourses changes
  useEffect(() => {
    if (allCourses.length === 0) return
    fetchCoursesWithStats(supabase, allCourses.map(c => c.id)).then(s => setCourseStats(s))
  }, [allCourses])

  const statsMap = Object.fromEntries(courseStats.map(s => [s.courseId, s]))

  // Most recently edited course
  const mostRecentCourse = allCourses.length > 0
    ? [...allCourses].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
    : null

  async function handleDeleteClick(course: Course) {
    const counts = await countCourseChildren(supabase, course.id)
    setChildCounts(counts)
    setDeletingCourse(course)
  }

  async function handleDeleteConfirm() {
    if (!deletingCourse) return
    await deleteCourse(supabase, deletingCourse.id)
    setCourses(prev => prev.filter(c => c.id !== deletingCourse.id))
    setAllCourses(prev => prev.filter(c => c.id !== deletingCourse.id))
    setDeletingCourse(null)
  }

  function handleExportCsv() {
    downloadCourseCsv(allCourses, courseStats)
  }

  const filters: { key: StatusFilter; label: string; testid: string }[] = [
    { key: 'all',            label: t('creator.studio.table.filterAll'),            testid: 'filter-all' },
    { key: 'published',      label: t('creator.studio.table.filterPublished'),      testid: 'filter-published' },
    { key: 'pending_review', label: t('creator.studio.table.filterPendingReview'), testid: 'filter-pending-review' },
    { key: 'draft',          label: t('creator.studio.table.filterDraft'),          testid: 'filter-draft' },
  ]

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <p
            className="uppercase font-medium tracking-widest text-(--ink-3) mb-2"
            style={{ fontSize: 11 }}
          >
            {t('creator.studio.eyebrow')}
          </p>
          <h1
            className="text-(--ink-1)"
            style={{ fontFamily: 'var(--font-serif)', fontSize: 38, lineHeight: 1.1 }}
          >
            {t('creator.studio.heading')}
          </h1>
        </div>
        <Link
          to="/creator/courses/new"
          data-testid="new-course-link"
          className="btn btn-accent"
        >
          {t('creator.studio.newCourse')}
        </Link>
      </div>

      {/* KPI Strip */}
      <div className="flex gap-4 mb-8">
        <KpiCard
          testid="kpi-students"
          label={t('creator.studio.kpi.students')}
          value={formatStudents(kpis.totalStudents)}
          detail={t('creator.studio.kpi.studentsDetail', { count: kpis.courseCount })}
        />
        <KpiCard
          testid="kpi-revenue"
          label={t('creator.studio.kpi.revenue')}
          value={formatCurrency(kpis.grossRevenue)}
          detail={t('creator.studio.kpi.revenueDetail')}
        />
        <KpiCard
          testid="kpi-payout"
          label={t('creator.studio.kpi.payout')}
          value={formatCurrency(kpis.totalPayout)}
          detail={t('creator.studio.kpi.payoutDetail')}
        />
        <KpiCard
          testid="kpi-rating"
          label={t('creator.studio.kpi.rating')}
          value={kpis.avgRating > 0 ? formatRating(kpis.avgRating) : '—'}
          detail={t('creator.studio.kpi.ratingDetail', { count: kpis.courseCount })}
        />
      </div>

      {/* Courses table or empty state */}
      {!loading && allCourses.length === 0 ? (
        <div
          className="card"
          style={{ padding: '80px 40px', textAlign: 'center', marginBottom: 32 }}
        >
          <p style={{ fontFamily: 'var(--font-serif)', fontSize: 28, color: 'var(--ink-1)', marginBottom: 12 }}>
            {t('creator.studio.emptyHeading')}
          </p>
          <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55, maxWidth: 520, margin: '0 auto 24px' }}>
            {t('creator.studio.emptyBody')}
          </p>
          <Link
            to="/creator/courses/new"
            data-testid="empty-state-cta"
            className="btn btn-accent btn-lg"
          >
            {t('creator.studio.emptyCtaLabel')}
          </Link>
        </div>
      ) : (
        <>
          <div className="card overflow-hidden mb-8">
            {/* Table header bar */}
            <div
              className="flex items-center justify-between border-b border-(--border)"
              style={{ padding: '14px 20px' }}
            >
              <div className="flex items-center gap-3">
                <span className="font-semibold text-(--ink-1)" style={{ fontSize: 14 }}>
                  {t('creator.studio.table.heading')}
                </span>
                <div className="flex gap-1">
                  {filters.map(({ key, label, testid }) => (
                    <button
                      key={key}
                      type="button"
                      data-testid={testid}
                      className="btn btn-sm"
                      style={{
                        height: 26,
                        fontSize: 11.5,
                        background: filter === key ? 'var(--ink-1)' : 'transparent',
                        color: filter === key ? '#fff' : 'var(--ink-3)',
                        borderRadius: 999,
                        padding: '0 10px',
                      }}
                      onClick={() => setFilter(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                data-testid="export-csv-btn"
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--ink-3)' }}
                onClick={handleExportCsv}
              >
                {t('creator.studio.table.export')}
              </button>
            </div>

            {/* Table */}
            <table className="w-full" style={{ fontSize: 13 }}>
              <thead>
                <tr className="border-b border-(--border)">
                  {[
                    t('creator.studio.table.colCourse'),
                    t('creator.studio.table.colStatus'),
                    t('creator.studio.table.colStudents'),
                    t('creator.studio.table.colRevenue'),
                    t('creator.studio.table.colRating'),
                    t('creator.studio.table.colActions'),
                  ].map((col, i) => (
                    <th
                      key={i}
                      style={{ padding: '14px 20px', fontSize: 11.5, letterSpacing: '0.05em', textAlign: i >= 2 && i <= 4 ? 'right' : 'left' }}
                      className="uppercase font-medium text-(--ink-3)"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="text-center text-(--ink-3) py-10">…</td>
                  </tr>
                ) : courses.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-(--ink-3) py-10">
                      {t('creator.studio.table.empty')}
                    </td>
                  </tr>
                ) : (
                  courses.map(course => {
                    const s = statsMap[course.id]
                    return (
                      <tr key={course.id} className="border-b border-(--border) last:border-0">
                        <td style={{ padding: '14px 20px' }}>
                          <div className="flex items-center gap-3">
                            <div
                              style={{ width: 40, height: 40, background: 'var(--surface-3)', borderRadius: 'var(--r-sm)', flexShrink: 0 }}
                              aria-hidden="true"
                            />
                            <span className="font-medium text-(--ink-1)">{course.title}</span>
                          </div>
                        </td>
                        <td style={{ padding: '14px 20px' }}>
                          <span className={STATUS_PILL[course.status] ?? 'pill'}>
                            {t(`creator.studio.status.${course.status}`)}
                          </span>
                        </td>
                        <td data-testid={`course-students-${course.id}`} style={{ padding: '14px 20px', textAlign: 'right' }} className="text-(--ink-2)">
                          {s != null ? s.students : 0}
                        </td>
                        <td data-testid={`course-revenue-${course.id}`} style={{ padding: '14px 20px', textAlign: 'right' }} className="text-(--ink-2)">
                          {s != null ? formatCurrency(s.revenue) : '—'}
                        </td>
                        <td data-testid={`course-rating-${course.id}`} style={{ padding: '14px 20px', textAlign: 'right' }} className="text-(--ink-2)">
                          {s?.rating != null ? s.rating.toFixed(1) : '—'}
                        </td>
                        <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                          <KebabMenu course={course} onDelete={handleDeleteClick} t={t} />
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Inline Course Builder */}
          {mostRecentCourse && (
            <CourseBuilderInline
              courseId={mostRecentCourse.id}
              courseTitle={mostRecentCourse.title}
              initialStatus={mostRecentCourse.status}
            />
          )}
        </>
      )}

      {/* Delete confirmation dialog */}
      {deletingCourse && (
        <DeleteDialog
          course={deletingCourse}
          chapters={childCounts.chapters}
          lessons={childCounts.lessons}
          onCancel={() => setDeletingCourse(null)}
          onConfirm={handleDeleteConfirm}
          t={t}
        />
      )}
    </div>
  )
}
