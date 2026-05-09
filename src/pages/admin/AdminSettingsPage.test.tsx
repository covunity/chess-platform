import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import AdminSettingsPage from './AdminSettingsPage'

const { mockGetBankConfig, mockUpdateBankConfig } = vi.hoisted(() => ({
  mockGetBankConfig: vi.fn(),
  mockUpdateBankConfig: vi.fn(),
}))

vi.mock('../../lib/configApi', () => ({
  getBankConfig: mockGetBankConfig,
  updateBankConfig: mockUpdateBankConfig,
}))

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

const seededBank = {
  short_name: 'MBBANK',
  bin: '970422',
  account_number: '0123456789',
  account_name: 'CHESS COURSE',
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AdminSettingsPage />
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('AdminSettingsPage — Payment tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBankConfig.mockResolvedValue({ bank: seededBank, error: null })
    mockUpdateBankConfig.mockResolvedValue({ error: null })
  })

  it('renders the Payment tab as active by default', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('settings-tab-payment')).toHaveAttribute('aria-selected', 'true')
    })
  })

  it('pre-fills the form with current bank config values', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('input-short-name')).toHaveValue('MBBANK')
    })
    expect(screen.getByTestId('input-bin')).toHaveValue('970422')
    expect(screen.getByTestId('input-account-number')).toHaveValue('0123456789')
    expect(screen.getByTestId('input-account-name')).toHaveValue('CHESS COURSE')
  })

  it('renders the live VietQR preview pointing at img.vietqr.io', async () => {
    renderPage()
    const preview = await screen.findByTestId('vietqr-preview')
    expect(preview.tagName).toBe('IMG')
    const src = preview.getAttribute('src') ?? ''
    expect(src).toContain('https://img.vietqr.io/image/MBBANK-0123456789-')
    expect(src).toContain('amount=10000')
    expect(src).toContain('addInfo=PREVIEW')
  })

  it('updates the preview as the admin types', async () => {
    renderPage()
    await waitFor(() => screen.getByTestId('input-short-name'))

    const shortNameInput = screen.getByTestId('input-short-name')
    await userEvent.clear(shortNameInput)
    await userEvent.type(shortNameInput, 'TCB')

    const acctInput = screen.getByTestId('input-account-number')
    await userEvent.clear(acctInput)
    await userEvent.type(acctInput, '9999999999')

    const preview = screen.getByTestId('vietqr-preview')
    const src = preview.getAttribute('src') ?? ''
    expect(src).toContain('TCB-9999999999-')
  })

  it('rejects a 5-digit BIN before calling the RPC', async () => {
    renderPage()
    await waitFor(() => screen.getByTestId('input-bin'))

    const binInput = screen.getByTestId('input-bin')
    await userEvent.clear(binInput)
    await userEvent.type(binInput, '12345')
    await userEvent.click(screen.getByTestId('save-button'))

    expect(await screen.findByTestId('bin-validation-error')).toBeInTheDocument()
    expect(mockUpdateBankConfig).not.toHaveBeenCalled()
  })

  it('saves on click and shows success toast', async () => {
    renderPage()
    await waitFor(() => screen.getByTestId('save-button'))

    await userEvent.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(mockUpdateBankConfig).toHaveBeenCalledWith(expect.anything(), {
        short_name: 'MBBANK',
        bin: '970422',
        account_number: '0123456789',
        account_name: 'CHESS COURSE',
      })
    })
    expect(await screen.findByTestId('save-success-toast')).toBeInTheDocument()
  })

  it('shows error toast and keeps form when RPC fails', async () => {
    mockUpdateBankConfig.mockResolvedValueOnce({ error: { message: 'forbidden' } })
    renderPage()
    await waitFor(() => screen.getByTestId('save-button'))

    await userEvent.click(screen.getByTestId('save-button'))

    expect(await screen.findByTestId('save-error-toast')).toBeInTheDocument()
    // Form values preserved on error
    expect(screen.getByTestId('input-short-name')).toHaveValue('MBBANK')
  })

  it('refetches config after successful save (so seeded placeholders get replaced live)', async () => {
    renderPage()
    await waitFor(() => screen.getByTestId('save-button'))

    mockGetBankConfig.mockResolvedValueOnce({
      bank: { ...seededBank, account_number: '7777777777' },
      error: null,
    })
    await userEvent.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(mockGetBankConfig).toHaveBeenCalledTimes(2)
    })
  })
})
