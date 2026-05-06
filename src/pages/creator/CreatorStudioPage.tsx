import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { listCourses, deleteCourse, countCourseChildren } from '../../lib/creatorApi'
import type { Course, CourseStatus } from '../../lib/creatorApi'
import { useAuth } from '../../context/AuthContext'

type StatusFilter = CourseStatus | 'all'

const STATUS_PILL: Record<CourseStatus, string> = {
  published: 'pill pill-success',
  draft: 'pill',
}

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
        <h2 className="text-lg font-semibold text-[--ink-1] mb-3">{t('creator.deleteConfirm.title')}</h2>
        <p className="text-sm text-[--ink-2] mb-6">
          {t('creator.deleteConfirm.body', { chapters, lessons })}
        </p>
        <p className="text-xs text-[--ink-3] mb-6 font-medium">{course.title}</p>
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
            className="block px-4 py-2 text-sm text-[--ink-1] hover:bg-[--surface-2]"
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

export default function CreatorStudioPage() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null)
  const [childCounts, setChildCounts] = useState({ chapters: 0, lessons: 0 })

  useEffect(() => {
    if (!profile?.id) return
    setLoading(true)
    const opts = filter !== 'all' ? { status: filter as CourseStatus } : {}
    listCourses(supabase, profile.id, opts).then(({ courses: c }) => {
      setCourses(c)
      setLoading(false)
    })
  }, [profile?.id, filter])

  async function handleDeleteClick(course: Course) {
    const counts = await countCourseChildren(supabase, course.id)
    setChildCounts(counts)
    setDeletingCourse(course)
  }

  async function handleDeleteConfirm() {
    if (!deletingCourse) return
    await deleteCourse(supabase, deletingCourse.id)
    setCourses(prev => prev.filter(c => c.id !== deletingCourse.id))
    setDeletingCourse(null)
  }

  const filters: { key: StatusFilter; label: string; testid: string }[] = [
    { key: 'all',       label: t('creator.studio.table.filterAll'),       testid: 'filter-all' },
    { key: 'published', label: t('creator.studio.table.filterPublished'), testid: 'filter-published' },
    { key: 'draft',     label: t('creator.studio.table.filterDraft'),     testid: 'filter-draft' },
  ]

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <p
            className="uppercase font-medium tracking-widest text-[--ink-3] mb-2"
            style={{ fontSize: 11 }}
          >
            {t('creator.studio.eyebrow')}
          </p>
          <h1
            className="text-[--ink-1]"
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
        <KpiCard testid="kpi-students" label={t('creator.studio.kpi.students')} value="2,840" detail={t('creator.studio.kpi.studentsDetail')} />
        <KpiCard testid="kpi-revenue" label={t('creator.studio.kpi.revenue')} value="186M ₫" detail={t('creator.studio.kpi.revenueDetail')} />
        <KpiCard testid="kpi-payout" label={t('creator.studio.kpi.payout')} value="148.8M ₫" detail={t('creator.studio.kpi.payoutDetail')} />
        <KpiCard testid="kpi-rating" label={t('creator.studio.kpi.rating')} value="4.83" detail={t('creator.studio.kpi.ratingDetail', { count: courses.length })} />
      </div>

      {/* Courses table */}
      <div className="card overflow-hidden">
        {/* Table header bar */}
        <div
          className="flex items-center justify-between border-b border-[--border]"
          style={{ padding: '14px 20px' }}
        >
          <div className="flex items-center gap-3">
            <span className="font-semibold text-[--ink-1]" style={{ fontSize: 14 }}>
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
          <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--ink-3)' }}>
            {t('creator.studio.table.export')}
          </button>
        </div>

        {/* Table */}
        <table className="w-full" style={{ fontSize: 13 }}>
          <thead>
            <tr className="border-b border-[--border]">
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
                  className="uppercase font-medium text-[--ink-3]"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center text-[--ink-3] py-10">…</td>
              </tr>
            ) : courses.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-[--ink-3] py-10">
                  {t('creator.studio.table.empty')}
                </td>
              </tr>
            ) : (
              courses.map(course => (
                <tr key={course.id} className="border-b border-[--border] last:border-0">
                  <td style={{ padding: '14px 20px' }}>
                    <div className="flex items-center gap-3">
                      <div
                        style={{ width: 40, height: 40, background: 'var(--surface-3)', borderRadius: 'var(--r-sm)', flexShrink: 0 }}
                        aria-hidden="true"
                      />
                      <span className="font-medium text-[--ink-1]">{course.title}</span>
                    </div>
                  </td>
                  <td style={{ padding: '14px 20px' }}>
                    <span className={STATUS_PILL[course.status] ?? 'pill'}>
                      {t(`creator.studio.status.${course.status}`)}
                    </span>
                  </td>
                  <td style={{ padding: '14px 20px', textAlign: 'right' }} className="text-[--ink-2]">0</td>
                  <td style={{ padding: '14px 20px', textAlign: 'right' }} className="text-[--ink-2]">—</td>
                  <td style={{ padding: '14px 20px', textAlign: 'right' }} className="text-[--ink-2]">—</td>
                  <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                    <KebabMenu course={course} onDelete={handleDeleteClick} t={t} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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
