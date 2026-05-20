import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import AccountOrdersPage from './AccountOrdersPage'
import { AuthContext } from '../context/AuthContext'
import type { AuthContextValue } from '../context/AuthContext'
import type { User } from '@supabase/supabase-js'

const { mockListMyOrders, mockCreateOrder, mockNavigate } = vi.hoisted(() => ({
  mockListMyOrders: vi.fn(),
  mockCreateOrder: vi.fn(),
  mockNavigate: vi.fn(),
}))

vi.mock('../lib/orderApi', () => ({
  listMyOrders: mockListMyOrders,
  createOrder: mockCreateOrder,
}))

vi.mock('../lib/supabase', () => ({ supabase: {} }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const learner = {
  id: 'u-1',
  email: 'alice@test.com',
  name: 'Alice',
  avatar_url: null,
  role: 'learner' as const,
  created_at: '2026-01-01T00:00:00Z',
}

function makeCtx(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: { id: 'u-1', email: 'alice@test.com' } as User,
    loading: false,
    profile: learner,
    profileLoading: false,
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    ...overrides,
  }
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ord-1',
    course_id: 'c-1',
    user_id: 'u-1',
    status: 'pending' as const,
    amount: 480000,
    code: 'ORD-2026-000142',
    notes: null,
    platform_fee_pct: 20,
    platform_fee_amount: 96000,
    creator_payout_amount: 384000,
    creator_payout: 384000,
    account_tier_code: 'individual' as const,
    confirmed_at: null,
    confirmed_by: null,
    cancelled_at: null,
    cancelled_by: null,
    cancelled_reason: null,
    created_at: '2026-05-09T11:00:00Z',
    updated_at: '2026-05-09T11:00:00Z',
    course: { id: 'c-1', title: 'Chess Basics', thumbnail_url: '/t.jpg' },
    ...overrides,
  }
}

