import { Navigate, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'

export default function ProtectedCreatorRoute() {
  const { t } = useTranslation()
  const { user, loading, profile, profileLoading } = useAuth()

  if (loading || profileLoading) {
    return <div data-testid="creator-loading" aria-label="Loading" className="flex items-center justify-center min-h-screen" />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (profile?.role !== 'coach' && profile?.role !== 'admin') {
    return (
      <div
        data-testid="forbidden-creator"
        className="flex flex-col items-center justify-center min-h-screen gap-4 text-center px-6"
      >
        <h1 className="text-2xl font-semibold text-[--ink-1]">{t('creator.forbidden.title')}</h1>
        <p className="text-[--ink-3]">{t('creator.forbidden.body')}</p>
      </div>
    )
  }

  return <Outlet />
}
