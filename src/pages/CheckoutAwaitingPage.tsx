import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { getOrder } from '../lib/orderApi'
import type { OrderWithCourse } from '../lib/orderApi'

function formatVnd(n: number): string {
  return `${n.toLocaleString('vi-VN')} ₫`
}

export default function CheckoutAwaitingPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t } = useTranslation()

  const [order, setOrder] = useState<OrderWithCourse | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const orderRef = useRef<OrderWithCourse | null>(null)

  function stopPolling() {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  async function pollOrderStatus() {
    if (!orderId || !orderRef.current) return
    const { order: fresh } = await getOrder(supabase, orderId)
    if (!fresh) return
    if (fresh.status === 'active') {
      stopPolling()
      navigate(`/learn/${fresh.course_id}`, { replace: true })
    } else if (fresh.status === 'cancelled') {
      stopPolling()
      navigate('/account/orders', { replace: true, state: { fromCancelledOrder: fresh.cancelled_reason ?? t('checkout.awaiting.cancelledDefault') } })
    }
  }

  function startPolling() {
    stopPolling()
    intervalRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        pollOrderStatus()
      }
    }, 30000)
  }

  useEffect(() => {
    if (!user) {
      navigate('/login', { replace: true })
      return
    }
    if (!orderId) return

    getOrder(supabase, orderId).then(({ order: o, error }) => {
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
        navigate('/account/orders', { replace: true, state: { fromCancelledOrder: o.cancelled_reason ?? t('checkout.awaiting.cancelledDefault') } })
        return
      }
      orderRef.current = o
      setOrder(o)
      setLoading(false)
      startPolling()
    })

    return () => {
      stopPolling()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, orderId])

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        stopPolling()
      } else if (order) {
        startPolling()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order])

  if (!user) return null

  if (loading) {
    return (
      <div style={{ padding: '80px 56px', textAlign: 'center' }}>
        <div
          style={{
            width: 32,
            height: 32,
            border: '3px solid var(--border)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'spin 0.7s linear infinite',
            margin: '0 auto',
          }}
        />
      </div>
    )
  }

  if (notFound) {
    return (
      <div data-testid="awaiting-not-found" style={{ padding: '80px 56px', textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--font-serif)', fontSize: 28, color: 'var(--ink-1)' }}>
          {t('checkout.notFound')}
        </p>
        <Link
          to="/account/orders"
          className="btn btn-secondary"
          style={{ marginTop: 16, display: 'inline-block' }}
        >
          {t('account.orders.title')}
        </Link>
      </div>
    )
  }

  if (!order) return null

  return (
    <main style={{ padding: '48px 56px', minHeight: '100vh' }}>
      <div
        style={{
          maxWidth: 480,
          margin: '0 auto',
          textAlign: 'center',
        }}
      >
        {/* Hourglass icon */}
        <div style={{ marginBottom: 24 }}>
          <svg
            width={64}
            height={64}
            viewBox="0 0 24 24"
            fill="none"
            stroke="oklch(0.7 0.16 80)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 22h14" />
            <path d="M5 2h14" />
            <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
            <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
          </svg>
        </div>

        {/* Heading */}
        <h1
          data-testid="awaiting-heading"
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 32,
            color: 'var(--ink-1)',
            margin: '0 0 16px',
            lineHeight: 1.2,
          }}
        >
          {t('checkout.awaiting.title')}
        </h1>

        {/* Body text */}
        <p
          style={{
            fontSize: 14,
            color: 'var(--ink-2)',
            lineHeight: 1.55,
            margin: '0 0 24px',
          }}
        >
          {t('checkout.awaiting.body')}
        </p>

        {/* Order details card */}
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            padding: 24,
            marginBottom: 24,
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
            <span style={{ color: 'var(--ink-3)' }}>{t('checkout.awaiting.orderCode')}</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--ink-1)' }}>
              {order.code}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
            <span style={{ color: 'var(--ink-3)' }}>{t('checkout.awaiting.course')}</span>
            <span style={{ color: 'var(--ink-1)', fontWeight: 500 }}>{order.course?.title ?? ''}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
            <span style={{ color: 'var(--ink-3)' }}>{t('checkout.awaiting.amount')}</span>
            <span data-testid="awaiting-amount" style={{ color: 'var(--ink-1)', fontWeight: 600 }}>
              {formatVnd(order.amount)}
            </span>
          </div>
        </div>

        {/* CTA row */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <Link
            data-testid="awaiting-go-home"
            to="/"
            className="btn btn-secondary"
          >
            {t('checkout.awaiting.goHome')}
          </Link>
          <Link
            data-testid="awaiting-view-orders"
            to="/account/orders"
            className="btn btn-ghost"
          >
            {t('checkout.awaiting.viewOrders')}
          </Link>
        </div>
      </div>
    </main>
  )
}
