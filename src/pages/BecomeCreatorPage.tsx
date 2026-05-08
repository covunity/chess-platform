import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import {
  getMyLatestApplication,
  submitCreatorApplication,
} from '../lib/creatorApplicationApi'
import type { CreatorApplication } from '../lib/creatorApplicationApi'

const MOTIVATION_MAX = 600
const EXPERIENCE_MAX = 600

export default function BecomeCreatorPage() {
  const { t } = useTranslation()
  const { user, loading: authLoading, profile, profileLoading } = useAuth()

  const [application, setApplication] = useState<CreatorApplication | null>(null)
  const [loading, setLoading] = useState(true)

  const [motivation, setMotivation] = useState('')
  const [experience, setExperience] = useState('')
  const [sampleUrl, setSampleUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }
    let cancelled = false
    getMyLatestApplication(supabase, user.id).then(({ application }) => {
      if (cancelled) return
      setApplication(application)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [user])

  if (authLoading || profileLoading) {
    return (
      <div
        data-testid="become-creator-loading"
        aria-label="Loading"
        style={{ minHeight: 240 }}
      />
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ next: '/become-creator' }} />
  }

  if (profile?.role === 'creator' || profile?.role === 'admin') {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 32px' }}>
        <Eyebrow>{t('becomeCreator.eyebrow', 'TRỞ THÀNH CREATOR')}</Eyebrow>
        <Heading>
          {t('becomeCreator.alreadyCreatorHeading', 'Bạn đã là creator.')}
        </Heading>
        <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6, marginTop: 12 }}>
          {t(
            'becomeCreator.alreadyCreatorBody',
            'Bạn đã có quyền tạo và xuất bản khóa học. Truy cập Creator Studio để bắt đầu.'
          )}
        </p>
        <div style={{ marginTop: 24 }}>
          <Link to="/creator" className="btn btn-accent">
            {t('becomeCreator.openStudio', 'Mở Creator Studio')}
          </Link>
        </div>
      </div>
    )
  }

  const canSubmit = !application || application.status === 'rejected'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    if (motivation.trim().length < 20) {
      setSubmitError(t('becomeCreator.errors.motivation', 'Vui lòng mô tả động lực ít nhất 20 ký tự.'))
      return
    }
    if (experience.trim().length < 20) {
      setSubmitError(t('becomeCreator.errors.experience', 'Vui lòng mô tả kinh nghiệm ít nhất 20 ký tự.'))
      return
    }
    setSubmitError(null)
    setSubmitting(true)
    const { application: created, error } = await submitCreatorApplication(supabase, user.id, {
      motivation,
      experience,
      sample_url: sampleUrl,
    })
    setSubmitting(false)
    if (error) {
      setSubmitError(t('becomeCreator.errors.generic', 'Không thể gửi đơn. Vui lòng thử lại.'))
      return
    }
    setApplication(created)
    setMotivation('')
    setExperience('')
    setSampleUrl('')
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 32px' }}>
      <Eyebrow>{t('becomeCreator.eyebrow', 'TRỞ THÀNH CREATOR')}</Eyebrow>
      <Heading>
        {t('becomeCreator.heading', 'Chia sẻ kiến thức cờ vua của bạn.')}
      </Heading>
      <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6, marginTop: 12, maxWidth: 560 }}>
        {t(
          'becomeCreator.intro',
          'Gambitly tuyển chọn các creator có chuyên môn cờ vua rõ ràng. Sau khi gửi đơn, đội ngũ admin sẽ xem xét và phản hồi qua email trong vòng vài ngày.'
        )}
      </p>

      {loading ? (
        <div
          data-testid="become-creator-status-loading"
          style={{ marginTop: 32, color: 'var(--ink-3)', fontSize: 14 }}
        >
          {t('becomeCreator.statusLoading', 'Đang tải...')}
        </div>
      ) : application && application.status === 'pending' ? (
        <StatusCard
          tone="warning"
          testId="application-status-pending"
          heading={t('becomeCreator.pendingHeading', 'Đơn của bạn đang được xem xét.')}
          body={t(
            'becomeCreator.pendingBody',
            'Chúng tôi sẽ phản hồi qua email khi có kết quả.'
          )}
          submittedAt={application.created_at}
        />
      ) : application && application.status === 'approved' ? (
        <StatusCard
          tone="success"
          testId="application-status-approved"
          heading={t('becomeCreator.approvedHeading', 'Đơn của bạn đã được duyệt!')}
          body={t(
            'becomeCreator.approvedBody',
            'Tài khoản của bạn đã được nâng cấp lên creator. Hãy mở lại trang để truy cập Creator Studio.'
          )}
          submittedAt={application.created_at}
        />
      ) : application && application.status === 'rejected' ? (
        <StatusCard
          tone="danger"
          testId="application-status-rejected"
          heading={t('becomeCreator.rejectedHeading', 'Đơn của bạn chưa được duyệt.')}
          body={
            application.rejection_reason ??
            t('becomeCreator.rejectedBodyFallback', 'Bạn có thể chỉnh sửa và gửi lại đơn dưới đây.')
          }
          submittedAt={application.created_at}
        />
      ) : null}

      {canSubmit && !loading && (
        <form
          onSubmit={handleSubmit}
          data-testid="creator-application-form"
          style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 18 }}
        >
          <Field
            label={t('becomeCreator.fieldMotivationLabel', 'Vì sao bạn muốn trở thành creator?')}
            hint={t(
              'becomeCreator.fieldMotivationHint',
              'Chia sẻ ngắn gọn (tối thiểu 20 ký tự, tối đa 600 ký tự).'
            )}
          >
            <textarea
              data-testid="field-motivation"
              className="input"
              value={motivation}
              onChange={e => setMotivation(e.target.value)}
              maxLength={MOTIVATION_MAX}
              style={{ minHeight: 120, padding: 12, lineHeight: 1.5 }}
            />
          </Field>

          <Field
            label={t('becomeCreator.fieldExperienceLabel', 'Kinh nghiệm cờ vua / giảng dạy của bạn')}
            hint={t(
              'becomeCreator.fieldExperienceHint',
              'Giải đấu, ELO, kênh dạy, học sinh… (tối thiểu 20 ký tự).'
            )}
          >
            <textarea
              data-testid="field-experience"
              className="input"
              value={experience}
              onChange={e => setExperience(e.target.value)}
              maxLength={EXPERIENCE_MAX}
              style={{ minHeight: 120, padding: 12, lineHeight: 1.5 }}
            />
          </Field>

          <Field
            label={t('becomeCreator.fieldSampleLabel', 'Link mẫu (tùy chọn)')}
            hint={t(
              'becomeCreator.fieldSampleHint',
              'YouTube, Lichess study, hoặc bất kỳ tài liệu nào thể hiện chuyên môn của bạn.'
            )}
          >
            <input
              data-testid="field-sample"
              className="input"
              type="url"
              value={sampleUrl}
              onChange={e => setSampleUrl(e.target.value)}
              placeholder="https://"
            />
          </Field>

          {submitError && (
            <div
              role="alert"
              data-testid="submit-error"
              style={{
                background: 'var(--danger-soft)',
                color: 'var(--danger)',
                borderRadius: 'var(--r-md)',
                padding: '10px 14px',
                fontSize: 13,
              }}
            >
              {submitError}
            </div>
          )}

          <div>
            <button
              type="submit"
              className="btn btn-accent"
              data-testid="submit-application"
              disabled={submitting}
            >
              {submitting
                ? t('becomeCreator.submitting', 'Đang gửi...')
                : application?.status === 'rejected'
                  ? t('becomeCreator.resubmit', 'Gửi lại đơn')
                  : t('becomeCreator.submit', 'Gửi đơn')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--ink-3)',
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h1
      style={{
        fontFamily: 'var(--font-serif)',
        fontSize: 38,
        fontWeight: 400,
        color: 'var(--ink-1)',
        margin: 0,
        letterSpacing: '-0.02em',
      }}
    >
      {children}
    </h1>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="label" style={{ marginBottom: 0 }}>
        {label}
      </span>
      {children}
      {hint && (
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{hint}</span>
      )}
    </div>
  )
}

function StatusCard({
  tone,
  testId,
  heading,
  body,
  submittedAt,
}: {
  tone: 'warning' | 'success' | 'danger'
  testId: string
  heading: string
  body: string
  submittedAt: string
}) {
  const palette = {
    warning: { bg: 'var(--warning-soft)', fg: 'var(--warning)' },
    success: { bg: 'var(--success-soft)', fg: 'var(--success)' },
    danger: { bg: 'var(--danger-soft)', fg: 'var(--danger)' },
  }[tone]

  return (
    <div
      data-testid={testId}
      style={{
        marginTop: 32,
        background: palette.bg,
        borderRadius: 'var(--r-lg)',
        padding: 20,
        border: '1px solid var(--border)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: palette.fg, margin: 0 }}>{heading}</h2>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--ink-3)',
          }}
        >
          {new Date(submittedAt).toLocaleDateString('vi-VN')}
        </span>
      </div>
      <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 10, marginBottom: 0 }}>
        {body}
      </p>
    </div>
  )
}
