import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import {
  approveAccountApplication,
  listAccountApplications,
  rejectAccountApplication,
} from '../../lib/accountApplicationApi'
import { findDuplicatePayoutOwners } from '../../lib/creatorPayoutInfoApi'
import type { DuplicatePayoutOwner } from '../../lib/creatorPayoutInfoApi'
import { parseViolatingCourses } from '../../lib/adminApi'
import type {
  AccountApplicationStatus,
  AccountApplicationWithApplicant,
} from '../../lib/accountApplicationApi'
import { useAccountTiers } from '../../lib/accountTiers'
import type { AccountTierCode } from '../../lib/accountTiers'

interface PayoutInfoSnapshot {
  bank_code?: string
  bank_name?: string
  account_number?: string
  account_holder?: string
  bank_branch?: string
}

function getPayoutSnapshot(metadata: Record<string, unknown>): PayoutInfoSnapshot | null {
  const raw = metadata?.payout_info
  if (!raw || typeof raw !== 'object') return null
  return raw as PayoutInfoSnapshot
}

const STATUS_TABS: AccountApplicationStatus[] = ['pending', 'approved', 'rejected']

const TIER_I18N: Record<AccountTierCode, string> = {
  individual: 'accountTier.individual',
  business: 'accountTier.business',
  athlete: 'accountTier.athlete',
  training_center: 'accountTier.trainingCenter',
}

function TierBadge({
  tierCode,
  isEnterprise,
  t,
}: {
  tierCode: AccountTierCode
  isEnterprise: boolean
  t: (k: string) => string
}) {
  return (
    <span
      className="pill"
      style={
        isEnterprise
          ? { background: 'var(--accent-soft)', color: 'var(--accent-ink)', border: '1px solid var(--accent-border)' }
          : undefined
      }
    >
      {t(TIER_I18N[tierCode] ?? tierCode)}
    </span>
  )
}

function MetadataSection({
  tierCode,
  metadata,
  t,
}: {
  tierCode: AccountTierCode
  metadata: Record<string, unknown>
  t: (k: string) => string
}) {
  if (tierCode === 'individual') return null

  const fields: { key: string; label: string }[] = []

  if (tierCode === 'business') {
    fields.push(
      { key: 'business_name', label: t('admin.applications.metadata.businessName') },
      { key: 'business_registration_no', label: t('admin.applications.metadata.businessRegistrationNo') }
    )
  } else if (tierCode === 'athlete') {
    fields.push({ key: 'federation_or_team', label: t('admin.applications.metadata.federationOrTeam') })
  } else if (tierCode === 'training_center') {
    fields.push(
      { key: 'center_address', label: t('admin.applications.metadata.centerAddress') },
      { key: 'center_size', label: t('admin.applications.metadata.centerSize') }
    )
  }

  return (
    <>
      {fields.map(f => {
        const val = metadata[f.key]
        if (val == null) return null
        return (
          <DetailField key={f.key} label={f.label} value={String(val)} />
        )
      })}
    </>
  )
}

