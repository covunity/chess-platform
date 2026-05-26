import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { QRCode } from 'react-qr-code'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { getOrder, cancelOrder } from '../lib/orderApi'
import { createPayosPayment } from '../lib/payos'
import type { OrderWithCourse } from '../lib/orderApi'
import type { PayosCheckoutData } from '../lib/payos'
import { formatPrice } from '../lib/utils'

const POLL_INTERVAL_MS = 5000

// PRD-0005 §5.8: PayOS returns the EMV QR code as a text payload. We render
// it client-side via `react-qr-code` (SVG output) — see issue #274. This
// removes a third-party SaaS dependency (api.qrserver.com) from the
// payment-critical path. ECC level "M" matches the api.qrserver.com default.
const QR_SIZE_PX = 240
const QR_ECC_LEVEL: 'L' | 'M' | 'Q' | 'H' = 'M'

interface CancelDialogProps {
  onConfirm: (reason: string) => void
  onClose: () => void
  loading: boolean
}

function CancelDialog({ onConfirm, onClose, loading }: CancelDialogProps) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')

  return (
    <div
      data-testid="cancel-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20,22,26,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: 'var(--bg)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--sh-3)',
          padding: 32,
          maxWidth: 480,
          width: '100%',
          margin: '0 16px',
        }}
      >
        <h3
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 22,
            color: 'var(--ink-1)',
            margin: '0 0 8px',
          }}
        >
          {t('checkout.cancelDialog.title')}
        </h3>
        <p style={{ fontSize: 14, color: 'var(--ink-2)', margin: '0 0 16px' }}>
          {t('checkout.cancelDialog.body')}
        </p>
        <textarea
          data-testid="cancel-reason-input"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder={t('checkout.cancelDialog.reasonPlaceholder')}
          maxLength={500}
          rows={4}
          style={{
            width: '100%',
            resize: 'vertical',
            padding: '10px 12px',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--r-md)',
            fontSize: 14,
            color: 'var(--ink-1)',
            background: 'var(--bg)',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('checkout.cancelDialog.back')}
          </button>
          <button
            type="button"
            data-testid="cancel-confirm-btn"
            className="btn btn-danger"
            disabled={loading}
            onClick={() => {
              if (reason.trim()) onConfirm(reason.trim())
            }}
          >
            {t('checkout.cancelDialog.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CheckoutPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const { t } = useTranslation()

  const [order, setOrder] = useState<OrderWithCourse | null>(null)
  const [payos, setPayos] = useState<PayosCheckoutData | null>(null)
  const [payosLoading, setPayosLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState(false)
  const [copied, setCopied] = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function stopPolling() {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  // Initial load + PayOS data fetch.
  useEffect(() => {
    // Wait for AuthContext to hydrate the persisted session from localStorage
    // before deciding whether the caller is logged in. On a hard refresh
    // `user` is null for ~1 frame while `getSession()` resolves; without this
    // guard we'd navigate('/login') and kick the user out unnecessarily.
    if (authLoading) return
    if (!user) {
      navigate('/login', { replace: true })
      return
    }
    if (!orderId) return

    let cancelled = false
    getOrder(supabase, orderId).then(async ({ order: o, error }) => {
      if (cancelled) return
      if (error || !o) {
        setNotFound(true)
        setLoading(false)
        return
      }
      if (o.user_id !== user.id) {
        setNotFound(true)
        setLoading(false)
        return
      }
      if (o.status === 'active') {
        navigate(`/learn/${o.course_id}`, { replace: true })
        return
      }
      if (o.status === 'cancelled' || o.status === 'expired') {
        navigate('/account/orders', { replace: true })
        return
      }
      setOrder(o)
      setLoading(false)

      // Fetch PayOS checkout data. The Edge Function is idempotent on this
      // call (issue #275): if a payment was already created for the order,
      // it returns the cached payload — same shape as a first-create — so
      // a page refresh after the QR loads renders normally with no 409.
      setPayosLoading(true)
      const result = await createPayosPayment(supabase, orderId)
      if (cancelled) return
      setPayos(result)
      setPayosLoading(false)
    })

    return () => {
      cancelled = true
      stopPolling()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, orderId, authLoading])

  // Status polling — every 5s while order is pending and tab visible.
  useEffect(() => {
    if (!order || order.status !== 'pending' || !orderId) return

    async function poll() {
      if (document.visibilityState !== 'visible') return
      const { order: fresh } = await getOrder(supabase, orderId!)
      if (!fresh) return
      if (fresh.status === 'active') {
        stopPolling()
        navigate(`/learn/${fresh.course_id}`, { replace: true })
      } else if (fresh.status === 'cancelled' || fresh.status === 'expired') {
        stopPolling()
        navigate('/account/orders', { replace: true })
      }
    }

    stopPolling()
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS)
    return stopPolling
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, orderId])

  async function handleCancel(reason: string) {
    if (!order) return
    setCancelling(true)
    setCancelError(false)
    const { error } = await cancelOrder(supabase, order.id, reason)
    setCancelling(false)
    if (!error) {
      navigate('/account/orders', { replace: true })
    } else {
      setCancelError(true)
      setShowCancel(false)
    }
  }

  function handleCopyCode() {
    if (!order) return
    navigator.clipboard.writeText(order.code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  // Render a spinner while we're either still hydrating the auth session OR
  // loading the order. Avoids the "blank page then flash to login" jank that
  // used to happen on a hard refresh of /checkout/:orderId.
  if (authLoading || (user && loading)) {
    return (
      <div style={{ padding: '80px 56px', textAlign: 'center' }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto' }} />
      </div>
    )
  }

  if (!user) return null

  if (loading) {
    return (
      <div style={{ padding: '80px 56px', textAlign: 'center' }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto' }} />
      </div>
    )
  }

  if (notFound) {
    return (
      <div data-testid="checkout-not-found" style={{ padding: '80px 56px', textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--font-serif)', fontSize: 28, color: 'var(--ink-1)' }}>
          {t('checkout.notFound')}
        </p>
        <Link to="/account/orders" className="btn btn-secondary" style={{ marginTop: 16, display: 'inline-block' }}>
          {t('account.orders.title')}
        </Link>
      </div>
    )
  }

  if (!order) return null

  const payosReady = payos && payos.error === null && payos.qrCode

  return (
    <main style={{ padding: '48px 56px', minHeight: '100vh' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 32,
            color: 'var(--ink-1)',
            margin: '0 0 32px',
          }}
        >
          {t('checkout.title')}
        </h1>

        {/* Two-column card grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1.2fr',
            gap: 24,
            alignItems: 'start',
          }}
        >
          {/* Left: Order summary */}
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>
              {t('checkout.summary.heading')}
            </h2>

            {order.course?.thumbnail_url ? (
              <img
                src={order.course.thumbnail_url}
                alt={order.course?.title ?? ''}
                style={{ width: '100%', aspectRatio: '16/10', objectFit: 'cover', borderRadius: 'var(--r-md)' }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  aspectRatio: '16/10',
                  background: 'var(--surface-2)',
                  borderRadius: 'var(--r-md)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
              </div>
            )}

            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', lineHeight: 1.3 }}>
                {order.course?.title ?? ''}
              </div>
            </div>

            <div style={{ height: 1, background: 'var(--border)' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: 'var(--ink-2)' }}>{t('checkout.summary.price')}</span>
                <span style={{ color: 'var(--ink-1)' }}>{formatPrice(order.amount)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 600 }}>
                <span style={{ color: 'var(--ink-1)' }}>{t('checkout.summary.total')}</span>
                <span data-testid="checkout-amount" style={{ color: 'var(--ink-1)' }}>{formatPrice(order.amount)}</span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{t('checkout.summary.orderCode')}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--ink-1)', fontWeight: 500 }}>
                {order.code}
              </span>
            </div>
          </div>

          {/* Right: PayOS QR + bank info */}
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>
              {t('checkout.qr.heading')}
            </h2>

            {payosLoading && !payos && (
              <div
                data-testid="payos-loading"
                style={{ width: 240, height: 240, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              </div>
            )}

            {payos && payos.error && (
              <div
                data-testid="payos-error"
                style={{
                  padding: 16,
                  background: 'var(--danger-soft)',
                  border: '1px solid var(--danger-border)',
                  borderRadius: 'var(--r-md)',
                  fontSize: 13,
                  color: 'var(--danger)',
                }}
              >
                {t('checkout.payos.error')}
              </div>
            )}

            {payosReady && (
              <div
                data-testid="payos-qr"
                aria-label="PayOS QR"
                style={{
                  width: QR_SIZE_PX,
                  height: QR_SIZE_PX,
                  margin: '0 auto',
                  padding: 8,
                  background: '#fff',
                  borderRadius: 'var(--r-md)',
                  boxSizing: 'border-box',
                }}
              >
                <QRCode
                  value={payos!.qrCode!}
                  size={QR_SIZE_PX - 16}
                  level={QR_ECC_LEVEL}
                  bgColor="#ffffff"
                  fgColor="#000000"
                  style={{ display: 'block', width: '100%', height: '100%' }}
                />
              </div>
            )}

            {payosReady && (
              <p style={{ fontSize: 12.5, color: 'var(--ink-2)', margin: 0, textAlign: 'center' }}>
                {t('checkout.qr.scanInstruction')}
              </p>
            )}

            {payosReady && (
              <div
                style={{
                  background: 'var(--surface-2)',
                  borderRadius: 'var(--r-md)',
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--ink-3)' }}>{t('checkout.bank.accountNumber')}</span>
                  <span style={{ color: 'var(--ink-1)', fontWeight: 500 }}>{payos!.accountNumber}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--ink-3)' }}>{t('checkout.bank.accountName')}</span>
                  <span style={{ color: 'var(--ink-1)', fontWeight: 500 }}>{payos!.accountName}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--ink-3)' }}>{t('checkout.bank.amount')}</span>
                  <span style={{ color: 'var(--ink-1)', fontWeight: 500 }}>{formatPrice(order.amount)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--ink-3)' }}>{t('checkout.bank.note')}</span>
                  <span style={{ fontFamily: 'monospace', color: 'var(--ink-1)', fontWeight: 500 }}>{payos!.description}</span>
                </div>
              </div>
            )}

            {/* Order code copy */}
            <div
              style={{
                background: 'var(--warning-soft)',
                border: '1px solid var(--warning-border)',
                borderRadius: 'var(--r-md)',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <p style={{ fontSize: 12.5, color: 'var(--warning)', margin: 0, lineHeight: 1.55 }}>
                {t('checkout.exactAmountNotice')}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--ink-1)', fontWeight: 600 }}>
                  {order.code}
                </code>
                <button
                  type="button"
                  data-testid="copy-order-code-btn"
                  className="btn btn-ghost btn-sm"
                  onClick={handleCopyCode}
                  style={{ fontSize: 12 }}
                >
                  {copied ? t('checkout.copied') : t('checkout.copyOrderCode')}
                </button>
              </div>
            </div>

            {/* Polling status zone */}
            <div
              data-testid="payos-status-zone"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                background: 'var(--surface-2)',
                borderRadius: 'var(--r-md)',
              }}
            >
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  animation: 'pulse 1.4s ease-in-out infinite',
                }}
              />
              <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                {t('checkout.statusWaiting')}
              </span>
            </div>
          </div>
        </div>

        {cancelError && (
          <div
            data-testid="cancel-error"
            style={{
              marginTop: 16,
              padding: '12px 16px',
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger-border)',
              borderRadius: 'var(--r-md)',
              fontSize: 14,
              color: 'var(--danger)',
            }}
          >
            {t('checkout.loadingError')}
          </div>
        )}

        {/* Action footer — no "Tôi đã thanh toán"; cancel is the only action */}
        <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setShowCancel(true)}
          >
            {t('checkout.action.cancel')}
          </button>
        </div>
      </div>

      {showCancel && (
        <CancelDialog
          onConfirm={handleCancel}
          onClose={() => setShowCancel(false)}
          loading={cancelling}
        />
      )}
    </main>
  )
}
