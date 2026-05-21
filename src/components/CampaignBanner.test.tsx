import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import CampaignBanner from './CampaignBanner'
import type { Campaign } from '../lib/campaignsApi'

const platformWideCampaign: Campaign = {
  id: 'cmp-1',
  name: 'Tết Sale 2026',
  description: null,
  discount_type: 'percentage',
  discount_value: 20,
  max_discount_amount: null,
  applicable_courses: null,
  starts_at: '2026-01-15T00:00:00Z',
  ends_at: '2026-02-15T00:00:00Z',
  is_active: true,
  created_by: 'admin-1',
  created_at: '2026-01-10T00:00:00Z',
  updated_at: '2026-01-10T00:00:00Z',
  orders_count: 0,
}

function renderBanner(campaign: Campaign, onDismiss = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <CampaignBanner campaign={campaign} onDismiss={onDismiss} />
    </I18nextProvider>
  )
}

describe('CampaignBanner', () => {
  it('renders the campaign name', () => {
    renderBanner(platformWideCampaign)
    expect(screen.getByText(/Tết Sale 2026/)).toBeInTheDocument()
  })

  it('renders platform-wide scope label when applicable_courses is null', () => {
    renderBanner(platformWideCampaign)
    expect(screen.getByText(/tất cả khoá học/i)).toBeInTheDocument()
  })

  it('renders course-count scope label when applicable_courses is an array', () => {
    renderBanner({ ...platformWideCampaign, applicable_courses: ['c-1', 'c-2', 'c-3'] })
    expect(screen.getByText(/3 khoá học/i)).toBeInTheDocument()
  })

  it('renders the percentage discount value', () => {
    renderBanner(platformWideCampaign)
    expect(screen.getByText(/Giảm 20%/i)).toBeInTheDocument()
  })

  it('renders the end date hint', () => {
    renderBanner(platformWideCampaign)
    // ends_at = 2026-02-15 → "15/02"
    expect(screen.getByText(/15\/02/)).toBeInTheDocument()
  })

  it('close button has aria-label from i18n', () => {
    renderBanner(platformWideCampaign)
    expect(screen.getByRole('button', { name: /đóng/i })).toBeInTheDocument()
  })

  it('clicking close calls onDismiss', async () => {
    const onDismiss = vi.fn()
    renderBanner(platformWideCampaign, onDismiss)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /đóng/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
