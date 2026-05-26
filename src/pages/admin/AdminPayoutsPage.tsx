import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import {
  fetchPendingPayouts,
  fetchCreatorsWithoutPayoutInfo,
  createWeeklyPayouts,
  markPayoutComplete,
  buildPayoutsCsv,
  isoWeek,
  type PendingPayout,
  type CreatorMissingPayoutInfo,
} from '../../lib/adminPayoutsApi'
import { formatPrice } from '../../lib/utils'

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

interface MarkCompleteDialogProps {
  payout: PendingPayout
  saving: boolean
  errorMsg: string | null
  onCancel: () => void
  onConfirm: (reference: string) => void
  t: (k: string, opts?: Record<string, string | number>) => string
}

function MarkCompleteDialog({
  payout,
  saving,
  errorMsg,
  onCancel,
  onConfirm,
  t,
}: MarkCompleteDialogProps) {
  const [reference, setReference] = useState('')
  const trimmed = reference.trim()
  const canSubmit = trimmed.length > 0 && !saving

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(20,22,26,0.4)', zIndex: 50 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mark-complete-dialog-title"
      data-testid="mark-complete-dialog"
    >
      <div className="card" style={{ width: 480, borderRadius: 'var(--r-lg)', padding: 28 }}>
        <h2
          id="mark-complete-dialog-title"
          className="text-lg font-semibold text-(--ink-1) mb-3"
        >
          {t('admin.payouts.markCompleteDialog.title')}
        </h2>
        <p className="text-sm text-(--ink-2) mb-4">
          {t('admin.payouts.markCompleteDialog.body')}{' '}
          <span className="font-medium text-(--ink-1)">
            {payout.creatorName ?? payout.creatorEmail}
          </span>{' '}
          ({formatPrice(payout.amount)}).
        </p>

        <label className="label mb-1 block" htmlFor="payout-reference">
          {t('admin.payouts.markCompleteDialog.referenceLabel')}
        </label>
        <input
          id="payout-reference"
          data-testid="reference-input"
          className="input w-full"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder={t('admin.payouts.markCompleteDialog.referencePlaceholder')}
        />

        {errorMsg && (
          <div
            role="alert"
            className="mt-3"
            style={{
              background: 'var(--danger-soft)',
              color: 'var(--danger)',
              borderRadius: 'var(--r-md)',
              padding: '10px 14px',
              fontSize: 13,
            }}
          >
            {errorMsg}
          </div>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            {t('admin.payouts.markCompleteDialog.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="mark-complete-submit"
            onClick={() => onConfirm(trimmed)}
            disabled={!canSubmit}
          >
            {saving
              ? t('admin.payouts.markCompleteDialog.saving')
              : t('admin.payouts.markCompleteDialog.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminPayoutsPage() {
  const { t } = useTranslation()
  const [payouts, setPayouts] = useState<PendingPayout[]>([])
  const [missing, setMissing] = useState<CreatorMissingPayoutInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [dialogTarget, setDialogTarget] = useState<PendingPayout | null>(null)
  const [saving, setSaving] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [toast, setToast] = useState<'success' | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Auto-create pending payout rows for newly-eligible creators (idempotent
      // per ISO week per creator). Without this, a creator who fills in their
      // payout_info AFTER admin's first "Xuất CSV" click would have no row in
      // the pending list — they'd silently disappear from /admin/payouts until
      // admin happens to re-click the button. See bug report on slice 7.
      await createWeeklyPayouts(supabase)
      if (cancelled) return
      const [p, m] = await Promise.all([
        fetchPendingPayouts(supabase),
        fetchCreatorsWithoutPayoutInfo(supabase),
      ])
      if (cancelled) return
      if (p.error) setLoadError(t('admin.payouts.loadError'))
      else setLoadError(null)
      setPayouts(p.payouts)
      setMissing(m.creators)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [t])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])

  async function handleExport() {
    setExporting(true)
    setExportError(null)
    const { payouts: fresh, error } = await createWeeklyPayouts(supabase)
    setExporting(false)
    if (error) {
      setExportError(t('admin.payouts.exportError'))
      return
    }
    // Reconcile state with whatever the RPC returned (new + pre-existing for this week).
    setPayouts((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]))
      for (const f of fresh) {
        // Preserve any creator name/email already loaded from join.
        const existing = byId.get(f.id)
        byId.set(f.id, existing ? { ...f, creatorName: existing.creatorName, creatorEmail: existing.creatorEmail } : f)
      }
      return Array.from(byId.values())
    })
    // A creator who just received their first pending payout row should drop
    // out of the "Chưa có thông tin thanh toán" section. Re-fetch instead of
    // diffing locally — small admin-only list, cheap query.
    const { creators: missingFresh } = await fetchCreatorsWithoutPayoutInfo(supabase)
    setMissing(missingFresh)
    const now = new Date()
    const { year, week } = isoWeek(now)
    const ww = week < 10 ? `0${week}` : String(week)
    downloadCsv(buildPayoutsCsv(fresh, now), `gambitly-payouts-${year}-W${ww}.csv`)
  }

  async function handleMarkComplete(reference: string) {
    if (!dialogTarget) return
    setSaving(true)
    setDialogError(null)
    const { error } = await markPayoutComplete(supabase, dialogTarget.id, reference)
    setSaving(false)
    if (error) {
      setDialogError(t('admin.payouts.markCompleteDialog.error'))
      return
    }
    // Optimistically remove the row from the pending list.
    setPayouts((prev) => prev.filter((p) => p.id !== dialogTarget.id))
    setDialogTarget(null)
    setToast('success')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 border-b border-(--border) bg-(--surface) shrink-0"
        style={{ height: 60 }}
      >
        <h1
          className="text-lg font-semibold tracking-tight text-(--ink-1)"
          style={{ letterSpacing: '-0.01em' }}
        >
          {t('admin.payouts.pageTitle')}
        </h1>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          data-testid="export-csv-btn"
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? t('admin.payouts.exporting') : t('admin.payouts.exportCsv')}
        </button>
      </div>

      <div className="flex-1 px-6 py-6 overflow-auto">
        {loadError && (
          <div
            role="alert"
            style={{
              background: 'var(--danger-soft)',
              color: 'var(--danger)',
              borderRadius: 'var(--r-md)',
              padding: '10px 14px',
              marginBottom: 16,
              fontSize: 13,
            }}
          >
            {loadError}
          </div>
        )}

        {exportError && (
          <div
            role="alert"
            style={{
              background: 'var(--danger-soft)',
              color: 'var(--danger)',
              borderRadius: 'var(--r-md)',
              padding: '10px 14px',
              marginBottom: 16,
              fontSize: 13,
            }}
          >
            {exportError}
          </div>
        )}

        {/* Pending payouts table */}
        <section className="mb-8">
          <h2
            className="text-base font-semibold text-(--ink-1) mb-3"
            style={{ letterSpacing: '-0.005em' }}
          >
            {t('admin.payouts.pendingHeading')}
            {!loading && payouts.length > 0 && (
              <span className="text-(--ink-3) font-normal" style={{ marginLeft: 8 }}>
                ({payouts.length})
              </span>
            )}
          </h2>

          <div className="card overflow-visible">
            <table className="w-full" style={{ fontSize: 13 }}>
              <thead>
                <tr className="border-b border-(--border)">
                  <th
                    className="px-4 text-left font-medium uppercase text-(--ink-3)"
                    style={{ padding: '14px 16px', fontSize: 11.5, letterSpacing: '0.05em' }}
                  >
                    {t('admin.payouts.colCreator')}
                  </th>
                  <th
                    className="px-4 text-left font-medium uppercase text-(--ink-3)"
                    style={{ padding: '14px 16px', fontSize: 11.5, letterSpacing: '0.05em' }}
                  >
                    {t('admin.payouts.colBank')}
                  </th>
                  <th
                    className="px-4 text-left font-medium uppercase text-(--ink-3)"
                    style={{ padding: '14px 16px', fontSize: 11.5, letterSpacing: '0.05em' }}
                  >
                    {t('admin.payouts.colAccount')}
                  </th>
                  <th
                    className="text-right font-medium uppercase text-(--ink-3)"
                    style={{ padding: '14px 16px', fontSize: 11.5, letterSpacing: '0.05em' }}
                  >
                    {t('admin.payouts.colAmount')}
                  </th>
                  <th
                    className="text-right font-medium uppercase text-(--ink-3)"
                    style={{ padding: '14px 16px', fontSize: 11.5, letterSpacing: '0.05em' }}
                  >
                    {t('admin.payouts.colOrders')}
                  </th>
                  <th style={{ padding: '14px 16px' }} />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="text-center text-(--ink-3) py-10">
                      …
                    </td>
                  </tr>
                ) : payouts.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-10 text-center text-(--ink-3)"
                      data-testid="pending-payouts-empty"
                    >
                      {t('admin.payouts.empty')}
                    </td>
                  </tr>
                ) : (
                  payouts.map((p) => (
                    <tr
                      key={p.id}
                      data-testid={`pending-payout-row-${p.id}`}
                      className="border-b border-(--border) last:border-0"
                    >
                      <td style={{ padding: '14px 16px' }}>
                        <div className="font-medium text-(--ink-1)">
                          {p.creatorName ?? '—'}
                        </div>
                        <div className="text-(--ink-3)" style={{ fontSize: 11.5 }}>
                          {p.creatorEmail}
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px' }} className="text-(--ink-2)">
                        {p.bankName}
                      </td>
                      <td
                        style={{ padding: '14px 16px' }}
                        className="font-mono text-(--ink-2)"
                      >
                        {p.accountNumber}
                      </td>
                      <td
                        style={{ padding: '14px 16px', textAlign: 'right' }}
                        className="text-(--ink-1) font-medium"
                      >
                        {formatPrice(p.amount)}
                      </td>
                      <td
                        style={{ padding: '14px 16px', textAlign: 'right' }}
                        className="text-(--ink-3)"
                      >
                        {p.orderCount}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          data-testid={`mark-complete-btn-${p.id}`}
                          onClick={() => {
                            setDialogError(null)
                            setDialogTarget(p)
                          }}
                          style={{ height: 26, padding: '0 10px', fontSize: 11.5 }}
                        >
                          {t('admin.payouts.markComplete')}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Missing payout info warning */}
        {missing.length > 0 && (
          <section data-testid="missing-payout-info-section">
            <h2
              className="text-base font-semibold text-(--ink-1) mb-1"
              style={{ letterSpacing: '-0.005em' }}
            >
              {t('admin.payouts.missingPayoutInfo.heading')}
            </h2>
            <p className="text-sm text-(--ink-3) mb-3">
              {t('admin.payouts.missingPayoutInfo.body')}
            </p>
            <div className="card overflow-hidden">
              <table className="w-full" style={{ fontSize: 13 }}>
                <thead>
                  <tr className="border-b border-(--border)">
                    <th
                      className="px-4 text-left font-medium uppercase text-(--ink-3)"
                      style={{ padding: '14px 16px', fontSize: 11.5, letterSpacing: '0.05em' }}
                    >
                      {t('admin.payouts.missingPayoutInfo.colCreator')}
                    </th>
                    <th
                      className="text-right font-medium uppercase text-(--ink-3)"
                      style={{ padding: '14px 16px', fontSize: 11.5, letterSpacing: '0.05em' }}
                    >
                      {t('admin.payouts.missingPayoutInfo.colPendingBalance')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {missing.map((m) => (
                    <tr
                      key={m.creatorId}
                      data-testid={`missing-payout-info-row-${m.creatorId}`}
                      className="border-b border-(--border) last:border-0"
                    >
                      <td style={{ padding: '14px 16px' }}>
                        <div className="font-medium text-(--ink-1)">{m.name ?? '—'}</div>
                        <div className="text-(--ink-3)" style={{ fontSize: 11.5 }}>
                          {m.email}
                        </div>
                      </td>
                      <td
                        style={{ padding: '14px 16px', textAlign: 'right' }}
                        className="text-(--ink-1) font-medium"
                      >
                        {formatPrice(m.pendingBalance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {dialogTarget && (
        <MarkCompleteDialog
          payout={dialogTarget}
          saving={saving}
          errorMsg={dialogError}
          onCancel={() => setDialogTarget(null)}
          onConfirm={handleMarkComplete}
          t={t}
        />
      )}

      {toast === 'success' && (
        <div data-testid="payouts-success-toast" className="toast toast-success">
          {t('admin.payouts.actionSuccess')}
        </div>
      )}
    </div>
  )
}
