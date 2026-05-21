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

describe('AnalyticsCharts — LevelDonut', () => {
  const levelLabels = {
    beginner: 'Người mới',
    intermediate: 'Trung cấp',
    advanced: 'Cao cấp',
  }

  it('renders the empty-state when data is empty', () => {
    renderWithI18n(
      <AnalyticsCharts
        kind="level-donut"
        data={[]}
        emptyLabel="Không có dữ liệu cho kỳ này"
        levelLabels={levelLabels}
      />
    )
    expect(screen.getByTestId('admin-analytics-level-donut-empty')).toHaveTextContent(
      'Không có dữ liệu cho kỳ này'
    )
  })

  it('renders the empty-state when all bucket counts are 0', () => {
    renderWithI18n(
      <AnalyticsCharts
        kind="level-donut"
        data={[
          { level: 'beginner', count: 0 },
          { level: 'intermediate', count: 0 },
        ]}
        emptyLabel="Không có dữ liệu cho kỳ này"
        levelLabels={levelLabels}
      />
    )
    expect(screen.getByTestId('admin-analytics-level-donut-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('admin-analytics-level-donut')).not.toBeInTheDocument()
  })

  it('renders the donut when at least one bucket is non-zero', () => {
    renderWithI18n(
      <AnalyticsCharts
        kind="level-donut"
        data={[
          { level: 'beginner', count: 12 },
          { level: 'intermediate', count: 6 },
          { level: 'advanced', count: 2 },
        ]}
        emptyLabel="empty"
        levelLabels={levelLabels}
      />
    )
    expect(screen.getByTestId('admin-analytics-level-donut')).toBeInTheDocument()
    expect(screen.queryByTestId('admin-analytics-level-donut-empty')).not.toBeInTheDocument()
  })
})

describe('AnalyticsCharts — LanguagePie', () => {
  const languageLabels = { vi: 'Tiếng Việt', en: 'Tiếng Anh' }

  it('renders the empty-state when data is empty', () => {
    renderWithI18n(
      <AnalyticsCharts
        kind="language-pie"
        data={[]}
        emptyLabel="Không có dữ liệu cho kỳ này"
        languageLabels={languageLabels}
      />
    )
    expect(screen.getByTestId('admin-analytics-language-pie-empty')).toBeInTheDocument()
  })

  it('renders the pie when at least one bucket is non-zero', () => {
    renderWithI18n(
      <AnalyticsCharts
        kind="language-pie"
        data={[
          { language: 'vi', count: 18 },
          { language: 'en', count: 2 },
        ]}
        emptyLabel="empty"
        languageLabels={languageLabels}
      />
    )
    expect(screen.getByTestId('admin-analytics-language-pie')).toBeInTheDocument()
  })
})

describe('AnalyticsCharts — CompletionBar', () => {
  it('renders the empty-state when data is empty', () => {
    renderWithI18n(
      <AnalyticsCharts
        kind="completion-bar"
        data={[]}
        emptyLabel="Không có dữ liệu cho kỳ này"
      />
    )
    expect(screen.getByTestId('admin-analytics-completion-bar-empty')).toBeInTheDocument()
  })

  it('renders the bar chart when given rows (no minimum-enrollment threshold)', () => {
    // A course with one enrollee + 5/10 lessons → completion_rate = 0.5.
    // The chart must render it without any threshold filtering.
    renderWithI18n(
      <AnalyticsCharts
        kind="completion-bar"
        data={[
          { course_id: 'a', title: 'Khoá 1', completion_rate: 0.5, enrollment_count: 1 },
          { course_id: 'b', title: 'Khoá 2', completion_rate: 0.3, enrollment_count: 87 },
        ]}
        emptyLabel="empty"
      />
    )
    expect(screen.getByTestId('admin-analytics-completion-bar')).toBeInTheDocument()
  })
})

describe('AnalyticsCharts — SignupTrendChart', () => {
  it('renders the empty-state when data is empty', () => {
    renderWithI18n(
      <AnalyticsCharts
        kind="signup-trend"
        data={[]}
        emptyLabel="Không có dữ liệu cho kỳ này"
        title="Biểu đồ đăng ký"
      />
    )
    expect(screen.getByTestId('admin-analytics-signup-trend-empty')).toBeInTheDocument()
  })

  it('renders the empty-state when all values are 0', () => {
    renderWithI18n(
      <AnalyticsCharts
        kind="signup-trend"
        data={[
          { bucket: '2026-05-15', value: 0 },
          { bucket: '2026-05-16', value: 0 },
        ]}
        emptyLabel="Không có dữ liệu cho kỳ này"
        title="Biểu đồ đăng ký"
      />
    )
    expect(screen.getByTestId('admin-analytics-signup-trend-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('admin-analytics-signup-trend')).not.toBeInTheDocument()
  })

  it('renders the line chart container when at least one bucket has signups', () => {
    renderWithI18n(
      <AnalyticsCharts
        kind="signup-trend"
        data={[
          { bucket: '2026-05-15', value: 0 },
          { bucket: '2026-05-16', value: 7 },
        ]}
        emptyLabel="empty"
        title="Biểu đồ đăng ký"
      />
    )
    expect(screen.getByTestId('admin-analytics-signup-trend')).toBeInTheDocument()
  })
})

describe('AnalyticsCharts — TopBuyersTable', () => {
  it('renders the empty state when rows are empty', () => {
    renderWithI18n(
      <AnalyticsCharts
        kind="top-buyers"
        rows={[]}
        emptyLabel="Không có dữ liệu cho kỳ này"
      />
    )
    expect(screen.getByTestId('admin-analytics-top-buyers-empty')).toBeInTheDocument()
  })

  it('renders rows with rank, name, VND-formatted spend, and order count', () => {
    renderWithI18n(
      <AnalyticsCharts
        kind="top-buyers"
        rows={[
          { user_id: 'u1', name: 'Khách Anh',  spend: 850_000, order_count: 3 },
          { user_id: 'u2', name: 'Khách Bình', spend: 450_000, order_count: 2 },
        ]}
        emptyLabel="empty"
      />
    )
    const rows = screen.getAllByTestId('admin-analytics-top-buyers-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Khách Anh')).toBeInTheDocument()
    expect(within(rows[0]).getByText(/850\.000/)).toBeInTheDocument()
    expect(within(rows[0]).getByText('3')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Khách Bình')).toBeInTheDocument()
  })

  it('respects the input ordering — does NOT re-sort by order_count (sort is by spend at the RPC layer)', () => {
    // A free-claim-only user (spend = 0, many orders) MUST NOT displace a
    // paying customer above. The RPC sorts by spend DESC; the FE trusts it.
    renderWithI18n(
      <AnalyticsCharts
        kind="top-buyers"
        rows={[
          { user_id: 'u-paid', name: 'Khách trả tiền', spend: 100_000, order_count: 1 },
          { user_id: 'u-free', name: 'Khách miễn phí', spend: 0,       order_count: 5 },
        ]}
        emptyLabel="empty"
      />
    )
    const rows = screen.getAllByTestId('admin-analytics-top-buyers-row')
    expect(rows).toHaveLength(2)
    // Paying customer is rank 1 even though they have fewer orders.
    expect(within(rows[0]).getByText('Khách trả tiền')).toBeInTheDocument()
    // Free claimer is rank 2 with 0 VND spend.
    expect(within(rows[1]).getByText('Khách miễn phí')).toBeInTheDocument()
    expect(within(rows[1]).getByText(/0/)).toBeInTheDocument()
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