export default function AdminCreatorApplicationsPage() {
  const { t } = useTranslation()
  const { tiers, getTier } = useAccountTiers()
  const [tab, setTab] = useState<AccountApplicationStatus>('pending')
  const [tierFilter, setTierFilter] = useState<AccountTierCode | ''>('')
  const [applications, setApplications] = useState<AccountApplicationWithApplicant[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<AccountApplicationWithApplicant | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [duplicateOwners, setDuplicateOwners] = useState<DuplicatePayoutOwner[]>([])

  useEffect(() => {
    let cancelled = false
    const payout = selected ? getPayoutSnapshot(selected.metadata) : null
    const lookup =
      selected && payout?.bank_code && payout?.account_number
        ? findDuplicatePayoutOwners(supabase, {
            bank_code: payout.bank_code,
            account_number: payout.account_number,
            exclude_user_id: selected.user_id,
          })
        : Promise.resolve({ owners: [], error: null })
    lookup.then(({ owners }) => {
      if (cancelled) return
      setDuplicateOwners(owners)
    })
    return () => { cancelled = true }
  }, [selected])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listAccountApplications(supabase, {
      status: tab,
      tier: tierFilter || undefined,
    }).then(({ applications, error }) => {
      if (cancelled) return
      if (error) {
        setErrorMsg(t('admin.applications.loadError', 'Không thể tải danh sách đơn. Vui lòng thử lại.'))
      }
      setApplications(applications)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [tab, tierFilter, t])

  async function handleApprove(app: AccountApplicationWithApplicant) {
    setSaving(true)
    setErrorMsg(null)
    const { error } = await approveAccountApplication(supabase, app.id)
    setSaving(false)
    if (error) {
      const msg = (error as { message?: string }).message ?? ''
      if (msg.includes('tier_downgrade_violates_chapter_limit')) {
        const courses = parseViolatingCourses(error)
        if (courses.length > 0) {
          const listed = courses
            .slice(0, 3)
            .map(c => `${c.title} (${c.chapter_count} chương)`)
            .join(', ')
          const extra =
            courses.length > 3
              ? ` ${t('errors.andMore', { count: String(courses.length - 3) })}`
              : ''
          setErrorMsg(t('errors.tierDowngradeBlockedWithCourses', { courses: listed + extra }))
        } else {
          setErrorMsg(t('errors.tierDowngradeBlocked'))
        }
      } else {
        setErrorMsg(t('admin.applications.approveError', 'Không thể duyệt đơn. Vui lòng thử lại.'))
      }
      return
    }
    setApplications(prev => prev.filter(a => a.id !== app.id))
    setSelected(null)
  }

  async function handleReject() {
    if (!rejectingId || rejectReason.trim().length < 5) {
      setErrorMsg(
        t('admin.applications.rejectReasonError', 'Vui lòng nhập lý do từ chối (tối thiểu 5 ký tự).')
      )
      return
    }
    setSaving(true)
    setErrorMsg(null)
    const { error } = await rejectAccountApplication(supabase, rejectingId, rejectReason.trim())
    setSaving(false)
    if (error) {
      setErrorMsg(t('admin.applications.rejectError', 'Không thể từ chối đơn. Vui lòng thử lại.'))
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
          {t('admin.applications.pageTitle', 'Đơn đăng ký tài khoản')}
        </h1>
        <div className="flex items-center gap-3">
          {/* Tier filter */}
          <select
            data-testid="tier-filter"
            value={tierFilter}
            onChange={e => {
              setTierFilter(e.target.value as AccountTierCode | '')
              setSelected(null)
            }}
            className="input"
            style={{ height: 34, fontSize: 13, padding: '0 10px' }}
            aria-label={t('admin.applications.filterAllTiers', 'Tất cả tier')}
          >
            <option value="">{t('admin.applications.filterAllTiers', 'Tất cả tier')}</option>
            {tiers.map(tier => (
              <option key={tier.code} value={tier.code}>
                {tier.name_vi}
              </option>
            ))}
          </select>

          {/* Status filter — segmented control */}
          <div
            role="tablist"
            style={{
              display: 'inline-flex',
              gap: 2,
              padding: 3,
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--border)',
              background: 'var(--bg)',
            }}
          >
            {STATUS_TABS.map(s => (
              <button
                key={s}
                role="tab"
                type="button"
                data-testid={`status-tab-${s}`}
                aria-selected={tab === s}
                onClick={() => { setTab(s); setSelected(null) }}
                style={{
                  whiteSpace: 'nowrap',
                  padding: '4px 12px',
                  borderRadius: 'calc(var(--r-md) - 2px)',
                  border: 'none',
                  fontSize: 13,
                  fontWeight: tab === s ? 600 : 400,
                  background: tab === s ? 'var(--ink-1)' : 'transparent',
                  color: tab === s ? 'var(--ink-on-accent)' : 'var(--ink-2)',
                  cursor: 'pointer',
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                {t(`admin.applications.tab.${s}`, s)}
              </button>
            ))}
          </div>
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
              {t('admin.applications.empty', 'Không có đơn nào ở trạng thái này.')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {applications.map(app => {
                const isSelected = selected?.id === app.id
                const appTier = getTier(app.requested_tier_code)
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
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                        <TierBadge
                          tierCode={app.requested_tier_code}
                          isEnterprise={appTier?.is_enterprise ?? false}
                          t={t}
                        />
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
                          {new Date(app.created_at).toLocaleDateString('vi-VN')}
                        </span>
                      </div>
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
                  {t(`admin.applications.tab.${selected.status}`, selected.status)}
                </div>
                <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink-1)', margin: '6px 0 4px' }}>
                  {selected.applicant?.name ?? '—'}
                </h2>
                <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{selected.applicant?.email}</div>
              </div>

              {/* Tier badge */}
              <div style={{ marginBottom: 16 }}>
                <span className="label" style={{ marginBottom: 4 }}>
                  {t('admin.applications.fieldTier', 'Tier yêu cầu')}
                </span>
                <div style={{ marginTop: 6 }}>
                  <TierBadge
                    tierCode={selected.requested_tier_code}
                    isEnterprise={getTier(selected.requested_tier_code)?.is_enterprise ?? false}
                    t={t}
                  />
                </div>
              </div>

              <DetailField
                label={t('admin.applications.fieldMotivation', 'Động lực')}
                value={selected.motivation}
              />
              {selected.experience && (
                <DetailField
                  label={t('admin.applications.fieldExperience', 'Kinh nghiệm')}
                  value={selected.experience}
                />
              )}
              {selected.sample_url && (
                <div style={{ marginBottom: 16 }}>
                  <span className="label" style={{ marginBottom: 4 }}>
                    {t('admin.applications.fieldSample', 'Link mẫu')}
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

              {/* Tier-specific metadata */}
              <MetadataSection
                tierCode={selected.requested_tier_code}
                metadata={selected.metadata}
                t={t}
              />

              <PayoutInfoBlock
                payout={getPayoutSnapshot(selected.metadata)}
                duplicates={duplicateOwners}
                t={t}
              />

              {selected.status === 'rejected' && selected.rejection_reason && (
                <DetailField
                  label={t('admin.applications.fieldRejectionReason', 'Lý do từ chối')}
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
                        {t('admin.applications.rejectReasonLabel', 'Lý do từ chối')}
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
                          {t('admin.applications.cancel', 'Hủy')}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          data-testid="confirm-reject"
                          onClick={handleReject}
                          disabled={saving}
                          style={{ background: 'var(--danger)', color: 'var(--ink-on-accent)' }}
                        >
                          {t('admin.applications.confirmReject', 'Từ chối đơn')}
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
                        {t('admin.applications.reject', 'Từ chối')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-accent"
                        data-testid="approve-btn"
                        onClick={() => handleApprove(selected)}
                        disabled={saving}
                      >
                        {t('admin.applications.approve', 'Duyệt & nâng vai trò')}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="text-(--ink-3) text-sm" style={{ padding: '32px 0', textAlign: 'center' }}>
              {t('admin.applications.selectHint', 'Chọn một đơn để xem chi tiết.')}
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

function PayoutInfoBlock({
  payout,
  duplicates,
  t,
}: {
  payout: PayoutInfoSnapshot | null
  duplicates: DuplicatePayoutOwner[]
  t: (k: string, opts?: Record<string, string | number>) => string
}) {
  if (!payout) return null
  return (
    <div data-testid="admin-payout-section" style={{ marginTop: 8 }}>
      <span className="label" style={{ marginBottom: 4 }}>
        {t('admin.applications.payoutInfo.section')}
      </span>
      {duplicates.length > 0 && (
        <div
          role="alert"
          data-testid="admin-payout-duplicate-warning"
          style={{
            background: 'var(--warning-soft)',
            color: 'var(--warning)',
            borderRadius: 'var(--r-md)',
            padding: '10px 14px',
            fontSize: 13,
            margin: '6px 0 12px',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {t('admin.applications.payoutInfo.duplicateWarningHeading', { count: duplicates.length })}
          </div>
          <div>{t('admin.applications.payoutInfo.duplicateWarningBody')}</div>
          <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
            {duplicates.map(d => (
              <li key={d.user_id} data-testid={`duplicate-owner-${d.user_id}`}>
                {d.name || '—'} ({d.email})
              </li>
            ))}
          </ul>
        </div>
      )}
      {payout.bank_name && (
        <DetailField label={t('admin.applications.payoutInfo.bank')} value={payout.bank_name} />
      )}
      {payout.account_number && (
        <DetailField label={t('admin.applications.payoutInfo.accountNumber')} value={payout.account_number} />
      )}
      {payout.account_holder && (
        <DetailField label={t('admin.applications.payoutInfo.accountHolder')} value={payout.account_holder} />
      )}
      {payout.bank_branch && (
        <DetailField label={t('admin.applications.payoutInfo.bankBranch')} value={payout.bank_branch} />
      )}
    </div>
  )
}
