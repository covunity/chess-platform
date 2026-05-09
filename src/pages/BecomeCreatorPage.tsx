import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { getMyLatestAccountApplication, submitAccountApplication } from '../lib/accountApplicationApi'
import type { AccountApplication } from '../lib/accountApplicationApi'
import {
  savePendingAccountApplication,
  getPendingAccountApplication,
  clearPendingAccountApplication,
  getPendingApplicationFromUserMetadata,
  clearPendingApplicationFromMetadata,
} from '../lib/pendingAccountApplication'
import { useAccountTiers } from '../lib/accountTiers'
import type { AccountTier, AccountTierCode } from '../lib/accountTiers'

const MOTIVATION_MAX = 600
const EXPERIENCE_MAX = 600

// ─── Tier-specific metadata ──────────────────────────────────────────────────

interface TierFields {
  businessName: string
  businessRegistrationNo: string
  federationOrTeam: string
  centerAddress: string
  centerSize: string
}

const EMPTY_TIER_FIELDS: TierFields = {
  businessName: '',
  businessRegistrationNo: '',
  federationOrTeam: '',
  centerAddress: '',
  centerSize: '',
}

function buildMetadata(tier: AccountTierCode, fields: TierFields): Record<string, unknown> {
  if (tier === 'business') {
    return {
      business_name: fields.businessName.trim(),
      business_registration_no: fields.businessRegistrationNo.trim(),
    }
  }
  if (tier === 'athlete') {
    return { federation_or_team: fields.federationOrTeam.trim() }
  }
  if (tier === 'training_center') {
    return {
      center_address: fields.centerAddress.trim(),
      center_size: parseInt(fields.centerSize, 10),
    }
  }
  return {}
}

function validateTierFields(
  tier: AccountTierCode,
  fields: TierFields,
  t: (k: string) => string
): string | null {
  if (tier === 'business') {
    if (!fields.businessName.trim()) return t('becomeCreator.errors.businessName')
    if (!fields.businessRegistrationNo.trim()) return t('becomeCreator.errors.businessRegistrationNo')
  }
  if (tier === 'athlete') {
    if (!fields.federationOrTeam.trim()) return t('becomeCreator.errors.federationOrTeam')
  }
  if (tier === 'training_center') {
    if (!fields.centerAddress.trim()) return t('becomeCreator.errors.centerAddress')
    const size = parseInt(fields.centerSize, 10)
    if (!fields.centerSize.trim() || isNaN(size) || size <= 0) return t('becomeCreator.errors.centerSize')
  }
  return null
}

// ─── Tier selector cards ─────────────────────────────────────────────────────

