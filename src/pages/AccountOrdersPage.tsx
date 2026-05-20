import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { listMyOrders, createOrder } from '../lib/orderApi'
import type { MyOrderRow, OrderStatus } from '../lib/orderApi'
import { writeLastSeenOrdersAt } from '../lib/orderUpdatesApi'

const PAGE_SIZE = 20
const FILTERS: ('all' | OrderStatus)[] = ['all', 'active', 'pending', 'expired', 'cancelled']

const STATUS_PILL_STYLE: Record<OrderStatus, React.CSSProperties> = {
  active: { background: 'var(--success-soft)', color: 'var(--success)', border: '1px solid var(--success-border)' },
  pending: { background: 'var(--warning-soft)', color: 'var(--warning)', border: '1px solid var(--warning-border)' },
  cancelled: { background: 'var(--danger-soft)', color: 'var(--danger)', border: '1px solid var(--danger-border)' },
  expired: { background: 'var(--surface-2)', color: 'var(--ink-3)', border: '1px solid var(--border)' },
  // refund_pending uses the same amber palette as pending — money is in flight
  // back to the learner, PRD-0005 D12d. The tooltip explains the 3–7 day SLA.
  refund_pending: { background: 'var(--warning-soft)', color: 'var(--warning)', border: '1px solid var(--warning-border)' },
  // refunded is a terminal neutral state, visually identical to expired.
  refunded: { background: 'var(--surface-2)', color: 'var(--ink-3)', border: '1px solid var(--border)' },
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

export default function AccountOrdersPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()

  const cancelledToast = (location.state as { fromCancelledOrder?: string } | null)?.fromCancelledOrder ?? null
  const [toastVisible, setToastVisible] = useState(!!cancelledToast)

  const [filter, setFilter] = useState<'all' | OrderStatus>('all')
  const [orders, setOrders] = useState<MyOrderRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [revealedId, setRevealedId] = useState<string | null>(null)
  const [reorderingId, setReorderingId] = useState<string | null>(null)

  async function handleReorder(courseId: string, orderId: string) {
    setReorderingId(orderId)
    const { order, error } = await createOrder(supabase, courseId)
    setReorderingId(null)
    if (order) {
      navigate(`/checkout/${order.id}`)
      return
    }
    // If a duplicate pending exists (raced), navigate there.
    if (error) {
      const msg = (error as { message?: string }).message ?? ''
      if (msg.includes('duplicate_pending_order')) {
        const parts = msg.split(':')
        const existingId = parts[1]?.trim()
        if (existingId) navigate(`/checkout/${existingId}`)
      }
    }
  }

  useEffect(() => {
    if (!user) navigate('/login', { replace: true })
  }, [user, navigate])

  // PRD-0005 D12c — opening this page is the user signal "I have seen the
  // latest order activity". TopNav reads `last_seen_orders_at` from
  // localStorage to decide whether to show the unread-orders dot indicator.
  // Write AFTER the auth gate so unauthorized visits don't clear the marker.
  useEffect(() => {
    if (!user) return
    writeLastSeenOrdersAt()
  }, [user])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    listMyOrders(supabase, {
      status: filter === 'all' ? undefined : filter,
      page,
      pageSize: PAGE_SIZE,
    }).then(({ orders: rows, total: tot }) => {
      if (!cancelled) { setOrders(rows); setTotal(tot); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [user, filter, page])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  if (!user) return null

  return (
    <div className="container" style={{ maxWidth: 1280, padding: '40px 56px 64px' }}>
      <p
        className="uppercase font-medium text-(--ink-3) mb-2"
        style={{ fontSize: 11, letterSpacing: '0.06em' }}
      >
        {t('account.eyebrow')}
      </p>
      <h1
        className="font-serif text-(--ink-1) mb-8"
        style={{ fontSize: 32, letterSpacing: '-0.01em' }}
      >
        {t('account.orders.title')}
      </h1>

      {/* Cancelled order toast */}
      {toastVisible && cancelledToast && (
        <div
          data-testid="cancelled-order-toast"
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            background: 'var(--warning-soft)',
            border: '1px solid var(--warning-border)',
            borderRadius: 'var(--r-md)',
            padding: '12px 16px',
            marginBottom: 20,
            fontSize: 14,
            color: 'var(--warning)',
          }}
        >
          <span>{t('account.orders.cancelledToast', { reason: cancelledToast })}</span>
          <button
            type="button"
            aria-label="Đóng"
            onClick={() => setToastVisible(false)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--warning)', fontSize: 18, lineHeight: 1, padding: 0 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Filter pills */}
      <div className="flex items-center gap-2 mb-6 flex-wrap" role="group" aria-label={t('account.orders.filterAria')}>
        {FILTERS.map(f => (
          <button
            key={f}
            type="button"
            data-testid={`filter-${f}`}
            aria-pressed={filter === f}
            onClick={() => {
              setFilter(f)
              setPage(1)
            }}
            className="btn btn-sm"
            style={{
              background: filter === f ? 'var(--ink-1)' : 'var(--surface)',
              color: filter === f ? 'var(--ink-on-accent)' : 'var(--ink-2)',
              border: '1px solid var(--border)',
            }}
          >
            {t(`account.orders.filter.${f}`)}
            {f === 'all' && total > 0 && filter === 'all' && (
              <span className="ml-1" style={{ opacity: 0.85 }}>({total})</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card p-10 text-center text-(--ink-3)">…</div>
      ) : orders.length === 0 ? (
        <div
          className="card text-center"
          data-testid="orders-empty"
          style={{ padding: '64px 24px' }}
        >
          <div
            aria-hidden="true"
            style={{ fontSize: 48, color: 'var(--ink-4)', marginBottom: 12 }}
          >
            ⌛
          </div>
          <p className="text-(--ink-1) font-medium mb-2">{t('account.orders.empty.title')}</p>
          <p className="text-(--ink-3) mb-6" style={{ fontSize: 13 }}>
            {t('account.orders.empty.body')}
          </p>
          <Link to="/" className="btn btn-accent">
            {t('account.orders.empty.cta')}
          </Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full" style={{ fontSize: 13 }}>
            <thead>
              <tr className="border-b border-(--border)">
                {[
                  t('account.orders.colCode'),
                  t('account.orders.colCourse'),
                  t('account.orders.colAmount'),
                  t('account.orders.colStatus'),
                  t('account.orders.colDate'),
                  '',
                ].map((col, i) => (
                  <th
                    key={i}
                    className="text-left font-medium uppercase text-(--ink-3)"
                    style={{ padding: '14px 16px', fontSize: 11.5, letterSpacing: '0.05em' }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map(o => {
                const isFree = o.amount === 0
                const isOwnerCancel = o.cancelled_by === user.id
                const revealed = revealedId === o.id
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
                        {o.course?.thumbnail_url ? (
                          <img
                            src={o.course.thumbnail_url}
                            alt=""
                            style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', objectFit: 'cover' }}
                          />
                        ) : (
                          <span
                            aria-hidden="true"
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 'var(--r-sm)',
                              background: 'var(--surface-2)',
                            }}
                          />
                        )}
                        <span className="text-(--ink-1)">{o.course?.title ?? '—'}</span>
                      </div>
                    </td>
                    <td
                      style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 600 }}
                      className={isFree ? 'text-(--success)' : 'text-(--ink-1)'}
                    >
                      {isFree ? t('account.orders.free') : formatVnd(o.amount)}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span
                        className="pill"
                        style={STATUS_PILL_STYLE[o.status]}
                        title={
                          o.status === 'refund_pending'
                            ? t('account.orders.refundPendingTooltip')
                            : undefined
                        }
                      >
                        {t(`account.orders.status.${o.status}`)}
                      </span>
                    </td>
                    <td
                      style={{ padding: '14px 16px', fontSize: 12.5 }}
                      className="text-(--ink-3)"
                      title={new Date(o.created_at).toLocaleString('vi-VN')}
                    >
                      {formatRelative(o.created_at)}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      {o.status === 'active' && (
                        <Link
                          to={`/learn/${o.course_id}`}
                          className="btn btn-secondary btn-sm"
                          data-testid={`action-learn-${o.id}`}
                        >
                          {t('account.orders.actionLearn')}
                        </Link>
                      )}
                      {o.status === 'pending' && (
                        <Link
                          to={`/checkout/${o.id}`}
                          className="btn btn-secondary btn-sm"
                          data-testid={`action-checkout-${o.id}`}
                        >
                          {t('account.orders.actionCheckout')}
                        </Link>
                      )}
                      {o.status === 'expired' && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          data-testid={`action-reorder-${o.id}`}
                          onClick={() => handleReorder(o.course_id, o.id)}
                          disabled={reorderingId === o.id}
                        >
                          {t('account.orders.actionReorder')}
                        </button>
                      )}
                      {o.status === 'cancelled' && (
                        <div className="flex flex-col items-end gap-2">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            data-testid={`action-reveal-${o.id}`}
                            onClick={() => setRevealedId(revealed ? null : o.id)}
                            aria-expanded={revealed}
                          >
                            {revealed
                              ? t('account.orders.actionHideReason')
                              : t('account.orders.actionShowReason')}
                          </button>
                          {revealed && (
                            <div
                              data-testid={`cancel-reveal-${o.id}`}
                              className="text-left"
                              style={{
                                background: 'var(--surface-2)',
                                borderRadius: 'var(--r-md)',
                                padding: '8px 12px',
                                fontSize: 12.5,
                                color: 'var(--ink-2)',
                                maxWidth: 280,
                              }}
                            >
                              <span className="text-(--ink-3) block mb-1" style={{ fontSize: 11.5 }}>
                                {isOwnerCancel
                                  ? t('account.orders.cancelByOwner')
                                  : t('account.orders.cancelByAdmin')}
                              </span>
                              {o.cancelled_reason ?? '—'}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

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
  )
}
