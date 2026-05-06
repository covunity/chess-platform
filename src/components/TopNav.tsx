import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function TopNav() {
  const { t } = useTranslation()
  return (
    <header role="banner" className="h-16 flex items-center px-14 border-b border-[--border] bg-[--surface]">
      <Link to="/" className="flex items-center gap-2" aria-label="Gambitly home">
        <span className="logo-mark" aria-hidden="true" />
        <span className="font-serif text-lg text-[--ink-1]">Gambitly</span>
      </Link>
      <nav className="ml-auto flex items-center gap-6 text-sm text-[--ink-2]">
        <Link to="/">{t('nav.home')}</Link>
      </nav>
    </header>
  )
}
