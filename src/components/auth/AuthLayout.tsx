import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation()

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <div className="auth-split">
      <div className="auth-brand">
        <div className="auth-brand__logo">
          <Link to="/" aria-label={t('auth.backHome')}>
            <img src="/icons/logo-dark.svg" alt="Covunity" style={{ height: 72, width: 'auto', display: 'block', marginLeft: '-35px' }} />
          </Link>
        </div>

        <div className="auth-brand__body">
          <h1 className="auth-brand__headline">
            {t('auth.brand.headline1')}
            <br />
            {t('auth.brand.headline2')}
            <br />
            <em>{t('auth.brand.headline3')}</em>
          </h1>
          <p className="auth-brand__sub">{t('auth.brand.sub')}</p>
        </div>

        <div className="auth-brand__stats">
          <div className="auth-brand__stat">
            <span className="auth-brand__stat-number">{t('auth.brand.stat1Number')}</span>
            <span className="auth-brand__stat-label">{t('auth.brand.stat1Label')}</span>
          </div>
          <div className="auth-brand__stat">
            <span className="auth-brand__stat-number">{t('auth.brand.stat2Number')}</span>
            <span className="auth-brand__stat-label">{t('auth.brand.stat2Label')}</span>
          </div>
          <div className="auth-brand__stat">
            <span className="auth-brand__stat-number">{t('auth.brand.stat3Number')}</span>
            <span className="auth-brand__stat-label">{t('auth.brand.stat3Label')}</span>
          </div>
        </div>

        <div className="auth-brand__board" aria-hidden="true" />
      </div>

      <div className="auth-form-panel">
        <div className="auth-form-panel__inner">
          {children}
        </div>
      </div>
    </div>
  )
}
