import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import AuthLayout from '../components/auth/AuthLayout'
import { useAuth } from '../context/AuthContext'
import { validateEmail } from '../lib/authValidation'

export default function ForgotPasswordPage() {
  const { t } = useTranslation()
  const { resetPassword } = useAuth()

  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [serverError, setServerError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const fieldErrors = validateEmail(email)
    if (fieldErrors.email) {
      setEmailError(t(`auth.${fieldErrors.email}`))
      return
    }

    setEmailError('')
    setServerError('')
    setSubmitting(true)

    try {
      const { error } = await resetPassword(email)
      if (error) {
        setServerError(error.message)
        return
      }
      setSubmitted(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <AuthLayout>
        <div className="auth-success">
          <div className="auth-success__icon" aria-hidden="true">✓</div>
          <h2 className="auth-heading">{t('auth.forgotPassword.successTitle')}</h2>
          <p className="auth-helper">{t('auth.forgotPassword.successBody')}</p>
          <Link to="/login" className="btn btn-secondary">{t('auth.forgotPassword.backToLogin')}</Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <p className="auth-eyebrow">{t('auth.forgotPassword.eyebrow')}</p>
      <h2 className="auth-heading">{t('auth.forgotPassword.heading')}</h2>
      <p className="auth-helper">{t('auth.forgotPassword.helper')}</p>

      {serverError && (
        <p role="alert" className="auth-server-error">{serverError}</p>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="email" className="label">{t('auth.forgotPassword.email')}</label>
          <input
            id="email"
            type="email"
            className="input"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
          />
          {emailError && <p className="field-error">{emailError}</p>}
        </div>

        <button
          type="submit"
          className="btn btn-accent btn-lg auth-cta"
          disabled={submitting}
        >
          {t('auth.forgotPassword.cta')}
          <span className="btn-arrow" aria-hidden="true">→</span>
        </button>
      </form>

      <p className="auth-footer-text">
        <Link to="/login" className="link-accent">{t('auth.forgotPassword.backToLogin')}</Link>
      </p>
    </AuthLayout>
  )
}
