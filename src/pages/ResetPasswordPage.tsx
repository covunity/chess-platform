import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import AuthLayout from '../components/auth/AuthLayout'
import { useAuth } from '../context/AuthContext'
import { validateNewPassword } from '../lib/authValidation'

export default function ResetPasswordPage() {
  const { t } = useTranslation()
  const { updatePassword } = useAuth()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')
  const [succeeded, setSucceeded] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const fieldErrors = validateNewPassword(password, confirmPassword)
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
      const { error } = await updatePassword(password)
      if (error) {
        setServerError(error.message)
        return
      }
      setSucceeded(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (succeeded) {
    return (
      <AuthLayout>
        <div className="auth-success">
          <div className="auth-success__icon" aria-hidden="true">✓</div>
          <h2 className="auth-heading">{t('auth.resetPassword.successTitle')}</h2>
          <p className="auth-helper">{t('auth.resetPassword.successBody')}</p>
          <Link to="/login" className="btn btn-accent btn-lg">{t('auth.login.cta')}</Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <p className="auth-eyebrow">{t('auth.resetPassword.eyebrow')}</p>
      <h2 className="auth-heading">{t('auth.resetPassword.heading')}</h2>

      {serverError && (
        <p role="alert" className="auth-server-error">{serverError}</p>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="password" className="label">{t('auth.resetPassword.newPassword')}</label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <p className="field-hint">{t('auth.resetPassword.passwordHint')}</p>
          {errors.password && <p className="field-error">{errors.password}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="confirmPassword" className="label">{t('auth.resetPassword.confirmPassword')}</label>
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

        <button
          type="submit"
          className="btn btn-accent btn-lg auth-cta"
          disabled={submitting}
        >
          {t('auth.resetPassword.cta')}
          <span className="btn-arrow" aria-hidden="true">→</span>
        </button>
      </form>
    </AuthLayout>
  )
}
