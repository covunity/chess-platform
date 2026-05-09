import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { getOrder, cancelOrder } from '../lib/orderApi'
import { getBankConfig } from '../lib/configApi'
import { buildVietQRUrl } from '../lib/vietqr'
import type { OrderWithCourse } from '../lib/orderApi'
import type { BankConfig } from '../lib/configApi'

function formatVnd(n: number): string {
  return `${n.toLocaleString('vi-VN')} ₫`
}

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
  const { user } = useAuth()
  const { t } = useTranslation()

  const [order, setOrder] = useState<OrderWithCourse | null>(null)
  const [bank, setBank] = useState<BankConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!user) {
      navigate('/login', { replace: true })
      return
    }
    if (!orderId) return

    Promise.all([
      getOrder(supabase, orderId),
      getBankConfig(supabase),
    ]).then(([{ order: o, error }, { bank: b }]) => {
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
      if (o.status === 'cancelled') {
        navigate('/account/orders', { replace: true })
        return
      }
      setOrder(o)
      setBank(b)
      setLoading(false)
    })
  }, [user, orderId, navigate])

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

  function buildQRUrl(): string | null {
    if (!bank || !bank.short_name || !bank.account_number || !bank.account_name || !order) return null
    try {
      return buildVietQRUrl({
        shortName: bank.short_name,
        accountNumber: bank.account_number,
        accountName: bank.account_name,
        amount: order.amount,
        addInfo: order.code,
      })
    } catch {
      return null
    }
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

  const qrUrl = buildQRUrl()

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

            {/* Course thumbnail */}
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

            {/* Course title */}
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', lineHeight: 1.3 }}>
                {order.course?.title ?? ''}
              </div>
            </div>

            <div style={{ height: 1, background: 'var(--border)' }} />

            {/* Price rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: 'var(--ink-2)' }}>{t('checkout.summary.price')}</span>
                <span style={{ color: 'var(--ink-1)' }}>{formatVnd(order.amount)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 600 }}>
                <span style={{ color: 'var(--ink-1)' }}>{t('checkout.summary.total')}</span>
                <span data-testid="checkout-amount" style={{ color: 'var(--ink-1)' }}>{formatVnd(order.amount)}</span>
              </div>
            </div>

            {/* Order code */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{t('checkout.summary.orderCode')}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--ink-1)', fontWeight: 500 }}>
                {order.code}
              </span>
            </div>
          </div>

          {/* Right: QR + transfer info */}
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

            {/* VietQR image or fallback */}
            {qrUrl ? (
              <img
                data-testid="vietqr-image"
                src={qrUrl}
                alt="VietQR"
                width={220}
                height={220}
                style={{ display: 'block', margin: '0 auto', borderRadius: 'var(--r-md)' }}
                onError={e => {
                  const target = e.currentTarget
                  target.style.display = 'none'
                  const fallback = target.nextElementSibling as HTMLElement | null
                  if (fallback) fallback.style.display = 'block'
                }}
              />
            ) : null}

            {/* Bank info fallback — shown when qrUrl is null or image errors */}
            <div
              data-testid="bank-info-fallback"
              style={{ display: qrUrl ? 'none' : 'block' }}
            >
              <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: 0 }}>
                {t('checkout.qr.fallback')}
              </p>
            </div>

            {/* Bank details */}
            {bank && (
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
                {bank.short_name && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--ink-3)' }}>{t('checkout.bank.bankName')}</span>
                    <span style={{ color: 'var(--ink-1)', fontWeight: 500 }}>{bank.short_name}</span>
                  </div>
                )}
                {bank.account_number && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--ink-3)' }}>{t('checkout.bank.accountNumber')}</span>
                    <span style={{ color: 'var(--ink-1)', fontWeight: 500 }}>{bank.account_number}</span>
                  </div>
                )}
                {bank.account_name && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--ink-3)' }}>{t('checkout.bank.accountName')}</span>
                    <span style={{ color: 'var(--ink-1)', fontWeight: 500 }}>{bank.account_name}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--ink-3)' }}>{t('checkout.bank.amount')}</span>
                  <span style={{ color: 'var(--ink-1)', fontWeight: 500 }}>{formatVnd(order.amount)}</span>
                </div>
              </div>
            )}

            {/* Warning note + copy order code */}
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
                {t('checkout.noteWarning')}
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
          </div>
        </div>

        {/* Cancel error message */}
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

        {/* Action footer */}
        <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setShowCancel(true)}
          >
            {t('checkout.action.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate(`/courses/${order.course_id}`)}
          >
            {t('checkout.action.notPaidYet')}
          </button>
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => navigate(`/checkout/${order.id}/awaiting`)}
          >
            {t('checkout.action.iPaid')}
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
