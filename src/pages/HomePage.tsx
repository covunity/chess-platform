import { useTranslation } from 'react-i18next'

export default function HomePage() {
  const { t } = useTranslation()
  return (
    <main className="max-w-[1280px] mx-auto px-14 py-20">
      <h1 className="font-serif italic text-5xl text-[--ink-1] mb-6">{t('home.headline')}</h1>
      <p className="text-[--ink-2] text-lg">{t('home.subheadline')}</p>
    </main>
  )
}
