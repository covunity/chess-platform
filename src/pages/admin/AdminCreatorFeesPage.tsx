import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import {
  listCreatorFees,
  setCreatorFeeOverride,
  clearCreatorFeeOverride,
  setCreatorLessonLimitOverride,
  clearCreatorLessonLimitOverride,
  validateOverridePct,
  validateLessonLimitOverride,
} from '../../lib/adminCreatorFeesApi'
import type { CreatorFeeRow, OverrideValidationError } from '../../lib/adminCreatorFeesApi'

const SEARCH_DEBOUNCE_MS = 250

type ModalKind = 'fee' | 'lesson'
type ModalMode = 'set' | 'clear'
interface ModalState {
  kind: ModalKind
  mode: ModalMode
  creator: CreatorFeeRow
}

const ERROR_KEY: Record<OverrideValidationError, string> = {
  required: 'admin.creatorFees.errors.required',
  numeric: 'admin.creatorFees.errors.numeric',
  range: 'admin.creatorFees.errors.range',
}

const ERROR_KEY_LESSON: Record<OverrideValidationError, string> = {
  required: 'admin.creatorFees.errors.required',
  numeric: 'admin.creatorFees.errors.lessonNumeric',
  range: 'admin.creatorFees.errors.lessonRange',
}

function formatPct(value: number): string {
  // Drop trailing zeros: 20.00 → "20", 12.50 → "12.5"
  return Number(value).toString()
}

