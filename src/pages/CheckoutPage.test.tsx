import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, beforeAll, describe, it, expect } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import CheckoutPage from './CheckoutPage'
import * as orderApi from '../lib/orderApi'
import * as configApi from '../lib/configApi'
import { AuthContext } from '../context/AuthContext'
import type { AuthContextValue } from '../context/AuthContext'
import type { Order } from '../lib/orderApi'
import type { BankConfig } from '../lib/configApi'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      in: vi.fn().mockReturnThis(),
    }),
    rpc: vi.fn(),
  },
}))

const mockGetOrder = vi.spyOn(orderApi, 'getOrder')
const mockCancelOrder = vi.spyOn(orderApi, 'cancelOrder')
const mockGetBankConfig = vi.spyOn(configApi, 'getBankConfig')

const sampleOrder: Order & { course: { id: string; title: string; thumbnail_url: string | null } } = {
  id: 'ord-1',
  course_id: 'c-1',
  user_id: 'u-1',
  status: 'pending',
  amount: 480000,
  code: 'ORD-2026-000042',
  notes: null,
  platform_fee_pct: 20,
  platform_fee_amount: 96000,
  creator_payout_amount: 384000,
  creator_payout: 384000,
  account_tier_code: 'individual',
  confirmed_at: null,
  confirmed_by: null,
  cancelled_at: null,
  cancelled_by: null,
  cancelled_reason: null,
  created_at: '2026-05-09T10:00:00Z',
  updated_at: '2026-05-09T10:00:00Z',
  course: { id: 'c-1', title: 'The Italian Game', thumbnail_url: null },
}

const sampleBank: BankConfig = {
  short_name: 'MBBANK',
  bin: '970422',
  account_number: '1234567890',
  account_name: 'NGUYEN VAN A',
}

const noAuthContext: AuthContextValue = {
  user: null,
  loading: false,
  profile: null,
  profileLoading: false,
  signUp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  resetPassword: vi.fn(),
  updatePassword: vi.fn(),
}

const loggedInContext: AuthContextValue = {
  ...noAuthContext,
  user: { id: 'u-1', email: 'learner@test.com' } as AuthContextValue['user'],
  profile: {
    id: 'u-1',
    email: 'learner@test.com',
    name: 'Learner',
    avatar_url: null,
    role: 'learner',
    created_at: '2026-01-01T00:00:00Z',
  },
}

const otherUserContext: AuthContextValue = {
  ...noAuthContext,
  user: { id: 'u-other', email: 'other@test.com' } as AuthContextValue['user'],
  profile: {
    id: 'u-other',
    email: 'other@test.com',
    name: 'Other',
    avatar_url: null,
    role: 'learner',
    created_at: '2026-01-01T00:00:00Z',
  },
}

function renderPage(auth = loggedInContext, orderId = 'ord-1') {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[`/checkout/${orderId}`]}>
        <I18nextProvider i18n={i18n}>
          <Routes>
            <Route path="/checkout/:orderId" element={<CheckoutPage />} />
            <Route path="/checkout/:orderId/awaiting" element={<div data-testid="awaiting-page" />} />
            <Route path="/account/orders" element={<div data-testid="orders-page" />} />
            <Route path="/login" element={<div data-testid="login-page" />} />
            <Route path="/learn/:courseId" element={<div data-testid="learn-page" />} />
          </Routes>
        </I18nextProvider>
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

