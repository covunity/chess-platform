import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function CheckEmailPage() {
  const { t } = useTranslation()

  return (
    <div data-testid="check-email-page" className="check-email-page">
      <div className="check-email-page__inner">
        <div className="check-email-page__icon" aria-hidden="true">✉</div>
        <h1 className="auth-heading">{t('auth.checkEmail.heading')}</h1>
        <p className="auth-helper">{t('auth.checkEmail.body')}</p>
        <div className="check-email-page__actions">
          <Link to="/signup" className="link-accent">{t('auth.checkEmail.backToSignup')}</Link>
        </div>
      </div>
    </div>
  )
}
