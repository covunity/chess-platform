import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import {
  listPendingOrders,
  listAllOrders,
  listStalePendingOrders,
  getStalePendingOrderCount,
  listRefundPendingOrders,
  getRefundPendingOrderCount,
  markOrderRefunded,
  type AdminOrderRow,
  type DiscountFilter,
} from '../../lib/adminOrdersApi'
import { confirmOrder, cancelOrder } from '../../lib/orderApi'
import type { OrderStatus } from '../../lib/orderApi'
import { useDebounce } from '../../hooks/useDebounce'
import { maskAccount } from '../../lib/bankAccount'

type Tab = 'pending' | 'stale' | 'refund' | 'all'
const PAGE_SIZE = 20

const STATUS_PILL: Record<OrderStatus, string> = {
  pending: 'pill',
  active: 'pill pill-accent',
  cancelled: 'pill',
  expired: 'pill',
  refund_pending: 'pill',
  refunded: 'pill',
}

function formatVnd(n: number): string {
  return `${n.toLocaleString('en-US')} ₫`
}

function formatRelative(iso: string, now = new Date()): string {
  const then = new Date(iso)
  const diff = (now.getTime() - then.getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

interface CancelDialogProps {
  order: AdminOrderRow
  saving: boolean
  errorMsg: string | null
  onCancel: () => void
  onConfirm: (reason: string) => void
  t: (k: string) => string
}

function CancelDialog({ order, saving, errorMsg, onCancel, onConfirm, t }: CancelDialogProps) {
  const [reason, setReason] = useState('')
  const trimmedLength = reason.trim().length
  const tooLong = reason.length > 500
  const canSubmit = trimmedLength > 0 && !tooLong && !saving

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(20,22,26,0.4)', zIndex: 50 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-dialog-title"
      data-testid="cancel-dialog"
    >
      <div className="card" style={{ width: 480, borderRadius: 'var(--r-lg)', padding: 28 }}>
        <h2 id="cancel-dialog-title" className="text-lg font-semibold text-(--ink-1) mb-3">
          {t('admin.orders.cancelDialog.title')}
        </h2>
        <p className="text-sm text-(--ink-2) mb-4">
          {t('admin.orders.cancelDialog.body')} <span className="font-mono">{order.code}</span>
        </p>

        <label className="label mb-1 block" htmlFor="cancel-reason">
          {t('admin.orders.cancelDialog.reasonLabel')}
        </label>
        <textarea
          id="cancel-reason"
          data-testid="cancel-reason-textarea"
          className="input w-full"
          rows={4}
          maxLength={500}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder={t('admin.orders.cancelDialog.reasonPlaceholder')}
        />
        <div className="flex justify-between mt-1" style={{ fontSize: 11.5 }}>
          <span className="text-(--ink-3)">
            {tooLong
              ? t('admin.orders.cancelDialog.tooLong')
              : t('admin.orders.cancelDialog.charCount').replace('{n}', String(reason.length))}
          </span>
        </div>

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
            {t('admin.orders.cancelDialog.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            data-testid="cancel-dialog-confirm"
            onClick={() => onConfirm(reason.trim())}
            disabled={!canSubmit}
          >
            {t('admin.orders.cancelDialog.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

interface RefundDialogProps {
  order: AdminOrderRow
  saving: boolean
  errorMsg: string | null
  onCancel: () => void
  onConfirm: (reference: string) => void
  t: (k: string) => string
}

function RefundDialog({ order, saving, errorMsg, onCancel, onConfirm, t }: RefundDialogProps) {
  const [reference, setReference] = useState('')
  const trimmedLength = reference.trim().length
  const canSubmit = trimmedLength > 0 && !saving

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(20,22,26,0.4)', zIndex: 50 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="refund-dialog-title"
      data-testid="refund-dialog"
    >
      <div className="card" style={{ width: 480, borderRadius: 'var(--r-lg)', padding: 28 }}>
        <h2 id="refund-dialog-title" className="text-lg font-semibold text-(--ink-1) mb-3">
          {t('admin.orders.refund.dialogTitle')}
        </h2>
        <p className="text-sm text-(--ink-2) mb-4">
          {t('admin.orders.refund.dialogBody')}{' '}
          <span className="font-mono">{order.code}</span>
        </p>

        <label className="label mb-1 block" htmlFor="refund-reference">
          {t('admin.orders.refund.referenceLabel')}
        </label>
        <input
          id="refund-reference"
          type="text"
          data-testid="refund-reference-input"
          className="input w-full"
          value={reference}
          onChange={e => setReference(e.target.value)}
          placeholder={t('admin.orders.refund.referencePlaceholder')}
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
            {t('admin.orders.refund.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="refund-dialog-confirm"
            onClick={() => onConfirm(reference.trim())}
            disabled={!canSubmit}
          >
            {t('admin.orders.refund.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ManualConfirmDialogProps {
  order: AdminOrderRow
  saving: boolean
  errorMsg: string | null
  onCancel: () => void
  onConfirm: (reason: string) => void
  t: (k: string) => string
}

function ManualConfirmDialog({ order, saving, errorMsg, onCancel, onConfirm, t }: ManualConfirmDialogProps) {
  const [reason, setReason] = useState('')
  const trimmedLength = reason.trim().length
  const canSubmit = trimmedLength > 0 && !saving

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(20,22,26,0.4)', zIndex: 50 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-confirm-dialog-title"
      data-testid="manual-confirm-dialog"
    >
      <div className="card" style={{ width: 480, borderRadius: 'var(--r-lg)', padding: 28 }}>
        <h2 id="manual-confirm-dialog-title" className="text-lg font-semibold text-(--ink-1) mb-3">
          {t('admin.orders.manualConfirm.dialogTitle')}
        </h2>
        <p className="text-sm text-(--ink-2) mb-4">
          {t('admin.orders.manualConfirm.dialogBody')} <span className="font-mono">{order.code}</span>
        </p>

        <label className="label mb-1 block" htmlFor="manual-confirm-reason">
          {t('admin.orders.manualConfirm.reasonLabel')}
        </label>
        <textarea
          id="manual-confirm-reason"
          data-testid="manual-confirm-reason-textarea"
          className="input w-full"
          rows={4}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder={t('admin.orders.manualConfirm.reasonPlaceholder')}
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
            {t('admin.orders.manualConfirm.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="manual-confirm-dialog-confirm"
            onClick={() => onConfirm(reason.trim())}
            disabled={!canSubmit}
          >
            {t('admin.orders.manualConfirm.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminOrdersPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('pending')
  const [orders, setOrders] = useState<AdminOrderRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  // All-tab filters
  const [statusFilter, setStatusFilter] = useState<'' | OrderStatus>('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  // PRD-0006 slice 5: discount-visibility chips on All tab. Single-value
  // (chips are mutually exclusive — a row can't both have-voucher AND
  // have-no-discount). Clicking the active chip clears the filter.
  const [discountFilter, setDiscountFilter] = useState<DiscountFilter | null>(null)
  // PRD-0006 slice 5: per-row inline breakdown expansion. Keyed by order id.
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)

  // Cancel dialog state
  const [cancelTarget, setCancelTarget] = useState<AdminOrderRow | null>(null)
  const [cancelSaving, setCancelSaving] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  // Manual-confirm dialog state (Cần can thiệp tab)
  const [manualConfirmTarget, setManualConfirmTarget] = useState<AdminOrderRow | null>(null)
  const [manualConfirmSaving, setManualConfirmSaving] = useState(false)
  const [manualConfirmError, setManualConfirmError] = useState<string | null>(null)

  // Tab counter for stale-pending ("Cần can thiệp")
  const [staleCount, setStaleCount] = useState(0)

  // Tab counter for refund_pending ("Cần refund")
  const [refundCount, setRefundCount] = useState(0)

  // Refund dialog state ("Đánh dấu hoàn tiền")
  const [refundTarget, setRefundTarget] = useState<AdminOrderRow | null>(null)
  const [refundSaving, setRefundSaving] = useState(false)
  const [refundError, setRefundError] = useState<string | null>(null)

  // Kebab menu state — track which row's menu is open
  const [menuFor, setMenuFor] = useState<string | null>(null)

  const [toast, setToast] = useState<'success' | 'error' | 'manualSuccess' | 'refundSuccess' | null>(null)
  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Refresh the stale-pending counter — called on mount and after any
  // confirm/cancel action that might affect the count.
  const refreshStaleCount = useCallback(async () => {
    const { count } = await getStalePendingOrderCount(supabase)
    setStaleCount(count)
  }, [])

  const refreshRefundCount = useCallback(async () => {
    const { count } = await getRefundPendingOrderCount(supabase)
    setRefundCount(count)
  }, [])

  // Issue #296: refresh both counters together — used on mount, on tab
  // visibility, and on tab click. PRD-0005 §5.8 forbids polling so we rely on
  // user-driven events (visibilitychange + tab click) plus the existing
  // post-action refreshes after confirm/cancel/refund.
  const refreshAdminCounters = useCallback(async () => {
    await Promise.all([refreshStaleCount(), refreshRefundCount()])
  }, [refreshStaleCount, refreshRefundCount])

  useEffect(() => {
    let cancelled = false
    if (tab === 'pending') {
      listPendingOrders(supabase, { page, pageSize: PAGE_SIZE }).then(({ orders: rows, total: tot }) => {
        if (!cancelled) { setOrders(rows); setTotal(tot); setLoading(false) }
      })
    } else if (tab === 'stale') {
      listStalePendingOrders(supabase, { page, pageSize: PAGE_SIZE }).then(({ orders: rows, total: tot }) => {
        if (!cancelled) { setOrders(rows); setTotal(tot); setLoading(false) }
      })
    } else if (tab === 'refund') {
      listRefundPendingOrders(supabase, { page, pageSize: PAGE_SIZE }).then(({ orders: rows, total: tot }) => {
        if (!cancelled) { setOrders(rows); setTotal(tot); setLoading(false) }
      })
    } else {
      listAllOrders(supabase, {
        status: statusFilter || undefined,
        search: debouncedSearch || undefined,
        discountFilter: discountFilter ?? undefined,
        page,
        pageSize: PAGE_SIZE,
      }).then(({ orders: rows, total: tot }) => {
        if (!cancelled) { setOrders(rows); setTotal(tot); setLoading(false) }
      })
    }
    return () => { cancelled = true }
  }, [tab, page, statusFilter, debouncedSearch, discountFilter])

  // Fetch both admin counters on mount and again whenever the tab regains
  // focus. Issue #296: an order can cross the 1h stale threshold while the
  // admin sits on this page — without a focus-driven refresh the counter is
  // stale until the next confirm/cancel/refund action. No polling
  // (PRD-0005 §5.8) — we drive refreshes off `visibilitychange` instead.
  useEffect(() => {
    void refreshAdminCounters()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refreshAdminCounters()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refreshAdminCounters])

  // Auto-dismiss toasts
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])

  function switchTab(next: Tab) {
    setTab(next)
    setPage(1)
    // Issue #296: clicking the "Cần can thiệp" / "Cần refund" tabs is a strong
    // signal the admin wants the freshest count — refresh the relevant
    // counter on each click. Listing the rows is handled by the tab-driven
    // useEffect above; this just keeps the tab badge in sync.
    if (next === 'stale') {
      void refreshStaleCount()
    } else if (next === 'refund') {
      void refreshRefundCount()
    }
  }

  async function handleManualConfirmSubmit(reason: string) {
    if (!manualConfirmTarget) return
    if (reason.length === 0) return
    setManualConfirmSaving(true)
    setManualConfirmError(null)
    // Issue #293: forward the dialog reason to the `confirm_order` RPC so it
    // lands in `orders.manual_confirm_reason` for audit. Previously this was
    // console.info'd and discarded.
    const { order, error } = await confirmOrder(supabase, manualConfirmTarget.id, reason)
    setManualConfirmSaving(false)
    if (error || !order) {
      setManualConfirmError(t('admin.orders.actionError'))
      return
    }
    setOrders(prev => {
      if (tab === 'pending' || tab === 'stale') return prev.filter(o => o.id !== manualConfirmTarget.id)
      return prev.map(o => (o.id === manualConfirmTarget.id ? { ...o, ...order } : o))
    })
    setManualConfirmTarget(null)
    setToast('manualSuccess')
    void refreshStaleCount()
  }

  async function handleRefundSubmit(reference: string) {
    if (!refundTarget) return
    if (reference.length === 0) return
    setRefundSaving(true)
    setRefundError(null)
    const { order, error } = await markOrderRefunded(supabase, refundTarget.id, reference)
    setRefundSaving(false)
    if (error || !order) {
      setRefundError(t('admin.orders.refund.errors.submitFailed'))
      return
    }
    setOrders(prev => {
      // On the refund tab, drop the row; on all tab, replace it.
      if (tab === 'refund') return prev.filter(o => o.id !== refundTarget.id)
      return prev.map(o => (o.id === refundTarget.id ? { ...o, ...order } : o))
    })
    setRefundTarget(null)
    setToast('refundSuccess')
    void refreshRefundCount()
  }

  async function handleCancelSubmit(reason: string) {
    if (!cancelTarget) return
    if (reason.length === 0 || reason.length > 500) return
    setCancelSaving(true)
    setCancelError(null)
    const { order, error } = await cancelOrder(supabase, cancelTarget.id, reason)
    setCancelSaving(false)
    if (error || !order) {
      setCancelError(t('admin.orders.cancelDialog.error'))
      return
    }
    setOrders(prev => {
      if (tab === 'pending' || tab === 'stale') return prev.filter(o => o.id !== cancelTarget.id)
      return prev.map(o => (o.id === cancelTarget.id ? { ...o, ...order } : o))
    })
    setCancelTarget(null)
    setToast('success')
    void refreshStaleCount()
  }

  const columns = useMemo(() => {
    if (tab === 'refund') {
      return [
        t('admin.orders.colCode'),
        t('admin.orders.refund.colPayer'),
        t('admin.orders.refund.colBank'),
        t('admin.orders.refund.colAmount'),
        t('admin.orders.refund.colPaidAt'),
        '',
      ]
    }
    const base = [
      t('admin.orders.colCode'),
      t('admin.orders.colLearner'),
      t('admin.orders.colCourse'),
      t('admin.orders.colAmount'),
      t('admin.orders.colVoucher'),
      t('admin.orders.colCampaign'),
      t('admin.orders.colFeePayout'),
      t('admin.orders.colCreated'),
    ]
    if (tab === 'all') base.push(t('admin.orders.colStatus'))
    base.push('')
    return base
  }, [tab, t])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 border-b border-(--border) bg-(--surface) shrink-0"
        style={{ height: 60 }}
      >
        <h1 className="text-lg font-semibold tracking-tight text-(--ink-1)" style={{ letterSpacing: '-0.01em' }}>
          {t('admin.orders.pageTitle')}
        </h1>
      </div>

      {/* Tabs row + filters */}
      <div className="px-6 pt-4 pb-3 flex items-center gap-4 flex-wrap">
        <div role="tablist" className="flex items-center gap-1">
          <button
            role="tab"
            type="button"
            data-testid="orders-tab-pending"
            aria-selected={tab === 'pending'}
            onClick={() => switchTab('pending')}
            className="btn btn-sm"
            style={{
              background: tab === 'pending' ? 'var(--ink-1)' : 'transparent',
              color: tab === 'pending' ? 'var(--ink-on-accent)' : 'var(--ink-2)',
              border: '1px solid var(--border)',
            }}
          >
            {t('admin.orders.tab.pending')}
            {tab === 'pending' && total > 0 && (
              <span className="ml-1" style={{ opacity: 0.85 }}>({total})</span>
            )}
          </button>
          <button
            role="tab"
            type="button"
            data-testid="orders-tab-stale"
            aria-selected={tab === 'stale'}
            onClick={() => switchTab('stale')}
            className="btn btn-sm"
            style={{
              background: tab === 'stale' ? 'var(--ink-1)' : 'transparent',
              color: tab === 'stale' ? 'var(--ink-on-accent)' : 'var(--ink-2)',
              border: '1px solid var(--border)',
            }}
          >
            {t('admin.orders.tab.stale')}
            <span className="ml-1" style={{ opacity: 0.85 }}>({staleCount})</span>
          </button>
          <button
            role="tab"
            type="button"
            data-testid="orders-tab-refund"
            aria-selected={tab === 'refund'}
            onClick={() => switchTab('refund')}
            className="btn btn-sm"
            style={{
              background: tab === 'refund' ? 'var(--ink-1)' : 'transparent',
              color: tab === 'refund' ? 'var(--ink-on-accent)' : 'var(--ink-2)',
              border: '1px solid var(--border)',
            }}
          >
            {t('admin.orders.tab.refund')}
            <span className="ml-1" style={{ opacity: 0.85 }}>({refundCount})</span>
          </button>
          <button
            role="tab"
            type="button"
            data-testid="orders-tab-all"
            aria-selected={tab === 'all'}
            onClick={() => switchTab('all')}
            className="btn btn-sm"
            style={{
              background: tab === 'all' ? 'var(--ink-1)' : 'transparent',
              color: tab === 'all' ? 'var(--ink-on-accent)' : 'var(--ink-2)',
              border: '1px solid var(--border)',
            }}
          >
            {t('admin.orders.tab.all')}
          </button>
        </div>

        {tab === 'all' && (
          <>
            <select
              data-testid="status-filter"
              className="input"
              value={statusFilter}
              onChange={e => {
                setStatusFilter(e.target.value as '' | OrderStatus)
                setPage(1)
              }}
              style={{ height: 36, width: 200 }}
            >
              <option value="">{t('admin.orders.filter.all')}</option>
              <option value="pending">{t('admin.orders.filter.pending')}</option>
              <option value="active">{t('admin.orders.filter.active')}</option>
              <option value="cancelled">{t('admin.orders.filter.cancelled')}</option>
            </select>
            <input
              type="search"
              data-testid="orders-search"
              placeholder={t('admin.orders.searchPlaceholder')}
              value={search}
              onChange={e => {
                setSearch(e.target.value)
                setPage(1)
              }}
              className="input"
              style={{ width: 280, height: 36 }}
              aria-label={t('admin.orders.searchPlaceholder')}
            />
            <div className="flex items-center gap-2">
              {(['hasVoucher', 'hasCampaign', 'noDiscount'] as const).map(key => {
                const isActive = discountFilter === key
                return (
                  <button
                    key={key}
                    type="button"
                    data-testid={`discount-filter-${key}`}
                    onClick={() => {
                      setDiscountFilter(isActive ? null : key)
                      setPage(1)
                    }}
                    className="btn btn-sm"
                    aria-pressed={isActive}
                    style={{
                      background: isActive ? 'var(--ink-1)' : 'transparent',
                      color: isActive ? 'var(--ink-on-accent)' : 'var(--ink-2)',
                      border: '1px solid var(--border)',
                      height: 36,
                    }}
                  >
                    {t(`admin.orders.filter.${key}`)}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 px-6 pb-6 overflow-auto">
        <div className="card overflow-visible">
          <table className="w-full" style={{ fontSize: 13 }}>
            <thead>
              <tr className="border-b border-(--border)">
                {columns.map((col, i) => (
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
                  <td colSpan={columns.length} className="text-center text-(--ink-3) py-10">
                    …
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="py-10 text-center text-(--ink-3)" data-testid="orders-empty">
                    {t('admin.orders.empty')}
                  </td>
                </tr>
              ) : tab === 'refund' ? (
                orders.map(o => {
                  const due = o.refund_due_to ?? null
                  const paidAtIso = due?.paid_at ?? null
                  return (
                    <tr
                      key={o.id}
                      data-testid={`order-row-${o.id}`}
                      className="border-b border-(--border) last:border-0"
                    >
                      <td style={{ padding: '14px 16px' }} className="font-mono text-(--ink-1)">
                        {o.code}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div>
                          <div className="font-medium text-(--ink-1)">
                            {due?.payer_name ?? '—'}
                          </div>
                          <div
                            className="text-(--ink-3) font-mono"
                            style={{ fontSize: 11.5 }}
                          >
                            {maskAccount(due?.payer_account)}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px' }} className="text-(--ink-2)">
                        {due?.payer_bank ?? '—'}
                      </td>
                      <td
                        style={{ padding: '14px 16px', textAlign: 'right' }}
                        className="text-(--ink-1) font-medium"
                      >
                        {formatVnd(o.amount)}
                      </td>
                      <td
                        style={{ padding: '14px 16px' }}
                        className="text-(--ink-2)"
                        title={paidAtIso ? new Date(paidAtIso).toLocaleString('vi-VN') : ''}
                      >
                        {paidAtIso ? formatRelative(paidAtIso) : '—'}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          data-testid={`mark-refunded-btn-${o.id}`}
                          onClick={() => {
                            setRefundTarget(o)
                            setRefundError(null)
                          }}
                          style={{ height: 26, padding: '0 10px', fontSize: 11.5 }}
                        >
                          {t('admin.orders.refund.actionMarkRefunded')}
                        </button>
                      </td>
                    </tr>
                  )
                })
              ) : (
                orders.flatMap(o => {
                  const isPending = o.status === 'pending'
                  const hasDiscount = o.campaign_id !== null || o.voucher_id !== null ||
                    (o.voucher_code !== null && o.voucher_code !== '')
                  const isExpanded = expandedRowId === o.id
                  const voucherDisplay = o.voucher_code ?? null
                  const campaignName = o.campaign?.name ?? null
                  const breakdownColspan = tab === 'all' ? 10 : 9
                  return [
                    <tr
                      key={o.id}
                      data-testid={`order-row-${o.id}`}
                      className="border-b border-(--border) last:border-0"
                    >
                      <td style={{ padding: '14px 16px' }} className="font-mono text-(--ink-1)">
                        <div>{o.code}</div>
                        {/*
                          Issue #293: surface the manual-confirm reason on every
                          order that carries one so admins can audit the override
                          inline without a per-row detail panel.
                        */}
                        {o.manual_confirm_reason && (
                            <div
                              data-testid={`manual-confirm-reason-${o.id}`}
                              className="text-(--ink-3)"
                              style={{
                                fontSize: 11,
                                fontFamily: 'inherit',
                                marginTop: 4,
                                maxWidth: 240,
                                whiteSpace: 'normal',
                                lineHeight: 1.4,
                              }}
                              title={o.manual_confirm_reason}
                            >
                              <span className="text-(--ink-2)">
                                {t('admin.orders.manualConfirm.reasonRowLabel')}:
                              </span>{' '}
                              {o.manual_confirm_reason}
                            </div>
                          )}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div className="flex items-center gap-2">
                          <span className="avatar shrink-0" style={{ width: 28, height: 28, fontSize: 12 }} aria-hidden="true">
                            {(o.buyer?.name ?? o.buyer?.email ?? '?').charAt(0).toUpperCase()}
                          </span>
                          <div>
                            <div className="font-medium text-(--ink-1)">{o.buyer?.name ?? '—'}</div>
                            <div className="text-(--ink-3)" style={{ fontSize: 11.5 }}>{o.buyer?.email}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px', maxWidth: 240 }} className="text-(--ink-2) truncate">
                        {o.course?.title ?? '—'}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }} className="text-(--ink-1) font-medium">
                        {formatVnd(o.amount)}
                      </td>
                      <td
                        style={{ padding: '14px 16px' }}
                        className="text-(--ink-2)"
                        data-testid={`order-voucher-cell-${o.id}`}
                      >
                        {voucherDisplay
                          ? <span className="font-mono">{voucherDisplay}</span>
                          : '—'}
                      </td>
                      <td
                        style={{ padding: '14px 16px', maxWidth: 180 }}
                        className="text-(--ink-2) truncate"
                        data-testid={`order-campaign-cell-${o.id}`}
                        title={campaignName ?? undefined}
                      >
                        {campaignName ?? '—'}
                      </td>
                      <td style={{ padding: '14px 16px' }} className="text-(--ink-3)" >
                        {`${Math.round(o.platform_fee_amount / 1000)}k → ${Math.round(o.creator_payout_amount / 1000)}k`}
                      </td>
                      <td
                        style={{ padding: '14px 16px' }}
                        className="text-(--ink-2)"
                        title={new Date(o.created_at).toLocaleString('vi-VN')}
                      >
                        {formatRelative(o.created_at)}
                      </td>
                      {tab === 'all' && (
                        <td style={{ padding: '14px 16px' }}>
                          <span className={STATUS_PILL[o.status]}>
                            {t(`admin.orders.status.${o.status}`)}
                          </span>
                        </td>
                      )}
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div className="flex items-center justify-end gap-2 relative">
                          {hasDiscount && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              data-testid={`order-details-btn-${o.id}`}
                              onClick={() => setExpandedRowId(isExpanded ? null : o.id)}
                              style={{ height: 26, padding: '0 10px', fontSize: 11.5 }}
                              aria-expanded={isExpanded}
                              aria-controls={`order-breakdown-${o.id}`}
                            >
                              {isExpanded
                                ? t('admin.orders.breakdown.toggleHide')
                                : t('admin.orders.breakdown.toggleShow')}
                            </button>
                          )}
                          {/*
                            Issue #294: the legacy inline 1-click "Xác nhận"
                            button on the Pending tab (and on pending rows in
                            the All tab) has been removed. PRD-0005 D12b locks
                            the manual-confirm surface to the "Cần can thiệp"
                            tab (created_at > 1h) so admins cannot
                            accidentally grant free access on in-flight orders
                            that PayOS will confirm within 5–30s. The Pending
                            tab is read-only for confirm operations; the
                            kebab "Huỷ đơn" remains available for cancelling
                            a stuck pending order.
                          */}
                          {isPending && tab === 'stale' && (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              data-testid={`manual-confirm-btn-${o.id}`}
                              onClick={() => {
                                setManualConfirmTarget(o)
                                setManualConfirmError(null)
                              }}
                              style={{ height: 26, padding: '0 10px', fontSize: 11.5 }}
                              aria-label={t('admin.orders.manualConfirm.action')}
                            >
                              {t('admin.orders.manualConfirm.action')}
                            </button>
                          )}
                          {/*
                            Issue #292: cancel_order only accepts pending|active
                            (migration 062). Hide the kebab on every other
                            status — flipping refund_pending → cancelled would
                            orphan the refund obligation (learner has already
                            transferred money) and lose the refund_due_to
                            snapshot. The kebab currently has a single item
                            ("Huỷ đơn"), so hiding the trigger entirely is the
                            cleanest fix.
                          */}
                          {(o.status === 'pending' || o.status === 'active') && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              data-testid={`kebab-btn-${o.id}`}
                              onClick={() => setMenuFor(menuFor === o.id ? null : o.id)}
                              style={{ height: 26, padding: '0 8px', fontSize: 13 }}
                              aria-label={t('admin.orders.menu')}
                              aria-haspopup="menu"
                              aria-expanded={menuFor === o.id}
                            >
                              ⋯
                            </button>
                          )}
                          {menuFor === o.id && (
                            <div
                              className="card"
                              role="menu"
                              style={{
                                position: 'absolute',
                                right: 0,
                                top: 30,
                                padding: 4,
                                minWidth: 160,
                                zIndex: 10,
                              }}
                            >
                              <button
                                type="button"
                                role="menuitem"
                                data-testid={`cancel-menu-item-${o.id}`}
                                onClick={() => {
                                  setMenuFor(null)
                                  setCancelTarget(o)
                                  setCancelError(null)
                                }}
                                className="btn btn-ghost btn-sm w-full"
                                style={{ justifyContent: 'flex-start', color: 'var(--danger)' }}
                              >
                                {t('admin.orders.cancel')}
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>,
                    isExpanded && hasDiscount ? (
                      <tr
                        key={`${o.id}-breakdown`}
                        data-testid={`order-breakdown-${o.id}`}
                        id={`order-breakdown-${o.id}`}
                        className="border-b border-(--border) last:border-0"
                      >
                        <td
                          colSpan={breakdownColspan}
                          style={{
                            padding: '12px 24px 18px',
                            background: 'var(--surface-2, var(--surface))',
                          }}
                        >
                          <div
                            className="grid"
                            style={{
                              gridTemplateColumns: 'minmax(180px, 220px) 1fr',
                              rowGap: 6,
                              fontSize: 12.5,
                              maxWidth: 520,
                            }}
                          >
                            <div className="text-(--ink-3)" data-testid="breakdown-original-label">
                              {t('admin.orders.breakdown.original')}
                            </div>
                            <div
                              className="text-(--ink-1)"
                              data-testid="breakdown-original"
                              style={{ textAlign: 'right' }}
                            >
                              {formatVnd(o.original_price)}
                            </div>

                            {o.campaign_id !== null && (
                              <div
                                data-testid="breakdown-campaign"
                                style={{ display: 'contents' }}
                              >
                                <div className="text-(--ink-3)">
                                  {t('admin.orders.breakdown.campaign')}
                                  {campaignName && (
                                    <span className="text-(--ink-2)">
                                      {' '}· {campaignName}
                                    </span>
                                  )}
                                </div>
                                <div
                                  style={{ textAlign: 'right', color: 'var(--danger)' }}
                                >
                                  −{formatVnd(o.campaign_discount_amount)}
                                </div>
                              </div>
                            )}

                            {(o.voucher_id !== null || (o.voucher_code !== null && o.voucher_code !== '')) && (
                              <div
                                data-testid="breakdown-voucher"
                                style={{ display: 'contents' }}
                              >
                                <div className="text-(--ink-3)">
                                  {t('admin.orders.breakdown.voucher')}
                                  {voucherDisplay && (
                                    <span className="font-mono text-(--ink-2)">
                                      {' '}· {voucherDisplay}
                                    </span>
                                  )}
                                </div>
                                <div
                                  style={{ textAlign: 'right', color: 'var(--danger)' }}
                                >
                                  −{formatVnd(o.voucher_discount_amount)}
                                </div>
                              </div>
                            )}

                            <div className="text-(--ink-2) font-medium" style={{ paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                              {t('admin.orders.breakdown.final')}
                            </div>
                            <div
                              className="text-(--ink-1) font-semibold"
                              data-testid="breakdown-final"
                              style={{ textAlign: 'right', paddingTop: 6, borderTop: '1px solid var(--border)' }}
                            >
                              {formatVnd(o.amount)}
                            </div>

                            <div className="text-(--ink-3)">
                              {t('admin.orders.breakdown.platformFee')}
                            </div>
                            <div
                              className="text-(--ink-2)"
                              data-testid="breakdown-platform-fee"
                              style={{ textAlign: 'right' }}
                            >
                              {formatVnd(o.platform_fee_amount)}
                            </div>

                            <div className="text-(--ink-3)">
                              {t('admin.orders.breakdown.creatorPayout')}
                            </div>
                            <div
                              className="text-(--ink-2)"
                              data-testid="breakdown-creator-payout"
                              style={{ textAlign: 'right' }}
                            >
                              {formatVnd(o.creator_payout_amount)}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null,
                  ]
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <span className="text-sm text-(--ink-3)">{total}</span>
            <div className="flex items-center gap-3">
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                aria-label="Previous page"
              >
                ←
              </button>
              <span className="text-sm text-(--ink-2)">
                {page} / {totalPages}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                aria-label="Next page"
              >
                →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Cancel dialog */}
      {cancelTarget && (
        <CancelDialog
          order={cancelTarget}
          saving={cancelSaving}
          errorMsg={cancelError}
          onCancel={() => setCancelTarget(null)}
          onConfirm={handleCancelSubmit}
          t={t}
        />
      )}

      {/* Manual-confirm dialog (Cần can thiệp) */}
      {manualConfirmTarget && (
        <ManualConfirmDialog
          order={manualConfirmTarget}
          saving={manualConfirmSaving}
          errorMsg={manualConfirmError}
          onCancel={() => setManualConfirmTarget(null)}
          onConfirm={handleManualConfirmSubmit}
          t={t}
        />
      )}

      {/* Refund dialog (Cần refund) */}
      {refundTarget && (
        <RefundDialog
          order={refundTarget}
          saving={refundSaving}
          errorMsg={refundError}
          onCancel={() => setRefundTarget(null)}
          onConfirm={handleRefundSubmit}
          t={t}
        />
      )}

      {/* Toasts */}
      {(toast === 'success' || toast === 'manualSuccess' || toast === 'refundSuccess') && (
        <div
          data-testid="orders-success-toast"
          className="toast toast-success"
        >
          {toast === 'manualSuccess'
            ? t('admin.orders.manualConfirm.toastSuccess')
            : toast === 'refundSuccess'
            ? t('admin.orders.refund.toastSuccess')
            : t('admin.orders.actionSuccess')}
        </div>
      )}
      {toast === 'error' && (
        <div
          data-testid="orders-error-toast"
          className="toast toast-error"
        >
          {t('admin.orders.actionError')}
        </div>
      )}
    </div>
  )
}
