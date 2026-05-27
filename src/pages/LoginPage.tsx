import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import AuthLayout from '../components/auth/AuthLayout'
import { useAuth } from '../context/AuthContext'
import { validateLogin } from '../lib/authValidation'
import { getPendingAccountApplication } from '../lib/pendingAccountApplication'
import { GoogleIcon, FacebookIcon } from '../components/icons/BrandIcons'

type OAuthProvider = 'google' | 'facebook'

export default function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { signIn, signInWithOAuth } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null)

  const oauthCallbackError = searchParams.get('error') === 'oauth_failed'
    ? t('auth.errors.oauthCallbackFailed')
    : ''
  const displayedServerError = serverError || oauthCallbackError

  async function handleOAuth(provider: OAuthProvider) {
    setServerError('')
    setOauthLoading(provider)
    const { error } = await signInWithOAuth(provider)
    if (error) {
      setServerError(t('auth.errors.oauthFailed', { provider: provider === 'google' ? 'Google' : 'Facebook' }))
      setOauthLoading(null)
    }
  }

  function translateServerError(message: string): string {
    const lower = message.toLowerCase()
    if (lower.includes('invalid login credentials') || lower.includes('invalid_credentials')) {
      return t('auth.serverError.invalidCredentials')
    }
    if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network')) {
      return t('auth.serverError.networkError')
    }
    if (lower.includes('too many requests') || lower.includes('rate limit')) {
      return t('auth.serverError.tooManyRequests')
    }
    return message
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setErrors({})
    setServerError('')

    const trimmedEmail = email.trim()
    const fieldErrors = validateLogin(trimmedEmail, password)
    if (Object.keys(fieldErrors).length > 0) {
      const translated: Record<string, string> = {}
      for (const [k, v] of Object.entries(fieldErrors)) {
        translated[k] = t(`auth.${v}`)
      }
      setErrors(translated)
      return
    }

    setSubmitting(true)

    try {
      const { error } = await signIn(trimmedEmail, password)
      if (error) {
        setServerError(translateServerError(error.message))
        return
      }
      if (getPendingAccountApplication()) {
        navigate('/become-creator')
      } else {
        navigate('/')
      }
    } catch {
      setServerError(t('auth.serverError.networkError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout>
      <p className="auth-eyebrow">{t('auth.login.eyebrow')}</p>
      <h2 className="auth-heading">{t('auth.login.heading')}</h2>
      <p className="auth-helper">{t('auth.login.helper')}</p>

      <div className="auth-oauth">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => handleOAuth('google')}
          disabled={oauthLoading !== null || submitting}
          aria-busy={oauthLoading === 'google'}
        >
          {oauthLoading === 'google' ? (
            <span className="btn-spinner" aria-hidden="true" />
          ) : (
            <GoogleIcon />
          )}
          <span>{t('auth.login.googleBtn')}</span>
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => handleOAuth('facebook')}
          disabled={oauthLoading !== null || submitting}
          aria-busy={oauthLoading === 'facebook'}
        >
          {oauthLoading === 'facebook' ? (
            <span className="btn-spinner" aria-hidden="true" />
          ) : (
            <FacebookIcon />
          )}
          <span>{t('auth.login.facebookBtn')}</span>
        </button>
      </div>

      <div className="auth-divider">
        <span>{t('auth.login.orWithEmail')}</span>
      </div>

      {displayedServerError && (
        <p role="alert" className="auth-server-error">{displayedServerError}</p>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="email" className="label">{t('auth.login.email')}</label>
          <input
            id="email"
            type="email"
            className="input"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
          />
          {errors.email && <p className="field-error">{errors.email}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="password" className="label">{t('auth.login.password')}</label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {errors.password && <p className="field-error">{errors.password}</p>}
          <div className="form-group__row">
            <Link to="/forgot-password" className="link-muted">{t('auth.login.forgotPassword')}</Link>
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-accent btn-lg auth-cta"
          disabled={submitting}
        >
          {t('auth.login.cta')}
          <span className="btn-arrow" aria-hidden="true">→</span>
        </button>
      </form>

      <p className="auth-footer-text">
        {t('auth.login.footerPrompt')}{' '}
        <Link to="/signup" className="link-accent">{t('auth.login.footerLink')}</Link>
      </p>
    </AuthLayout>
  )
}
