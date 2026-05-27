import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { listReportedComments, hideComment, dismissReports } from '../../lib/adminReportsApi'
import type { ReportedComment } from '../../lib/adminReportsApi'
import { listReportedCourses, dismissCourseReports, unpublishCourse } from '../../lib/courseReportsApi'
import type { ReportedCourse } from '../../lib/courseReportsApi'
import type { ReportReason } from '../../lib/commentsApi'

type Tab = 'comments' | 'courses'

const REASON_KEY: Record<ReportReason, string> = {
  inappropriate: 'adminReports.reasonInappropriate',
  spam: 'adminReports.reasonSpam',
  misleading: 'adminReports.reasonMisleading',
}

function ReasonPill({ reason }: { reason: ReportReason }) {
  const { t } = useTranslation()
  const pillClass = reason === 'spam' ? 'pill pill-warning' : reason === 'inappropriate' ? 'pill pill-danger' : 'pill'
  return <span className={pillClass}>{t(REASON_KEY[reason])}</span>
}

// ── Comment reports panel ──────────────────────────────────────────────────────

function CommentReportsPanel() {
  const { t } = useTranslation()
  const [comments, setComments] = useState<ReportedComment[]>([])
  const [selected, setSelected] = useState<ReportedComment | null>(null)
  const [loading, setLoading] = useState(true)
  const [actioning, setActioning] = useState(false)

  useEffect(() => {
    listReportedComments(supabase).then(({ comments: rows }) => {
      setComments(rows)
      setLoading(false)
    })
  }, [])

  async function handleHide(commentId: string) {
    setActioning(true)
    await hideComment(supabase, commentId)
    setActioning(false)
    setComments(prev => prev.filter(c => c.id !== commentId))
    setSelected(null)
  }

  async function handleDismiss(commentId: string) {
    setActioning(true)
    await dismissReports(supabase, commentId)
    setActioning(false)
    setComments(prev => prev.filter(c => c.id !== commentId))
    setSelected(null)
  }

  if (loading) return <div style={{ color: 'var(--ink-3)', fontSize: 14 }}>…</div>

  if (comments.length === 0) {
    return (
      <div
        data-testid="reports-empty"
        style={{ fontSize: 14, color: 'var(--ink-3)', padding: '48px 0', textAlign: 'center' }}
      >
        {t('adminReports.noReports')}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
      {/* Left — Queue */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {comments.map(c => (
          <button
            key={c.id}
            type="button"
            data-testid={`report-item-${c.id}`}
            onClick={() => setSelected(c)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: 16,
              border: `1px solid ${selected?.id === c.id ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 'var(--r-lg)',
              background: selected?.id === c.id ? 'var(--accent-soft)' : 'var(--surface)',
              cursor: 'pointer',
            }}
          >
            <p
              style={{
                fontSize: 13,
                color: 'var(--ink-1)',
                margin: '0 0 8px',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {c.body}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {c.course?.title && <span>{t('adminReports.inCourse', { title: c.course.title })}</span>}
                {c.author?.name && <span style={{ marginLeft: 6 }}>· {t('adminReports.commentBy', { name: c.author.name })}</span>}
              </div>
              <span
                data-testid={`report-count-${c.id}`}
                style={{ fontSize: 12, color: 'var(--ink-3)', flexShrink: 0 }}
              >
                {t('adminReports.reportsCount', { count: c.reports.length })}
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Right — Detail panel */}
      {selected ? (
        <div
          data-testid="report-detail-panel"
          className="card"
          style={{ padding: 24, position: 'sticky', top: 80 }}
        >
          <blockquote
            data-testid="detail-comment-body"
            style={{
              borderLeft: '3px solid var(--border-strong)',
              margin: '0 0 20px',
              paddingLeft: 16,
              color: 'var(--ink-2)',
              fontStyle: 'italic',
              fontSize: 13.5,
              lineHeight: 1.55,
            }}
          >
            {selected.body}
          </blockquote>

          <div data-testid="reporters-list" style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 12px' }}>
              {t('adminReports.reporterList')}
            </p>
            {selected.reports.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div
                  className="avatar"
                  style={{ width: 32, height: 32, fontSize: 11, fontWeight: 600, background: 'var(--surface-3)', color: 'var(--ink-1)', flexShrink: 0 }}
                >
                  {r.reporter?.name?.charAt(0).toUpperCase() ?? '?'}
                </div>
                <span style={{ fontSize: 13, color: 'var(--ink-1)', flex: 1 }}>{r.reporter?.name ?? '—'}</span>
                <ReasonPill reason={r.reason} />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              data-testid="dismiss-reports-btn"
              className="btn btn-secondary"
              disabled={actioning}
              onClick={() => handleDismiss(selected.id)}
            >
              {t('adminReports.dismiss')}
            </button>
            <button
              type="button"
              data-testid="hide-comment-btn"
              className="btn btn-primary"
              disabled={actioning}
              onClick={() => handleHide(selected.id)}
              style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
            >
              {t('adminReports.hide')}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 14, color: 'var(--ink-3)', padding: '40px 0', textAlign: 'center' }}>
          {t('adminReports.selectToView')}
        </div>
      )}
    </div>
  )
}

// ── Course reports panel ───────────────────────────────────────────────────────

function CourseReportsPanel() {
  const { t } = useTranslation()
  const [courses, setCourses] = useState<ReportedCourse[]>([])
  const [selected, setSelected] = useState<ReportedCourse | null>(null)
  const [loading, setLoading] = useState(true)
  const [actioning, setActioning] = useState(false)

  useEffect(() => {
    listReportedCourses(supabase).then(({ courses: rows }) => {
      setCourses(rows)
      setLoading(false)
    })
  }, [])

  async function handleDismiss(courseId: string) {
    setActioning(true)
    await dismissCourseReports(supabase, courseId)
    setActioning(false)
    setCourses(prev => prev.filter(c => c.id !== courseId))
    setSelected(null)
  }

  async function handleUnpublish(courseId: string) {
    setActioning(true)
    await unpublishCourse(supabase, courseId)
    await dismissCourseReports(supabase, courseId)
    setActioning(false)
    setCourses(prev => prev.filter(c => c.id !== courseId))
    setSelected(null)
  }

  if (loading) return <div style={{ color: 'var(--ink-3)', fontSize: 14 }}>…</div>

  if (courses.length === 0) {
    return (
      <div
        data-testid="course-reports-empty"
        style={{ fontSize: 14, color: 'var(--ink-3)', padding: '48px 0', textAlign: 'center' }}
      >
        {t('adminReports.noCourseReports')}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
      {/* Left — Queue */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {courses.map(c => (
          <button
            key={c.id}
            type="button"
            data-testid={`course-report-item-${c.id}`}
            onClick={() => setSelected(c)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: 16,
              border: `1px solid ${selected?.id === c.id ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 'var(--r-lg)',
              background: selected?.id === c.id ? 'var(--accent-soft)' : 'var(--surface)',
              cursor: 'pointer',
            }}
          >
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-1)', margin: '0 0 6px' }}>
              {c.title}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {c.creator?.name && <span>{t('adminReports.courseCreatedBy', { name: c.creator.name })}</span>}
                {c.status === 'draft' && (
                  <span style={{ marginLeft: 6, color: 'var(--ink-3)' }}>· {t('adminReports.hiddenLabel')}</span>
                )}
              </div>
              <span
                data-testid={`course-report-count-${c.id}`}
                style={{ fontSize: 12, color: 'var(--ink-3)', flexShrink: 0 }}
              >
                {t('adminReports.reportsCount', { count: c.course_reports.length })}
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Right — Detail panel */}
      {selected ? (
        <div
          data-testid="course-report-detail-panel"
          className="card"
          style={{ padding: 24, position: 'sticky', top: 80 }}
        >
          <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-1)', margin: '0 0 4px' }}>
            {selected.title}
          </p>
          {selected.creator?.name && (
            <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 20px' }}>
              {t('adminReports.courseCreatedBy', { name: selected.creator.name })}
            </p>
          )}

          <div data-testid="course-reporters-list" style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 12px' }}>
              {t('adminReports.reporterList')}
            </p>
            {selected.course_reports.map(r => (
              <div key={r.id} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    className="avatar"
                    style={{ width: 32, height: 32, fontSize: 11, fontWeight: 600, background: 'var(--surface-3)', color: 'var(--ink-1)', flexShrink: 0 }}
                  >
                    {r.reporter?.name?.charAt(0).toUpperCase() ?? '?'}
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--ink-1)', flex: 1 }}>{r.reporter?.name ?? '—'}</span>
                  <ReasonPill reason={r.reason} />
                </div>
                {r.context && (
                  <p style={{ fontSize: 12.5, color: 'var(--ink-2)', margin: '6px 0 0 42px', fontStyle: 'italic', lineHeight: 1.5 }}>
                    {r.context}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              data-testid="dismiss-course-reports-btn"
              className="btn btn-secondary"
              disabled={actioning}
              onClick={() => handleDismiss(selected.id)}
            >
              {t('adminReports.dismissCourse')}
            </button>
            <button
              type="button"
              data-testid="unpublish-course-btn"
              className="btn btn-primary"
              disabled={actioning}
              onClick={() => handleUnpublish(selected.id)}
              style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
            >
              {t('adminReports.unpublishCourse')}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 14, color: 'var(--ink-3)', padding: '40px 0', textAlign: 'center' }}>
          {t('adminReports.selectCourseToView')}
        </div>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AdminReportsPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('comments')

  return (
    <div style={{ padding: 32 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink-1)', margin: '0 0 16px' }}>
          {t('adminReports.pageTitle')}
        </h1>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
          {(['comments', 'courses'] as Tab[]).map(t2 => (
            <button
              key={t2}
              type="button"
              data-testid={`tab-${t2}`}
              onClick={() => setTab(t2)}
              style={{
                padding: '8px 20px',
                fontSize: 13.5,
                fontWeight: tab === t2 ? 600 : 400,
                color: tab === t2 ? 'var(--accent)' : 'var(--ink-3)',
                background: 'none',
                border: 'none',
                borderBottom: tab === t2 ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
                cursor: 'pointer',
              }}
            >
              {t(`adminReports.tab${t2.charAt(0).toUpperCase() + t2.slice(1)}`)}
            </button>
          ))}
        </div>
      </div>

      {tab === 'comments' ? <CommentReportsPanel /> : <CourseReportsPanel />}
    </div>
  )
}
