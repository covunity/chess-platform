import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { fetchAccountTiers, updateAccountTier, clearAccountTiersCache } from '../../lib/accountTiers'
import type { AccountTier } from '../../lib/accountTiers'

interface ModalState {
  tier: AccountTier
}

type FieldError =
  | 'fee_required' | 'fee_numeric' | 'fee_range'
  | 'cap_required' | 'cap_numeric' | 'cap_range'
  | 'lesson_required' | 'lesson_numeric' | 'lesson_range'

const ERROR_KEY: Record<FieldError, string> = {
  fee_required: 'admin.tiers.errors.feeRequired',
  fee_numeric: 'admin.tiers.errors.feeNumeric',
  fee_range: 'admin.tiers.errors.feeRange',
  cap_required: 'admin.tiers.errors.capRequired',
  cap_numeric: 'admin.tiers.errors.capNumeric',
  cap_range: 'admin.tiers.errors.capRange',
  lesson_required: 'admin.tiers.errors.lessonRequired',
  lesson_numeric: 'admin.tiers.errors.lessonNumeric',
  lesson_range: 'admin.tiers.errors.lessonRange',
}

function formatPct(value: number): string {
  return Number(value).toString()
}

function validate(feeRaw: string, capRaw: string, lessonRaw: string): FieldError | null {
  const fee = feeRaw.trim()
  if (!fee) return 'fee_required'
  const feeNum = Number(fee)
  if (Number.isNaN(feeNum)) return 'fee_numeric'
  if (feeNum < 0 || feeNum > 100) return 'fee_range'
  const cap = capRaw.trim()
  if (!cap) return 'cap_required'
  const capNum = Number(cap)
  if (!Number.isInteger(capNum)) return 'cap_numeric'
  if (capNum < 1 || capNum > 1000) return 'cap_range'
  const lesson = lessonRaw.trim()
  if (!lesson) return 'lesson_required'
  const lessonNum = Number(lesson)
  if (!Number.isInteger(lessonNum)) return 'lesson_numeric'
  if (lessonNum < 1 || lessonNum > 10000) return 'lesson_range'
  return null
}

