import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import AuthLayout from '../components/auth/AuthLayout'
import { useAuth } from '../context/AuthContext'
import { validateSignUp } from '../lib/authValidation'
import { GoogleIcon, FacebookIcon } from '../components/icons/BrandIcons'

type OAuthProvider = 'google' | 'facebook'

export default function SignUpPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { signUp, signInWithOAuth } = useAuth()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [tos, setTos] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null)

  async function handleOAuth(provider: OAuthProvider) {
    setServerError('')
    setOauthLoading(provider)
    const { error } = await signInWithOAuth(provider)
    if (error) {
      setServerError(t('auth.errors.oauthFailed', { provider: provider === 'google' ? 'Google' : 'Facebook' }))
      setOauthLoading(null)
    }
    // On success the browser is redirected to the provider — no need to clear state.
  }

  function translateServerError(message: string): string {
    const lower = message.toLowerCase()
    if (lower.includes('already registered') || lower.includes('already been registered')) {
      return t('auth.serverError.emailAlreadyRegistered')
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
    const fieldErrors = validateSignUp(name, trimmedEmail, password, confirmPassword, tos)
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
      const { error } = await signUp(name, trimmedEmail, password)
      if (error) {
        setServerError(translateServerError(error.message))
        return
      }
      navigate('/check-email')
    } catch {
      setServerError(t('auth.serverError.networkError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout>
      <p className="auth-eyebrow">{t('auth.signup.eyebrow')}</p>
      <h2 className="auth-heading">{t('auth.signup.heading')}</h2>
      <p className="auth-helper">{t('auth.signup.helper')}</p>

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
          <span>{t('auth.signup.googleBtn')}</span>
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
          <span>{t('auth.signup.facebookBtn')}</span>
        </button>
      </div>

      <div className="auth-divider">
        <span>{t('auth.signup.orWithEmail')}</span>
      </div>

      {serverError && (
        <p role="alert" className="auth-server-error">{serverError}</p>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="name" className="label">{t('auth.signup.fullName')}</label>
          <input
            id="name"
            type="text"
            className="input"
            value={name}
            onChange={e => setName(e.target.value)}
            autoComplete="name"
          />
          {errors.name && <p className="field-error">{errors.name}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="email" className="label">{t('auth.signup.email')}</label>
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
          <label htmlFor="password" className="label">{t('auth.signup.password')}</label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <p className="field-hint">{t('auth.signup.passwordHint')}</p>
          {errors.password && <p className="field-error">{errors.password}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="confirmPassword" className="label">{t('auth.signup.confirmPassword')}</label>
          <input
            id="confirmPassword"
            type="password"
            className="input"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
          {errors.confirmPassword && <p className="field-error">{errors.confirmPassword}</p>}
        </div>

        <div className="form-group form-group--checkbox">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={tos}
              onChange={e => setTos(e.target.checked)}
            />
            <span>
              {t('auth.signup.tosCheckbox')}{' '}
              <Link to="/terms" className="link-accent">{t('auth.signup.tosLink')}</Link>
              {' '}{t('auth.signup.andWord')}{' '}
              <Link to="/privacy" className="link-accent">{t('auth.signup.privacyLink')}</Link>
              .
            </span>
          </label>
          {errors.tos && <p className="field-error">{errors.tos}</p>}
        </div>

        <button
          type="submit"
          className="btn btn-accent btn-lg auth-cta"
          disabled={submitting}
        >
          {t('auth.signup.cta')}
          <span className="btn-arrow" aria-hidden="true">→</span>
        </button>
      </form>

      <p className="auth-footer-text">
        {t('auth.signup.footerPrompt')}{' '}
        <Link to="/login" className="link-accent">{t('auth.signup.footerLink')}</Link>
      </p>
    </AuthLayout>
  )
}
