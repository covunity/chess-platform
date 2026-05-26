import { useTranslation } from 'react-i18next'
import type { Campaign } from '../lib/campaignsApi'
import { formatPrice } from '../lib/utils'

function formatEndDate(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}`
}

export default function CampaignBanner({
  campaign,
  onDismiss,
}: {
  campaign: Campaign
  onDismiss: () => void
}) {
  const { t } = useTranslation()

  const scopeLabel = campaign.applicable_courses === null
    ? t('campaign.banner.scopeAll')
    : t('campaign.banner.scopeCount', { count: campaign.applicable_courses.length })

  const discountLabel = campaign.discount_type === 'percentage'
    ? t('campaign.banner.discountPercent', { value: campaign.discount_value })
    : t('campaign.banner.discountFixed', { value: formatPrice(campaign.discount_value) })

  const endsAtLabel = t('campaign.banner.endsAt', { date: formatEndDate(campaign.ends_at) })

  return (
    <div
      data-testid="campaign-banner"
      style={{
        background: 'var(--accent-soft)',
        borderBottom: '1px solid var(--accent-border)',
        color: 'var(--accent-ink)',
        padding: '10px 56px',
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 16 }}>🔥</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{campaign.name}</span>
        <span style={{ fontSize: 13, opacity: 0.85 }}>
          {discountLabel} · {scopeLabel} · {endsAtLabel}
        </span>
        <button
          type="button"
          aria-label={t('campaign.banner.dismiss')}
          onClick={onDismiss}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--accent-ink)',
            fontSize: 18,
            lineHeight: 1,
            padding: 4,
          }}
        >
          ×
        </button>
      </div>
    </div>
  )
}
