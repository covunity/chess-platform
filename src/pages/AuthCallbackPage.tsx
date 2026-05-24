import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import AuthLayout from '../components/auth/AuthLayout'

export default function AuthCallbackPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()

  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(({ data, error }) => {
      if (cancelled) return
      if (error || !data.session) {
        navigate('/login?error=oauth_failed', { replace: true })
        return
      }
      navigate('/dashboard', { replace: true })
    })
    return () => { cancelled = true }
  }, [navigate])

  return (
    <AuthLayout>
      <p className="auth-eyebrow">{t('auth.callback.eyebrow')}</p>
      <h2 className="auth-heading">{t('auth.callback.processing')}</h2>
      <p className="auth-helper">{t('auth.callback.helper')}</p>
    </AuthLayout>
  )
}
