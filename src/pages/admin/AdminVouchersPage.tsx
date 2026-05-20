import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import {
  listVouchers,
  createVoucher,
  updateVoucher,
  deactivateVoucher,
  deleteVoucher,
  getVoucherUsages,
  formatVoucherDiscount,
} from '../../lib/vouchersApi'
import type {
  Voucher,
  VoucherDiscountType,
  VoucherInput,
  VoucherUsage,
} from '../../lib/vouchersApi'
import { listAdminCourses, listCampaigns } from '../../lib/campaignsApi'
import type { Campaign, CoursePickerRow } from '../../lib/campaignsApi'
import { useDebounce } from '../../hooks/useDebounce'
import CourseMultiSelect from '../../components/admin/CourseMultiSelect'

type StatusFilter = 'all' | 'active' | 'inactive'

interface FormState {
  editingId: string | null
  totalUsesAtOpen: number
  code: string
  discount_type: VoucherDiscountType
  discount_value: string
  max_discount_amount: string
  scope: 'all' | 'some'
  applicable_courses: string[]
  total_quota: string
  per_user_limit: string
  starts_at: string
  ends_at: string
  campaign_id: string
}

const VOUCHER_CODE_REGEX = /^[A-Z0-9]{6,20}$/

function emptyForm(): FormState {
  return {
    editingId: null,
    totalUsesAtOpen: 0,
    code: '',
    discount_type: 'percentage',
    discount_value: '',
    max_discount_amount: '',
    scope: 'all',
    applicable_courses: [],
    total_quota: '',
    per_user_limit: '1',
    starts_at: '',
    ends_at: '',
    campaign_id: '',
  }
}

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

function fromVoucher(v: Voucher): FormState {
  return {
    editingId: v.id,
    totalUsesAtOpen: v.total_uses,
    code: v.code,
    discount_type: v.discount_type,
    discount_value: String(v.discount_value),
    max_discount_amount: v.max_discount_amount == null ? '' : String(v.max_discount_amount),
    scope: v.applicable_courses == null ? 'all' : 'some',
    applicable_courses: v.applicable_courses ?? [],
    total_quota: v.total_quota == null ? '' : String(v.total_quota),
    per_user_limit: String(v.per_user_limit),
    starts_at: isoToLocalInput(v.starts_at),
    ends_at: isoToLocalInput(v.ends_at),
    campaign_id: v.campaign_id ?? '',
  }
}

function formatDateRange(v: Voucher): string {
  const s = new Date(v.starts_at).toLocaleDateString('vi-VN')
  const e = new Date(v.ends_at).toLocaleDateString('vi-VN')
  return `${s} → ${e}`
}

function validate(form: FormState, t: (key: string) => string): string | null {
  if (!form.code.trim()) return t('admin.vouchers.form.errors.codeRequired')
  if (!VOUCHER_CODE_REGEX.test(form.code.trim()))
    return t('admin.vouchers.form.errors.codeInvalidFormat')
  if (!form.discount_value.trim())
    return t('admin.vouchers.form.errors.discountValueRequired')
  const dv = Number(form.discount_value)
  if (!Number.isInteger(dv) || dv < 0)
    return t('admin.vouchers.form.errors.discountValueNumeric')
  if (form.discount_type === 'percentage' && dv > 100)
    return t('admin.vouchers.form.errors.discountValuePercentRange')
  if (form.max_discount_amount.trim()) {
    const m = Number(form.max_discount_amount)
    if (!Number.isInteger(m) || m <= 0)
      return t('admin.vouchers.form.errors.maxDiscountNumeric')
  }
  if (form.total_quota.trim()) {
    const q = Number(form.total_quota)
    if (!Number.isInteger(q) || q <= 0)
      return t('admin.vouchers.form.errors.totalQuotaNumeric')
  }
  const pul = Number(form.per_user_limit)
  if (!Number.isInteger(pul) || pul < 1)
    return t('admin.vouchers.form.errors.perUserLimitNumeric')
  if (!form.starts_at) return t('admin.vouchers.form.errors.startsAtRequired')
  if (!form.ends_at) return t('admin.vouchers.form.errors.endsAtRequired')
  if (new Date(form.ends_at).getTime() <= new Date(form.starts_at).getTime())
    return t('admin.vouchers.form.errors.endsAfterStarts')
  if (form.scope === 'some' && form.applicable_courses.length === 0)
    return t('admin.vouchers.form.errors.scopeSomeEmpty')
  return null
}

