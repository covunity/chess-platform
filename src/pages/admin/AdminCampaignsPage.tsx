import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import {
  listCampaigns,
  createCampaign,
  updateCampaign,
  deactivateCampaign,
  listAdminCourses,
} from '../../lib/campaignsApi'
import type {
  Campaign,
  CampaignDiscountType,
  CampaignInput,
  CoursePickerRow,
} from '../../lib/campaignsApi'
import { useDebounce } from '../../hooks/useDebounce'
import CourseMultiSelect from '../../components/admin/CourseMultiSelect'
import { formatPrice } from '../../lib/utils'

type StatusFilter = 'all' | 'active' | 'inactive'

interface FormState {
  editingId: string | null
  name: string
  description: string
  discount_type: CampaignDiscountType
  discount_value: string
  max_discount_amount: string
  scope: 'all' | 'some'
  applicable_courses: string[]
  starts_at: string
  ends_at: string
}

function emptyForm(): FormState {
  return {
    editingId: null,
    name: '',
    description: '',
    discount_type: 'percentage',
    discount_value: '',
    max_discount_amount: '',
    scope: 'all',
    applicable_courses: [],
    starts_at: '',
    ends_at: '',
  }
}

// `<input type="datetime-local">` posts back a string like `2026-02-15T00:00`
// in local time. Convert to an ISO string with timezone so Postgres reads it
// unambiguously.
function localInputToIso(value: string): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString()
}

