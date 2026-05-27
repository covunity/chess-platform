import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import {
  listCourses,
  deleteCourse,
  duplicateCourse,
  countCourseChildren,
  fetchCreatorKpis,
  fetchCoursesWithStats,
} from '../../lib/creatorApi'
import type { Course, CourseStatus, CreatorKpis, CourseStats } from '../../lib/creatorApi'
import { Pencil, Copy, Trash2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import RevenuePanel from '../../components/creator/RevenuePanel'
import { formatPrice } from '../../lib/utils'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../../components/ui/dropdown-menu'

type StatusFilter = CourseStatus | 'all'
type DashboardTab = 'courses' | 'revenue'

const STATUS_PILL: Record<CourseStatus, string> = {
  published: 'pill pill-success',
  draft: 'pill',
}

function formatStudents(n: number): string {
  return n.toLocaleString('en-US')
}

function formatCurrency(n: number): string {
  if (n === 0) return '—'
  return formatPrice(n)
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
  onDuplicate: (c: Course) => void
  t: (k: string) => string
}

function KebabMenu({ course, onDelete, onDuplicate, t }: KebabMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="kebab-btn"
          className="btn btn-ghost btn-sm"
          aria-label="actions"
        >
          •••
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link
            to={`/creator/courses/${course.id}/edit`}
            data-testid={`kebab-edit-${course.id}`}
            className="flex items-center gap-2"
          >
            <Pencil size={14} />
            {t('creator.studio.table.kebabEdit')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid={`kebab-duplicate-${course.id}`}
          onSelect={() => onDuplicate(course)}
        >
          <Copy size={14} />
          {t('creator.studio.table.kebabDuplicate')}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid={`kebab-delete-${course.id}`}
          danger
          onSelect={() => onDelete(course)}
        >
          <Trash2 size={14} />
          {t('creator.studio.table.kebabDelete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────

export default function CreatorStudioPage() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const [courses, setCourses] = useState<Course[]>([])
  const [coursesLoaded, setCoursesLoaded] = useState(false)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [activeTab, setActiveTab] = useState<DashboardTab>('courses')
  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null)
  const [childCounts, setChildCounts] = useState({ chapters: 0, lessons: 0 })
  const [kpis, setKpis] = useState<CreatorKpis>({ totalStudents: 0, grossRevenue: 0, totalPayout: 0, avgRating: 0, courseCount: 0 })
  const [courseStats, setCourseStats] = useState<CourseStats[]>([])
  const [allCourses, setAllCourses] = useState<Course[]>([])
  const [duplicateToast, setDuplicateToast] = useState<'success' | 'error' | null>(null)

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

  async function handleDuplicate(course: Course) {
    const { course: newCourse, error } = await duplicateCourse(supabase, course.id)
    if (error || !newCourse) {
      setDuplicateToast('error')
      setTimeout(() => setDuplicateToast(null), 3000)
      return
    }
    setCourses(prev => [newCourse, ...prev])
    setAllCourses(prev => [newCourse, ...prev])
    setDuplicateToast('success')
    setTimeout(() => setDuplicateToast(null), 3000)
  }

  const filters: { key: StatusFilter; label: string; testid: string }[] = [
    { key: 'all',            label: t('creator.studio.table.filterAll'),            testid: 'filter-all' },
    { key: 'published',      label: t('creator.studio.table.filterPublished'),      testid: 'filter-published' },
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

      {/* Dashboard tabs */}
      <div
        className="flex gap-1 border-b border-(--border) mb-6"
        role="tablist"
      >
        {([
          { key: 'courses', label: t('creator.studio.heading'), testid: 'tab-courses' },
          { key: 'revenue', label: t('creator.revenue.tabLabel'), testid: 'tab-revenue' },
        ] as const).map(({ key, label, testid }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            data-testid={testid}
            onClick={() => setActiveTab(key)}
            style={{
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: activeTab === key ? 600 : 500,
              color: activeTab === key ? 'var(--ink-1)' : 'var(--ink-3)',
              borderBottom: activeTab === key ? '2px solid var(--ink-1)' : '2px solid transparent',
              marginBottom: -1,
              background: 'transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'revenue' && profile?.id && (
        <RevenuePanel creatorId={profile.id} />
      )}

      {activeTab === 'courses' && (
        <>
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

      {/* Course builder block — most recently edited course */}
      {!loading && allCourses.length > 0 && (() => {
        const lastId = localStorage.getItem('lastEditedCourseId')
        const recent = (lastId ? allCourses.find(c => c.id === lastId) : null)
          ?? [...allCourses].sort((a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          )[0]
        return (
          <div
            data-testid="course-builder-block"
            className="card"
            style={{ padding: '16px 24px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                {t('creator.studio.builderHeading')}
              </div>
              <div data-testid="builder-heading" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-1)' }}>
                {recent.title}
              </div>
            </div>
            <Link to={`/creator/courses/${recent.id}/edit`} className="btn btn-secondary btn-sm">
              {t('creator.studio.builderContinue')}
            </Link>
          </div>
        )
      })()}

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
                        color: filter === key ? 'var(--on-ink-1)' : 'var(--ink-3)',
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
                            {course.thumbnail_url ? (
                              <img
                                src={course.thumbnail_url}
                                alt=""
                                style={{ width: 40, height: 40, borderRadius: 'var(--r-sm)', flexShrink: 0, objectFit: 'cover' }}
                              />
                            ) : (
                              <div
                                style={{ width: 40, height: 40, background: 'var(--surface-3)', borderRadius: 'var(--r-sm)', flexShrink: 0 }}
                                aria-hidden="true"
                              />
                            )}
                            <span data-testid={`course-title-${course.id}`} className="font-medium text-(--ink-1)">{course.title}</span>
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
                          <KebabMenu course={course} onDelete={handleDeleteClick} onDuplicate={handleDuplicate} t={t} />
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

        </>
      )}

      {/* Duplicate toast */}
      {duplicateToast === 'success' && (
        <div
          data-testid="duplicate-toast"
          className="toast toast-success"
        >
          {t('creator.studio.duplicateToast')}
        </div>
      )}
      {duplicateToast === 'error' && (
        <div
          data-testid="duplicate-error-toast"
          className="toast toast-error"
        >
          {t('creator.studio.duplicateError')}
        </div>
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
        </>
      )}
    </div>
  )
}
