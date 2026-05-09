import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import AdminOrdersPage from './AdminOrdersPage'

const {
  mockListPendingOrders,
  mockListAllOrders,
  mockConfirmOrder,
  mockCancelOrder,
} = vi.hoisted(() => ({
  mockListPendingOrders: vi.fn(),
  mockListAllOrders: vi.fn(),
  mockConfirmOrder: vi.fn(),
  mockCancelOrder: vi.fn(),
}))

vi.mock('../../lib/adminOrdersApi', () => ({
  listPendingOrders: mockListPendingOrders,
  listAllOrders: mockListAllOrders,
  getPendingOrderCount: vi.fn().mockResolvedValue({ count: 0, error: null }),
}))

vi.mock('../../lib/orderApi', () => ({
  confirmOrder: mockConfirmOrder,
  cancelOrder: mockCancelOrder,
}))

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ord-1',
    course_id: 'c-1',
    user_id: 'u-1',
    status: 'pending',
    amount: 480000,
    code: 'ORD-2026-000142',
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
    created_at: '2026-05-09T11:00:00Z',
    updated_at: '2026-05-09T11:00:00Z',
    buyer: { id: 'u-1', name: 'Alice', email: 'alice@test.com', avatar_url: null },
    course: { id: 'c-1', title: 'Chess Basics' },
    ...overrides,
  }
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AdminOrdersPage />
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('AdminOrdersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListPendingOrders.mockResolvedValue({ orders: [makeRow()], total: 1, error: null })
    mockListAllOrders.mockResolvedValue({ orders: [], total: 0, error: null })
    mockConfirmOrder.mockResolvedValue({ order: makeRow({ status: 'active' }), error: null })
    mockCancelOrder.mockResolvedValue({ order: makeRow({ status: 'cancelled' }), error: null })
  })

  describe('Pending tab (default)', () => {
    it('loads pending orders and renders the row', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('order-row-ord-1')).toBeInTheDocument()
      })
      expect(screen.getByTestId('orders-tab-pending')).toHaveAttribute('aria-selected', 'true')
      expect(mockListPendingOrders).toHaveBeenCalled()
      // Code, learner, and course title rendered
      const row = screen.getByTestId('order-row-ord-1')
      expect(within(row).getByText('ORD-2026-000142')).toBeInTheDocument()
      expect(within(row).getByText('Alice')).toBeInTheDocument()
      expect(within(row).getByText('alice@test.com')).toBeInTheDocument()
      expect(within(row).getByText('Chess Basics')).toBeInTheDocument()
    })

    it('shows empty state when there are no pending orders', async () => {
      mockListPendingOrders.mockResolvedValueOnce({ orders: [], total: 0, error: null })
      renderPage()
      await waitFor(() => {
        expect(screen.getByTestId('orders-empty')).toBeInTheDocument()
      })
    })
  })

  describe('confirm action', () => {
    it('calls confirmOrder, shows success toast, and removes the row from the pending list', async () => {
      renderPage()
      const row = await screen.findByTestId('order-row-ord-1')
      await userEvent.click(within(row).getByTestId('confirm-btn-ord-1'))

      await waitFor(() => {
        expect(mockConfirmOrder).toHaveBeenCalledWith(expect.anything(), 'ord-1')
      })
      expect(await screen.findByTestId('orders-success-toast')).toBeInTheDocument()
      // Optimistic: row leaves the pending tab once status becomes 'active'
      await waitFor(() => {
        expect(screen.queryByTestId('order-row-ord-1')).not.toBeInTheDocument()
      })
    })

    it('shows error toast when confirm fails', async () => {
      mockConfirmOrder.mockResolvedValueOnce({ order: null, error: { message: 'forbidden' } })
      renderPage()
      const row = await screen.findByTestId('order-row-ord-1')
      await userEvent.click(within(row).getByTestId('confirm-btn-ord-1'))

      expect(await screen.findByTestId('orders-error-toast')).toBeInTheDocument()
      // Row is preserved on failure
      expect(screen.getByTestId('order-row-ord-1')).toBeInTheDocument()
    })
  })

  describe('cancel dialog', () => {
    it('opens dialog from kebab menu and requires non-empty reason', async () => {
      renderPage()
      const row = await screen.findByTestId('order-row-ord-1')
      await userEvent.click(within(row).getByTestId('kebab-btn-ord-1'))
      await userEvent.click(screen.getByTestId('cancel-menu-item-ord-1'))

      const dialog = await screen.findByTestId('cancel-dialog')
      const confirmBtn = within(dialog).getByTestId('cancel-dialog-confirm')

      // With empty textarea, the confirm button should be disabled
      expect(confirmBtn).toBeDisabled()

      const textarea = within(dialog).getByTestId('cancel-reason-textarea')
      await userEvent.type(textarea, 'Wrong amount transferred')
      expect(confirmBtn).toBeEnabled()
    })

    it('submits cancel with reason and removes the row + shows success toast', async () => {
      renderPage()
      const row = await screen.findByTestId('order-row-ord-1')
      await userEvent.click(within(row).getByTestId('kebab-btn-ord-1'))
      await userEvent.click(screen.getByTestId('cancel-menu-item-ord-1'))

      const dialog = await screen.findByTestId('cancel-dialog')
      await userEvent.type(within(dialog).getByTestId('cancel-reason-textarea'), 'Wrong amount')
      await userEvent.click(within(dialog).getByTestId('cancel-dialog-confirm'))

      await waitFor(() => {
        expect(mockCancelOrder).toHaveBeenCalledWith(expect.anything(), 'ord-1', 'Wrong amount')
      })
      expect(await screen.findByTestId('orders-success-toast')).toBeInTheDocument()
      await waitFor(() => {
        expect(screen.queryByTestId('order-row-ord-1')).not.toBeInTheDocument()
      })
    })

    it('rejects reason longer than 500 chars without calling RPC', async () => {
      renderPage()
      const row = await screen.findByTestId('order-row-ord-1')
      await userEvent.click(within(row).getByTestId('kebab-btn-ord-1'))
      await userEvent.click(screen.getByTestId('cancel-menu-item-ord-1'))

      const dialog = await screen.findByTestId('cancel-dialog')
      const textarea = within(dialog).getByTestId('cancel-reason-textarea')
      // maxLength=500 — typing 600 chars yields a 500-char value, so we drive
      // the over-length path by directly setting the field via fireEvent.
      const longReason = 'x'.repeat(501)
      // Bypass maxLength to force the > 500 case
      ;(textarea as HTMLTextAreaElement).value = longReason
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      await userEvent.click(within(dialog).getByTestId('cancel-dialog-confirm'))

      // The button should remain a no-op past 500 chars; cancelOrder must NOT be called.
      expect(mockCancelOrder).not.toHaveBeenCalled()
    })
  })

  describe('All tab', () => {
    it('switches to All and refetches with no status filter', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))

      const activeRow = makeRow({ id: 'ord-2', status: 'active' })
      mockListAllOrders.mockResolvedValueOnce({ orders: [activeRow], total: 1, error: null })

      await userEvent.click(screen.getByTestId('orders-tab-all'))

      await waitFor(() => {
        expect(mockListAllOrders).toHaveBeenCalled()
      })
      expect(screen.getByTestId('orders-tab-all')).toHaveAttribute('aria-selected', 'true')
      // Status pill column visible on All tab
      expect(await screen.findByTestId('order-row-ord-2')).toBeInTheDocument()
    })

    it('applies status filter from dropdown', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      await userEvent.click(screen.getByTestId('orders-tab-all'))
      await waitFor(() => expect(mockListAllOrders).toHaveBeenCalled())

      mockListAllOrders.mockResolvedValueOnce({ orders: [], total: 0, error: null })
      await userEvent.selectOptions(screen.getByTestId('status-filter'), 'active')

      await waitFor(() => {
        expect(mockListAllOrders).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.objectContaining({ status: 'active' })
        )
      })
    })

    it('applies search input (debounced), forwards to listAllOrders', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      await userEvent.click(screen.getByTestId('orders-tab-all'))
      await waitFor(() => expect(mockListAllOrders).toHaveBeenCalled())

      mockListAllOrders.mockResolvedValueOnce({ orders: [], total: 0, error: null })
      await userEvent.type(screen.getByTestId('orders-search'), 'ORD-2026')

      await waitFor(() => {
        const lastCall = mockListAllOrders.mock.calls[mockListAllOrders.mock.calls.length - 1]
        expect(lastCall[1]).toMatchObject({ search: 'ORD-2026' })
      }, { timeout: 2000 })
    })
  })
})