function isoToLocalInput(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromCampaign(c: Campaign): FormState {
  return {
    editingId: c.id,
    name: c.name,
    description: c.description ?? '',
    discount_type: c.discount_type,
    discount_value: String(c.discount_value),
    max_discount_amount: c.max_discount_amount == null ? '' : String(c.max_discount_amount),
    scope: c.applicable_courses == null ? 'all' : 'some',
    applicable_courses: c.applicable_courses ?? [],
    starts_at: isoToLocalInput(c.starts_at),
    ends_at: isoToLocalInput(c.ends_at),
  }
}

function formatDiscount(c: Campaign): string {
  if (c.discount_type === 'percentage') return `-${c.discount_value}%`
  return `-${formatPrice(c.discount_value)}`
}

function formatDateRange(c: Campaign): string {
  const s = new Date(c.starts_at).toLocaleDateString('vi-VN')
  const e = new Date(c.ends_at).toLocaleDateString('vi-VN')
  return `${s} → ${e}`
}

function validate(form: FormState, t: (key: string) => string): string | null {
  if (!form.name.trim()) return t('admin.campaigns.form.errors.nameRequired')
  if (!form.discount_value.trim())
    return t('admin.campaigns.form.errors.discountValueRequired')
  const dv = Number(form.discount_value)
  if (!Number.isInteger(dv) || dv < 0)
    return t('admin.campaigns.form.errors.discountValueNumeric')
  if (form.discount_type === 'percentage' && dv > 100)
    return t('admin.campaigns.form.errors.discountValuePercentRange')
  if (form.max_discount_amount.trim()) {
    const m = Number(form.max_discount_amount)
    if (!Number.isInteger(m) || m <= 0)
      return t('admin.campaigns.form.errors.maxDiscountNumeric')
  }
  if (!form.starts_at) return t('admin.campaigns.form.errors.startsAtRequired')
  if (!form.ends_at) return t('admin.campaigns.form.errors.endsAtRequired')
  if (new Date(form.ends_at).getTime() <= new Date(form.starts_at).getTime())
    return t('admin.campaigns.form.errors.endsAfterStarts')
  if (form.scope === 'some' && form.applicable_courses.length === 0)
    return t('admin.campaigns.form.errors.scopeSomeEmpty')
  return null
}

function toInput(form: FormState): CampaignInput {
  return {
    name: form.name.trim(),
    description: form.description.trim() ? form.description.trim() : null,
    discount_type: form.discount_type,
    discount_value: Number(form.discount_value),
    max_discount_amount:
      form.discount_type === 'percentage' && form.max_discount_amount.trim()
        ? Number(form.max_discount_amount)
        : null,
    applicable_courses: form.scope === 'all' ? null : form.applicable_courses,
    starts_at: localInputToIso(form.starts_at),
    ends_at: localInputToIso(form.ends_at),
  }
}

export default function AdminCampaignsPage() {
  const { t } = useTranslation()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 250)
  const [refetchKey, setRefetchKey] = useState(0)
  const [courses, setCourses] = useState<CoursePickerRow[]>([])

  // Form modal
  const [form, setForm] = useState<FormState | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<Campaign | null>(null)
  const [deactivating, setDeactivating] = useState(false)

  useEffect(() => {
    let cancelled = false
    listCampaigns(supabase, { status, search: debouncedSearch.trim() }).then(
      ({ campaigns: rows, error }) => {
        if (cancelled) return
        if (error) {
          setLoadError(t('admin.campaigns.loadError'))
          setCampaigns([])
        } else {
          setLoadError(null)
          setCampaigns(rows)
        }
        setLoading(false)
      }
    )
    return () => {
      cancelled = true
    }
  }, [status, debouncedSearch, refetchKey, t])

  // Course list is only needed while the modal is open; lazy-fetch on first open.
  useEffect(() => {
    if (!form || courses.length > 0) return
    listAdminCourses(supabase).then(({ courses: rows }) => {
      setCourses(rows)
    })
  }, [form, courses.length])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])

  function openCreate() {
    setForm(emptyForm())
    setFormError(null)
  }
  function openEdit(c: Campaign) {
    setForm(fromCampaign(c))
    setFormError(null)
  }
  function closeForm() {
    setForm(null)
    setFormError(null)
  }

  async function submit() {
    if (!form) return
    const err = validate(form, t)
    if (err) {
      setFormError(err)
      return
    }
    setSaving(true)
    setFormError(null)
    const input = toInput(form)
    const result = form.editingId
      ? await updateCampaign(supabase, form.editingId, input)
      : await createCampaign(supabase, input)
    setSaving(false)
    if (result.error || !result.campaign) {
      const msg = (result.error as { message?: string } | null)?.message ?? ''
      if (msg.includes('campaign_overlap_with_existing')) {
        setFormError(t('admin.campaigns.form.errors.overlap'))
      } else {
        setFormError(t('admin.campaigns.form.errors.submitFailed'))
      }
      return
    }
    closeForm()
    setRefetchKey(k => k + 1)
  }

  async function confirmDeactivate() {
    if (!deactivateTarget) return
    setDeactivating(true)
    const { error } = await deactivateCampaign(supabase, deactivateTarget.id)
    setDeactivating(false)
    setDeactivateTarget(null)
    if (error) {
      setToast(t('admin.campaigns.actionDeactivateError'))
      return
    }
    setToast(t('admin.campaigns.actionDeactivateSuccess'))
    setRefetchKey(k => k + 1)
  }

  const columns = useMemo(
    () => [
      t('admin.campaigns.colName'),
      t('admin.campaigns.colDiscount'),
      t('admin.campaigns.colScope'),
      t('admin.campaigns.colDates'),
      t('admin.campaigns.colStatus'),
      t('admin.campaigns.colOrders'),
      t('admin.campaigns.colActions'),
    ],
    [t]
  )

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center justify-between px-6 border-b border-(--border) bg-(--surface) shrink-0"
        style={{ height: 60 }}
      >
        <h1 className="text-lg font-semibold text-(--ink-1)" style={{ letterSpacing: '-0.01em' }}>
          {t('admin.campaigns.pageTitle')}
        </h1>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          data-testid="admin-campaigns-create-btn"
          onClick={openCreate}
        >
          {t('admin.campaigns.createBtn')}
        </button>
      </div>

      <p className="px-6 pt-4 text-sm text-(--ink-2)" style={{ lineHeight: 1.55 }}>
        {t('admin.campaigns.intro')}
      </p>

      <div className="px-6 pt-3 pb-3 flex items-center gap-3 flex-wrap">
        <select
          data-testid="admin-campaigns-status-filter"
          className="input"
          value={status}
          onChange={e => setStatus(e.target.value as StatusFilter)}
          style={{ height: 36, width: 200 }}
        >
          <option value="all">{t('admin.campaigns.filter.all')}</option>
          <option value="active">{t('admin.campaigns.filter.active')}</option>
          <option value="inactive">{t('admin.campaigns.filter.inactive')}</option>
        </select>
        <input
          type="search"
          data-testid="admin-campaigns-search"
          className="input"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('admin.campaigns.searchPlaceholder')}
          aria-label={t('admin.campaigns.searchPlaceholder')}
          style={{ width: 280, height: 36 }}
        />
      </div>

      <div className="flex-1 px-6 pb-6 overflow-auto">
        {loadError && (
          <div
            role="alert"
            data-testid="admin-campaigns-error"
            style={{
              background: 'var(--danger-soft)',
              color: 'var(--danger)',
              borderRadius: 'var(--r-md)',
              padding: '10px 14px',
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {loadError}
          </div>
        )}

        <div className="card overflow-visible">
          <table className="w-full" style={{ fontSize: 13 }}>
            <thead>
              <tr className="border-b border-(--border)">
                {columns.map((c, i) => (
                  <th
                    key={i}
                    className="px-4 text-left font-medium uppercase text-(--ink-3)"
                    style={{ padding: '14px 16px', fontSize: 11.5, letterSpacing: '0.05em' }}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={columns.length} className="text-center text-(--ink-3) py-10">
                    …
                  </td>
                </tr>
              ) : campaigns.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="text-center text-(--ink-3) py-10"
                    data-testid="admin-campaigns-empty"
                  >
                    {t('admin.campaigns.empty')}
                  </td>
                </tr>
              ) : (
                campaigns.map(c => {
                  const scope =
                    c.applicable_courses == null
                      ? t('admin.campaigns.scopeAll')
                      : t('admin.campaigns.scopeNCourses', {
                          count: c.applicable_courses.length,
                        })
                  return (
                    <tr
                      key={c.id}
                      data-testid={`admin-campaigns-row-${c.id}`}
                      className="border-b border-(--border) last:border-0"
                    >
                      <td style={{ padding: '14px 16px' }}>
                        <div className="font-medium text-(--ink-1)">{c.name}</div>
                        {c.description && (
                          <div
                            className="text-(--ink-3)"
                            style={{ fontSize: 11.5, marginTop: 2 }}
                          >
                            {c.description}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '14px 16px' }} className="text-(--ink-1) font-medium">
                        {formatDiscount(c)}
                      </td>
                      <td style={{ padding: '14px 16px' }} className="text-(--ink-2)">
                        {scope}
                      </td>
                      <td style={{ padding: '14px 16px' }} className="text-(--ink-2)">
                        {formatDateRange(c)}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span className={c.is_active ? 'pill pill-accent' : 'pill'}>
                          {t(
                            c.is_active
                              ? 'admin.campaigns.status.active'
                              : 'admin.campaigns.status.inactive'
                          )}
                        </span>
                      </td>
                      <td
                        style={{ padding: '14px 16px' }}
                        className="text-(--ink-2)"
                        data-testid={`admin-campaigns-orders-count-${c.id}`}
                      >
                        {c.orders_count.toLocaleString('vi-VN')}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div className="flex items-center justify-end gap-2">
                          {c.is_active && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              data-testid={`admin-campaigns-deactivate-${c.id}`}
                              onClick={() => setDeactivateTarget(c)}
                              style={{ color: 'var(--danger)' }}
                            >
                              {t('admin.campaigns.deactivate')}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            data-testid={`admin-campaigns-edit-${c.id}`}
                            onClick={() => openEdit(c)}
                          >
                            {t('admin.campaigns.edit')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ background: 'rgba(20,22,26,0.4)', zIndex: 60 }}
          role="dialog"
          aria-modal="true"
          data-testid="admin-campaigns-form-dialog"
        >
          <div
            className="card"
            style={{
              width: 640,
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 28,
              borderRadius: 'var(--r-lg)',
            }}
          >
            <h2 className="text-lg font-semibold text-(--ink-1) mb-4">
              {t(
                form.editingId
                  ? 'admin.campaigns.form.editTitle'
                  : 'admin.campaigns.form.createTitle'
              )}
            </h2>

            <div className="flex flex-col gap-3">
              <label className="label" htmlFor="campaign-name-input">
                {t('admin.campaigns.form.nameLabel')}
              </label>
              <input
                id="campaign-name-input"
                data-testid="campaign-name-input"
                className="input"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder={t('admin.campaigns.form.namePlaceholder')}
                maxLength={100}
              />

              <label className="label" htmlFor="campaign-description-input">
                {t('admin.campaigns.form.descriptionLabel')}
              </label>
              <textarea
                id="campaign-description-input"
                data-testid="campaign-description-input"
                className="input"
                rows={2}
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder={t('admin.campaigns.form.descriptionPlaceholder')}
                maxLength={500}
              />

              <label className="label">{t('admin.campaigns.form.discountTypeLabel')}</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="discount-type"
                    value="percentage"
                    checked={form.discount_type === 'percentage'}
                    onChange={() => setForm({ ...form, discount_type: 'percentage' })}
                  />
                  {t('admin.campaigns.form.discountTypePercentage')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="discount-type"
                    value="fixed_amount"
                    checked={form.discount_type === 'fixed_amount'}
                    onChange={() => setForm({ ...form, discount_type: 'fixed_amount' })}
                  />
                  {t('admin.campaigns.form.discountTypeFixedAmount')}
                </label>
              </div>

              <label className="label" htmlFor="campaign-discount-value-input">
                {t('admin.campaigns.form.discountValueLabel')}
              </label>
              <input
                id="campaign-discount-value-input"
                data-testid="campaign-discount-value-input"
                className="input"
                inputMode="numeric"
                value={form.discount_value}
                onChange={e => setForm({ ...form, discount_value: e.target.value })}
              />
              <p className="text-(--ink-3)" style={{ fontSize: 11.5 }}>
                {t(
                  form.discount_type === 'percentage'
                    ? 'admin.campaigns.form.discountValuePercentHint'
                    : 'admin.campaigns.form.discountValueFixedHint'
                )}
              </p>

              {form.discount_type === 'percentage' && (
                <>
                  <label className="label" htmlFor="campaign-max-discount-input">
                    {t('admin.campaigns.form.maxDiscountLabel')}
                  </label>
                  <input
                    id="campaign-max-discount-input"
                    data-testid="campaign-max-discount-input"
                    className="input"
                    inputMode="numeric"
                    value={form.max_discount_amount}
                    onChange={e =>
                      setForm({ ...form, max_discount_amount: e.target.value })
                    }
                  />
                  <p className="text-(--ink-3)" style={{ fontSize: 11.5 }}>
                    {t('admin.campaigns.form.maxDiscountHint')}
                  </p>
                </>
              )}

              <label className="label">{t('admin.campaigns.form.scopeLabel')}</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="scope"
                    value="all"
                    data-testid="campaign-scope-all"
                    checked={form.scope === 'all'}
                    onChange={() =>
                      setForm({ ...form, scope: 'all', applicable_courses: [] })
                    }
                  />
                  {t('admin.campaigns.form.scopeAll')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="scope"
                    value="some"
                    data-testid="campaign-scope-some"
                    checked={form.scope === 'some'}
                    onChange={() => setForm({ ...form, scope: 'some' })}
                  />
                  {t('admin.campaigns.form.scopeSome')}
                </label>
              </div>

              {form.scope === 'some' && (
                <CourseMultiSelect
                  courses={courses}
                  selected={form.applicable_courses}
                  onChange={ids => setForm({ ...form, applicable_courses: ids })}
                />
              )}

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="label" htmlFor="campaign-starts-at-input">
                    {t('admin.campaigns.form.startsAtLabel')}
                  </label>
                  <input
                    id="campaign-starts-at-input"
                    data-testid="campaign-starts-at-input"
                    type="datetime-local"
                    className="input w-full"
                    value={form.starts_at}
                    onChange={e => setForm({ ...form, starts_at: e.target.value })}
                  />
                </div>
                <div className="flex-1">
                  <label className="label" htmlFor="campaign-ends-at-input">
                    {t('admin.campaigns.form.endsAtLabel')}
                  </label>
                  <input
                    id="campaign-ends-at-input"
                    data-testid="campaign-ends-at-input"
                    type="datetime-local"
                    className="input w-full"
                    value={form.ends_at}
                    onChange={e => setForm({ ...form, ends_at: e.target.value })}
                  />
                </div>
              </div>

              {formError && (
                <p
                  role="alert"
                  data-testid="admin-campaigns-form-error"
                  style={{
                    background: 'var(--danger-soft)',
                    color: 'var(--danger)',
                    borderRadius: 'var(--r-md)',
                    padding: '10px 14px',
                    fontSize: 13,
                  }}
                >
                  {formError}
                </p>
              )}

              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={closeForm}
                  disabled={saving}
                >
                  {t('admin.campaigns.form.cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  data-testid="admin-campaigns-save-btn"
                  onClick={submit}
                  disabled={saving}
                >
                  {saving ? t('admin.campaigns.form.saving') : t('admin.campaigns.form.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deactivateTarget && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ background: 'rgba(20,22,26,0.4)', zIndex: 60 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-campaigns-deactivate-title"
          data-testid="admin-campaigns-deactivate-dialog"
        >
          <div
            className="card"
            style={{ width: 480, padding: 24, borderRadius: 'var(--r-lg)' }}
          >
            <h2
              id="admin-campaigns-deactivate-title"
              className="text-lg font-semibold text-(--ink-1) mb-2"
            >
              {t('admin.campaigns.deactivateDialogTitle', { name: deactivateTarget.name })}
            </h2>
            <p className="text-sm text-(--ink-2)" style={{ lineHeight: 1.55, marginBottom: 20 }}>
              {t('admin.campaigns.confirmDeactivate')}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-testid="admin-campaigns-deactivate-cancel"
                onClick={() => setDeactivateTarget(null)}
                disabled={deactivating}
              >
                {t('admin.campaigns.deactivateDialogCancel')}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                data-testid="admin-campaigns-deactivate-confirm"
                onClick={confirmDeactivate}
                disabled={deactivating}
                style={{ background: 'var(--danger)', color: '#fff' }}
              >
                {deactivating
                  ? t('admin.campaigns.deactivateDialogPending')
                  : t('admin.campaigns.deactivateDialogConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div data-testid="admin-campaigns-toast" className="toast toast-success">
          {toast}
        </div>
      )}
    </div>
  )
}
