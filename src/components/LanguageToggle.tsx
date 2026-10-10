import { useTranslation } from 'react-i18next'

export default function LanguageToggle() {
  const { i18n } = useTranslation()
  const currentLang = i18n.language || 'vi'
  const isVi = currentLang.startsWith('vi')

  const toggleLanguage = () => {
    const nextLang = isVi ? 'en' : 'vi'
    i18n.changeLanguage(nextLang)
    try {
      localStorage.setItem('chess_lang', nextLang)
    } catch {
      // localStorage may fail in sandboxed or private browsing
    }
  }

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      title={isVi ? 'Switch to English' : 'Chuyển sang Tiếng Việt'}
      aria-label={isVi ? 'Switch to English' : 'Chuyển sang Tiếng Việt'}
      className="h-9 px-2.5 rounded-[10px] text-xs font-bold border border-(--border) bg-(--surface) text-(--ink-2) hover:bg-(--surface-2) hover:text-(--ink-1) transition-colors cursor-pointer inline-flex items-center gap-1.5 shrink-0"
    >
      <span>🌐</span>
      <span>{isVi ? 'VI' : 'EN'}</span>
    </button>
  )
}
