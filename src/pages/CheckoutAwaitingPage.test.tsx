import { render, screen, waitFor, act } from '@testing-library/react'
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import CheckoutAwaitingPage from './CheckoutAwaitingPage'
import * as orderApi from '../lib/orderApi'
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
    }),
    rpc: vi.fn(),
  },
}))

const mockGetOrder = vi.spyOn(orderApi, 'getOrder')

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
      <MemoryRouter initialEntries={[`/checkout/${orderId}/awaiting`]}>
        <I18nextProvider i18n={i18n}>
          <Routes>
            <Route path="/checkout/:orderId/awaiting" element={<CheckoutAwaitingPage />} />
            <Route path="/account/orders" element={<div data-testid="orders-page" />} />
            <Route path="/login" element={<div data-testid="login-page" />} />
            <Route path="/learn/:courseId" element={<div data-testid="learn-page" />} />
            <Route path="/" element={<div data-testid="home-page" />} />
          </Routes>
        </I18nextProvider>
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

describe('CheckoutAwaitingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOrder.mockResolvedValue({ order: sampleOrder as unknown as Order, error: null })
  })

  describe('auth guard', () => {
    it('redirects to login when not authenticated', async () => {
      renderPage(noAuthContext)
      await waitFor(() => {
        expect(screen.getByTestId('login-page')).toBeInTheDocument()
      })
    })
  })

  describe('ownership', () => {
    it('shows 404 when order belongs to different user', async () => {
      renderPage(otherUserContext)
      await waitFor(() => {
        expect(screen.getByTestId('awaiting-not-found')).toBeInTheDocument()
      })
    })
  })

  describe('status redirects on load', () => {
    it('redirects to /learn/:courseId when order is already active', async () => {
      mockGetOrder.mockResolvedValue({
        order: { ...sampleOrder, status: 'active' } as unknown as Order,
        error: null,
      })
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('learn-page')).toBeInTheDocument()
      })
    })

    it('redirects to /account/orders when order is already cancelled', async () => {
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
    it('renders awaiting heading', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('awaiting-heading')).toBeInTheDocument()
      })
    })

    it('renders order code in details card', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByText('ORD-2026-000042')).toBeInTheDocument()
      })
    })

    it('renders course title in details card', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByText('The Italian Game')).toBeInTheDocument()
      })
    })

    it('renders formatted amount in details card', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('awaiting-amount')).toBeInTheDocument()
      })
    })

    it('renders "Về trang chủ" CTA', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('awaiting-go-home')).toBeInTheDocument()
      })
    })

    it('renders "Xem trong lịch sử đơn" CTA linking to /account/orders', async () => {
      renderPage()
      await waitFor(() => {
        const link = screen.getByTestId('awaiting-view-orders')
        expect(link).toBeInTheDocument()
      })
    })
  })

  describe('polling', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('polls order status every 30 seconds', async () => {
      renderPage()
      // Flush initial fetch + React state update
      await act(async () => {})
      expect(screen.getByTestId('awaiting-heading')).toBeInTheDocument()
      expect(mockGetOrder).toHaveBeenCalledTimes(1)

      await act(async () => {
        vi.advanceTimersByTime(30000)
      })
      expect(mockGetOrder).toHaveBeenCalledTimes(2)

      await act(async () => {
        vi.advanceTimersByTime(30000)
      })
      expect(mockGetOrder).toHaveBeenCalledTimes(3)
    })

    it('auto-navigates to /learn/:courseId when poll returns active', async () => {
      renderPage()
      await act(async () => {})
      expect(screen.getByTestId('awaiting-heading')).toBeInTheDocument()

      mockGetOrder.mockResolvedValueOnce({
        order: { ...sampleOrder, status: 'active' } as unknown as Order,
        error: null,
      })

      await act(async () => {
        vi.advanceTimersByTime(30000)
      })
      await act(async () => {})

      expect(screen.getByTestId('learn-page')).toBeInTheDocument()
    })

    it('auto-navigates to /account/orders when poll returns cancelled', async () => {
      renderPage()
      await act(async () => {})
      expect(screen.getByTestId('awaiting-heading')).toBeInTheDocument()

      mockGetOrder.mockResolvedValueOnce({
        order: { ...sampleOrder, status: 'cancelled', cancelled_reason: 'Admin huỷ' } as unknown as Order,
        error: null,
      })

      await act(async () => {
        vi.advanceTimersByTime(30000)
      })
      await act(async () => {})

      expect(screen.getByTestId('orders-page')).toBeInTheDocument()
    })

    it('pauses polling when tab is hidden', async () => {
      renderPage()
      await act(async () => {})
      expect(screen.getByTestId('awaiting-heading')).toBeInTheDocument()

      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))

      const callCountBeforeAdvance = mockGetOrder.mock.calls.length

      await act(async () => {
        vi.advanceTimersByTime(30000)
      })
      await act(async () => {})

      expect(mockGetOrder.mock.calls.length).toBe(callCountBeforeAdvance)

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      })
    })

    it('resumes polling when tab becomes visible again', async () => {
      renderPage()
      await act(async () => {})
      expect(screen.getByTestId('awaiting-heading')).toBeInTheDocument()

      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))

      await act(async () => {
        vi.advanceTimersByTime(30000)
      })
      await act(async () => {})

      const callCountWhileHidden = mockGetOrder.mock.calls.length

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))

      await act(async () => {
        vi.advanceTimersByTime(30000)
      })
      await act(async () => {})

      expect(mockGetOrder.mock.calls.length).toBeGreaterThan(callCountWhileHidden)
    })

    it('clears interval on unmount (no memory leak)', async () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
      const { unmount } = renderPage()
      await act(async () => {})
      expect(screen.getByTestId('awaiting-heading')).toBeInTheDocument()

      unmount()

      expect(clearIntervalSpy).toHaveBeenCalled()
      clearIntervalSpy.mockRestore()
    })
  })
})
