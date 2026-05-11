import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function Footer() {
  const { t } = useTranslation()
  return (
    <footer className="border-t border-(--border) bg-(--surface-2) py-6 px-14">
      <div className="max-w-[1280px] mx-auto flex flex-wrap items-center gap-6 text-[13px] text-(--ink-3)">
        <span className="font-serif text-(--ink-1)">Gambitly</span>
        <Link to="/become-creator">{t('footer.becomeCreator', 'Trở thành creator')}</Link>
        <Link to="/help">{t('footer.help', 'Trợ giúp')}</Link>
        <Link to="/terms">{t('footer.terms', 'Điều khoản')}</Link>
        <Link to="/privacy">{t('footer.privacy', 'Bảo mật')}</Link>
        <span className="ml-auto">VI</span>
      </div>
    </footer>
  )
}
