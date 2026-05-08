import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import {
  approveCreatorApplication,
  listCreatorApplications,
  rejectCreatorApplication,
} from '../../lib/creatorApplicationApi'
import type {
  CreatorApplicationStatus,
  CreatorApplicationWithApplicant,
} from '../../lib/creatorApplicationApi'

const STATUS_TABS: CreatorApplicationStatus[] = ['pending', 'approved', 'rejected']

export default function AdminCreatorApplicationsPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<CreatorApplicationStatus>('pending')
  const [applications, setApplications] = useState<CreatorApplicationWithApplicant[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<CreatorApplicationWithApplicant | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listCreatorApplications(supabase, { status: tab }).then(({ applications }) => {
      if (cancelled) return
      setApplications(applications)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [tab])

  async function handleApprove(app: CreatorApplicationWithApplicant) {
    setSaving(true)
    setErrorMsg(null)
    const { error } = await approveCreatorApplication(supabase, app.id)
    setSaving(false)
    if (error) {
      setErrorMsg(t('admin.creatorApplications.approveError', 'Không thể duyệt đơn. Vui lòng thử lại.'))
      return
    }
    setApplications(prev => prev.filter(a => a.id !== app.id))
    setSelected(null)
  }

  async function handleReject() {
    if (!rejectingId || rejectReason.trim().length < 5) {
      setErrorMsg(
        t('admin.creatorApplications.rejectReasonError', 'Vui lòng nhập lý do từ chối (tối thiểu 5 ký tự).')
      )
      return
    }
    setSaving(true)
    setErrorMsg(null)
    const { error } = await rejectCreatorApplication(supabase, rejectingId, rejectReason.trim())
    setSaving(false)
    if (error) {
      setErrorMsg(t('admin.creatorApplications.rejectError', 'Không thể từ chối đơn. Vui lòng thử lại.'))
      return
    }
    setApplications(prev => prev.filter(a => a.id !== rejectingId))
    setSelected(null)
    setRejectingId(null)
    setRejectReason('')
  }

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center justify-between px-6 border-b border-(--border) bg-(--surface) shrink-0"
        style={{ height: 60 }}
      >
        <h1 className="text-lg font-semibold text-(--ink-1)" style={{ letterSpacing: '-0.01em' }}>
          {t('admin.creatorApplications.pageTitle', 'Đơn đăng ký creator')}
        </h1>
        <div role="tablist" className="flex items-center gap-1">
          {STATUS_TABS.map(s => (
            <button
              key={s}
              role="tab"
              type="button"
              data-testid={`status-tab-${s}`}
              aria-selected={tab === s}
              onClick={() => setTab(s)}
              className="btn btn-sm"
              style={{
                background: tab === s ? 'var(--ink-1)' : 'transparent',
                color: tab === s ? 'var(--ink-on-accent)' : 'var(--ink-2)',
                border: '1px solid var(--border)',
              }}
            >
              {t(`admin.creatorApplications.tab.${s}`, s)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 grid overflow-hidden" style={{ gridTemplateColumns: '1.1fr 1fr' }}>
        {/* List */}
        <div className="overflow-auto p-6 border-r border-(--border)">
          {loading ? (
            <div data-testid="applications-loading" className="text-(--ink-3) text-sm">…</div>
          ) : applications.length === 0 ? (
            <div
              data-testid="applications-empty"
              className="text-(--ink-3) text-sm"
              style={{ padding: '32px 0', textAlign: 'center' }}
            >
              {t('admin.creatorApplications.empty', 'Không có đơn nào ở trạng thái này.')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {applications.map(app => {
                const isSelected = selected?.id === app.id
                return (
                  <button
                    key={app.id}
                    type="button"
                    data-testid={`application-row-${app.id}`}
                    onClick={() => {
                      setSelected(app)
                      setRejectingId(null)
                      setRejectReason('')
                      setErrorMsg(null)
                    }}
                    className="card text-left"
                    style={{
                      padding: 14,
                      cursor: 'pointer',
                      borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                      background: isSelected ? 'var(--accent-soft)' : 'var(--surface)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>
                          {app.applicant?.name ?? app.applicant?.email ?? '—'}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                          {app.applicant?.email}
                        </div>
                      </div>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          color: 'var(--ink-3)',
                          flexShrink: 0,
                        }}
                      >
                        {new Date(app.created_at).toLocaleDateString('vi-VN')}
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: 12.5,
                        color: 'var(--ink-2)',
                        marginTop: 6,
                        lineHeight: 1.4,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {app.motivation}
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Detail */}
        <div className="overflow-auto p-6">
          {selected ? (
            <div data-testid="application-detail">
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--ink-3)', textTransform: 'uppercase' }}>
                  {t(`admin.creatorApplications.tab.${selected.status}`, selected.status)}
                </div>
                <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink-1)', margin: '6px 0 4px' }}>
                  {selected.applicant?.name ?? '—'}
                </h2>
                <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{selected.applicant?.email}</div>
              </div>

              <DetailField
                label={t('admin.creatorApplications.fieldMotivation', 'Động lực')}
                value={selected.motivation}
              />
              <DetailField
                label={t('admin.creatorApplications.fieldExperience', 'Kinh nghiệm')}
                value={selected.experience}
              />
              {selected.sample_url && (
                <div style={{ marginBottom: 16 }}>
                  <span className="label" style={{ marginBottom: 4 }}>
                    {t('admin.creatorApplications.fieldSample', 'Link mẫu')}
                  </span>
                  <a
                    href={selected.sample_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent-ink)', fontSize: 13.5, wordBreak: 'break-all' }}
                  >
                    {selected.sample_url}
                  </a>
                </div>
              )}
              {selected.status === 'rejected' && selected.rejection_reason && (
                <DetailField
                  label={t('admin.creatorApplications.fieldRejectionReason', 'Lý do từ chối')}
                  value={selected.rejection_reason}
                />
              )}

              {errorMsg && (
                <div
                  role="alert"
                  data-testid="action-error"
                  style={{
                    background: 'var(--danger-soft)',
                    color: 'var(--danger)',
                    borderRadius: 'var(--r-md)',
                    padding: '10px 14px',
                    fontSize: 13,
                    marginBottom: 12,
                  }}
                >
                  {errorMsg}
                </div>
              )}

              {selected.status === 'pending' && (
                <>
                  {rejectingId === selected.id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
                      <span className="label" style={{ marginBottom: 0 }}>
                        {t('admin.creatorApplications.rejectReasonLabel', 'Lý do từ chối')}
                      </span>
                      <textarea
                        data-testid="reject-reason"
                        className="input"
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        style={{ minHeight: 90, padding: 12, lineHeight: 1.5 }}
                      />
                      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            setRejectingId(null)
                            setRejectReason('')
                            setErrorMsg(null)
                          }}
                          disabled={saving}
                        >
                          {t('admin.creatorApplications.cancel', 'Hủy')}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          data-testid="confirm-reject"
                          onClick={handleReject}
                          disabled={saving}
                          style={{
                            background: 'var(--danger)',
                            color: 'var(--ink-on-accent)',
                          }}
                        >
                          {t('admin.creatorApplications.confirmReject', 'Từ chối đơn')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        data-testid="reject-btn"
                        onClick={() => setRejectingId(selected.id)}
                        disabled={saving}
                      >
                        {t('admin.creatorApplications.reject', 'Từ chối')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-accent"
                        data-testid="approve-btn"
                        onClick={() => handleApprove(selected)}
                        disabled={saving}
                      >
                        {t('admin.creatorApplications.approve', 'Duyệt & nâng vai trò')}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="text-(--ink-3) text-sm" style={{ padding: '32px 0', textAlign: 'center' }}>
              {t('admin.creatorApplications.selectHint', 'Chọn một đơn để xem chi tiết.')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <span className="label" style={{ marginBottom: 4 }}>{label}</span>
      <p style={{ fontSize: 13.5, color: 'var(--ink-1)', lineHeight: 1.55, margin: 0, whiteSpace: 'pre-wrap' }}>
        {value}
      </p>
    </div>
  )
}