function TierSelectorCards({
  tiers,
  selected,
  onSelect,
  t,
}: {
  tiers: AccountTier[]
  selected: AccountTierCode
  onSelect: (code: AccountTierCode) => void
  t: (k: string, opts?: Record<string, string | number>) => string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="label" style={{ marginBottom: 0 }}>
        {t('becomeCreator.tierSelector.heading')}
      </span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {tiers.map(tier => (
          <button
            key={tier.code}
            type="button"
            data-testid={`tier-card-${tier.code}`}
            aria-pressed={selected === tier.code}
            onClick={() => onSelect(tier.code)}
            style={{
              textAlign: 'left',
              padding: '12px 14px',
              borderRadius: 'var(--r-md)',
              border: selected === tier.code
                ? '2px solid var(--accent)'
                : '1px solid var(--border)',
              background: selected === tier.code ? 'var(--accent-soft)' : 'var(--surface)',
              cursor: 'pointer',
              transition: 'border-color 0.15s, background 0.15s',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 4 }}>
              {tier.name_vi}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              {t('becomeCreator.tierSelector.feeLabel', { pct: tier.platform_fee_pct })}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              {t('becomeCreator.tierSelector.maxChaptersLabel', { max: tier.max_chapters_per_course })}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Tier-specific fields ────────────────────────────────────────────────────

function TierSpecificFields({
  tier,
  fields,
  onChange,
  t,
}: {
  tier: AccountTierCode
  fields: TierFields
  onChange: (partial: Partial<TierFields>) => void
  t: (k: string) => string
}) {
  if (tier === 'business') {
    return (
      <>
        <Field label={t('becomeCreator.fields.businessName')}>
          <input
            data-testid="field-business-name"
            className="input"
            type="text"
            value={fields.businessName}
            onChange={e => onChange({ businessName: e.target.value })}
          />
        </Field>
        <Field label={t('becomeCreator.fields.businessRegistrationNo')}>
          <input
            data-testid="field-business-registration-no"
            className="input"
            type="text"
            value={fields.businessRegistrationNo}
            onChange={e => onChange({ businessRegistrationNo: e.target.value })}
          />
        </Field>
      </>
    )
  }
  if (tier === 'athlete') {
    return (
      <Field label={t('becomeCreator.fields.federationOrTeam')}>
        <input
          data-testid="field-federation-or-team"
          className="input"
          type="text"
          value={fields.federationOrTeam}
          onChange={e => onChange({ federationOrTeam: e.target.value })}
        />
      </Field>
    )
  }
  if (tier === 'training_center') {
    return (
      <>
        <Field label={t('becomeCreator.fields.centerAddress')}>
          <input
            data-testid="field-center-address"
            className="input"
            type="text"
            value={fields.centerAddress}
            onChange={e => onChange({ centerAddress: e.target.value })}
          />
        </Field>
        <Field label={t('becomeCreator.fields.centerSize')}>
          <input
            data-testid="field-center-size"
            className="input"
            type="number"
            min={1}
            value={fields.centerSize}
            onChange={e => onChange({ centerSize: e.target.value })}
          />
        </Field>
      </>
    )
  }
  return null
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BecomeCreatorPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, loading: authLoading, profile, profileLoading, signUp } = useAuth()
  const { tiers } = useAccountTiers()

  const enterpriseTiers = tiers.filter(ti => ti.is_enterprise)

  const initialTier = (searchParams.get('tier') as AccountTierCode) || 'individual'
  const [requestedTier, setRequestedTier] = useState<AccountTierCode>(initialTier)
  const [tierFields, setTierFields] = useState<TierFields>(EMPTY_TIER_FIELDS)

  const [application, setApplication] = useState<AccountApplication | null>(null)
  const [loading, setLoading] = useState(true)

  // Application form fields
  const [motivation, setMotivation] = useState('')
  const [experience, setExperience] = useState('')
  const [sampleUrl, setSampleUrl] = useState('')

  // Auth fields (anon path only)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const submittingRef = useRef(false)

  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }
    let cancelled = false
    getMyLatestAccountApplication(supabase, user.id).then(({ application: app }) => {
      if (cancelled) return
      setApplication(app)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [user])

  // Auto-submit from localStorage after email verification + login (learners only)
  useEffect(() => {
    if (!user || loading) return
    if (application && (application.status === 'pending' || application.status === 'approved')) return
    if (profile?.role === 'creator' || profile?.role === 'admin') return

    const pending =
      getPendingAccountApplication() ??
      getPendingApplicationFromUserMetadata(user.user_metadata as Record<string, unknown>)
    if (!pending) return

    // Guard against StrictMode double-fire: ref persists across the unmount/remount cycle
    if (submittingRef.current) return
    submittingRef.current = true

    let cancelled = false
    setSubmitting(true)
    setSubmitError(null)
    submitAccountApplication(supabase, {
      requested_tier_code: pending.requested_tier_code,
      motivation: pending.motivation ?? '',
      experience: pending.experience ?? '',
      sample_url: pending.sample_url,
      metadata: pending.metadata,
    }).then(({ id, error }) => {
      if (cancelled) return
      setSubmitting(false)
      if (error) {
        setSubmitError(t('becomeCreator.errors.generic'))
        return
      }
      clearPendingAccountApplication()
      clearPendingApplicationFromMetadata(supabase)
      if (id) {
        getMyLatestAccountApplication(supabase, user.id).then(({ application: app }) => {
          if (!cancelled) setApplication(app)
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, [user, loading, application, profile, t])

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
    return (
      <AnonCombinedForm
        t={t}
        tiers={tiers}
        requestedTier={requestedTier}
        setRequestedTier={setRequestedTier}
        tierFields={tierFields}
        setTierFields={setTierFields}
        name={name} setName={setName}
        email={email} setEmail={setEmail}
        password={password} setPassword={setPassword}
        motivation={motivation} setMotivation={setMotivation}
        experience={experience} setExperience={setExperience}
        sampleUrl={sampleUrl} setSampleUrl={setSampleUrl}
        submitting={submitting} setSubmitting={setSubmitting}
        submitError={submitError} setSubmitError={setSubmitError}
        signUp={signUp}
        navigate={navigate}
      />
    )
  }

  // Admin always sees "already creator" panel
  if (profile?.role === 'admin') {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 32px' }}>
        <Eyebrow>{t('becomeCreator.eyebrow')}</Eyebrow>
        <Heading>{t('becomeCreator.alreadyCreatorHeading')}</Heading>
        <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6, marginTop: 12 }}>
          {t('becomeCreator.alreadyCreatorBody')}
        </p>
        <div style={{ marginTop: 24 }}>
          <Link to="/creator" className="btn btn-accent">
            {t('becomeCreator.openStudio')}
          </Link>
        </div>
      </div>
    )
  }

  // Creator with enterprise tier → already upgraded
  if (profile?.role === 'creator' && profile.account_tier_id !== 'individual') {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 32px' }}>
        <Eyebrow>{t('becomeCreator.eyebrow')}</Eyebrow>
        <Heading data-testid="already-enterprise-heading">
          {t('becomeCreator.alreadyEnterpriseHeading')}
        </Heading>
        <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6, marginTop: 12 }}>
          {t('becomeCreator.alreadyEnterpriseBody')}
        </p>
        <div style={{ marginTop: 24 }}>
          <Link to="/creator" className="btn btn-accent">
            {t('becomeCreator.openStudio')}
          </Link>
        </div>
      </div>
    )
  }

  // Creator with individual tier → upgrade form
  if (profile?.role === 'creator' && profile.account_tier_id === 'individual') {
    const canUpgrade = !application || application.status !== 'pending'

    async function handleUpgradeSubmit(e: React.FormEvent) {
      e.preventDefault()
      if (!user) return

      const tierError = validateTierFields(requestedTier, tierFields, t)
      if (tierError) { setSubmitError(tierError); return }
      if (motivation.trim().length < 20) { setSubmitError(t('becomeCreator.errors.motivation')); return }
      if (experience.trim().length < 20) { setSubmitError(t('becomeCreator.errors.experience')); return }

      setSubmitError(null)
      setSubmitting(true)
      const metadata = buildMetadata(requestedTier, tierFields)
      const { id, error } = await submitAccountApplication(supabase, {
        requested_tier_code: requestedTier,
        motivation,
        experience,
        sample_url: sampleUrl || undefined,
        metadata,
      })
      setSubmitting(false)
      if (error) { setSubmitError(t('becomeCreator.errors.generic')); return }
      if (id) {
        const { application: app } = await getMyLatestAccountApplication(supabase, user.id)
        setApplication(app)
      }
      setMotivation('')
      setExperience('')
      setSampleUrl('')
      setTierFields(EMPTY_TIER_FIELDS)
    }

    // Use first enterprise tier as default when on upgrade path
    const upgradeDefaultTier = enterpriseTiers[0]?.code ?? 'business'
    const upgradeSelectedTier = enterpriseTiers.some(t => t.code === requestedTier)
      ? requestedTier
      : upgradeDefaultTier

    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 32px' }}>
        {/* Upgrade banner */}
        <div
          data-testid="upgrade-banner"
          style={{
            background: 'var(--accent-soft)',
            border: '1px solid var(--accent-border)',
            borderRadius: 'var(--r-md)',
            padding: '12px 16px',
            marginBottom: 28,
            fontSize: 13.5,
            color: 'var(--accent-ink)',
          }}
        >
          {t('becomeCreator.upgradeBanner')}
        </div>

        <Eyebrow>{t('becomeCreator.eyebrow')}</Eyebrow>
        <Heading>{t('becomeCreator.upgradeHeading')}</Heading>
        <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6, marginTop: 12, maxWidth: 560 }}>
          {t('becomeCreator.upgradeIntro')}
        </p>

        {loading || submitting ? (
          <div data-testid="become-creator-status-loading" style={{ marginTop: 32, color: 'var(--ink-3)', fontSize: 14 }}>
            {t('becomeCreator.statusLoading')}
          </div>
        ) : application?.status === 'pending' ? (
          <StatusCard
            tone="warning"
            testId="application-status-pending"
            heading={t('becomeCreator.pendingHeading')}
            body={t('becomeCreator.pendingBody')}
            submittedAt={application.created_at}
          />
        ) : null}

        {submitError && (
          <div
            role="alert"
            data-testid="submit-error"
            style={{ background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 'var(--r-md)', padding: '10px 14px', fontSize: 13, marginTop: 16 }}
          >
            {submitError}
          </div>
        )}

        {canUpgrade && !loading && !submitting && (
          <form
            onSubmit={handleUpgradeSubmit}
            data-testid="upgrade-form"
            style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 18 }}
          >
            {enterpriseTiers.length > 0 && (
              <TierSelectorCards
                tiers={enterpriseTiers}
                selected={upgradeSelectedTier}
                onSelect={code => {
                  setRequestedTier(code)
                  setTierFields(EMPTY_TIER_FIELDS)
                }}
                t={t}
              />
            )}

            <TierSpecificFields
              tier={upgradeSelectedTier}
              fields={tierFields}
              onChange={partial => setTierFields(prev => ({ ...prev, ...partial }))}
              t={t}
            />

            <Field label={t('becomeCreator.fieldMotivationLabel')} hint={t('becomeCreator.fieldMotivationHint')}>
              <textarea
                data-testid="field-motivation"
                className="input"
                value={motivation}
                onChange={e => setMotivation(e.target.value)}
                maxLength={MOTIVATION_MAX}
                style={{ minHeight: 120, padding: 12, lineHeight: 1.5 }}
              />
            </Field>

            <Field label={t('becomeCreator.fieldExperienceLabel')} hint={t('becomeCreator.fieldExperienceHint')}>
              <textarea
                data-testid="field-experience"
                className="input"
                value={experience}
                onChange={e => setExperience(e.target.value)}
                maxLength={EXPERIENCE_MAX}
                style={{ minHeight: 120, padding: 12, lineHeight: 1.5 }}
              />
            </Field>

            <Field label={t('becomeCreator.fieldSampleLabel')} hint={t('becomeCreator.fieldSampleHint')}>
              <input
                data-testid="field-sample"
                className="input"
                type="url"
                value={sampleUrl}
                onChange={e => setSampleUrl(e.target.value)}
                placeholder="https://"
              />
            </Field>

            <div>
              <button
                type="submit"
                className="btn btn-accent"
                data-testid="submit-application"
                disabled={submitting}
              >
                {submitting ? t('becomeCreator.submitting') : t('becomeCreator.upgradeSubmit')}
              </button>
            </div>
          </form>
        )}
      </div>
    )
  }

  // Learner (default)
  const canSubmit = !application || application.status === 'rejected'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return

    const tierError = validateTierFields(requestedTier, tierFields, t)
    if (tierError) { setSubmitError(tierError); return }
    if (motivation.trim().length < 20) { setSubmitError(t('becomeCreator.errors.motivation')); return }
    if (experience.trim().length < 20) { setSubmitError(t('becomeCreator.errors.experience')); return }

    setSubmitError(null)
    setSubmitting(true)
    const metadata = buildMetadata(requestedTier, tierFields)
    const { id, error } = await submitAccountApplication(supabase, {
      requested_tier_code: requestedTier,
      motivation,
      experience,
      sample_url: sampleUrl || undefined,
      metadata,
    })
    setSubmitting(false)
    if (error) { setSubmitError(t('becomeCreator.errors.generic')); return }
    if (id) {
      const { application: created } = await getMyLatestAccountApplication(supabase, user.id)
      setApplication(created)
    }
    setMotivation('')
    setExperience('')
    setSampleUrl('')
    setTierFields(EMPTY_TIER_FIELDS)
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 32px' }}>
      <Eyebrow>{t('becomeCreator.eyebrow')}</Eyebrow>
      <Heading>{t('becomeCreator.heading')}</Heading>
      <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6, marginTop: 12, maxWidth: 560 }}>
        {t('becomeCreator.intro')}
      </p>

      {loading || submitting ? (
        <div data-testid="become-creator-status-loading" style={{ marginTop: 32, color: 'var(--ink-3)', fontSize: 14 }}>
          {t('becomeCreator.statusLoading')}
        </div>
      ) : application && application.status === 'pending' ? (
        <StatusCard tone="warning" testId="application-status-pending" heading={t('becomeCreator.pendingHeading')} body={t('becomeCreator.pendingBody')} submittedAt={application.created_at} />
      ) : application && application.status === 'approved' ? (
        <StatusCard tone="success" testId="application-status-approved" heading={t('becomeCreator.approvedHeading')} body={t('becomeCreator.approvedBody')} submittedAt={application.created_at} />
      ) : application && application.status === 'rejected' ? (
        <StatusCard tone="danger" testId="application-status-rejected" heading={t('becomeCreator.rejectedHeading')} body={application.rejection_reason ?? t('becomeCreator.rejectedBodyFallback')} submittedAt={application.created_at} />
      ) : null}

      {submitError && (
        <div role="alert" data-testid="submit-error" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 'var(--r-md)', padding: '10px 14px', fontSize: 13, marginTop: 16 }}>
          {submitError}
        </div>
      )}

      {canSubmit && !loading && !submitting && (
        <form
          onSubmit={handleSubmit}
          data-testid="creator-application-form"
          style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 18 }}
        >
          {tiers.length > 0 && (
            <TierSelectorCards
              tiers={tiers}
              selected={requestedTier}
              onSelect={code => {
                setRequestedTier(code)
                setTierFields(EMPTY_TIER_FIELDS)
              }}
              t={t}
            />
          )}

          <TierSpecificFields tier={requestedTier} fields={tierFields} onChange={partial => setTierFields(prev => ({ ...prev, ...partial }))} t={t} />

          <Field label={t('becomeCreator.fieldMotivationLabel')} hint={t('becomeCreator.fieldMotivationHint')}>
            <textarea data-testid="field-motivation" className="input" value={motivation} onChange={e => setMotivation(e.target.value)} maxLength={MOTIVATION_MAX} style={{ minHeight: 120, padding: 12, lineHeight: 1.5 }} />
          </Field>

          <Field label={t('becomeCreator.fieldExperienceLabel')} hint={t('becomeCreator.fieldExperienceHint')}>
            <textarea data-testid="field-experience" className="input" value={experience} onChange={e => setExperience(e.target.value)} maxLength={EXPERIENCE_MAX} style={{ minHeight: 120, padding: 12, lineHeight: 1.5 }} />
          </Field>

          <Field label={t('becomeCreator.fieldSampleLabel')} hint={t('becomeCreator.fieldSampleHint')}>
            <input data-testid="field-sample" className="input" type="url" value={sampleUrl} onChange={e => setSampleUrl(e.target.value)} placeholder="https://" />
          </Field>

          <div>
            <button type="submit" className="btn btn-accent" data-testid="submit-application" disabled={submitting}>
              {submitting ? t('becomeCreator.submitting') : application?.status === 'rejected' ? t('becomeCreator.resubmit') : t('becomeCreator.submit')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ─── Anon combined form ───────────────────────────────────────────────────────

interface AnonFormProps {
  t: (k: string, opts?: Record<string, string | number>) => string
  tiers: AccountTier[]
  requestedTier: AccountTierCode
  setRequestedTier: (c: AccountTierCode) => void
  tierFields: TierFields
  setTierFields: (f: TierFields) => void
  name: string; setName: (v: string) => void
  email: string; setEmail: (v: string) => void
  password: string; setPassword: (v: string) => void
  motivation: string; setMotivation: (v: string) => void
  experience: string; setExperience: (v: string) => void
  sampleUrl: string; setSampleUrl: (v: string) => void
  submitting: boolean; setSubmitting: (v: boolean) => void
  submitError: string | null; setSubmitError: (v: string | null) => void
  signUp: (name: string, email: string, password: string, extraData?: Record<string, unknown>) => Promise<{ error: Error | null }>
  navigate: (path: string) => void
}

function AnonCombinedForm({
  t, tiers,
  requestedTier, setRequestedTier,
  tierFields, setTierFields,
  name, setName,
  email, setEmail,
  password, setPassword,
  motivation, setMotivation,
  experience, setExperience,
  sampleUrl, setSampleUrl,
  submitting, setSubmitting,
  submitError, setSubmitError,
  signUp, navigate,
}: AnonFormProps) {
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const displayName = requestedTier === 'business' ? tierFields.businessName.trim() : name.trim()

    if (!displayName) {
      setSubmitError(
        requestedTier === 'business'
          ? t('becomeCreator.errors.businessName')
          : t('becomeCreator.combined.errors.name')
      )
      return
    }
    if (!email.trim()) { setSubmitError(t('becomeCreator.combined.errors.email')); return }
    if (password.length < 6) { setSubmitError(t('becomeCreator.combined.errors.password')); return }

    const tierError = validateTierFields(requestedTier, tierFields, t)
    if (tierError) { setSubmitError(tierError); return }

    setSubmitError(null)
    setSubmitting(true)

    const metadata = buildMetadata(requestedTier, tierFields)

    const pendingPayload = {
      requested_tier_code: requestedTier,
      motivation: motivation.trim() || undefined,
      experience: experience.trim() || undefined,
      sample_url: sampleUrl.trim() || undefined,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    }
    savePendingAccountApplication(pendingPayload)

    const { error } = await signUp(displayName, email.trim(), password, {
      pending_application: pendingPayload,
    })
    setSubmitting(false)
    if (error) {
      setSubmitError((error as { message?: string }).message ?? t('becomeCreator.errors.generic'))
      return
    }
    navigate('/check-email')
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 32px' }}>
      <Eyebrow>{t('becomeCreator.eyebrow')}</Eyebrow>
      <Heading>{t('becomeCreator.heading')}</Heading>
      <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6, marginTop: 12, maxWidth: 560 }}>
        {t('becomeCreator.intro')}
      </p>

      <form
        onSubmit={handleSubmit}
        data-testid="anon-combined-form"
        noValidate
        style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 18 }}
      >
        {tiers.length > 0 && (
          <TierSelectorCards
            tiers={tiers}
            selected={requestedTier}
            onSelect={code => {
              setRequestedTier(code)
              setTierFields(EMPTY_TIER_FIELDS)
            }}
            t={t}
          />
        )}

        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', margin: 0 }}>
          {t('becomeCreator.combined.authSection')}
        </p>

        {requestedTier !== 'business' && (
          <Field label={t('becomeCreator.combined.fieldNameLabel')}>
            <input
              data-testid="field-name"
              className="input"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              autoComplete="name"
            />
          </Field>
        )}

        <Field label={t('becomeCreator.combined.fieldEmailLabel')}>
          <input
            data-testid="field-email"
            className="input"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
          />
        </Field>

        <Field label={t('becomeCreator.combined.fieldPasswordLabel')} hint={t('becomeCreator.combined.fieldPasswordHint')}>
          <input
            data-testid="field-password"
            className="input"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>

        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', margin: '8px 0 0' }}>
          {t('becomeCreator.combined.applicationSection')}
        </p>

        <TierSpecificFields
          tier={requestedTier}
          fields={tierFields}
          onChange={partial => setTierFields({ ...tierFields, ...partial })}
          t={t}
        />

        <Field label={t('becomeCreator.fieldMotivationLabel')} hint={t('becomeCreator.combined.optionalHint')}>
          <textarea
            data-testid="field-motivation"
            className="input"
            value={motivation}
            onChange={e => setMotivation(e.target.value)}
            maxLength={MOTIVATION_MAX}
            style={{ minHeight: 100, padding: 12, lineHeight: 1.5 }}
          />
        </Field>

        <Field label={t('becomeCreator.fieldExperienceLabel')} hint={t('becomeCreator.combined.optionalHint')}>
          <textarea
            data-testid="field-experience"
            className="input"
            value={experience}
            onChange={e => setExperience(e.target.value)}
            maxLength={EXPERIENCE_MAX}
            style={{ minHeight: 100, padding: 12, lineHeight: 1.5 }}
          />
        </Field>

        <Field label={t('becomeCreator.fieldSampleLabel')} hint={t('becomeCreator.combined.optionalHint')}>
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
            style={{ background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 'var(--r-md)', padding: '10px 14px', fontSize: 13 }}
          >
            {submitError}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            type="submit"
            className="btn btn-accent"
            data-testid="anon-submit"
            disabled={submitting}
          >
            {submitting ? t('becomeCreator.submitting') : t('becomeCreator.combined.submitBtn')}
          </button>
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            {t('becomeCreator.combined.orLogin')}{' '}
            <Link to="/login" className="link-accent">{t('becomeCreator.combined.loginLink')}</Link>
          </span>
        </div>
      </form>
    </div>
  )
}

// ─── Shared UI atoms ──────────────────────────────────────────────────────────

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>
      {children}
    </div>
  )
}

function Heading({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) {
  return (
    <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 38, fontWeight: 400, color: 'var(--ink-1)', margin: 0, letterSpacing: '-0.02em' }} {...props}>
      {children}
    </h1>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="label" style={{ marginBottom: 0 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{hint}</span>}
    </div>
  )
}

function StatusCard({
  tone, testId, heading, body, submittedAt,
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
    <div data-testid={testId} style={{ marginTop: 32, background: palette.bg, borderRadius: 'var(--r-lg)', padding: 20, border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: palette.fg, margin: 0 }}>{heading}</h2>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
          {new Date(submittedAt).toLocaleDateString('vi-VN')}
        </span>
      </div>
      <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 10, marginBottom: 0 }}>{body}</p>
    </div>
  )
}
