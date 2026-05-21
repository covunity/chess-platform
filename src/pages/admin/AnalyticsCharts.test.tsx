import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import AnalyticsCharts from './AnalyticsCharts'

// Recharts measures the parent DOM node to decide its render size. jsdom
// returns 0 for those measurements, so without a stubbed bounding rect the
// chart silently renders nothing. Forcing a non-zero size lets us assert
// the chart container and basic SVG output.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    value: 600,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    value: 280,
  })
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 600,
      height: 280,
      top: 0,
      left: 0,
      right: 600,
      bottom: 280,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
  })
  // ResponsiveContainer relies on ResizeObserver — jsdom doesn't ship one.
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      class {
        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = vi.fn()
      } as unknown as typeof ResizeObserver
  }
})

function renderWithI18n(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
}

describe('AnalyticsCharts — RevenueTrendChart', () => {
  it('renders the empty-state when data is empty', () => {
    renderWithI18n(
      <AnalyticsCharts
        kind="revenue-trend"
        data={[]}
        emptyLabel="Không có dữ liệu cho kỳ này"
        title="Biểu đồ doanh thu"
      />
    )
    expect(screen.getByTestId('admin-analytics-trend-empty')).toHaveTextContent(
      'Không có dữ liệu cho kỳ này'
    )
  })

  it('renders the empty-state when all values are 0 (technically non-empty array)', () => {
    renderWithI18n(
      <AnalyticsCharts
        kind="revenue-trend"
        data={[
          { bucket: '2026-05-15', value: 0 },
          { bucket: '2026-05-16', value: 0 },
        ]}
        emptyLabel="Không có dữ liệu cho kỳ này"
        title="Biểu đồ doanh thu"
      />
    )
    expect(screen.getByTestId('admin-analytics-trend-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('admin-analytics-revenue-trend')).not.toBeInTheDocument()
  })

  it('renders the line chart container when at least one bucket has revenue', () => {
    renderWithI18n(
      <AnalyticsCharts
        kind="revenue-trend"
        data={[
          { bucket: '2026-05-15', value: 0 },
          { bucket: '2026-05-16', value: 450_000 },
          { bucket: '2026-05-17', value: 0 },
        ]}
        emptyLabel="Không có dữ liệu cho kỳ này"
        title="Biểu đồ doanh thu"
      />
    )
    expect(screen.getByTestId('admin-analytics-revenue-trend')).toBeInTheDocument()
    expect(screen.queryByTestId('admin-analytics-trend-empty')).not.toBeInTheDocument()
  })
})

describe('AnalyticsCharts — TopCoursesTable', () => {
  it('renders the empty state when rows are empty', () => {
    renderWithI18n(
      <AnalyticsCharts
        kind="top-courses"
        rows={[]}
        emptyLabel="Không có dữ liệu cho kỳ này"
      />
    )
    expect(screen.getByTestId('admin-analytics-top-courses-empty')).toHaveTextContent(
      'Không có dữ liệu cho kỳ này'
    )
  })

  it('renders rows with rank, title, and VND-formatted revenue', () => {
    renderWithI18n(
      <AnalyticsCharts
        kind="top-courses"
        rows={[
          { course_id: 'a', title: 'Khai cuộc Sicilian', revenue: 3_200_000 },
          { course_id: 'b', title: 'Tàn cuộc cơ bản', revenue: 1_800_000 },
        ]}
        emptyLabel="Không có dữ liệu cho kỳ này"
      />
    )
    const rows = screen.getAllByTestId('admin-analytics-top-courses-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('1')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Khai cuộc Sicilian')).toBeInTheDocument()
    expect(within(rows[0]).getByText(/3\.200\.000/)).toBeInTheDocument()
    expect(within(rows[1]).getByText('2')).toBeInTheDocument()
  })

  it('respects the input ordering — does not re-sort client-side', () => {
    // The RPC already sorts; the FE must trust it. Reorder check.
    renderWithI18n(
      <AnalyticsCharts
        kind="top-courses"
        rows={[
          { course_id: 'low', title: 'Thấp', revenue: 100 },
          { course_id: 'high', title: 'Cao', revenue: 999_999 },
        ]}
        emptyLabel="empty"
      />
    )
    const rows = screen.getAllByTestId('admin-analytics-top-courses-row')
    expect(within(rows[0]).getByText('Thấp')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Cao')).toBeInTheDocument()
  })
})

describe('AnalyticsCharts — TopCreatorsTable', () => {
  it('renders the empty state when rows are empty', () => {
    renderWithI18n(
      <AnalyticsCharts
        kind="top-creators"
        rows={[]}
        emptyLabel="Không có dữ liệu cho kỳ này"
      />
    )
    expect(screen.getByTestId('admin-analytics-top-creators-empty')).toBeInTheDocument()
  })

  it('renders rows with rank, name, and VND-formatted payout', () => {
    renderWithI18n(
      <AnalyticsCharts
        kind="top-creators"
        rows={[
          { creator_id: 'c1', name: 'GM Anh', revenue: 4_100_000 },
          { creator_id: 'c2', name: 'IM Bình', revenue: 2_300_000 },
        ]}
        emptyLabel="empty"
      />
    )
    const rows = screen.getAllByTestId('admin-analytics-top-creators-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('GM Anh')).toBeInTheDocument()
    expect(within(rows[0]).getByText(/4\.100\.000/)).toBeInTheDocument()
    expect(within(rows[1]).getByText('IM Bình')).toBeInTheDocument()
  })
})
