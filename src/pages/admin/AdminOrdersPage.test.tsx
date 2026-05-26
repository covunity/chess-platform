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
  mockListStalePendingOrders,
  mockGetStalePendingOrderCount,
  mockListRefundPendingOrders,
  mockGetRefundPendingOrderCount,
  mockMarkOrderRefunded,
  mockConfirmOrder,
  mockCancelOrder,
} = vi.hoisted(() => ({
  mockListPendingOrders: vi.fn(),
  mockListAllOrders: vi.fn(),
  mockListStalePendingOrders: vi.fn(),
  mockGetStalePendingOrderCount: vi.fn(),
  mockListRefundPendingOrders: vi.fn(),
  mockGetRefundPendingOrderCount: vi.fn(),
  mockMarkOrderRefunded: vi.fn(),
  mockConfirmOrder: vi.fn(),
  mockCancelOrder: vi.fn(),
}))

vi.mock('../../lib/adminOrdersApi', () => ({
  listPendingOrders: mockListPendingOrders,
  listAllOrders: mockListAllOrders,
  listStalePendingOrders: mockListStalePendingOrders,
  getPendingOrderCount: vi.fn().mockResolvedValue({ count: 0, error: null }),
  getStalePendingOrderCount: mockGetStalePendingOrderCount,
  listRefundPendingOrders: mockListRefundPendingOrders,
  getRefundPendingOrderCount: mockGetRefundPendingOrderCount,
  markOrderRefunded: mockMarkOrderRefunded,
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
    // PRD-0006 slice 5: snapshot fields populated by slice 2 + 3b RPCs.
    // makeRow defaults to a "no discount" order; tests override per scenario.
    original_price: 480000,
    campaign_id: null,
    campaign_discount_amount: 0,
    voucher_id: null,
    voucher_code: null,
    voucher_discount_amount: 0,
    campaign: null,
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
    mockListStalePendingOrders.mockResolvedValue({ orders: [], total: 0, error: null })
    mockGetStalePendingOrderCount.mockResolvedValue({ count: 0, error: null })
    mockListRefundPendingOrders.mockResolvedValue({ orders: [], total: 0, error: null })
    mockGetRefundPendingOrderCount.mockResolvedValue({ count: 0, error: null })
    mockMarkOrderRefunded.mockResolvedValue({
      order: makeRow({ status: 'refunded' }),
      error: null,
    })
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

  // ── Issue #294: Pending tab no longer has inline 1-click confirm ──
  //
  // PRD-0005 D12b locks manual-confirm surface to the "Cần can thiệp" tab
  // (created_at > 1h) to prevent admins from accidentally granting free
  // access on in-flight orders (PayOS normally confirms in 5-30s). The
  // legacy inline `confirm-btn-<id>` on Pending rows violated this and has
  // been removed entirely. The canonical path is now the
  // `manual-confirm-btn-<id>` + dialog on the stale tab.
  describe('Pending tab: no inline confirm (#294)', () => {
    it('does not render an inline confirm button on pending rows', async () => {
      renderPage()
      const row = await screen.findByTestId('order-row-ord-1')
      expect(within(row).queryByTestId('confirm-btn-ord-1')).not.toBeInTheDocument()
    })

    it('does not render an inline confirm button on pending rows visible in the All tab', async () => {
      const pendingRow = makeRow({ id: 'ord-all-pending', status: 'pending' })
      mockListAllOrders.mockResolvedValueOnce({
        orders: [pendingRow],
        total: 1,
        error: null,
      })
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      await userEvent.click(screen.getByTestId('orders-tab-all'))

      const row = await screen.findByTestId('order-row-ord-all-pending')
      expect(within(row).queryByTestId('confirm-btn-ord-all-pending')).not.toBeInTheDocument()
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

    // ── Issue #292: cancel_order must not be reachable from terminal states ──
    //
    // The kebab "Huỷ đơn" item was previously gated only by status !== 'cancelled',
    // which left it clickable on refund_pending / refunded / expired rows. Clicking
    // it on refund_pending flipped the row to cancelled, orphaning the refund
    // obligation (learner had already transferred money). Hide the kebab for any
    // status outside the allowlist (pending|active).
    it.each([
      ['refund_pending'],
      ['refunded'],
      ['expired'],
      ['cancelled'],
    ])('hides the kebab "Huỷ đơn" entry on %s rows in the All tab', async status => {
      const terminalRow = makeRow({ id: `ord-${status}`, status })
      mockListAllOrders.mockResolvedValueOnce({
        orders: [terminalRow],
        total: 1,
        error: null,
      })
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      await userEvent.click(screen.getByTestId('orders-tab-all'))

      await screen.findByTestId(`order-row-ord-${status}`)
      // Neither the kebab trigger nor the menu item should be in the DOM.
      expect(screen.queryByTestId(`kebab-btn-ord-${status}`)).not.toBeInTheDocument()
      expect(screen.queryByTestId(`cancel-menu-item-ord-${status}`)).not.toBeInTheDocument()
    })

    it('still shows the kebab "Huỷ đơn" entry on active rows in the All tab', async () => {
      const activeRow = makeRow({ id: 'ord-active', status: 'active' })
      mockListAllOrders.mockResolvedValueOnce({
        orders: [activeRow],
        total: 1,
        error: null,
      })
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      await userEvent.click(screen.getByTestId('orders-tab-all'))

      const row = await screen.findByTestId('order-row-ord-active')
      await userEvent.click(within(row).getByTestId('kebab-btn-ord-active'))
      expect(screen.getByTestId('cancel-menu-item-ord-active')).toBeInTheDocument()
    })
  })

  // ── Slice 4 of PRD-0005: "Cần can thiệp" tab ────────────────────────────
  describe('Cần can thiệp (stale pending) tab', () => {
    it('renders the tab with the count badge from getStalePendingOrderCount', async () => {
      mockGetStalePendingOrderCount.mockResolvedValueOnce({ count: 2, error: null })
      renderPage()

      const tab = await screen.findByTestId('orders-tab-stale')
      expect(tab).toBeInTheDocument()
      // Counter rendered in the tab label (e.g. "Cần can thiệp (2)")
      await waitFor(() => {
        expect(tab.textContent).toMatch(/2/)
      })
    })

    it('switching to the tab fetches stale pending orders', async () => {
      const staleRow = makeRow({ id: 'ord-stale', code: 'ORD-2026-000900' })
      mockListStalePendingOrders.mockResolvedValueOnce({
        orders: [staleRow],
        total: 1,
        error: null,
      })
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))

      await userEvent.click(screen.getByTestId('orders-tab-stale'))

      await waitFor(() => {
        expect(mockListStalePendingOrders).toHaveBeenCalled()
      })
      expect(screen.getByTestId('orders-tab-stale')).toHaveAttribute('aria-selected', 'true')
      expect(await screen.findByTestId('order-row-ord-stale')).toBeInTheDocument()
    })

    it('clicking "Xác nhận thủ công" opens a dialog requiring a non-empty reason', async () => {
      const staleRow = makeRow({ id: 'ord-stale' })
      mockListStalePendingOrders.mockResolvedValueOnce({
        orders: [staleRow],
        total: 1,
        error: null,
      })
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      await userEvent.click(screen.getByTestId('orders-tab-stale'))

      const row = await screen.findByTestId('order-row-ord-stale')
      await userEvent.click(within(row).getByTestId('manual-confirm-btn-ord-stale'))

      const dialog = await screen.findByTestId('manual-confirm-dialog')
      const confirmBtn = within(dialog).getByTestId('manual-confirm-dialog-confirm')
      expect(confirmBtn).toBeDisabled()

      const textarea = within(dialog).getByTestId('manual-confirm-reason-textarea')
      await userEvent.type(textarea, 'Bank statement OK; webhook missing')
      expect(confirmBtn).toBeEnabled()
    })

    it('submitting the manual-confirm dialog calls confirm_order RPC with the typed reason and removes the row', async () => {
      const staleRow = makeRow({ id: 'ord-stale' })
      mockListStalePendingOrders.mockResolvedValueOnce({
        orders: [staleRow],
        total: 1,
        error: null,
      })
      mockGetStalePendingOrderCount.mockResolvedValue({ count: 1, error: null })
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      await userEvent.click(screen.getByTestId('orders-tab-stale'))

      const row = await screen.findByTestId('order-row-ord-stale')
      await userEvent.click(within(row).getByTestId('manual-confirm-btn-ord-stale'))

      const dialog = await screen.findByTestId('manual-confirm-dialog')
      await userEvent.type(
        within(dialog).getByTestId('manual-confirm-reason-textarea'),
        'Bank statement OK'
      )
      await userEvent.click(within(dialog).getByTestId('manual-confirm-dialog-confirm'))

      // Issue #293: the typed reason MUST be forwarded to the RPC so the DB
      // captures `manual_confirm_reason` for audit. Previously the dialog text
      // was console.info'd then discarded.
      await waitFor(() => {
        expect(mockConfirmOrder).toHaveBeenCalledWith(
          expect.anything(),
          'ord-stale',
          'Bank statement OK'
        )
      })
      expect(await screen.findByTestId('orders-success-toast')).toBeInTheDocument()
      await waitFor(() => {
        expect(screen.queryByTestId('order-row-ord-stale')).not.toBeInTheDocument()
      })
    })

    it('renders the persisted manual_confirm_reason on rows that carry one (audit visibility, #293)', async () => {
      // A previously manually-confirmed order surfaced in the All tab should
      // show its reason inline so admins can audit why the override happened.
      const confirmedRow = makeRow({
        id: 'ord-mc-1',
        status: 'active',
        confirmed_at: '2026-05-19T08:00:00Z',
        confirmed_by: 'admin-uid',
        manual_confirm_reason: 'Bank statement OK; webhook missing',
      })
      mockListAllOrders.mockResolvedValueOnce({
        orders: [confirmedRow],
        total: 1,
        error: null,
      })
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      await userEvent.click(screen.getByTestId('orders-tab-all'))

      const row = await screen.findByTestId('order-row-ord-mc-1')
      const reasonEl = within(row).getByTestId('manual-confirm-reason-ord-mc-1')
      expect(reasonEl).toBeInTheDocument()
      expect(reasonEl.textContent).toMatch(/Bank statement OK; webhook missing/)
    })

    it('does not render a manual_confirm_reason element on rows without one', async () => {
      const plainRow = makeRow({ id: 'ord-plain', status: 'active' })
      mockListAllOrders.mockResolvedValueOnce({
        orders: [plainRow],
        total: 1,
        error: null,
      })
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      await userEvent.click(screen.getByTestId('orders-tab-all'))

      await screen.findByTestId('order-row-ord-plain')
      expect(screen.queryByTestId('manual-confirm-reason-ord-plain')).not.toBeInTheDocument()
    })

    it('stale row still exposes the kebab "Huỷ đơn" action', async () => {
      const staleRow = makeRow({ id: 'ord-stale' })
      mockListStalePendingOrders.mockResolvedValueOnce({
        orders: [staleRow],
        total: 1,
        error: null,
      })
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      await userEvent.click(screen.getByTestId('orders-tab-stale'))

      const row = await screen.findByTestId('order-row-ord-stale')
      await userEvent.click(within(row).getByTestId('kebab-btn-ord-stale'))
      expect(screen.getByTestId('cancel-menu-item-ord-stale')).toBeInTheDocument()
    })
  })

  // ── Slice 5 of PRD-0005: "Cần refund" tab ────────────────────────────
  // ── Issue #296: stale counter must refresh when admin sits on the page ──
  describe('Cần can thiệp counter refresh (#296)', () => {
    it('re-fetches stale + refund counts when the tab becomes visible again', async () => {
      // Initial mount returns 0 stale; after visibility flip we simulate an order
      // crossing the 1h threshold by returning 1.
      mockGetStalePendingOrderCount.mockResolvedValueOnce({ count: 0, error: null })
      mockGetRefundPendingOrderCount.mockResolvedValueOnce({ count: 0, error: null })
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      expect(mockGetStalePendingOrderCount).toHaveBeenCalledTimes(1)
      expect(mockGetRefundPendingOrderCount).toHaveBeenCalledTimes(1)

      // Simulate the admin tab regaining focus.
      mockGetStalePendingOrderCount.mockResolvedValueOnce({ count: 1, error: null })
      mockGetRefundPendingOrderCount.mockResolvedValueOnce({ count: 0, error: null })
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      })
      document.dispatchEvent(new Event('visibilitychange'))

      await waitFor(() => {
        expect(mockGetStalePendingOrderCount).toHaveBeenCalledTimes(2)
      })
      expect(mockGetRefundPendingOrderCount).toHaveBeenCalledTimes(2)
      // Tab badge updates to the new count.
      await waitFor(() => {
        expect(screen.getByTestId('orders-tab-stale').textContent).toMatch(/1/)
      })
    })

    it('does NOT re-fetch when document becomes hidden', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      expect(mockGetStalePendingOrderCount).toHaveBeenCalledTimes(1)

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      })
      document.dispatchEvent(new Event('visibilitychange'))

      // Give any spurious effect a chance to run.
      await new Promise(r => setTimeout(r, 10))
      expect(mockGetStalePendingOrderCount).toHaveBeenCalledTimes(1)
    })

    it('re-fetches stale count when admin clicks the "Cần can thiệp" tab', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      const initialStale = mockGetStalePendingOrderCount.mock.calls.length

      await userEvent.click(screen.getByTestId('orders-tab-stale'))

      await waitFor(() => {
        expect(mockGetStalePendingOrderCount.mock.calls.length).toBeGreaterThan(initialStale)
      })
    })

    it('re-fetches refund count when admin clicks the "Cần refund" tab', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      const initialRefund = mockGetRefundPendingOrderCount.mock.calls.length

      await userEvent.click(screen.getByTestId('orders-tab-refund'))

      await waitFor(() => {
        expect(mockGetRefundPendingOrderCount.mock.calls.length).toBeGreaterThan(initialRefund)
      })
    })
  })

  describe('Cần refund (refund_pending) tab', () => {
    const refundRow = makeRow({
      id: 'ord-rp',
      code: 'ORD-2026-000777',
      status: 'refund_pending',
      amount: 480000,
      refund_due_to: {
        payer_account: '0123456789',
        payer_name: 'NGUYEN VAN A',
        payer_bank: 'Vietcombank',
        amount: '480000',
        paid_at: '2026-05-18T10:00:00Z',
      },
    })

    it('renders the tab with the count badge from getRefundPendingOrderCount', async () => {
      mockGetRefundPendingOrderCount.mockResolvedValueOnce({ count: 3, error: null })
      renderPage()

      const tab = await screen.findByTestId('orders-tab-refund')
      expect(tab).toBeInTheDocument()
      await waitFor(() => {
        expect(tab.textContent).toMatch(/3/)
      })
    })

    it('switching to the tab fetches refund_pending orders and shows masked account + holder + bank', async () => {
      mockListRefundPendingOrders.mockResolvedValueOnce({
        orders: [refundRow],
        total: 1,
        error: null,
      })
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))

      await userEvent.click(screen.getByTestId('orders-tab-refund'))

      await waitFor(() => {
        expect(mockListRefundPendingOrders).toHaveBeenCalled()
      })
      expect(screen.getByTestId('orders-tab-refund')).toHaveAttribute('aria-selected', 'true')
      const row = await screen.findByTestId('order-row-ord-rp')
      // Masked account = last 4 digits prefixed by dots
      expect(within(row).getByText(/••••6789/)).toBeInTheDocument()
      expect(within(row).getByText('NGUYEN VAN A')).toBeInTheDocument()
      expect(within(row).getByText('Vietcombank')).toBeInTheDocument()
      expect(within(row).getByText('ORD-2026-000777')).toBeInTheDocument()
    })

    it('clicking "Đánh dấu hoàn tiền" opens a dialog requiring a non-empty reference', async () => {
      mockListRefundPendingOrders.mockResolvedValueOnce({
        orders: [refundRow],
        total: 1,
        error: null,
      })
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      await userEvent.click(screen.getByTestId('orders-tab-refund'))

      const row = await screen.findByTestId('order-row-ord-rp')
      await userEvent.click(within(row).getByTestId('mark-refunded-btn-ord-rp'))

      const dialog = await screen.findByTestId('refund-dialog')
      const confirmBtn = within(dialog).getByTestId('refund-dialog-confirm')
      expect(confirmBtn).toBeDisabled()

      const input = within(dialog).getByTestId('refund-reference-input')
      await userEvent.type(input, 'TF260519123456')
      expect(confirmBtn).toBeEnabled()
    })

    it('submitting the refund dialog calls mark_order_refunded RPC, removes the row, decrements counter', async () => {
      mockListRefundPendingOrders.mockResolvedValueOnce({
        orders: [refundRow],
        total: 1,
        error: null,
      })
      mockGetRefundPendingOrderCount.mockResolvedValueOnce({ count: 1, error: null })
      // After the action, the counter refresh returns 0
      mockGetRefundPendingOrderCount.mockResolvedValueOnce({ count: 0, error: null })
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      await userEvent.click(screen.getByTestId('orders-tab-refund'))

      const row = await screen.findByTestId('order-row-ord-rp')
      await userEvent.click(within(row).getByTestId('mark-refunded-btn-ord-rp'))

      const dialog = await screen.findByTestId('refund-dialog')
      await userEvent.type(
        within(dialog).getByTestId('refund-reference-input'),
        'TF260519123456'
      )
      await userEvent.click(within(dialog).getByTestId('refund-dialog-confirm'))

      await waitFor(() => {
        expect(mockMarkOrderRefunded).toHaveBeenCalledWith(
          expect.anything(),
          'ord-rp',
          'TF260519123456'
        )
      })
      expect(await screen.findByTestId('orders-success-toast')).toBeInTheDocument()
      await waitFor(() => {
        expect(screen.queryByTestId('order-row-ord-rp')).not.toBeInTheDocument()
      })
      // Counter refresh fires post-action
      await waitFor(() => {
        expect(mockGetRefundPendingOrderCount.mock.calls.length).toBeGreaterThanOrEqual(2)
      })
    })

    it('shows error toast when mark_order_refunded fails', async () => {
      mockListRefundPendingOrders.mockResolvedValueOnce({
        orders: [refundRow],
        total: 1,
        error: null,
      })
      mockMarkOrderRefunded.mockResolvedValueOnce({
        order: null,
        error: { message: 'order not in refund_pending status' },
      })
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      await userEvent.click(screen.getByTestId('orders-tab-refund'))

      const row = await screen.findByTestId('order-row-ord-rp')
      await userEvent.click(within(row).getByTestId('mark-refunded-btn-ord-rp'))
      const dialog = await screen.findByTestId('refund-dialog')
      await userEvent.type(
        within(dialog).getByTestId('refund-reference-input'),
        'TF260519123456'
      )
      await userEvent.click(within(dialog).getByTestId('refund-dialog-confirm'))

      // Dialog stays open and the inline error is visible
      await waitFor(() => {
        expect(within(dialog).getByRole('alert')).toBeInTheDocument()
      })
      // Row still present
      expect(screen.getByTestId('order-row-ord-rp')).toBeInTheDocument()
    })
  })

  // ── Slice 5 of PRD-0006: voucher + campaign visibility (#309) ─────────────
  describe('voucher + campaign columns (#309)', () => {
    it('renders "—" in both Voucher and Khuyến mại columns for a plain order', async () => {
      renderPage()
      const row = await screen.findByTestId('order-row-ord-1')
      const voucherCell = within(row).getByTestId('order-voucher-cell-ord-1')
      const campaignCell = within(row).getByTestId('order-campaign-cell-ord-1')
      expect(voucherCell.textContent).toBe('—')
      expect(campaignCell.textContent).toBe('—')
    })

    it('renders only the campaign name when only campaign_id is set', async () => {
      const campaignRow = makeRow({
        id: 'ord-cmp',
        original_price: 500000,
        amount: 400000,
        campaign_id: 'cmp-1',
        campaign_discount_amount: 100000,
        campaign: { id: 'cmp-1', name: 'Tết Sale 2026' },
      })
      mockListPendingOrders.mockResolvedValueOnce({
        orders: [campaignRow],
        total: 1,
        error: null,
      })
      renderPage()
      const row = await screen.findByTestId('order-row-ord-cmp')
      expect(within(row).getByTestId('order-voucher-cell-ord-cmp').textContent).toBe('—')
      expect(within(row).getByTestId('order-campaign-cell-ord-cmp').textContent).toBe(
        'Tết Sale 2026'
      )
    })

    it('renders only the voucher code (mono) when only voucher_id is set', async () => {
      const voucherRow = makeRow({
        id: 'ord-vch',
        original_price: 500000,
        amount: 450000,
        voucher_id: 'v-1',
        voucher_code: 'WELCOME10',
        voucher_discount_amount: 50000,
      })
      mockListPendingOrders.mockResolvedValueOnce({
        orders: [voucherRow],
        total: 1,
        error: null,
      })
      renderPage()
      const row = await screen.findByTestId('order-row-ord-vch')
      const voucherCell = within(row).getByTestId('order-voucher-cell-ord-vch')
      expect(voucherCell.textContent).toBe('WELCOME10')
      // Voucher codes are font-mono for readability and to mirror the order code style
      expect(voucherCell.querySelector('.font-mono')).not.toBeNull()
      expect(within(row).getByTestId('order-campaign-cell-ord-vch').textContent).toBe('—')
    })

    it('renders both columns populated when both voucher and campaign apply', async () => {
      const bothRow = makeRow({
        id: 'ord-both',
        original_price: 500000,
        amount: 350000,
        campaign_id: 'cmp-1',
        campaign_discount_amount: 100000,
        campaign: { id: 'cmp-1', name: 'Tết Sale 2026' },
        voucher_id: 'v-1',
        voucher_code: 'WELCOME10',
        voucher_discount_amount: 50000,
      })
      mockListPendingOrders.mockResolvedValueOnce({
        orders: [bothRow],
        total: 1,
        error: null,
      })
      renderPage()
      const row = await screen.findByTestId('order-row-ord-both')
      expect(within(row).getByTestId('order-voucher-cell-ord-both').textContent).toBe(
        'WELCOME10'
      )
      expect(within(row).getByTestId('order-campaign-cell-ord-both').textContent).toBe(
        'Tết Sale 2026'
      )
    })

    // Migration 068 sets voucher_id ON DELETE SET NULL but the snapshot code
    // text persists on the order. Admin must still see what code was used.
    it('falls back to voucher_code snapshot when voucher_id is null but code text exists', async () => {
      const deletedVoucherRow = makeRow({
        id: 'ord-deleted-v',
        original_price: 500000,
        amount: 450000,
        voucher_id: null,
        voucher_code: 'GHOST10',
        voucher_discount_amount: 50000,
      })
      mockListPendingOrders.mockResolvedValueOnce({
        orders: [deletedVoucherRow],
        total: 1,
        error: null,
      })
      renderPage()
      const row = await screen.findByTestId('order-row-ord-deleted-v')
      expect(within(row).getByTestId('order-voucher-cell-ord-deleted-v').textContent).toBe(
        'GHOST10'
      )
    })

    it('hides the detail-toggle on rows without any discount', async () => {
      renderPage()
      const row = await screen.findByTestId('order-row-ord-1')
      expect(within(row).queryByTestId('order-details-btn-ord-1')).not.toBeInTheDocument()
    })

    it('toggles a breakdown row showing original, campaign, voucher, final, fee, payout', async () => {
      const bothRow = makeRow({
        id: 'ord-both',
        original_price: 500000,
        amount: 350000,
        platform_fee_amount: 70000,
        creator_payout_amount: 280000,
        campaign_id: 'cmp-1',
        campaign_discount_amount: 100000,
        campaign: { id: 'cmp-1', name: 'Tết Sale 2026' },
        voucher_id: 'v-1',
        voucher_code: 'WELCOME10',
        voucher_discount_amount: 50000,
      })
      mockListPendingOrders.mockResolvedValueOnce({
        orders: [bothRow],
        total: 1,
        error: null,
      })
      renderPage()
      const row = await screen.findByTestId('order-row-ord-both')

      // No drawer until toggled
      expect(screen.queryByTestId('order-breakdown-ord-both')).not.toBeInTheDocument()

      await userEvent.click(within(row).getByTestId('order-details-btn-ord-both'))

      const drawer = await screen.findByTestId('order-breakdown-ord-both')
      // Each breakdown row carries a stable test id for asserting values
      expect(within(drawer).getByTestId('breakdown-original')).toHaveTextContent('500.000đ')
      expect(within(drawer).getByTestId('breakdown-campaign')).toHaveTextContent('100.000đ')
      expect(within(drawer).getByTestId('breakdown-campaign')).toHaveTextContent(
        'Tết Sale 2026'
      )
      expect(within(drawer).getByTestId('breakdown-voucher')).toHaveTextContent('50.000đ')
      expect(within(drawer).getByTestId('breakdown-voucher')).toHaveTextContent('WELCOME10')
      expect(within(drawer).getByTestId('breakdown-final')).toHaveTextContent('350.000đ')
      expect(within(drawer).getByTestId('breakdown-platform-fee')).toHaveTextContent('70.000đ')
      expect(within(drawer).getByTestId('breakdown-creator-payout')).toHaveTextContent(
        '280.000đ'
      )
    })

    it('hides the campaign breakdown row when only a voucher was applied', async () => {
      const voucherOnly = makeRow({
        id: 'ord-vch-only',
        original_price: 500000,
        amount: 450000,
        platform_fee_amount: 90000,
        creator_payout_amount: 360000,
        voucher_id: 'v-1',
        voucher_code: 'WELCOME10',
        voucher_discount_amount: 50000,
      })
      mockListPendingOrders.mockResolvedValueOnce({
        orders: [voucherOnly],
        total: 1,
        error: null,
      })
      renderPage()
      const row = await screen.findByTestId('order-row-ord-vch-only')
      await userEvent.click(within(row).getByTestId('order-details-btn-ord-vch-only'))

      const drawer = await screen.findByTestId('order-breakdown-ord-vch-only')
      expect(within(drawer).queryByTestId('breakdown-campaign')).not.toBeInTheDocument()
      expect(within(drawer).getByTestId('breakdown-voucher')).toHaveTextContent('WELCOME10')
    })
  })

  describe('discount filter chips (#309)', () => {
    it('renders the three chips only on the All tab', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))

      // Pending tab: chips not visible
      expect(screen.queryByTestId('discount-filter-hasVoucher')).not.toBeInTheDocument()

      await userEvent.click(screen.getByTestId('orders-tab-all'))

      expect(await screen.findByTestId('discount-filter-hasVoucher')).toBeInTheDocument()
      expect(screen.getByTestId('discount-filter-hasCampaign')).toBeInTheDocument()
      expect(screen.getByTestId('discount-filter-noDiscount')).toBeInTheDocument()
    })

    it('clicking "Có voucher" forwards discountFilter=hasVoucher to listAllOrders', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      await userEvent.click(screen.getByTestId('orders-tab-all'))
      await waitFor(() => expect(mockListAllOrders).toHaveBeenCalled())

      mockListAllOrders.mockResolvedValueOnce({ orders: [], total: 0, error: null })
      await userEvent.click(screen.getByTestId('discount-filter-hasVoucher'))

      await waitFor(() => {
        expect(mockListAllOrders).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.objectContaining({ discountFilter: 'hasVoucher' })
        )
      })
    })

    it('clicking "Có campaign" forwards discountFilter=hasCampaign', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      await userEvent.click(screen.getByTestId('orders-tab-all'))
      await waitFor(() => expect(mockListAllOrders).toHaveBeenCalled())

      mockListAllOrders.mockResolvedValueOnce({ orders: [], total: 0, error: null })
      await userEvent.click(screen.getByTestId('discount-filter-hasCampaign'))

      await waitFor(() => {
        expect(mockListAllOrders).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.objectContaining({ discountFilter: 'hasCampaign' })
        )
      })
    })

    it('clicking "Không discount" forwards discountFilter=noDiscount', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      await userEvent.click(screen.getByTestId('orders-tab-all'))
      await waitFor(() => expect(mockListAllOrders).toHaveBeenCalled())

      mockListAllOrders.mockResolvedValueOnce({ orders: [], total: 0, error: null })
      await userEvent.click(screen.getByTestId('discount-filter-noDiscount'))

      await waitFor(() => {
        expect(mockListAllOrders).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.objectContaining({ discountFilter: 'noDiscount' })
        )
      })
    })

    it('clicking an active chip again clears the filter (toggle off)', async () => {
      renderPage()
      await waitFor(() => screen.getByTestId('order-row-ord-1'))
      await userEvent.click(screen.getByTestId('orders-tab-all'))
      await waitFor(() => expect(mockListAllOrders).toHaveBeenCalled())

      await userEvent.click(screen.getByTestId('discount-filter-hasVoucher'))
      await waitFor(() => {
        expect(mockListAllOrders).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.objectContaining({ discountFilter: 'hasVoucher' })
        )
      })

      mockListAllOrders.mockResolvedValueOnce({ orders: [], total: 0, error: null })
      await userEvent.click(screen.getByTestId('discount-filter-hasVoucher'))

      await waitFor(() => {
        const last = mockListAllOrders.mock.calls[mockListAllOrders.mock.calls.length - 1]
        expect(last[1].discountFilter).toBeUndefined()
      })
    })
  })
})