function renderPage(ctx: AuthContextValue = makeCtx()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AuthContext.Provider value={ctx}>
          <AccountOrdersPage />
        </AuthContext.Provider>
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('AccountOrdersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListMyOrders.mockResolvedValue({ orders: [makeRow()], total: 1, error: null })
  })

  it('redirects unauthenticated users to /login', async () => {
    renderPage(makeCtx({ user: null, profile: null }))
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true })
    })
  })

  it('renders the page title and the row from listMyOrders', async () => {
    renderPage()
    await waitFor(() => screen.getByTestId('order-row-ord-1'))
    expect(screen.getByText(/lịch sử đơn hàng/i)).toBeInTheDocument()
    const row = screen.getByTestId('order-row-ord-1')
    expect(within(row).getByText('ORD-2026-000142')).toBeInTheDocument()
    expect(within(row).getByText('Chess Basics')).toBeInTheDocument()
  })

  it('renders empty state with browse-courses CTA when no orders', async () => {
    mockListMyOrders.mockResolvedValueOnce({ orders: [], total: 0, error: null })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('orders-empty')).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: /khám phá khoá học/i })).toHaveAttribute('href', '/')
  })

  it('shows free orders as "Miễn phí" instead of 0 ₫', async () => {
    const freeRow = makeRow({
      id: 'ord-free',
      amount: 0,
      status: 'active' as const,
      code: 'ORD-2026-000143',
    })
    mockListMyOrders.mockResolvedValueOnce({ orders: [freeRow], total: 1, error: null })
    renderPage()
    const row = await screen.findByTestId('order-row-ord-free')
    expect(within(row).getByText(/miễn phí/i)).toBeInTheDocument()
    expect(within(row).queryByText('0 ₫')).not.toBeInTheDocument()
  })

  describe('contextual action per status', () => {
    it('Active → "Vào học" link to /learn/:courseId', async () => {
      mockListMyOrders.mockResolvedValueOnce({
        orders: [makeRow({ status: 'active' as const })],
        total: 1,
        error: null,
      })
      renderPage()
      const row = await screen.findByTestId('order-row-ord-1')
      const link = within(row).getByTestId('action-learn-ord-1')
      expect(link).toHaveAttribute('href', '/learn/c-1')
    })

    it('Pending → "Xem hướng dẫn thanh toán" link to /checkout/:orderId', async () => {
      renderPage()
      const row = await screen.findByTestId('order-row-ord-1')
      const link = within(row).getByTestId('action-checkout-ord-1')
      expect(link).toHaveAttribute('href', '/checkout/ord-1')
    })

    it('Cancelled → "Xem lý do" reveals own-cancel reason', async () => {
      mockListMyOrders.mockResolvedValueOnce({
        orders: [
          makeRow({
            id: 'ord-cancel',
            status: 'cancelled' as const,
            cancelled_by: 'u-1',
            cancelled_reason: 'changed my mind',
          }),
        ],
        total: 1,
        error: null,
      })
      renderPage()
      const row = await screen.findByTestId('order-row-ord-cancel')
      await userEvent.click(within(row).getByTestId('action-reveal-ord-cancel'))
      const reveal = await within(row).findByTestId('cancel-reveal-ord-cancel')
      expect(reveal).toHaveTextContent(/bạn đã huỷ đơn này/i)
      expect(reveal).toHaveTextContent('changed my mind')
    })

    it('Cancelled → "Xem lý do" reveals admin-cancel reason with admin prefix', async () => {
      mockListMyOrders.mockResolvedValueOnce({
        orders: [
          makeRow({
            id: 'ord-admin-cancel',
            status: 'cancelled' as const,
            cancelled_by: 'admin-9',
            cancelled_reason: 'duplicate transfer',
          }),
        ],
        total: 1,
        error: null,
      })
      renderPage()
      const row = await screen.findByTestId('order-row-ord-admin-cancel')
      await userEvent.click(within(row).getByTestId('action-reveal-ord-admin-cancel'))
      const reveal = await within(row).findByTestId('cancel-reveal-ord-admin-cancel')
      expect(reveal).toHaveTextContent(/admin đã huỷ/i)
      expect(reveal).toHaveTextContent('duplicate transfer')
    })
  })

  describe('expired orders', () => {
    it('renders "Hết hạn" badge for expired orders', async () => {
      mockListMyOrders.mockResolvedValueOnce({
        orders: [
          makeRow({
            id: 'ord-expired',
            status: 'expired' as const,
            code: 'ORD-2026-000200',
          }),
        ],
        total: 1,
        error: null,
      })
      renderPage()
      const row = await screen.findByTestId('order-row-ord-expired')
      expect(within(row).getByText(/hết hạn/i)).toBeInTheDocument()
    })

    it('renders "Mua lại" CTA for expired orders and reorders on click', async () => {
      mockListMyOrders.mockResolvedValueOnce({
        orders: [
          makeRow({
            id: 'ord-expired',
            status: 'expired' as const,
            code: 'ORD-2026-000200',
          }),
        ],
        total: 1,
        error: null,
      })
      mockCreateOrder.mockResolvedValueOnce({
        order: { id: 'ord-new', course_id: 'c-1', status: 'pending' },
        error: null,
      })
      renderPage()
      const row = await screen.findByTestId('order-row-ord-expired')
      const reorderBtn = within(row).getByTestId('action-reorder-ord-expired')
      expect(reorderBtn).toHaveTextContent(/mua lại/i)
      await userEvent.click(reorderBtn)
      await waitFor(() => {
        expect(mockCreateOrder).toHaveBeenCalledWith(expect.anything(), 'c-1')
      })
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/checkout/ord-new')
      })
    })

    it('filter pill "Hết hạn" refetches with status=expired', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))

      mockListMyOrders.mockResolvedValueOnce({ orders: [], total: 0, error: null })
      await userEvent.click(screen.getByTestId('filter-expired'))

      await waitFor(() => {
        const lastCall = mockListMyOrders.mock.calls[mockListMyOrders.mock.calls.length - 1]
        expect(lastCall[1]).toMatchObject({ status: 'expired' })
      })
    })
  })

  describe('refund_pending orders', () => {
    it('renders amber "Đang hoàn tiền" badge with refund-pending tooltip', async () => {
      mockListMyOrders.mockResolvedValueOnce({
        orders: [
          makeRow({
            id: 'ord-refund',
            status: 'refund_pending' as const,
            code: 'ORD-2026-000300',
          }),
        ],
        total: 1,
        error: null,
      })
      renderPage()
      const row = await screen.findByTestId('order-row-ord-refund')
      const badge = within(row).getByText(/đang hoàn tiền/i)
      expect(badge).toBeInTheDocument()
      // Tooltip — PRD-0005 D12d: "Admin sẽ chuyển khoản lại trong 3–7 ngày"
      expect(badge).toHaveAttribute('title', expect.stringMatching(/3.7 ngày/i))
    })

    it('renders "Đã hoàn tiền" badge for refunded orders (terminal state)', async () => {
      mockListMyOrders.mockResolvedValueOnce({
        orders: [
          makeRow({
            id: 'ord-refunded',
            status: 'refunded' as const,
            code: 'ORD-2026-000301',
          }),
        ],
        total: 1,
        error: null,
      })
      renderPage()
      const row = await screen.findByTestId('order-row-ord-refunded')
      expect(within(row).getByText(/đã hoàn tiền/i)).toBeInTheDocument()
    })
  })

  describe('filter pills', () => {
    it('switches to Active and refetches with status filter', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))

      mockListMyOrders.mockResolvedValueOnce({ orders: [], total: 0, error: null })
      await userEvent.click(screen.getByTestId('filter-active'))

      await waitFor(() => {
        const lastCall = mockListMyOrders.mock.calls[mockListMyOrders.mock.calls.length - 1]
        expect(lastCall[1]).toMatchObject({ status: 'active' })
      })
      expect(screen.getByTestId('filter-active')).toHaveAttribute('aria-pressed', 'true')
    })

    it('All tab refetches with no status filter', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))

      // First click to active, then back to all
      mockListMyOrders.mockResolvedValueOnce({ orders: [], total: 0, error: null })
      await userEvent.click(screen.getByTestId('filter-active'))
      await waitFor(() => expect(mockListMyOrders).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'active' })
      ))

      mockListMyOrders.mockResolvedValueOnce({ orders: [makeRow()], total: 1, error: null })
      await userEvent.click(screen.getByTestId('filter-all'))
      await waitFor(() => {
        const lastCall = mockListMyOrders.mock.calls[mockListMyOrders.mock.calls.length - 1]
        expect(lastCall[1].status).toBeUndefined()
      })
    })
  })

  // ── PRD-0005 D12c — last_seen_orders_at write on page open ──────────────
  //
  // Opening /account/orders is the user signal "I have seen the latest order
  // activity". The TopNav dot indicator reads this same key to decide whether
  // any order has confirmed/refunded/expired since.
  describe('last_seen_orders_at timestamp (PRD-0005 D12c)', () => {
    beforeEach(() => {
      localStorage.clear()
    })

    it('writes localStorage.last_seen_orders_at to a recent ISO timestamp after successful mount', async () => {
      const before = Date.now()
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      const stored = localStorage.getItem('last_seen_orders_at')
      expect(stored).not.toBeNull()
      const writtenAt = new Date(stored!).getTime()
      expect(writtenAt).toBeGreaterThanOrEqual(before)
      expect(writtenAt).toBeLessThanOrEqual(Date.now())
    })

    it('does not write the timestamp when the user is unauthenticated (redirects to login)', async () => {
      renderPage(makeCtx({ user: null, profile: null }))
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true })
      })
      expect(localStorage.getItem('last_seen_orders_at')).toBeNull()
    })
  })
})
