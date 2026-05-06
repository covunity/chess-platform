import { useTranslation } from 'react-i18next'

export default function AdminComingSoonPage() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-center flex-1 text-[--ink-3] text-sm">
      {t('admin.comingSoon')}
    </div>
  )
}
