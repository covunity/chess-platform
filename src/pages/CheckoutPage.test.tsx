import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, beforeAll, describe, it, expect } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import CheckoutPage from './CheckoutPage'
import * as orderApi from '../lib/orderApi'
import * as payosLib from '../lib/payos'
import { AuthContext } from '../context/AuthContext'
import type { AuthContextValue } from '../context/AuthContext'
import type { Order } from '../lib/orderApi'

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
    functions: { invoke: vi.fn() },
  },
}))

const mockGetOrder = vi.spyOn(orderApi, 'getOrder')
const mockCancelOrder = vi.spyOn(orderApi, 'cancelOrder')
const mockCreatePayosPayment = vi.spyOn(payosLib, 'createPayosPayment')

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

const samplePayos = {
  qrCode: '00020101021238530010A00000072701230006970422011300000000000208QRIBFTTA53037045802VN540710000063044F2A',
  accountNumber: '0123456789',
  accountName: 'CTY ABC',
  bin: '970422',
  amount: 480000,
  description: 'ORD-2026-000042',
  checkoutUrl: 'https://pay.payos.vn/web/abc',
  error: null,
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
    vi.useRealTimers()
    mockGetOrder.mockResolvedValue({ order: sampleOrder as unknown as Order, error: null })
    mockCancelOrder.mockResolvedValue({ order: { ...sampleOrder, status: 'cancelled', cancelled_reason: 'test' } as unknown as Order, error: null })
    mockCreatePayosPayment.mockResolvedValue(samplePayos)
  })

  describe('auth guard', () => {
    it('redirects to login when not authenticated', async () => {
      renderPage(noAuthContext)
      await waitFor(() => {
        expect(screen.getByTestId('login-page')).toBeInTheDocument()
      })
    })

    it('does not redirect while auth session is still hydrating from localStorage', async () => {
      // Simulates a hard refresh: user is null but AuthContext has not yet
      // finished calling getSession(). The page must wait — kicking the user
      // to /login here would be the bug fixed in PR #287 follow-up.
      const hydratingContext: AuthContextValue = {
        ...noAuthContext,
        loading: true,
      }
      renderPage(hydratingContext)
      // Give React a tick to run effects.
      await new Promise((r) => setTimeout(r, 50))
      expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
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

  describe('status redirects on initial load', () => {
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

    it('redirects to /account/orders when order is expired', async () => {
      mockGetOrder.mockResolvedValue({
        order: { ...sampleOrder, status: 'expired' } as unknown as Order,
        error: null,
      })
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('orders-page')).toBeInTheDocument()
      })
    })
  })

  describe('PayOS embedded checkout', () => {
    it('calls createPayosPayment on mount with the order id', async () => {
      renderPage()
      await waitFor(() => {
        expect(mockCreatePayosPayment).toHaveBeenCalledWith(expect.anything(), 'ord-1')
      })
    })

    it('renders the PayOS QR data when payment is created', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('payos-qr')).toBeInTheDocument()
      })
    })

    it('renders the QR client-side (no third-party qrserver.com img)', async () => {
      renderPage()
      const qr = await screen.findByTestId('payos-qr')
      // Should not embed any external QR image service.
      const img = qr.querySelector('img')
      expect(img?.getAttribute('src') ?? '').not.toMatch(/qrserver\.com/)
      // Library renders an inline SVG — verify it exists inside the wrapper.
      expect(qr.querySelector('svg')).not.toBeNull()
    })

    it('renders bank info from the PayOS response (not from config)', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByText('0123456789')).toBeInTheDocument()
        expect(screen.getByText('CTY ABC')).toBeInTheDocument()
      })
    })

    it('renders the order code', async () => {
      renderPage()
      await waitFor(() => {
        const els = screen.getAllByText('ORD-2026-000042')
        expect(els.length).toBeGreaterThan(0)
      })
    })

    it('shows an error notice when createPayosPayment fails', async () => {
      mockCreatePayosPayment.mockResolvedValue({ ...samplePayos, qrCode: null, error: new Error('boom') })
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('payos-error')).toBeInTheDocument()
      })
    })

    // Issue #275: when the Edge Function is hit again for an order that already
    // has a payment link (typically a page refresh), it returns the cached
    // payload in the same shape as first-create. The page should render the QR
    // normally with no error banner.
    it('renders QR normally on refresh (cached payload, no 409 error)', async () => {
      // Simulate the Edge Function's idempotent path: same shape as first-create.
      mockCreatePayosPayment.mockResolvedValue({
        ...samplePayos,
        qrCode: 'CACHED_QR_PAYLOAD',
        accountNumber: '9876543210',
        error: null,
      })
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('payos-qr')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('payos-error')).not.toBeInTheDocument()
      expect(screen.getByText('9876543210')).toBeInTheDocument()
      // FE must call the Edge Function exactly once on mount — no retry/loop.
      expect(mockCreatePayosPayment).toHaveBeenCalledTimes(1)
    })

    it('does not render the "Tôi đã thanh toán" button', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('payos-qr'))
      expect(screen.queryByRole('button', { name: /tôi đã thanh toán/i })).not.toBeInTheDocument()
    })

    it('still renders the cancel order button', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /huỷ đơn/i })).toBeInTheDocument()
      })
    })
  })

  describe('status polling', () => {
    it('polls order status and redirects to /learn when active', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      // first call (mount) returns pending, subsequent poll returns active
      mockGetOrder
        .mockResolvedValueOnce({ order: sampleOrder as unknown as Order, error: null })
        .mockResolvedValue({ order: { ...sampleOrder, status: 'active' } as unknown as Order, error: null })

      renderPage()
      await waitFor(() => screen.getByTestId('payos-qr'))

      // advance 5 seconds — poll interval
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      await waitFor(() => {
        expect(screen.getByTestId('learn-page')).toBeInTheDocument()
      })
      vi.useRealTimers()
    })

    it('redirects to /account/orders when polled status is cancelled', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockGetOrder
        .mockResolvedValueOnce({ order: sampleOrder as unknown as Order, error: null })
        .mockResolvedValue({ order: { ...sampleOrder, status: 'cancelled' } as unknown as Order, error: null })

      renderPage()
      await waitFor(() => screen.getByTestId('payos-qr'))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      await waitFor(() => {
        expect(screen.getByTestId('orders-page')).toBeInTheDocument()
      })
      vi.useRealTimers()
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
  })

  describe('copy order code', () => {
    beforeAll(() => {
      if (!navigator.clipboard) {
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: vi.fn().mockResolvedValue(undefined) },
          writable: true,
          configurable: true,
        })
      }
    })

    it('copies the order code on click', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeText)
      const user = userEvent.setup()
      renderPage()
      await waitFor(() => screen.getByTestId('copy-order-code-btn'))
      await user.click(screen.getByTestId('copy-order-code-btn'))
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith('ORD-2026-000042')
      })
    })
  })
})
