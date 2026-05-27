import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import {
  fetchCoursePriceLimits,
  updateCoursePriceLimit,
  clearCoursePriceLimitsCache,
} from '../../lib/coursePriceLimits'
import type { CoursePriceLimit } from '../../lib/coursePriceLimits'

interface ModalState {
  limit: CoursePriceLimit
}

type FieldError =
  | 'min_required' | 'min_numeric' | 'min_negative'
  | 'max_required' | 'max_numeric' | 'max_lte_min'

const ERROR_KEY: Record<FieldError, string> = {
  min_required:  'admin.coursePriceLimits.errors.minRequired',
  min_numeric:   'admin.coursePriceLimits.errors.minNumeric',
  min_negative:  'admin.coursePriceLimits.errors.minNegative',
  max_required:  'admin.coursePriceLimits.errors.maxRequired',
  max_numeric:   'admin.coursePriceLimits.errors.maxNumeric',
  max_lte_min:   'admin.coursePriceLimits.errors.maxLteMin',
}

function validate(minRaw: string, maxRaw: string): FieldError | null {
  const minStr = minRaw.trim()
  if (!minStr) return 'min_required'
  const minNum = Number(minStr)
  if (Number.isNaN(minNum) || !Number.isInteger(minNum)) return 'min_numeric'
  if (minNum < 0) return 'min_negative'

  const maxStr = maxRaw.trim()
  if (!maxStr) return 'max_required'
  const maxNum = Number(maxStr)
  if (Number.isNaN(maxNum) || !Number.isInteger(maxNum)) return 'max_numeric'
  if (maxNum <= minNum) return 'max_lte_min'

  return null
}

function formatVnd(value: number): string {
  return value.toLocaleString('vi-VN')
}

export default function AdminCoursePriceLimitsPage() {
  const { t } = useTranslation()
  const [limits, setLimits] = useState<CoursePriceLimit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState | null>(null)
  const [minInput, setMinInput] = useState('')
  const [maxInput, setMaxInput] = useState('')
  const [modalError, setModalError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [refetchKey, setRefetchKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    clearCoursePriceLimitsCache()
    fetchCoursePriceLimits(supabase)
      .then((rows) => {
        if (cancelled) return
        setLimits(rows)
        setError(null)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(t('admin.coursePriceLimits.loadError'))
        setLimits([])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [refetchKey, t])

  function openEdit(limit: CoursePriceLimit) {
    setModal({ limit })
    setMinInput(String(limit.min_price))
    setMaxInput(String(limit.max_price))
    setModalError(null)
  }

  function closeModal() {
    setModal(null)
    setMinInput('')
    setMaxInput('')
    setModalError(null)
  }

  async function confirmSave() {
    if (!modal) return
    const err = validate(minInput, maxInput)
    if (err) {
      setModalError(t(ERROR_KEY[err]))
      return
    }
    setSaving(true)
    setModalError(null)
    const { error: rpcErr } = await updateCoursePriceLimit(
      supabase,
      modal.limit.level,
      Number(minInput.trim()),
      Number(maxInput.trim())
    )
    setSaving(false)
    if (rpcErr) {
      setModalError(t('admin.coursePriceLimits.errors.saveFailed'))
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
          {t('admin.coursePriceLimits.pageTitle')}
        </h1>
      </div>

      <p className="px-6 pt-4 text-sm text-(--ink-2)" style={{ lineHeight: 1.55 }}>
        {t('admin.coursePriceLimits.intro')}
      </p>

      <div className="flex-1 p-6 overflow-auto">
        {error && (
          <div
            role="alert"
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
                  t('admin.coursePriceLimits.colLevel'),
                  t('admin.coursePriceLimits.colMin'),
                  t('admin.coursePriceLimits.colMax'),
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
                  <td colSpan={4} className="text-center text-(--ink-3) py-10">…</td>
                </tr>
              ) : limits.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center text-(--ink-3) py-10">
                    {t('admin.coursePriceLimits.empty')}
                  </td>
                </tr>
              ) : (
                limits.map((limit) => (
                  <tr
                    key={limit.level}
                    data-testid={`admin-price-limits-row-${limit.level}`}
                    className="border-b border-(--border) last:border-0"
                  >
                    <td style={{ padding: '14px 16px' }}>
                      <div className="font-medium text-(--ink-1)">
                        {t(`admin.coursePriceLimits.levelName.${limit.level}`, { defaultValue: limit.level })}
                      </div>
                      <div className="text-(--ink-3)" style={{ fontSize: 12 }}>{limit.level}</div>
                    </td>
                    <td style={{ padding: '14px 16px' }} className="text-(--ink-1)">
                      ₫{formatVnd(limit.min_price)}
                    </td>
                    <td style={{ padding: '14px 16px' }} className="text-(--ink-1)">
                      ₫{formatVnd(limit.max_price)}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        data-testid={`admin-price-limits-edit-${limit.level}`}
                        onClick={() => openEdit(limit)}
                      >
                        {t('admin.coursePriceLimits.edit')}
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
          data-testid="admin-price-limits-edit-dialog"
        >
          <div className="card" style={{ width: 420, padding: 24 }}>
            <p className="font-semibold text-(--ink-1) mb-1" style={{ fontSize: 15 }}>
              {t('admin.coursePriceLimits.editDialogTitle', {
                level: t(`admin.coursePriceLimits.levelName.${modal.limit.level}`, { defaultValue: modal.limit.level }),
              })}
            </p>
            <p className="text-(--ink-3) mb-4" style={{ fontSize: 12 }}>
              {t('admin.coursePriceLimits.editDialogHint')}
            </p>

            <label className="block text-xs font-medium text-(--ink-2) mb-1" htmlFor="admin-price-limits-min-input">
              {t('admin.coursePriceLimits.minLabel')}
            </label>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', fontSize: 14 }}>₫</span>
              <input
                id="admin-price-limits-min-input"
                data-testid="admin-price-limits-min-input"
                className="input w-full"
                style={{ paddingLeft: 28 }}
                value={minInput}
                onChange={(e) => setMinInput(e.target.value)}
                inputMode="numeric"
              />
            </div>

            <label className="block text-xs font-medium text-(--ink-2) mb-1" htmlFor="admin-price-limits-max-input">
              {t('admin.coursePriceLimits.maxLabel')}
            </label>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', fontSize: 14 }}>₫</span>
              <input
                id="admin-price-limits-max-input"
                data-testid="admin-price-limits-max-input"
                className="input w-full"
                style={{ paddingLeft: 28 }}
                value={maxInput}
                onChange={(e) => setMaxInput(e.target.value)}
                inputMode="numeric"
              />
            </div>

            {modalError && (
              <p
                role="alert"
                data-testid="admin-price-limits-modal-error"
                className="mb-3"
                style={{ color: 'var(--danger)', fontSize: 12 }}
              >
                {modalError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={closeModal} disabled={saving}>
                {t('admin.coursePriceLimits.cancel')}
              </button>
              <button
                type="button"
                data-testid="admin-price-limits-save-btn"
                className="btn btn-primary btn-sm"
                onClick={confirmSave}
                disabled={saving}
              >
                {saving ? t('admin.coursePriceLimits.saving') : t('admin.coursePriceLimits.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
