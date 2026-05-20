import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import RevenuePanel from './RevenuePanel'

const { mockFetchCreatorWallet, mockFetchRecentEarnings, mockFetchPayoutHistory } = vi.hoisted(() => ({
  mockFetchCreatorWallet: vi.fn(),
  mockFetchRecentEarnings: vi.fn(),
  mockFetchPayoutHistory: vi.fn(),
}))

vi.mock('../../lib/creatorWalletApi', () => ({
  fetchCreatorWallet: mockFetchCreatorWallet,
  fetchRecentEarnings: mockFetchRecentEarnings,
  fetchPayoutHistory: mockFetchPayoutHistory,
}))

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

function renderPanel() {
  return render(
    <I18nextProvider i18n={i18n}>
      <RevenuePanel creatorId="creator-1" />
    </I18nextProvider>
  )
}

describe('RevenuePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchCreatorWallet.mockResolvedValue({
      wallet: { pendingBalance: 1_536_000, totalPaidOut: 768_000, lifetimeEarnings: 2_304_000 },
      error: null,
    })
    mockFetchRecentEarnings.mockResolvedValue({ earnings: [], error: null })
    mockFetchPayoutHistory.mockResolvedValue({ payouts: [], error: null })
  })

  it('shows pending balance prominently', async () => {
    renderPanel()
    await waitFor(() => {
      const card = screen.getByTestId('revenue-pending-balance')
      expect(card).toHaveTextContent(/1.?536.?000/)
    })
  })

  it('shows lifetime earnings as secondary metric', async () => {
    renderPanel()
    await waitFor(() => {
      const card = screen.getByTestId('revenue-lifetime-earnings')
      expect(card).toHaveTextContent(/2.?304.?000/)
    })
  })

  it('shows the weekly Monday payout caption', async () => {
    renderPanel()
    await waitFor(() => {
      expect(screen.getByTestId('revenue-cadence-caption')).toHaveTextContent(/thứ Hai hàng tuần/i)
    })
  })

  it('renders a recent earning row with course title, buyer email, and creator payout', async () => {
    mockFetchRecentEarnings.mockResolvedValue({
      earnings: [
        {
          orderId: 'ord-1',
          amount: 480_000,
          creatorPayout: 384_000,
          courseTitle: 'Tấn công kiểu Sicilian',
          buyerEmail: 'alice@test.com',
          confirmedAt: '2026-05-15T11:00:00Z',
        },
      ],
      error: null,
    })
    renderPanel()
    await waitFor(() => {
      const row = screen.getByTestId('recent-earning-ord-1')
      expect(row).toHaveTextContent('Tấn công kiểu Sicilian')
      expect(row).toHaveTextContent('alice@test.com')
      expect(row).toHaveTextContent(/384.?000/)
    })
  })

  it('renders the payout history empty state when no payouts exist', async () => {
    renderPanel()
    await waitFor(() => {
      expect(screen.getByTestId('payout-history-empty')).toHaveTextContent(/Chưa có payout/i)
    })
  })

  it('renders multiple payout history rows when slice 7 has populated the table', async () => {
    // Integration boundary check: confirms slice 7's admin mark-complete flow
    // surfaces correctly in slice 6's creator-facing payout history list.
    mockFetchPayoutHistory.mockResolvedValue({
      payouts: [
        {
          id: 'pay-week-21',
          amount: 1_536_000,
          bankName: 'Vietcombank',
          accountNumber: '1234567890',
          accountHolder: 'ALICE NGUYEN',
          transferredAt: '2026-05-19T08:00:00Z',
          referenceNote: 'FT26139ABC',
        },
        {
          id: 'pay-week-20',
          amount: 768_000,
          bankName: 'MB Bank',
          accountNumber: '0987654321',
          accountHolder: 'ALICE NGUYEN',
          transferredAt: '2026-05-12T08:00:00Z',
          referenceNote: 'FT26132DEF',
        },
      ],
      error: null,
    })
    renderPanel()
    await waitFor(() => {
      expect(screen.getByTestId('payout-history-pay-week-21')).toBeInTheDocument()
      expect(screen.getByTestId('payout-history-pay-week-20')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('payout-history-empty')).not.toBeInTheDocument()
    expect(screen.getByTestId('payout-history-pay-week-21')).toHaveTextContent('Vietcombank')
    expect(screen.getByTestId('payout-history-pay-week-21')).toHaveTextContent('FT26139ABC')
  })

  it('renders payout history rows with amount, reference, and masked account', async () => {
    mockFetchPayoutHistory.mockResolvedValue({
      payouts: [
        {
          id: 'pay-1',
          amount: 768_000,
          bankName: 'MB Bank',
          accountNumber: '0987654321',
          accountHolder: 'NGUYEN VAN A',
          transferredAt: '2026-05-13T09:00:00Z',
          referenceNote: 'TXN-2026-05-13-001',
        },
      ],
      error: null,
    })
    renderPanel()
    await waitFor(() => {
      const row = screen.getByTestId('payout-history-pay-1')
      expect(row).toHaveTextContent(/768.?000/)
      expect(row).toHaveTextContent('TXN-2026-05-13-001')
      // Masked account: last 4 digits visible, leading digits hidden
      expect(row).toHaveTextContent(/4321/)
      expect(row).not.toHaveTextContent('0987654321')
    })
  })
})
