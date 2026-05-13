import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import PayoutSettingsPage from './PayoutSettingsPage'
import { AuthContext } from '../../context/AuthContext'
import type { AuthContextValue } from '../../context/AuthContext'
import type { User } from '@supabase/supabase-js'

const { mockGetMyCreatorPayoutInfo, mockUpdateCreatorPayoutInfo } = vi.hoisted(() => ({
  mockGetMyCreatorPayoutInfo: vi.fn(),
  mockUpdateCreatorPayoutInfo: vi.fn(),
}))

vi.mock('../../lib/creatorPayoutInfoApi', async () => {
  const actual = await vi.importActual<typeof import('../../lib/creatorPayoutInfoApi')>('../../lib/creatorPayoutInfoApi')
  return {
    ...actual,
    getMyCreatorPayoutInfo: mockGetMyCreatorPayoutInfo,
    updateCreatorPayoutInfo: mockUpdateCreatorPayoutInfo,
  }
})

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

const stubUser = { id: 'u-1', email: 'creator@test.com' } as User

function makeCtx(overrides: Partial<AuthContextValue>): AuthContextValue {
  return {
    user: stubUser,
    loading: false,
    profile: {
      id: 'u-1',
      email: 'creator@test.com',
      name: 'Creator',
      avatar_url: null,
      role: 'creator',
      account_tier_id: 'individual',
      created_at: '2026-01-01T00:00:00Z',
    },
    profileLoading: false,
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    updateProfile: vi.fn(),
    ...overrides,
  }
}

function renderPage(ctx: Partial<AuthContextValue> = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/creator/settings/payout']}>
        <AuthContext.Provider value={makeCtx(ctx)}>
          <Routes>
            <Route path="/creator/settings/payout" element={<PayoutSettingsPage />} />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>
    </I18nextProvider>
  )
}

const existingPayout = {
  user_id: 'u-1',
  bank_code: 'MB',
  bank_name: 'MBBank — Ngân hàng TMCP Quân đội',
  account_number: '0987654321',
  account_holder: 'TRAN B',
  bank_branch: 'Hà Đông',
  updated_at: '2026-05-10T08:00:00Z',
}

describe('PayoutSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetMyCreatorPayoutInfo.mockResolvedValue({ payout: null, error: null })
    mockUpdateCreatorPayoutInfo.mockResolvedValue({ payout: existingPayout, error: null })
  })

  it('shows a loading placeholder until the initial fetch resolves', () => {
    mockGetMyCreatorPayoutInfo.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByTestId('payout-settings-loading')).toBeInTheDocument()
  })

  it('renders empty payout form when no row exists yet', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('payout-info-form')).toBeInTheDocument())
    expect((screen.getByTestId('payout-field-bank') as HTMLSelectElement).value).toBe('')
    expect(screen.queryByTestId('payout-settings-saved-at')).not.toBeInTheDocument()
  })

  it('prefills the form when the creator already has a payout row', async () => {
    mockGetMyCreatorPayoutInfo.mockResolvedValue({ payout: existingPayout, error: null })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('payout-info-form')).toBeInTheDocument())
    expect((screen.getByTestId('payout-field-bank') as HTMLSelectElement).value).toBe('MB')
    expect((screen.getByTestId('payout-field-account-number') as HTMLInputElement).value).toBe('0987654321')
    expect((screen.getByTestId('payout-field-account-holder') as HTMLInputElement).value).toBe('TRAN B')
    expect((screen.getByTestId('payout-field-bank-branch') as HTMLInputElement).value).toBe('Hà Đông')
    expect(screen.getByTestId('payout-settings-saved-at')).toBeInTheDocument()
  })

  it('blocks save when fields are empty and surfaces a validation error', async () => {
    renderPage()
    await waitFor(() => screen.getByTestId('payout-info-form'))
    await userEvent.click(screen.getByTestId('payout-settings-save'))
    expect(screen.getByTestId('payout-settings-error')).toHaveTextContent(/ngân hàng/i)
    expect(mockUpdateCreatorPayoutInfo).not.toHaveBeenCalled()
  })

  it('calls update_creator_payout_info RPC with payload on save', async () => {
    renderPage()
    await waitFor(() => screen.getByTestId('payout-info-form'))

    await userEvent.selectOptions(screen.getByTestId('payout-field-bank'), 'VCB')
    await userEvent.type(screen.getByTestId('payout-field-account-number'), '0123456789')
    await userEvent.type(screen.getByTestId('payout-field-account-holder'), 'NGUYEN VAN A')
    await userEvent.type(screen.getByTestId('payout-field-bank-branch'), 'Chi nhánh TP HCM')
    await userEvent.click(screen.getByTestId('payout-settings-save'))

    await waitFor(() => {
      expect(mockUpdateCreatorPayoutInfo).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          bank_code: 'VCB',
          account_number: '0123456789',
          account_holder: 'NGUYEN VAN A',
          bank_branch: 'Chi nhánh TP HCM',
        })
      )
      expect(screen.getByTestId('payout-settings-success')).toBeInTheDocument()
    })
  })

  it('shows server error message when update fails', async () => {
    mockGetMyCreatorPayoutInfo.mockResolvedValue({ payout: existingPayout, error: null })
    mockUpdateCreatorPayoutInfo.mockResolvedValue({
      payout: null,
      error: new Error('forbidden'),
    })
    renderPage()
    await waitFor(() => screen.getByTestId('payout-info-form'))

    await userEvent.click(screen.getByTestId('payout-settings-save'))

    await waitFor(() => {
      expect(screen.getByTestId('payout-settings-error')).toHaveTextContent(/lưu thông tin thanh toán/i)
    })
  })

  it('disables save button while saving', async () => {
    mockGetMyCreatorPayoutInfo.mockResolvedValue({ payout: existingPayout, error: null })
    let resolveUpdate: (v: { payout: typeof existingPayout; error: null }) => void = () => {}
    mockUpdateCreatorPayoutInfo.mockReturnValue(
      new Promise(resolve => {
        resolveUpdate = resolve
      })
    )
    renderPage()
    await waitFor(() => screen.getByTestId('payout-info-form'))

    await userEvent.click(screen.getByTestId('payout-settings-save'))
    expect(screen.getByTestId('payout-settings-save')).toBeDisabled()
    resolveUpdate({ payout: existingPayout, error: null })
    await waitFor(() => expect(screen.getByTestId('payout-settings-save')).not.toBeDisabled())
  })
})
