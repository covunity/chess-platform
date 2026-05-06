import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import AuthLayout from '../components/auth/AuthLayout'
import { useAuth } from '../context/AuthContext'
import { validateLogin } from '../lib/authValidation'

export default function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { signIn } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const fieldErrors = validateLogin(email, password)
    if (Object.keys(fieldErrors).length > 0) {
      const translated: Record<string, string> = {}
      for (const [k, v] of Object.entries(fieldErrors)) {
        translated[k] = t(`auth.${v}`)
      }
      setErrors(translated)
      return
    }

    setErrors({})
    setServerError('')
    setSubmitting(true)

    try {
      const { error } = await signIn(email, password)
      if (error) {
        setServerError(error.message)
        return
      }
      navigate('/')
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
        <button type="button" className="btn btn-secondary" disabled>
          {t('auth.login.googleBtn')}
        </button>
        <button type="button" className="btn btn-secondary" disabled>
          {t('auth.login.facebookBtn')}
        </button>
      </div>

      <div className="auth-divider">
        <span>{t('auth.login.orWithEmail')}</span>
      </div>

      {serverError && (
        <p role="alert" className="auth-server-error">{serverError}</p>
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
