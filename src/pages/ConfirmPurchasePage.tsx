import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { getCourseDetail, checkUserEnrollment } from '../lib/coursesApi'
import type { CourseDetail } from '../lib/coursesApi'
import { getPendingOrderForCourse, previewPurchase, createOrder } from '../lib/orderApi'
import type { PurchasePreview } from '../lib/orderApi'

function formatVnd(n: number): string {
  return `${n.toLocaleString('vi-VN')} ₫`
}

export default function ConfirmPurchasePage() {
  const { courseId } = useParams<{ courseId: string }>()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const { t } = useTranslation()

  const [course, setCourse] = useState<CourseDetail | null>(null)
  const [preview, setPreview] = useState<PurchasePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(false)

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      navigate(`/login?redirect=/confirm-purchase/${courseId}`, { replace: true })
      return
    }
    if (!courseId) return

    let cancelled = false
    async function loadGuards() {
      const { course: data } = await getCourseDetail(supabase, courseId!)
      if (cancelled) return
      if (!data) {
        setNotFound(true)
        setLoading(false)
        return
      }

      const enrolled = await checkUserEnrollment(supabase, courseId!, user!.id)
      if (cancelled) return
      if (enrolled) {
        navigate(`/learn/${courseId}`, { replace: true })
        return
      }

      const { order: pending } = await getPendingOrderForCourse(supabase, courseId!, user!.id)
      if (cancelled) return
      if (pending) {
        navigate(`/checkout/${pending.id}`, { replace: true })
        return
      }

      const { preview: p } = await previewPurchase(supabase, courseId!)
      if (cancelled) return
      setCourse(data)
      setPreview(p)
      setLoading(false)
    }
    void loadGuards()
    return () => { cancelled = true }
  }, [authLoading, user, courseId, navigate])

  async function handleSubmit() {
    if (!courseId || submitting) return
    setSubmitting(true)
    setSubmitError(false)
    const { order, error } = await createOrder(supabase, courseId, null)
    setSubmitting(false)

    if (order) {
      // Free path (D-05): RPC returns an already-active order with the
      // enrollment row in place. Skip /checkout entirely.
      if (order.status === 'active') {
        navigate(`/learn/${courseId}`, {
          replace: true,
          state: { freeCourseToast: true },
        })
        return
      }
      navigate(`/checkout/${order.id}`, { replace: true })
      return
    }

    if (error) {
      const msg = (error as { message?: string }).message ?? ''
      if (msg.includes('duplicate_pending_order')) {
        const existingId = msg.split(':')[1]?.trim()
        if (existingId) {
          navigate(`/checkout/${existingId}`, { replace: true })
          return
        }
      }
      setSubmitError(true)
    }
  }

  if (authLoading || (user && loading)) {
    return (
      <div style={{ padding: '80px 56px', textAlign: 'center' }}>
        <div
          data-testid="confirm-purchase-loading"
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

  if (!user) return null

  if (notFound) {
    return (
      <div
        data-testid="confirm-purchase-not-found"
        style={{ padding: '80px 56px', textAlign: 'center' }}
      >
        <p style={{ fontFamily: 'var(--font-serif)', fontSize: 28, color: 'var(--ink-1)' }}>
          {t('confirmPurchase.notFound')}
        </p>
        <Link
          to="/"
          className="btn btn-secondary"
          style={{ marginTop: 16, display: 'inline-block' }}
        >
          {t('notFound.cta')}
        </Link>
      </div>
    )
  }

  if (!course || !preview) return null

  const hasCampaign = preview.campaign_id != null && preview.campaign_discount_amount > 0

  return (
    <main style={{ padding: '48px 56px', minHeight: '100vh' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <h1
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 32,
            color: 'var(--ink-1)',
            margin: '0 0 32px',
          }}
        >
          {t('confirmPurchase.title')}
        </h1>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1.2fr',
            gap: 24,
            alignItems: 'start',
          }}
        >
          {/* Left: course summary */}
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
              {t('confirmPurchase.summaryHeading')}
            </h2>

            {course.thumbnail_url ? (
              <img
                src={course.thumbnail_url}
                alt={course.title}
                style={{
                  width: '100%',
                  aspectRatio: '16/10',
                  objectFit: 'cover',
                  borderRadius: 'var(--r-md)',
                }}
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
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--ink-4)"
                  strokeWidth="1.5"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
              </div>
            )}

            <div>
              <div
                data-testid="confirm-course-title"
                style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', lineHeight: 1.3 }}
              >
                {course.title}
              </div>
              {course.creator_name && (
                <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
                  {course.creator_name}
                </div>
              )}
            </div>
          </div>

          {/* Right: breakdown */}
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>
              {t('confirmPurchase.breakdownHeading')}
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: 'var(--ink-2)' }}>{t('confirmPurchase.originalPrice')}</span>
                <span data-testid="confirm-original-price" style={{ color: 'var(--ink-1)' }}>
                  {formatVnd(preview.original_price)}
                </span>
              </div>

              {hasCampaign && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                    <span style={{ color: 'var(--ink-2)' }}>
                      {t('confirmPurchase.campaignDiscount')}
                    </span>
                    <span
                      data-testid="confirm-campaign-discount"
                      style={{ color: 'var(--success)' }}
                    >
                      -{formatVnd(preview.campaign_discount_amount)}
                    </span>
                  </div>
                  {preview.campaign_name && (
                    <span
                      data-testid="confirm-campaign-name"
                      style={{ fontSize: 12, color: 'var(--ink-3)' }}
                    >
                      {t('confirmPurchase.campaignName', { name: preview.campaign_name })}
                    </span>
                  )}
                </div>
              )}

              <div style={{ height: 1, background: 'var(--border)' }} />

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 16,
                  fontWeight: 600,
                }}
              >
                <span style={{ color: 'var(--ink-1)' }}>{t('confirmPurchase.total')}</span>
                <span
                  data-testid="confirm-total-price"
                  style={{ color: 'var(--ink-1)', fontFamily: 'var(--font-serif)', fontSize: 22 }}
                >
                  {formatVnd(preview.final_price)}
                </span>
              </div>
            </div>

            {submitError && (
              <div
                data-testid="confirm-submit-error"
                style={{
                  padding: '10px 14px',
                  background: 'var(--danger-soft)',
                  border: '1px solid var(--danger-border)',
                  borderRadius: 'var(--r-md)',
                  fontSize: 13,
                  color: 'var(--danger)',
                }}
              >
                {t('confirmPurchase.loadError')}
              </div>
            )}

            <button
              type="button"
              data-testid="confirm-submit-btn"
              className="btn btn-accent btn-lg"
              style={{ width: '100%' }}
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? t('confirmPurchase.submitting') : t('confirmPurchase.submit')}
            </button>

            <Link
              to={`/courses/${courseId}`}
              data-testid="confirm-back-link"
              className="btn btn-ghost"
              style={{ textAlign: 'center' }}
            >
              {t('confirmPurchase.back')}
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
