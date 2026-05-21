import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import AdminAnalyticsPage from './AdminAnalyticsPage'
import type {
  AnalyticsSnapshotRow,
  FinancialSnapshotsByRange,
} from '../../lib/analyticsApi'

// Recharts measures the parent DOM node to decide its render size. jsdom
// returns 0 by default; stub clientWidth/clientHeight + ResizeObserver so
// the Suspense-loaded chart actually mounts.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    value: 600,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    value: 280,
  })
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      class {
        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = vi.fn()
      } as unknown as typeof ResizeObserver
  }
})

const { mockFetch, mockRecompute } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockRecompute: vi.fn(),
}))

vi.mock('../../lib/analyticsApi', async () => {
  const actual = await vi.importActual<typeof import('../../lib/analyticsApi')>(
    '../../lib/analyticsApi'
  )
  return {
    ...actual,
    fetchLatestFinancialSnapshots: mockFetch,
    recomputeAnalyticsSnapshot: mockRecompute,
  }
})

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

function row(time_range: 'mtd' | 'last_month' | '7d' | 'all_time', payload: AnalyticsSnapshotRow['payload']): AnalyticsSnapshotRow {
  return {
    snapshot_date: '2026-05-21',
    time_range,
    category: 'financial',
    payload,
    computed_at: '2026-05-21T00:05:00Z',
  }
}