describe('CheckoutPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOrder.mockResolvedValue({ order: sampleOrder as unknown as Order, error: null })
    mockGetBankConfig.mockResolvedValue({ bank: sampleBank, error: null })
    mockCancelOrder.mockResolvedValue({ order: { ...sampleOrder, status: 'cancelled', cancelled_reason: 'test' } as unknown as Order, error: null })
  })

  describe('auth guard', () => {
    it('redirects to login when not authenticated', async () => {
      renderPage(noAuthContext)
      await waitFor(() => {
        expect(screen.getByTestId('login-page')).toBeInTheDocument()
      })
    })
  })

  describe('order ownership', () => {
    it('shows 404 when order belongs to different user', async () => {
      renderPage(otherUserContext)
      await waitFor(() => {
        expect(screen.getByTestId('checkout-not-found')).toBeInTheDocument()
      })
    })
  })

  describe('status redirects', () => {
    it('redirects to /learn/:courseId when order is active', async () => {
      mockGetOrder.mockResolvedValue({
        order: { ...sampleOrder, status: 'active' } as unknown as Order,
        error: null,
      })
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('learn-page')).toBeInTheDocument()
      })
    })

    it('redirects to /account/orders when order is cancelled', async () => {
      mockGetOrder.mockResolvedValue({
        order: { ...sampleOrder, status: 'cancelled', cancelled_reason: 'Admin huỷ' } as unknown as Order,
        error: null,
      })
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('orders-page')).toBeInTheDocument()
      })
    })
  })

  describe('pending layout', () => {
    it('renders order code', async () => {
      renderPage()
      await waitFor(() => {
        const els = screen.getAllByText('ORD-2026-000042')
        expect(els.length).toBeGreaterThan(0)
      })
    })

    it('renders course title', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByText('The Italian Game')).toBeInTheDocument()
      })
    })

    it('renders formatted amount', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('checkout-amount')).toBeInTheDocument()
      })
    })

    it('renders VietQR image with correct URL containing bank short name', async () => {
      renderPage()
      await waitFor(() => {
        const img = screen.getByTestId('vietqr-image') as HTMLImageElement
        expect(img.src).toContain('MBBANK')
        expect(img.src).toContain('1234567890')
        expect(img.src).toContain('ORD-2026-000042')
      })
    })

    it('renders bank account number', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByText('1234567890')).toBeInTheDocument()
      })
    })

    it('renders "Tôi đã thanh toán" button', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /tôi đã thanh toán/i })).toBeInTheDocument()
      })
    })

    it('navigates to awaiting page when "Tôi đã thanh toán" is clicked', async () => {
      const user = userEvent.setup()
      renderPage()
      await waitFor(() => screen.getByRole('button', { name: /tôi đã thanh toán/i }))
      await user.click(screen.getByRole('button', { name: /tôi đã thanh toán/i }))
      await waitFor(() => {
        expect(screen.getByTestId('awaiting-page')).toBeInTheDocument()
      })
    })

    it('renders "Huỷ đơn" button', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /huỷ đơn/i })).toBeInTheDocument()
      })
    })
  })

  describe('cancel flow', () => {
    it('shows cancel dialog when "Huỷ đơn" is clicked', async () => {
      const user = userEvent.setup()
      renderPage()
      await waitFor(() => screen.getByRole('button', { name: /huỷ đơn/i }))
      await user.click(screen.getByRole('button', { name: /huỷ đơn/i }))
      await waitFor(() => {
        expect(screen.getByTestId('cancel-dialog')).toBeInTheDocument()
      })
    })

    it('calls cancelOrder and redirects to /account/orders on confirm', async () => {
      const user = userEvent.setup()
      renderPage()
      await waitFor(() => screen.getByRole('button', { name: /huỷ đơn/i }))
      await user.click(screen.getByRole('button', { name: /huỷ đơn/i }))
      await waitFor(() => screen.getByTestId('cancel-dialog'))
      const textarea = screen.getByTestId('cancel-reason-input')
      await user.type(textarea, 'Tôi muốn đổi khoá học')
      await user.click(screen.getByTestId('cancel-confirm-btn'))
      await waitFor(() => {
        expect(mockCancelOrder).toHaveBeenCalledWith(
          expect.anything(),
          'ord-1',
          'Tôi muốn đổi khoá học'
        )
        expect(screen.getByTestId('orders-page')).toBeInTheDocument()
      })
    })

    it('does not call cancelOrder when reason is empty', async () => {
      const user = userEvent.setup()
      renderPage()
      await waitFor(() => screen.getByRole('button', { name: /huỷ đơn/i }))
      await user.click(screen.getByRole('button', { name: /huỷ đơn/i }))
      await waitFor(() => screen.getByTestId('cancel-dialog'))
      await user.click(screen.getByTestId('cancel-confirm-btn'))
      expect(mockCancelOrder).not.toHaveBeenCalled()
    })

    it('stays on checkout page and shows error when cancelOrder fails', async () => {
      mockCancelOrder.mockResolvedValue({ order: null, error: new Error('Server error') })
      const user = userEvent.setup()
      renderPage()
      await waitFor(() => screen.getByRole('button', { name: /huỷ đơn/i }))
      await user.click(screen.getByRole('button', { name: /huỷ đơn/i }))
      await waitFor(() => screen.getByTestId('cancel-dialog'))
      const textarea = screen.getByTestId('cancel-reason-input')
      await user.type(textarea, 'Lý do huỷ')
      await user.click(screen.getByTestId('cancel-confirm-btn'))
      await waitFor(() => {
        expect(mockCancelOrder).toHaveBeenCalled()
        expect(screen.queryByTestId('orders-page')).not.toBeInTheDocument()
        expect(screen.getByTestId('cancel-error')).toBeInTheDocument()
      })
    })
  })

  describe('copy order code', () => {
    beforeAll(() => {
      // jsdom doesn't implement Clipboard API — define it once so vi.spyOn can intercept
      if (!navigator.clipboard) {
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: vi.fn().mockResolvedValue(undefined) },
          writable: true,
          configurable: true,
        })
      }
    })

    it('renders copy button for order code', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('copy-order-code-btn')).toBeInTheDocument()
      })
    })

    it('clicking copy button copies the order code and shows "Đã sao chép" confirmation', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeText)
      const user = userEvent.setup()
      renderPage()
      await waitFor(() => screen.getByTestId('copy-order-code-btn'))
      await user.click(screen.getByTestId('copy-order-code-btn'))
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith('ORD-2026-000042')
        expect(screen.getByTestId('copy-order-code-btn')).toHaveTextContent(/đã sao chép/i)
      })
    })
  })

  describe('VietQR fallback', () => {
    it('shows bank details text when bank config is null', async () => {
      mockGetBankConfig.mockResolvedValue({ bank: null, error: null })
      renderPage()
      await waitFor(() => {
        expect(screen.queryByTestId('vietqr-image')).not.toBeInTheDocument()
        expect(screen.getByTestId('bank-info-fallback')).toBeInTheDocument()
      })
    })
  })
})