export default function AdminTiersPage() {
  const { t } = useTranslation()
  const [tiers, setTiers] = useState<AccountTier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState | null>(null)
  const [feeInput, setFeeInput] = useState('')
  const [capInput, setCapInput] = useState('')
  const [lessonInput, setLessonInput] = useState('')
  const [modalError, setModalError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [refetchKey, setRefetchKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    clearAccountTiersCache()
    fetchAccountTiers(supabase)
      .then((rows) => {
        if (cancelled) return
        setTiers(rows)
        setError(null)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(t('admin.tiers.loadError'))
        setTiers([])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refetchKey, t])

  function openEdit(tier: AccountTier) {
    setModal({ tier })
    setFeeInput(formatPct(tier.platform_fee_pct))
    setCapInput(String(tier.max_chapters_per_course))
    setLessonInput(String(tier.max_lessons_per_course))
    setModalError(null)
  }

  function closeModal() {
    setModal(null)
    setFeeInput('')
    setCapInput('')
    setLessonInput('')
    setModalError(null)
  }

  async function confirmSave() {
    if (!modal) return
    const validation = validate(feeInput, capInput, lessonInput)
    if (validation) {
      setModalError(t(ERROR_KEY[validation]))
      return
    }
    setSaving(true)
    setModalError(null)
    const { error: rpcErr } = await updateAccountTier(supabase, modal.tier.code, {
      platform_fee_pct: Number(feeInput.trim()),
      max_chapters_per_course: Number(capInput.trim()),
      max_lessons_per_course: Number(lessonInput.trim()),
    })
    setSaving(false)
    if (rpcErr) {
      setModalError(t('admin.tiers.errors.saveFailed'))
      return
    }
    closeModal()
    setRefetchKey((k) => k + 1)
  }

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center justify-between px-6 border-b border-(--border) bg-(--surface) shrink-0 gap-3"
        style={{ height: 60 }}
      >
        <h1 className="text-lg font-semibold text-(--ink-1)" style={{ letterSpacing: '-0.01em' }}>
          {t('admin.tiers.pageTitle')}
        </h1>
      </div>

      <p className="px-6 pt-4 text-sm text-(--ink-2)" style={{ lineHeight: 1.55, maxWidth: 720 }}>
        {t('admin.tiers.intro')}
      </p>

      <div className="flex-1 p-6 overflow-auto">
        {error && (
          <div
            role="alert"
            data-testid="admin-tiers-error"
            style={{
              background: 'var(--danger-soft)',
              color: 'var(--danger)',
              borderRadius: 'var(--r-md)',
              padding: '10px 14px',
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        <div className="card overflow-hidden">
          <table className="w-full" style={{ fontSize: 13 }}>
            <thead>
              <tr className="border-b border-(--border)">
                {[
                  t('admin.tiers.colTier'),
                  t('admin.tiers.colFee'),
                  t('admin.tiers.colMaxChapters'),
                  t('admin.tiers.colMaxLessons'),
                  t('admin.tiers.colRequiresApproval'),
                  '',
                ].map((col, i) => (
                  <th
                    key={i}
                    className="px-4 text-left font-medium uppercase text-(--ink-3)"
                    style={{ padding: '14px 16px', fontSize: 11.5, letterSpacing: '0.05em' }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center text-(--ink-3) py-10" data-testid="admin-tiers-loading">
                    …
                  </td>
                </tr>
              ) : tiers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-(--ink-3) py-10" data-testid="admin-tiers-empty">
                    {t('admin.tiers.empty')}
                  </td>
                </tr>
              ) : (
                tiers.map((tier) => (
                  <tr
                    key={tier.code}
                    data-testid={`admin-tiers-row-${tier.code}`}
                    className="border-b border-(--border) last:border-0"
                  >
                    <td style={{ padding: '14px 16px' }}>
                      <div className="font-medium text-(--ink-1)">{tier.name_vi}</div>
                      <div className="text-(--ink-3)" style={{ fontSize: 12 }}>{tier.code}</div>
                    </td>
                    <td style={{ padding: '14px 16px' }} className="text-(--ink-1)" data-testid={`admin-tiers-fee-${tier.code}`}>
                      {formatPct(tier.platform_fee_pct)}%
                    </td>
                    <td style={{ padding: '14px 16px' }} className="text-(--ink-2)" data-testid={`admin-tiers-cap-${tier.code}`}>
                      {tier.max_chapters_per_course}
                    </td>
                    <td style={{ padding: '14px 16px' }} className="text-(--ink-2)" data-testid={`admin-tiers-lessoncap-${tier.code}`}>
                      {tier.max_lessons_per_course}
                    </td>
                    <td style={{ padding: '14px 16px' }} className="text-(--ink-2)">
                      {tier.requires_approval ? t('admin.tiers.yes') : t('admin.tiers.no')}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        data-testid={`admin-tiers-edit-${tier.code}`}
                        onClick={() => openEdit(tier)}
                      >
                        {t('admin.tiers.edit')}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ background: 'rgba(20,22,26,0.4)', zIndex: 60 }}
          role="dialog"
          aria-modal="true"
          data-testid="admin-tiers-edit-dialog"
        >
          <div className="card" style={{ width: 420, padding: 24 }}>
            <p className="font-semibold text-(--ink-1) mb-1" style={{ fontSize: 15 }}>
              {t('admin.tiers.editDialogTitle', { tier: modal.tier.name_vi })}
            </p>
            <p className="text-(--ink-3) mb-4" style={{ fontSize: 12 }}>
              {t('admin.tiers.editDialogHint')}
            </p>

            <label className="block text-xs font-medium text-(--ink-2) mb-1" htmlFor="admin-tiers-fee-input">
              {t('admin.tiers.feeLabel')}
            </label>
            <input
              id="admin-tiers-fee-input"
              data-testid="admin-tiers-fee-input"
              className="input w-full mb-3"
              value={feeInput}
              onChange={(e) => setFeeInput(e.target.value)}
              inputMode="decimal"
            />

            <label className="block text-xs font-medium text-(--ink-2) mb-1" htmlFor="admin-tiers-cap-input">
              {t('admin.tiers.capLabel')}
            </label>
            <input
              id="admin-tiers-cap-input"
              data-testid="admin-tiers-cap-input"
              className="input w-full mb-3"
              value={capInput}
              onChange={(e) => setCapInput(e.target.value)}
              inputMode="numeric"
            />

            <label className="block text-xs font-medium text-(--ink-2) mb-1" htmlFor="admin-tiers-lesson-input">
              {t('admin.tiers.lessonLabel')}
            </label>
            <input
              id="admin-tiers-lesson-input"
              data-testid="admin-tiers-lesson-input"
              className="input w-full mb-3"
              value={lessonInput}
              onChange={(e) => setLessonInput(e.target.value)}
              inputMode="numeric"
            />

            {modalError && (
              <p
                role="alert"
                data-testid="admin-tiers-modal-error"
                className="mb-3"
                style={{ color: 'var(--danger)', fontSize: 12 }}
              >
                {modalError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={closeModal} disabled={saving}>
                {t('admin.tiers.cancel')}
              </button>
              <button
                type="button"
                data-testid="admin-tiers-save-btn"
                className="btn btn-primary btn-sm"
                onClick={confirmSave}
                disabled={saving}
              >
                {saving ? t('admin.tiers.saving') : t('admin.tiers.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