export default function AdminCreatorFeesPage() {
  const { t } = useTranslation()
  const [creators, setCreators] = useState<CreatorFeeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [overridesOnly, setOverridesOnly] = useState(false)
  const [modal, setModal] = useState<ModalState | null>(null)
  const [overrideInput, setOverrideInput] = useState('')
  const [modalError, setModalError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [refetchKey, setRefetchKey] = useState(0)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let cancelled = false
    listCreatorFees(supabase, {
      search: debouncedSearch || undefined,
      overrides_only: overridesOnly,
    }).then(({ creators: rows, error: err }) => {
      if (cancelled) return
      if (err) {
        setError(t('admin.creatorFees.loadError'))
        setCreators([])
      } else {
        setError(null)
        setCreators(rows)
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [debouncedSearch, overridesOnly, refetchKey, t])

  function openSetFeeModal(c: CreatorFeeRow) {
    setModal({ kind: 'fee', mode: 'set', creator: c })
    setOverrideInput(c.platform_fee_pct_override == null ? '' : formatPct(c.platform_fee_pct_override))
    setModalError(null)
  }

  function openClearFeeModal(c: CreatorFeeRow) {
    setModal({ kind: 'fee', mode: 'clear', creator: c })
    setModalError(null)
  }

  function openSetLessonModal(c: CreatorFeeRow) {
    setModal({ kind: 'lesson', mode: 'set', creator: c })
    setOverrideInput(
      c.max_lessons_per_course_override == null ? '' : String(c.max_lessons_per_course_override)
    )
    setModalError(null)
  }

  function openClearLessonModal(c: CreatorFeeRow) {
    setModal({ kind: 'lesson', mode: 'clear', creator: c })
    setModalError(null)
  }

  function closeModal() {
    setModal(null)
    setOverrideInput('')
    setModalError(null)
  }

  async function confirmSet() {
    if (!modal || modal.mode !== 'set') return
    if (modal.kind === 'fee') {
      const validation = validateOverridePct(overrideInput)
      if (validation) {
        setModalError(t(ERROR_KEY[validation]))
        return
      }
      setSaving(true)
      setModalError(null)
      const { error: rpcErr } = await setCreatorFeeOverride(
        supabase,
        modal.creator.user_id,
        Number(overrideInput.trim())
      )
      setSaving(false)
      if (rpcErr) {
        setModalError(t('admin.creatorFees.errors.saveFailed'))
        return
      }
    } else {
      const validation = validateLessonLimitOverride(overrideInput)
      if (validation) {
        setModalError(t(ERROR_KEY_LESSON[validation]))
        return
      }
      setSaving(true)
      setModalError(null)
      const { error: rpcErr } = await setCreatorLessonLimitOverride(
        supabase,
        modal.creator.user_id,
        Number(overrideInput.trim())
      )
      setSaving(false)
      if (rpcErr) {
        setModalError(t('admin.creatorFees.errors.saveFailed'))
        return
      }
    }
    closeModal()
    setRefetchKey(k => k + 1)
  }

  async function confirmClear() {
    if (!modal || modal.mode !== 'clear') return
    setSaving(true)
    setModalError(null)
    const { error: rpcErr } = modal.kind === 'fee'
      ? await clearCreatorFeeOverride(supabase, modal.creator.user_id)
      : await clearCreatorLessonLimitOverride(supabase, modal.creator.user_id)
    setSaving(false)
    if (rpcErr) {
      setModalError(t('admin.creatorFees.errors.clearFailed'))
      return
    }
    closeModal()
    setRefetchKey(k => k + 1)
  }

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center justify-between px-6 border-b border-(--border) bg-(--surface) shrink-0 gap-3"
        style={{ height: 60 }}
      >
        <h1 className="text-lg font-semibold text-(--ink-1)" style={{ letterSpacing: '-0.01em' }}>
          {t('admin.creatorFees.pageTitle')}
        </h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-(--ink-2)">
            <input
              type="checkbox"
              data-testid="creator-fees-filter-overrides-only"
              checked={overridesOnly}
              onChange={e => setOverridesOnly(e.target.checked)}
            />
            {t('admin.creatorFees.filterOverridesOnly')}
          </label>
          <input
            type="search"
            data-testid="creator-fees-search"
            placeholder={t('admin.creatorFees.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input"
            style={{ width: 260, height: 36 }}
            aria-label={t('admin.creatorFees.searchPlaceholder')}
          />
        </div>
      </div>

      <p className="px-6 pt-4 text-sm text-(--ink-2)" style={{ lineHeight: 1.55, maxWidth: 720 }}>
        {t('admin.creatorFees.intro')}
      </p>

      <div className="flex-1 p-6 overflow-auto">
        {error && (
          <div
            role="alert"
            data-testid="creator-fees-error"
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
                  t('admin.creatorFees.colCreator'),
                  t('admin.creatorFees.colTier'),
                  t('admin.creatorFees.colFee'),
                  t('admin.creatorFees.colLessons'),
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
                  <td colSpan={5} className="text-center text-(--ink-3) py-10" data-testid="creator-fees-loading">
                    …
                  </td>
                </tr>
              ) : creators.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-(--ink-3) py-10" data-testid="creator-fees-empty">
                    {t('admin.creatorFees.empty')}
                  </td>
                </tr>
              ) : (
                creators.map(c => (
                  <tr
                    key={c.user_id}
                    data-testid={`creator-fees-row-${c.user_id}`}
                    className="border-b border-(--border) last:border-0"
                  >
                    <td style={{ padding: '14px 16px' }}>
                      <div className="font-medium text-(--ink-1)">{c.name ?? '—'}</div>
                      <div className="text-(--ink-3)" style={{ fontSize: 12 }}>{c.email}</div>
                    </td>
                    <td style={{ padding: '14px 16px' }} className="text-(--ink-2)">
                      {c.tier_name_vi ?? c.account_tier_id}
                    </td>

                    <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                      <FeeCell
                        creator={c}
                        onSet={() => openSetFeeModal(c)}
                        onClear={() => openClearFeeModal(c)}
                      />
                    </td>

                    <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                      <LessonCell
                        creator={c}
                        onSet={() => openSetLessonModal(c)}
                        onClear={() => openClearLessonModal(c)}
                      />
                    </td>

                    <td style={{ padding: '14px 16px' }} />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div
          data-testid="creator-fees-modal"
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div
            className="card"
            style={{
              width: 440,
              maxWidth: '92vw',
              background: 'var(--surface)',
              padding: 20,
              borderRadius: 'var(--r-md)',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>
              {modal.mode === 'set'
                ? t(
                    modal.kind === 'fee'
                      ? 'admin.creatorFees.modal.setHeading'
                      : 'admin.creatorFees.modal.setLessonHeading',
                    { name: modal.creator.name ?? modal.creator.email }
                  )
                : t(
                    modal.kind === 'fee'
                      ? 'admin.creatorFees.modal.clearHeading'
                      : 'admin.creatorFees.modal.clearLessonHeading',
                    { name: modal.creator.name ?? modal.creator.email }
                  )}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>
              {modal.kind === 'fee'
                ? t('admin.creatorFees.modal.tierFeeNote', { pct: formatPct(modal.creator.tier_fee_pct) })
                : t('admin.creatorFees.modal.tierLessonNote', { max: modal.creator.tier_max_lessons })}
            </p>

            {modal.mode === 'set' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="label" style={{ marginBottom: 0 }}>
                  {modal.kind === 'fee'
                    ? t('admin.creatorFees.modal.inputLabel')
                    : t('admin.creatorFees.modal.inputLessonLabel')}
                  <span aria-hidden="true" style={{ color: 'var(--danger)', marginLeft: 4 }}>*</span>
                </span>
                <input
                  data-testid="override-input"
                  className="input"
                  type="text"
                  inputMode={modal.kind === 'fee' ? 'decimal' : 'numeric'}
                  value={overrideInput}
                  onChange={e => setOverrideInput(e.target.value)}
                  autoFocus
                />
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {modal.kind === 'fee'
                    ? t('admin.creatorFees.modal.inputHint')
                    : t('admin.creatorFees.modal.inputLessonHint')}
                </span>
              </div>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: 0, lineHeight: 1.55 }}>
                {modal.kind === 'fee'
                  ? t('admin.creatorFees.modal.clearConfirm', { pct: formatPct(modal.creator.tier_fee_pct) })
                  : t('admin.creatorFees.modal.clearLessonConfirm', { max: modal.creator.tier_max_lessons })}
              </p>
            )}

            {modalError && (
              <div
                role="alert"
                data-testid="modal-error"
                style={{
                  background: 'var(--danger-soft)',
                  color: 'var(--danger)',
                  borderRadius: 'var(--r-md)',
                  padding: '8px 12px',
                  fontSize: 13,
                }}
              >
                {modalError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={closeModal}
                disabled={saving}
              >
                {t('admin.creatorFees.modal.cancel')}
              </button>
              {modal.mode === 'set' ? (
                <button
                  type="button"
                  className="btn btn-accent"
                  data-testid="modal-confirm-save"
                  onClick={confirmSet}
                  disabled={saving}
                >
                  {saving ? t('admin.creatorFees.modal.saving') : t('admin.creatorFees.modal.save')}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn"
                  data-testid="modal-confirm-clear"
                  onClick={confirmClear}
                  disabled={saving}
                  style={{ background: 'var(--danger)', color: 'var(--ink-on-accent)' }}
                >
                  {saving ? t('admin.creatorFees.modal.saving') : t('admin.creatorFees.modal.confirmClear')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FeeCell({
  creator: c,
  onSet,
  onClear,
}: {
  creator: CreatorFeeRow
  onSet: () => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="font-medium text-(--ink-1)" data-testid={`creator-fees-effective-fee-${c.user_id}`}>
          {formatPct(c.effective_fee_pct)}%
        </span>
        <span className="text-(--ink-3)" style={{ fontSize: 12 }}>
          {t('admin.creatorFees.tierBaseFee', { pct: formatPct(c.tier_fee_pct) })}
        </span>
      </div>
      {c.platform_fee_pct_override != null && (
        <span
          className="pill"
          data-testid={`creator-fees-fee-override-badge-${c.user_id}`}
          style={{
            background: 'var(--accent-soft)',
            color: 'var(--accent-ink)',
            border: '1px solid var(--accent-border)',
            padding: '2px 8px',
            fontSize: 12,
            alignSelf: 'flex-start',
          }}
        >
          {t('admin.creatorFees.overrideBadge')} · {formatPct(c.platform_fee_pct_override)}%
        </span>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          data-testid={`set-override-btn-${c.user_id}`}
          onClick={onSet}
        >
          {t('admin.creatorFees.setOverride')}
        </button>
        {c.platform_fee_pct_override != null && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            data-testid={`clear-override-btn-${c.user_id}`}
            onClick={onClear}
          >
            {t('admin.creatorFees.clearOverride')}
          </button>
        )}
      </div>
    </div>
  )
}

function LessonCell({
  creator: c,
  onSet,
  onClear,
}: {
  creator: CreatorFeeRow
  onSet: () => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span
          className="font-medium text-(--ink-1)"
          data-testid={`creator-fees-effective-lessons-${c.user_id}`}
        >
          {c.effective_max_lessons}
        </span>
        <span className="text-(--ink-3)" style={{ fontSize: 12 }}>
          {t('admin.creatorFees.tierBaseLessons', { max: c.tier_max_lessons })}
        </span>
      </div>
      {c.max_lessons_per_course_override != null && (
        <span
          className="pill"
          data-testid={`creator-fees-lesson-override-badge-${c.user_id}`}
          style={{
            background: 'var(--accent-soft)',
            color: 'var(--accent-ink)',
            border: '1px solid var(--accent-border)',
            padding: '2px 8px',
            fontSize: 12,
            alignSelf: 'flex-start',
          }}
        >
          {t('admin.creatorFees.overrideBadge')} · {c.max_lessons_per_course_override}
        </span>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          data-testid={`set-lesson-override-btn-${c.user_id}`}
          onClick={onSet}
        >
          {t('admin.creatorFees.setLessonOverride')}
        </button>
        {c.max_lessons_per_course_override != null && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            data-testid={`clear-lesson-override-btn-${c.user_id}`}
            onClick={onClear}
          >
            {t('admin.creatorFees.clearLessonOverride')}
          </button>
        )}
      </div>
    </div>
  )
}
