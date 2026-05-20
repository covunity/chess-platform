import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import AdminPayoutsPage from './AdminPayoutsPage'

const {
  mockFetchPendingPayouts,
  mockFetchCreatorsWithoutPayoutInfo,
  mockCreateWeeklyPayouts,
  mockMarkPayoutComplete,
} = vi.hoisted(() => ({
  mockFetchPendingPayouts: vi.fn(),
  mockFetchCreatorsWithoutPayoutInfo: vi.fn(),
  mockCreateWeeklyPayouts: vi.fn(),
  mockMarkPayoutComplete: vi.fn(),
}))

vi.mock('../../lib/adminPayoutsApi', async () => {
  const actual = await vi.importActual<typeof import('../../lib/adminPayoutsApi')>(
    '../../lib/adminPayoutsApi'
  )
  return {
    ...actual,
    fetchPendingPayouts: mockFetchPendingPayouts,
    fetchCreatorsWithoutPayoutInfo: mockFetchCreatorsWithoutPayoutInfo,
    createWeeklyPayouts: mockCreateWeeklyPayouts,
    markPayoutComplete: mockMarkPayoutComplete,
  }
})

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

const alicePayout = {
  id: 'pay-alice',
  creatorId: 'c-alice',
  creatorName: 'Alice Nguyễn',
  creatorEmail: 'alice@x.io',
  adminId: 'admin-1',
  amount: 1_536_000,
  bankCode: 'VCB',
  bankName: 'Vietcombank',
  accountNumber: '1234567890',
  accountHolder: 'ALICE NGUYEN',
  orderIds: ['o-1', 'o-2'],
  orderCount: 2,
  transferredAt: '2026-05-19T08:00:00Z',
  referenceNote: null,
}

const bobMissing = {
  creatorId: 'c-bob',
  name: 'Bob Trần',
  email: 'bob@x.io',
  pendingBalance: 480_000,
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AdminPayoutsPage />
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('AdminPayoutsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchPendingPayouts.mockResolvedValue({ payouts: [alicePayout], error: null })
    mockFetchCreatorsWithoutPayoutInfo.mockResolvedValue({ creators: [], error: null })
    mockCreateWeeklyPayouts.mockResolvedValue({ payouts: [alicePayout], error: null })
    mockMarkPayoutComplete.mockResolvedValue({
      payout: { ...alicePayout, referenceNote: 'FT123' },
      error: null,
    })
  })

  it('renders the page heading', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: /chi trả creator/i })).toBeInTheDocument()
  })

  it('shows pending payouts grouped by creator with bank info and amount', async () => {
    renderPage()
    const row = await screen.findByTestId('pending-payout-row-pay-alice')
    expect(within(row).getByText('Alice Nguyễn')).toBeInTheDocument()
    expect(within(row).getByText('alice@x.io')).toBeInTheDocument()
    expect(within(row).getByText(/Vietcombank/)).toBeInTheDocument()
    expect(within(row).getByText(/1234567890/)).toBeInTheDocument()
    expect(within(row).getByText(/1\.536\.000/)).toBeInTheDocument()
  })

  it('shows an empty state when no pending payouts', async () => {
    mockFetchPendingPayouts.mockResolvedValueOnce({ payouts: [], error: null })
    renderPage()
    expect(await screen.findByTestId('pending-payouts-empty')).toBeInTheDocument()
  })

  it('renders a missing-payout-info warning list when creators lack bank info', async () => {
    mockFetchCreatorsWithoutPayoutInfo.mockResolvedValueOnce({ creators: [bobMissing], error: null })
    renderPage()
    const warningRow = await screen.findByTestId('missing-payout-info-row-c-bob')
    expect(within(warningRow).getByText('Bob Trần')).toBeInTheDocument()
    expect(within(warningRow).getByText('bob@x.io')).toBeInTheDocument()
  })

  it('does NOT render the missing-info section when list is empty', async () => {
    renderPage()
    await screen.findByTestId('pending-payout-row-pay-alice')
    expect(screen.queryByTestId('missing-payout-info-section')).not.toBeInTheDocument()
  })

  it('auto-calls createWeeklyPayouts on mount so newly-eligible creators surface immediately', async () => {
    renderPage()
    await screen.findByTestId('pending-payout-row-pay-alice')
    // Mount triggers exactly one create call; CSV button NOT clicked here.
    expect(mockCreateWeeklyPayouts).toHaveBeenCalledTimes(1)
  })

  it('calls createWeeklyPayouts and triggers CSV download when Xuất CSV is clicked', async () => {
    const user = userEvent.setup()
    const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    renderPage()
    await screen.findByTestId('pending-payout-row-pay-alice')

    await user.click(screen.getByTestId('export-csv-btn'))

    await waitFor(() => {
      // Mount auto-calls createWeeklyPayouts (fix for the "creator disappears
      // after filling payout_info" bug) — so the button click is the SECOND
      // call. CSV download only fires on the explicit click.
      expect(mockCreateWeeklyPayouts).toHaveBeenCalledTimes(2)
      expect(createUrlSpy).toHaveBeenCalledTimes(1)
    })

    createUrlSpy.mockRestore()
    revokeSpy.mockRestore()
  })

  it('opens a mark-complete dialog and submits the reference, then removes the row', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByTestId('mark-complete-btn-pay-alice'))
    expect(await screen.findByTestId('mark-complete-dialog')).toBeInTheDocument()

    // Submit disabled when empty
    const submit = screen.getByTestId('mark-complete-submit')
    expect(submit).toBeDisabled()

    await user.type(screen.getByTestId('reference-input'), 'FT26139ABC')
    expect(submit).not.toBeDisabled()
    await user.click(submit)

    await waitFor(() => {
      expect(mockMarkPayoutComplete).toHaveBeenCalledWith(
        expect.anything(),
        'pay-alice',
        'FT26139ABC'
      )
    })

    // Row removed optimistically
    await waitFor(() => {
      expect(screen.queryByTestId('pending-payout-row-pay-alice')).not.toBeInTheDocument()
    })
  })
})