function toInput(form: FormState): VoucherInput {
  return {
    code: form.code.trim().toUpperCase(),
    discount_type: form.discount_type,
    discount_value: Number(form.discount_value),
    max_discount_amount:
      form.discount_type === 'percentage' && form.max_discount_amount.trim()
        ? Number(form.max_discount_amount)
        : null,
    applicable_courses: form.scope === 'all' ? null : form.applicable_courses,
    total_quota: form.total_quota.trim() ? Number(form.total_quota) : null,
    per_user_limit: Number(form.per_user_limit),
    starts_at: localInputToIso(form.starts_at),
    ends_at: localInputToIso(form.ends_at),
    campaign_id: form.campaign_id ? form.campaign_id : null,
  }
}

export default function AdminVouchersPage() {
  const { t } = useTranslation()
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 250)
  const [refetchKey, setRefetchKey] = useState(0)
  const [courses, setCourses] = useState<CoursePickerRow[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])

  const [form, setForm] = useState<FormState | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const [drawerVoucher, setDrawerVoucher] = useState<Voucher | null>(null)
  const [drawerUsages, setDrawerUsages] = useState<VoucherUsage[]>([])
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [drawerError, setDrawerError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listVouchers(supabase, { status, search: debouncedSearch.trim() }).then(
      ({ vouchers: rows, error }) => {
        if (cancelled) return
        if (error) {
          setLoadError(t('admin.vouchers.loadError'))
          setVouchers([])
        } else {
          setLoadError(null)
          setVouchers(rows)
        }
        setLoading(false)
      }
    )
    return () => {
      cancelled = true
    }
  }, [status, debouncedSearch, refetchKey, t])

  useEffect(() => {
    if (!form) return
    if (courses.length === 0) {
      listAdminCourses(supabase).then(({ courses: rows }) => setCourses(rows))
    }
    if (campaigns.length === 0) {
      listCampaigns(supabase, {}).then(({ campaigns: rows }) => setCampaigns(rows))
    }
  }, [form, courses.length, campaigns.length])

  useEffect(() => {
    if (!drawerVoucher) return
    let cancelled = false
    getVoucherUsages(supabase, drawerVoucher.id).then(({ usages, error }) => {
      if (cancelled) return
      if (error) {
        setDrawerError(t('admin.vouchers.drawer.loadError'))
        setDrawerUsages([])
      } else {
        setDrawerError(null)
        setDrawerUsages(usages)
      }
      setDrawerLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [drawerVoucher, t])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])

  function openCreate() {
    setForm(emptyForm())
    setFormError(null)
  }
  function openEdit(v: Voucher) {
    setForm(fromVoucher(v))
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
      ? await updateVoucher(supabase, form.editingId, input)
      : await createVoucher(supabase, input)
    setSaving(false)
    if (result.error || !result.voucher) {
      const msg = (result.error as { message?: string } | null)?.message ?? ''
      if (msg.includes('voucher_code_already_exists')) {
        setFormError(t('admin.vouchers.form.errors.codeAlreadyExists'))
      } else if (msg.includes('voucher_code_invalid_format')) {
        setFormError(t('admin.vouchers.form.errors.codeInvalidFormat'))
      } else if (msg.includes('voucher_course_not_found')) {
        setFormError(t('admin.vouchers.form.errors.courseNotFound'))
      } else if (msg.includes('voucher_locked_after_use')) {
        setFormError(t('admin.vouchers.form.errors.lockedAfterUse'))
      } else {
        setFormError(t('admin.vouchers.form.errors.submitFailed'))
      }
      return
    }
    closeForm()
    setRefetchKey(k => k + 1)
  }

  async function handleDeactivate(v: Voucher) {
    const { error } = await deactivateVoucher(supabase, v.id)
    if (error) {
      setToast(t('admin.vouchers.actionDeactivateError'))
      return
    }
    setToast(t('admin.vouchers.actionDeactivateSuccess'))
    setRefetchKey(k => k + 1)
  }

  async function handleDelete(v: Voucher) {
    if (v.total_uses > 0) return
    if (!window.confirm(t('admin.vouchers.confirmDelete'))) return
    const { error } = await deleteVoucher(supabase, v.id)
    if (error) {
      setToast(t('admin.vouchers.actionDeleteError'))
      return
    }
    setToast(t('admin.vouchers.actionDeleteSuccess'))
    setRefetchKey(k => k + 1)
  }

  const columns = useMemo(
    () => [
      t('admin.vouchers.colCode'),
      t('admin.vouchers.colDiscount'),
      t('admin.vouchers.colQuota'),
      t('admin.vouchers.colPerUserLimit'),
      t('admin.vouchers.colDates'),
      t('admin.vouchers.colStatus'),
      t('admin.vouchers.colActions'),
    ],
    [t]
  )

  const locked = (form?.totalUsesAtOpen ?? 0) > 0

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center justify-between px-6 border-b border-(--border) bg-(--surface) shrink-0"
        style={{ height: 60 }}
      >
        <h1 className="text-lg font-semibold text-(--ink-1)" style={{ letterSpacing: '-0.01em' }}>
          {t('admin.vouchers.pageTitle')}
        </h1>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          data-testid="admin-vouchers-create-btn"
          onClick={openCreate}
        >
          {t('admin.vouchers.createBtn')}
        </button>
      </div>

      <p className="px-6 pt-4 text-sm text-(--ink-2)" style={{ lineHeight: 1.55, maxWidth: 720 }}>
        {t('admin.vouchers.intro')}
      </p>

      <div className="px-6 pt-3 pb-3 flex items-center gap-3 flex-wrap">
        <select
          data-testid="admin-vouchers-status-filter"
          className="input"
          value={status}
          onChange={e => setStatus(e.target.value as StatusFilter)}
          style={{ height: 36, width: 200 }}
        >
          <option value="all">{t('admin.vouchers.filter.all')}</option>
          <option value="active">{t('admin.vouchers.filter.active')}</option>
          <option value="inactive">{t('admin.vouchers.filter.inactive')}</option>
        </select>
        <input
          type="search"
          data-testid="admin-vouchers-search"
          className="input"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('admin.vouchers.searchPlaceholder')}
          aria-label={t('admin.vouchers.searchPlaceholder')}
          style={{ width: 280, height: 36 }}
        />
      </div>

      <div className="flex-1 px-6 pb-6 overflow-auto">
        {loadError && (
          <div
            role="alert"
            data-testid="admin-vouchers-error"
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
              ) : vouchers.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="text-center text-(--ink-3) py-10"
                    data-testid="admin-vouchers-empty"
                  >
                    {t('admin.vouchers.empty')}
                  </td>
                </tr>
              ) : (
                vouchers.map(v => {
                  const quotaLabel =
                    v.total_quota == null
                      ? `${v.total_uses} / ∞`
                      : `${v.total_uses} / ${v.total_quota}`
                  const quotaPct =
                    v.total_quota == null || v.total_quota === 0
                      ? 0
                      : Math.min(100, Math.round((v.total_uses / v.total_quota) * 100))
                  const isLocked = v.total_uses > 0
                  return (
                    <tr
                      key={v.id}
                      data-testid={`admin-vouchers-row-${v.id}`}
                      className="border-b border-(--border) last:border-0"
                    >
                      <td style={{ padding: '14px 16px' }}>
                        <button
                          type="button"
                          data-testid={`admin-vouchers-row-open-${v.id}`}
                          onClick={() => {
                            setDrawerVoucher(v)
                            setDrawerLoading(true)
                            setDrawerUsages([])
                            setDrawerError(null)
                          }}
                          className="font-mono text-(--ink-1) hover:underline"
                          style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                        >
                          {v.code}
                        </button>
                      </td>
                      <td
                        style={{ padding: '14px 16px' }}
                        className="text-(--ink-1) font-medium"
                      >
                        {formatVoucherDiscount(v)}
                      </td>
                      <td style={{ padding: '14px 16px' }} className="text-(--ink-2)">
                        <div>{quotaLabel}</div>
                        {v.total_quota != null && (
                          <div
                            style={{
                              height: 4,
                              borderRadius: 999,
                              background: 'var(--surface-2)',
                              marginTop: 4,
                              overflow: 'hidden',
                              width: 100,
                            }}
                          >
                            <div
                              style={{
                                height: '100%',
                                width: `${quotaPct}%`,
                                background: 'var(--accent)',
                              }}
                            />
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '14px 16px' }} className="text-(--ink-2)">
                        {t('admin.vouchers.perUserLimit', { count: v.per_user_limit })}
                      </td>
                      <td style={{ padding: '14px 16px' }} className="text-(--ink-2)">
                        {formatDateRange(v)}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span className={v.is_active ? 'pill pill-accent' : 'pill'}>
                          {t(
                            v.is_active
                              ? 'admin.vouchers.status.active'
                              : 'admin.vouchers.status.inactive'
                          )}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            data-testid={`admin-vouchers-edit-${v.id}`}
                            onClick={() => openEdit(v)}
                          >
                            {t('admin.vouchers.edit')}
                          </button>
                          {v.is_active && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              data-testid={`admin-vouchers-deactivate-${v.id}`}
                              onClick={() => handleDeactivate(v)}
                              style={{ color: 'var(--danger)' }}
                            >
                              {t('admin.vouchers.deactivate')}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            data-testid={`admin-vouchers-delete-${v.id}`}
                            onClick={() => handleDelete(v)}
                            disabled={isLocked}
                            title={isLocked ? t('admin.vouchers.deleteLockedTooltip') : undefined}
                            style={{ color: 'var(--danger)' }}
                          >
                            {t('admin.vouchers.delete')}
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
          data-testid="admin-vouchers-form-dialog"
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
                  ? 'admin.vouchers.form.editTitle'
                  : 'admin.vouchers.form.createTitle'
              )}
            </h2>

            <div className="flex flex-col gap-3">
              <label className="label" htmlFor="voucher-code-input">
                {t('admin.vouchers.form.codeLabel')}
              </label>
              <input
                id="voucher-code-input"
                data-testid="voucher-code-input"
                className="input"
                value={form.code}
                onChange={e =>
                  setForm({ ...form, code: e.target.value.toUpperCase() })
                }
                placeholder={t('admin.vouchers.form.codePlaceholder')}
                maxLength={20}
                disabled={locked}
                title={locked ? t('admin.vouchers.lockedFieldTooltip') : undefined}
                style={{ fontFamily: 'var(--font-mono, monospace)' }}
              />
              <p className="text-(--ink-3)" style={{ fontSize: 11.5 }}>
                {t('admin.vouchers.form.codeHint')}
              </p>

              <label className="label">{t('admin.vouchers.form.discountTypeLabel')}</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="voucher-discount-type"
                    value="percentage"
                    data-testid="voucher-discount-type-percentage"
                    checked={form.discount_type === 'percentage'}
                    onChange={() => setForm({ ...form, discount_type: 'percentage' })}
                    disabled={locked}
                  />
                  {t('admin.vouchers.form.discountTypePercentage')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="voucher-discount-type"
                    value="fixed_amount"
                    data-testid="voucher-discount-type-fixed"
                    checked={form.discount_type === 'fixed_amount'}
                    onChange={() => setForm({ ...form, discount_type: 'fixed_amount' })}
                    disabled={locked}
                  />
                  {t('admin.vouchers.form.discountTypeFixedAmount')}
                </label>
              </div>

              <label className="label" htmlFor="voucher-discount-value-input">
                {t('admin.vouchers.form.discountValueLabel')}
              </label>
              <input
                id="voucher-discount-value-input"
                data-testid="voucher-discount-value-input"
                className="input"
                inputMode="numeric"
                value={form.discount_value}
                onChange={e => setForm({ ...form, discount_value: e.target.value })}
                disabled={locked}
                title={locked ? t('admin.vouchers.lockedFieldTooltip') : undefined}
              />
              <p className="text-(--ink-3)" style={{ fontSize: 11.5 }}>
                {t(
                  form.discount_type === 'percentage'
                    ? 'admin.vouchers.form.discountValuePercentHint'
                    : 'admin.vouchers.form.discountValueFixedHint'
                )}
              </p>

              {form.discount_type === 'percentage' && (
                <>
                  <label className="label" htmlFor="voucher-max-discount-input">
                    {t('admin.vouchers.form.maxDiscountLabel')}
                  </label>
                  <input
                    id="voucher-max-discount-input"
                    data-testid="voucher-max-discount-input"
                    className="input"
                    inputMode="numeric"
                    value={form.max_discount_amount}
                    onChange={e =>
                      setForm({ ...form, max_discount_amount: e.target.value })
                    }
                    disabled={locked}
                  />
                  <p className="text-(--ink-3)" style={{ fontSize: 11.5 }}>
                    {t('admin.vouchers.form.maxDiscountHint')}
                  </p>
                </>
              )}

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="label" htmlFor="voucher-total-quota-input">
                    {t('admin.vouchers.form.totalQuotaLabel')}
                  </label>
                  <input
                    id="voucher-total-quota-input"
                    data-testid="voucher-total-quota-input"
                    className="input w-full"
                    inputMode="numeric"
                    value={form.total_quota}
                    onChange={e => setForm({ ...form, total_quota: e.target.value })}
                    placeholder={t('admin.vouchers.quotaUnlimited')}
                  />
                  <p className="text-(--ink-3)" style={{ fontSize: 11.5 }}>
                    {t('admin.vouchers.form.totalQuotaHint')}
                  </p>
                </div>
                <div className="flex-1">
                  <label className="label" htmlFor="voucher-per-user-limit-input">
                    {t('admin.vouchers.form.perUserLimitLabel')}
                  </label>
                  <input
                    id="voucher-per-user-limit-input"
                    data-testid="voucher-per-user-limit-input"
                    className="input w-full"
                    inputMode="numeric"
                    value={form.per_user_limit}
                    onChange={e =>
                      setForm({ ...form, per_user_limit: e.target.value })
                    }
                    disabled={locked}
                    title={locked ? t('admin.vouchers.lockedFieldTooltip') : undefined}
                  />
                  <p className="text-(--ink-3)" style={{ fontSize: 11.5 }}>
                    {t('admin.vouchers.form.perUserLimitHint')}
                  </p>
                </div>
              </div>

              <label className="label">{t('admin.vouchers.form.scopeLabel')}</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="voucher-scope"
                    value="all"
                    data-testid="voucher-scope-all"
                    checked={form.scope === 'all'}
                    onChange={() =>
                      setForm({ ...form, scope: 'all', applicable_courses: [] })
                    }
                  />
                  {t('admin.vouchers.form.scopeAll')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="voucher-scope"
                    value="some"
                    data-testid="voucher-scope-some"
                    checked={form.scope === 'some'}
                    onChange={() => setForm({ ...form, scope: 'some' })}
                  />
                  {t('admin.vouchers.form.scopeSome')}
                </label>
              </div>

              {form.scope === 'some' && (
                <CourseMultiSelect
                  courses={courses}
                  selected={form.applicable_courses}
                  onChange={ids => setForm({ ...form, applicable_courses: ids })}
                />
              )}

              <label className="label" htmlFor="voucher-campaign-select">
                {t('admin.vouchers.form.campaignLabel')}
              </label>
              <select
                id="voucher-campaign-select"
                data-testid="voucher-campaign-select"
                className="input"
                value={form.campaign_id}
                onChange={e => setForm({ ...form, campaign_id: e.target.value })}
                style={{ height: 36 }}
              >
                <option value="">{t('admin.vouchers.form.campaignNone')}</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="label" htmlFor="voucher-starts-at-input">
                    {t('admin.vouchers.form.startsAtLabel')}
                  </label>
                  <input
                    id="voucher-starts-at-input"
                    data-testid="voucher-starts-at-input"
                    type="datetime-local"
                    className="input w-full"
                    value={form.starts_at}
                    onChange={e => setForm({ ...form, starts_at: e.target.value })}
                    disabled={locked}
                    title={locked ? t('admin.vouchers.lockedFieldTooltip') : undefined}
                  />
                </div>
                <div className="flex-1">
                  <label className="label" htmlFor="voucher-ends-at-input">
                    {t('admin.vouchers.form.endsAtLabel')}
                  </label>
                  <input
                    id="voucher-ends-at-input"
                    data-testid="voucher-ends-at-input"
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
                  data-testid="admin-vouchers-form-error"
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
                  {t('admin.vouchers.form.cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  data-testid="admin-vouchers-save-btn"
                  onClick={submit}
                  disabled={saving}
                >
                  {saving ? t('admin.vouchers.form.saving') : t('admin.vouchers.form.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {drawerVoucher && (
        <div
          className="fixed inset-0 flex justify-end"
          style={{ background: 'rgba(20,22,26,0.4)', zIndex: 55 }}
          role="dialog"
          aria-modal="true"
          data-testid="admin-vouchers-drawer"
          onClick={() => {
            setDrawerVoucher(null)
            setDrawerLoading(false)
          }}
        >
          <div
            className="bg-(--surface) border-l border-(--border)"
            style={{
              width: 480,
              height: '100%',
              padding: 24,
              overflowY: 'auto',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <p
                  className="text-(--ink-3) uppercase font-medium tracking-widest"
                  style={{ fontSize: 11 }}
                >
                  {t('admin.vouchers.drawer.title')}
                </p>
                <h2 className="text-lg font-semibold font-mono text-(--ink-1)">
                  {drawerVoucher.code}
                </h2>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setDrawerVoucher(null)
                  setDrawerLoading(false)
                }}
                data-testid="admin-vouchers-drawer-close"
              >
                {t('admin.vouchers.drawer.close')}
              </button>
            </div>

            {drawerError && (
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
                {drawerError}
              </div>
            )}

            {drawerLoading ? (
              <p className="text-(--ink-3) text-center py-10">…</p>
            ) : drawerUsages.length === 0 ? (
              <p
                data-testid="admin-vouchers-drawer-empty"
                className="text-(--ink-3) text-center py-10"
              >
                {t('admin.vouchers.drawer.empty')}
              </p>
            ) : (
              <table className="w-full" style={{ fontSize: 13 }}>
                <thead>
                  <tr className="border-b border-(--border)">
                    <th
                      className="text-left font-medium uppercase text-(--ink-3)"
                      style={{ padding: '10px 8px', fontSize: 11 }}
                    >
                      {t('admin.vouchers.drawer.colUser')}
                    </th>
                    <th
                      className="text-left font-medium uppercase text-(--ink-3)"
                      style={{ padding: '10px 8px', fontSize: 11 }}
                    >
                      {t('admin.vouchers.drawer.colOrder')}
                    </th>
                    <th
                      className="text-right font-medium uppercase text-(--ink-3)"
                      style={{ padding: '10px 8px', fontSize: 11 }}
                    >
                      {t('admin.vouchers.drawer.colDiscount')}
                    </th>
                    <th
                      className="text-left font-medium uppercase text-(--ink-3)"
                      style={{ padding: '10px 8px', fontSize: 11 }}
                    >
                      {t('admin.vouchers.drawer.colUsedAt')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {drawerUsages.map(u => {
                    const initial = (u.user?.name ?? u.user?.email ?? '?')
                      .charAt(0)
                      .toUpperCase()
                    return (
                      <tr
                        key={u.id}
                        data-testid={`admin-vouchers-usage-${u.id}`}
                        className="border-b border-(--border) last:border-0"
                      >
                        <td style={{ padding: '10px 8px' }}>
                          <div className="flex items-center gap-2">
                            <div
                              className="avatar shrink-0"
                              aria-hidden="true"
                              style={{ width: 24, height: 24, fontSize: 11 }}
                            >
                              {initial}
                            </div>
                            <div className="text-(--ink-1) truncate" style={{ maxWidth: 160 }}>
                              {u.user?.email ?? u.user_id}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '10px 8px' }} className="font-mono text-(--ink-2)">
                          {u.order?.code ?? '—'}
                        </td>
                        <td
                          style={{ padding: '10px 8px', textAlign: 'right' }}
                          className="text-(--ink-1)"
                        >
                          -{u.discount_amount.toLocaleString('de-DE')}₫
                        </td>
                        <td style={{ padding: '10px 8px' }} className="text-(--ink-3)">
                          {new Date(u.used_at).toLocaleString('vi-VN')}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div data-testid="admin-vouchers-toast" className="toast toast-success">
          {toast}
        </div>
      )}
    </div>
  )
}
