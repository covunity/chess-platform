import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { listReportedComments, hideComment, dismissReports } from '../../lib/adminReportsApi'
import type { ReportedComment } from '../../lib/adminReportsApi'
import type { ReportReason } from '../../lib/commentsApi'

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

export default function AdminReportsPage() {
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

  const pendingCount = comments.length

  return (
    <div style={{ padding: 32 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>
          {t('adminReports.pageTitle')}
        </h1>
        {pendingCount > 0 && (
          <span
            data-testid="pending-count-pill"
            className="pill pill-warning"
          >
            {t('adminReports.pending', { count: pendingCount })}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ color: 'var(--ink-3)', fontSize: 14 }}>…</div>
      ) : comments.length === 0 ? (
        <div
          data-testid="reports-empty"
          style={{ fontSize: 14, color: 'var(--ink-3)', padding: '48px 0', textAlign: 'center' }}
        >
          {t('adminReports.noReports')}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 24,
            alignItems: 'start',
          }}
        >
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
                {/* Body excerpt */}
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
                {/* Meta row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    {c.course?.title && (
                      <span>{t('adminReports.inCourse', { title: c.course.title })}</span>
                    )}
                    {c.author?.name && (
                      <span style={{ marginLeft: 6 }}>· {t('adminReports.commentBy', { name: c.author.name })}</span>
                    )}
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
              {/* Quoted comment body */}
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

              {/* Reporters list */}
              <div data-testid="reporters-list" style={{ marginBottom: 24 }}>
                <p style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 12px' }}>
                  {t('adminReports.reporterList')}
                </p>
                {selected.reports.map(r => (
                  <div
                    key={r.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}
                  >
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

              {/* Actions */}
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
            <div
              style={{ fontSize: 14, color: 'var(--ink-3)', padding: '40px 0', textAlign: 'center' }}
            >
              {t('adminReports.selectToView')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
