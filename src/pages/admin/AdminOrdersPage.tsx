import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import {
  listPendingOrders,
  listAllOrders,
  type AdminOrderRow,
} from '../../lib/adminOrdersApi'
import { confirmOrder, cancelOrder } from '../../lib/orderApi'
import type { OrderStatus } from '../../lib/orderApi'
import { useDebounce } from '../../hooks/useDebounce'

type Tab = 'pending' | 'all'
const PAGE_SIZE = 20

const STATUS_PILL: Record<OrderStatus, string> = {
  pending: 'pill',
  active: 'pill pill-accent',
  cancelled: 'pill',
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

  // Cancel dialog state
  const [cancelTarget, setCancelTarget] = useState<AdminOrderRow | null>(null)
  const [cancelSaving, setCancelSaving] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  // Kebab menu state — track which row's menu is open
  const [menuFor, setMenuFor] = useState<string | null>(null)

  const [toast, setToast] = useState<'success' | 'error' | null>(null)
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const load = useCallback(async () => {
    setLoading(true)
    if (tab === 'pending') {
      const { orders: rows, total: tot } = await listPendingOrders(supabase, {
        page,
        pageSize: PAGE_SIZE,
      })
      setOrders(rows)
      setTotal(tot)
    } else {
      const { orders: rows, total: tot } = await listAllOrders(supabase, {
        status: statusFilter || undefined,
        search: debouncedSearch || undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      setOrders(rows)
      setTotal(tot)
    }
    setLoading(false)
  }, [tab, page, statusFilter, debouncedSearch])

  useEffect(() => {
    void load()
  }, [load])

  // Auto-dismiss toasts
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])

  function switchTab(next: Tab) {
    setTab(next)
    setPage(1)
  }

  async function handleConfirm(orderId: string) {
    const { order, error } = await confirmOrder(supabase, orderId)
    if (error || !order) {
      setToast('error')
      return
    }
    setToast('success')
    setOrders(prev => {
      // On the pending tab, drop the row; on the all tab, replace it.
      if (tab === 'pending') return prev.filter(o => o.id !== orderId)
      return prev.map(o => (o.id === orderId ? { ...o, ...order } : o))
    })
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
      if (tab === 'pending') return prev.filter(o => o.id !== cancelTarget.id)
      return prev.map(o => (o.id === cancelTarget.id ? { ...o, ...order } : o))
    })
    setCancelTarget(null)
    setToast('success')
  }

  const columns = useMemo(() => {
    const base = [
      t('admin.orders.colCode'),
      t('admin.orders.colLearner'),
      t('admin.orders.colCourse'),
      t('admin.orders.colAmount'),
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
              ) : (
                orders.map(o => {
                  const isPending = o.status === 'pending'
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
                          {isPending && (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              data-testid={`confirm-btn-${o.id}`}
                              onClick={() => handleConfirm(o.id)}
                              style={{ height: 26, padding: '0 10px', fontSize: 11.5 }}
                              aria-label={t('admin.orders.confirm')}
                            >
                              {t('admin.orders.confirm')}
                            </button>
                          )}
                          {o.status !== 'cancelled' && (
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
                    </tr>
                  )
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

      {/* Toasts */}
      {toast === 'success' && (
        <div
          data-testid="orders-success-toast"
          className="fixed bottom-6 right-6 card"
          style={{ padding: '12px 20px', background: 'var(--ink-1)', color: '#fff', fontSize: 13, zIndex: 100 }}
        >
          {t('admin.orders.actionSuccess')}
        </div>
      )}
      {toast === 'error' && (
        <div
          data-testid="orders-error-toast"
          className="fixed bottom-6 right-6 card"
          style={{ padding: '12px 20px', background: 'var(--danger)', color: '#fff', fontSize: 13, zIndex: 100 }}
        >
          {t('admin.orders.actionError')}
        </div>
      )}
    </div>
  )
}
