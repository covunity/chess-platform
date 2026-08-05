import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function Footer() {
  const { t } = useTranslation()
  return (
    <footer className="border-t border-(--border) bg-(--surface-2) py-6 px-4 md:px-14">
      <div className="max-w-[1280px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-[13px] text-(--ink-3)">
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 sm:gap-6">
          <span className="font-serif">
            <span style={{ color: '#9610d5' }}>Covu</span>
            <span className="text-(--ink-1)">n<span className="brand-dotless-i">ı</span>ty</span>
          </span>
          <Link to="/become-creator">{t('footer.becomeCreator', 'Trở thành creator')}</Link>
          <Link to="/help">{t('footer.help', 'Trợ giúp')}</Link>
          <Link to="/terms">{t('footer.terms', 'Điều khoản')}</Link>
          <Link to="/privacy">{t('footer.privacy', 'Bảo mật')}</Link>
        </div>
        <span className="text-xs">VI</span>
      </div>
    </footer>
  )
}