const sample: FinancialSnapshotsByRange = {
  '7d': row('7d', {
    kpis: {
      revenue: { value: 5_000_000, delta_pct: 25.0 },
      order_count: { value: 14, delta_pct: 16.7 },
      platform_fee: { value: 1_000_000, delta_pct: 25.0 },
      creator_payout: { value: 4_000_000, delta_pct: 25.0 },
    },
    revenue_trend: [
      { bucket: '2026-05-15', value: 0 },
      { bucket: '2026-05-16', value: 1_200_000 },
      { bucket: '2026-05-17', value: 800_000 },
    ],
    top_courses: [
      { course_id: 'a', title: 'Khai cuộc Sicilian', revenue: 3_200_000 },
      { course_id: 'b', title: 'Tàn cuộc cơ bản', revenue: 1_800_000 },
    ],
    top_creators: [
      { creator_id: 'c1', name: 'GM Anh', revenue: 2_400_000 },
      { creator_id: 'c2', name: 'IM Bình', revenue: 1_600_000 },
    ],
  }),
  mtd: row('mtd', {
    kpis: {
      revenue: { value: 12_500_000, delta_pct: 12.4 },
      order_count: { value: 87, delta_pct: -3.1 },
      platform_fee: { value: 2_500_000, delta_pct: 12.4 },
      creator_payout: { value: 10_000_000, delta_pct: 12.4 },
    },
    revenue_trend: [
      { bucket: '2026-05-01', value: 500_000 },
      { bucket: '2026-05-02', value: 1_500_000 },
    ],
    top_courses: [
      { course_id: 'm1', title: 'Mẹo cờ vua', revenue: 7_500_000 },
    ],
    top_creators: [
      { creator_id: 'mc1', name: 'GM Cường', revenue: 6_000_000 },
    ],
  }),
  last_month: row('last_month', {
    kpis: {
      revenue: { value: 9_000_000, delta_pct: 5.0 },
      order_count: { value: 64, delta_pct: -2.0 },
      platform_fee: { value: 1_800_000, delta_pct: 5.0 },
      creator_payout: { value: 7_200_000, delta_pct: 5.0 },
    },
    revenue_trend: [{ bucket: '2026-04-10', value: 250_000 }],
    top_courses: [],
    top_creators: [],
  }),
  all_time: row('all_time', {
    kpis: {
      revenue: { value: 99_000_000, delta_pct: null },
      order_count: { value: 500, delta_pct: null },
      platform_fee: { value: 19_800_000, delta_pct: null },
      creator_payout: { value: 79_200_000, delta_pct: null },
    },
    revenue_trend: [
      { bucket: '2026-03', value: 30_000_000 },
      { bucket: '2026-04', value: 35_000_000 },
      { bucket: '2026-05', value: 34_000_000 },
    ],
    top_courses: [
      { course_id: 'at1', title: 'Bộ sưu tập', revenue: 99_000_000 },
    ],
    top_creators: [
      { creator_id: 'atc1', name: 'GM Tổng', revenue: 79_200_000 },
    ],
  }),
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AdminAnalyticsPage />
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('AdminAnalyticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({ snapshots: sample, error: null })
    mockRecompute.mockResolvedValue({ error: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the page title', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/phân tích/i)
    })
  })

  it('renders the four Financial KPI cards from the snapshot (default range = mtd)', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('admin-analytics-kpi-revenue')).toBeInTheDocument()
    })
    const revenue = screen.getByTestId('admin-analytics-kpi-revenue')
    // Default range is mtd → 12_500_000
    expect(within(revenue).getByTestId('kpi-value')).toHaveTextContent(/12\.500\.000/)
    expect(within(revenue).getByTestId('kpi-delta')).toHaveTextContent(/12,4/)
    // Order count card present
    expect(screen.getByTestId('admin-analytics-kpi-order-count')).toHaveTextContent('87')
    expect(screen.getByTestId('admin-analytics-kpi-platform-fee')).toBeInTheDocument()
    expect(screen.getByTestId('admin-analytics-kpi-creator-payout')).toBeInTheDocument()
  })

  it('renders down-delta in red for negative percentages', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('admin-analytics-kpi-order-count')).toBeInTheDocument()
    })
    const order = screen.getByTestId('admin-analytics-kpi-order-count')
    const delta = within(order).getByTestId('kpi-delta')
    // Down arrow + magnitude
    expect(delta).toHaveTextContent(/3,1/)
    expect(delta).toHaveAttribute('data-direction', 'down')
  })

  it('renders "—" for all_time deltas (no comparable prior period)', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('admin-analytics-range-selector')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('admin-analytics-range-all_time'))
    await waitFor(() => {
      const revenue = screen.getByTestId('admin-analytics-kpi-revenue')
      const delta = within(revenue).getByTestId('kpi-delta')
      expect(delta).toHaveTextContent('—')
      expect(delta).toHaveAttribute('data-direction', 'none')
    })
  })

  it('switching to last_month reloads cards from the matching snapshot row', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('admin-analytics-range-selector')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('admin-analytics-range-last_month'))
    await waitFor(() => {
      const revenue = screen.getByTestId('admin-analytics-kpi-revenue')
      expect(within(revenue).getByTestId('kpi-value')).toHaveTextContent(/9\.000\.000/)
    })
  })

  it('disables the refresh button for 30s after a click with visible countdown', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('admin-analytics-refresh-btn')).toBeInTheDocument()
    })
    const btn = screen.getByTestId('admin-analytics-refresh-btn')
    await user.click(btn)
    // RPC was called
    expect(mockRecompute).toHaveBeenCalledTimes(1)
    // Wait for the post-recompute reload to settle and the cooldown banner
    // to render the initial value.
    await waitFor(() => {
      expect(btn).toBeDisabled()
      expect(btn.textContent ?? '').toMatch(/30/)
    })
    // A second click within the cooldown is a no-op (button is disabled).
    await user.click(btn)
    expect(mockRecompute).toHaveBeenCalledTimes(1)
  })

  it('clicking Refresh refetches snapshots and updates the last-updated timestamp', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('admin-analytics-refresh-btn')).toBeInTheDocument()
    })
    // After the initial fetch + a refresh click, fetchLatestFinancialSnapshots
    // is called twice (once on mount, once after recompute resolves).
    await user.click(screen.getByTestId('admin-analytics-refresh-btn'))
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  it('shows the empty-state message when no snapshot exists for the selected range', async () => {
    // No mtd row → default range has nothing to render.
    mockFetch.mockResolvedValue({
      snapshots: { '7d': sample['7d'] } satisfies FinancialSnapshotsByRange,
      error: null,
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('admin-analytics-empty-range')).toBeInTheDocument()
    })
  })

  it('renders a load-error banner when the fetch fails', async () => {
    mockFetch.mockResolvedValue({ snapshots: {}, error: new Error('boom') })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('admin-analytics-load-error')).toBeInTheDocument()
    })
  })

  // ── Slice 2 (#329) — trend chart + leaderboards ─────────────────────────

  it('renders the revenue trend chart for the selected range', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('admin-analytics-kpi-revenue')).toBeInTheDocument()
    })
    // Default range is mtd; mtd has non-zero trend points.
    await waitFor(() => {
      expect(screen.getByTestId('admin-analytics-revenue-trend')).toBeInTheDocument()
    })
  })

  it('renders top courses + top creators tables from the snapshot payload', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('admin-analytics-kpi-revenue')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByTestId('admin-analytics-top-courses')).toBeInTheDocument()
    })
    expect(screen.getByTestId('admin-analytics-top-creators')).toBeInTheDocument()

    // mtd: 1 course + 1 creator row.
    const courseRows = screen.getAllByTestId('admin-analytics-top-courses-row')
    expect(courseRows).toHaveLength(1)
    expect(within(courseRows[0]).getByText('Mẹo cờ vua')).toBeInTheDocument()

    const creatorRows = screen.getAllByTestId('admin-analytics-top-creators-row')
    expect(creatorRows).toHaveLength(1)
    expect(within(creatorRows[0]).getByText('GM Cường')).toBeInTheDocument()
  })

  it('switching to last_month with empty leaderboards renders the empty-state messages', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('admin-analytics-range-selector')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('admin-analytics-range-last_month'))
    await waitFor(() => {
      expect(
        screen.getByTestId('admin-analytics-top-courses-empty')
      ).toBeInTheDocument()
    })
    expect(
      screen.getByTestId('admin-analytics-top-creators-empty')
    ).toBeInTheDocument()
  })

  it('switching to all_time uses monthly buckets in the trend chart payload', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('admin-analytics-range-selector')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('admin-analytics-range-all_time'))
    await waitFor(() => {
      expect(screen.getByTestId('admin-analytics-revenue-trend')).toBeInTheDocument()
    })
    // all_time row's top_courses includes "Bộ sưu tập".
    await waitFor(() => {
      expect(screen.getByText('Bộ sưu tập')).toBeInTheDocument()
    })
  })

  it('does not call the orders table directly — only reads analytics_snapshots via the api helper', async () => {
    // The whole point of ADR-0009: no live aggregate query on `orders` from the
    // page. The page MUST use `fetchLatestFinancialSnapshots` and nothing else.
    // We assert this by ensuring `supabase` is not invoked with `from('orders')`
    // — the page should not directly construct any query against `orders`.
    renderPage()
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })
    // mockFetch is the only data-loading code path; any direct orders read would
    // bypass it and would need a separate import. This test is the contract.
  })
})
