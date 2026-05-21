import { useTranslation } from 'react-i18next'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type {
  RevenueTrendPoint,
  TopCourseRow,
  TopCreatorRow,
} from '../../lib/analyticsApi'

// VND formatter — matches AdminAnalyticsPage so values render consistently
// across KPI cards, chart tooltips, and leaderboard cells.
const vnd = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
})

function formatVnd(n: number): string {
  return vnd.format(n)
}

// Recharts-internal axis tick formatter — must stay terse for narrow viewports.
function formatRevenueTick(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return String(value)
}

interface RevenueTrendProps {
  kind: 'revenue-trend'
  data: RevenueTrendPoint[]
  emptyLabel: string
  title: string
}

interface TopCoursesProps {
  kind: 'top-courses'
  rows: TopCourseRow[]
  emptyLabel: string
}

interface TopCreatorsProps {
  kind: 'top-creators'
  rows: TopCreatorRow[]
  emptyLabel: string
}

export type AnalyticsChartProps =
  | RevenueTrendProps
  | TopCoursesProps
  | TopCreatorsProps

/**
 * Single lazy-loaded entry point for all chart + leaderboard renderers.
 *
 * AdminAnalyticsPage imports this via React.lazy(() => import('./AnalyticsCharts')),
 * which keeps recharts + this module out of the learner bundle. The component
 * dispatches on `kind` so the parent can render any of the three views without
 * forcing three separate lazy chunks (and three Suspense fallbacks) on every
 * Financial section render.
 */
export default function AnalyticsCharts(props: AnalyticsChartProps) {
  if (props.kind === 'revenue-trend') {
    return <RevenueTrendChart {...props} />
  }
  if (props.kind === 'top-courses') {
    return <TopCoursesTable {...props} />
  }
  return <TopCreatorsTable {...props} />
}

// ── Revenue trend line ──────────────────────────────────────────────────────
// Daily buckets (`YYYY-MM-DD`) for 7d / mtd / last_month; monthly buckets
// (`YYYY-MM`) for all_time. Strings render verbatim on the X axis — the FE
// does not parse + reformat.
function RevenueTrendChart({ data, emptyLabel, title }: RevenueTrendProps) {
  const hasData = data.length > 0 && data.some(d => d.value > 0)

  if (!hasData) {
    return (
      <div
        data-testid="admin-analytics-trend-empty"
        className="text-(--ink-3) text-sm"
        style={{ padding: '24px 0' }}
      >
        {emptyLabel}
      </div>
    )
  }

  return (
    <div
      data-testid="admin-analytics-revenue-trend"
      aria-label={title}
      style={{ width: '100%', height: 280 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="bucket"
            stroke="var(--ink-3)"
            fontSize={11}
            tickLine={false}
          />
          <YAxis
            stroke="var(--ink-3)"
            fontSize={11}
            tickLine={false}
            tickFormatter={formatRevenueTick}
            width={56}
          />
          <Tooltip
            formatter={(v) => formatVnd(Number(v ?? 0))}
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              color: 'var(--ink-1)',
            }}
            labelStyle={{ color: 'var(--ink-2)' }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={{ fill: 'var(--accent)', r: 3 }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Top 10 courses ───────────────────────────────────────────────────────────
function TopCoursesTable({ rows, emptyLabel }: TopCoursesProps) {
  const { t } = useTranslation()

  if (rows.length === 0) {
    return (
      <div
        data-testid="admin-analytics-top-courses-empty"
        className="text-(--ink-3) text-sm"
        style={{ padding: '24px 0' }}
      >
        {emptyLabel}
      </div>
    )
  }

  return (
    <table
      data-testid="admin-analytics-top-courses"
      className="w-full text-sm"
      style={{ borderCollapse: 'collapse' }}
    >
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          <th
            className="text-(--ink-3) text-left"
            style={{ padding: '8px 12px', fontWeight: 500, width: 40 }}
          >
            {t('admin.analytics.financial.colRank')}
          </th>
          <th
            className="text-(--ink-3) text-left"
            style={{ padding: '8px 12px', fontWeight: 500 }}
          >
            {t('admin.analytics.financial.colCourse')}
          </th>
          <th
            className="text-(--ink-3) text-right"
            style={{ padding: '8px 12px', fontWeight: 500 }}
          >
            {t('admin.analytics.financial.colRevenue')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr
            key={row.course_id}
            data-testid="admin-analytics-top-courses-row"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <td className="text-(--ink-3)" style={{ padding: '8px 12px' }}>
              {idx + 1}
            </td>
            <td className="text-(--ink-1)" style={{ padding: '8px 12px' }}>
              {row.title}
            </td>
            <td
              className="text-(--ink-1) text-right"
              style={{ padding: '8px 12px', fontVariantNumeric: 'tabular-nums' }}
            >
              {formatVnd(row.revenue)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Top 10 creators ──────────────────────────────────────────────────────────
function TopCreatorsTable({ rows, emptyLabel }: TopCreatorsProps) {
  const { t } = useTranslation()

  if (rows.length === 0) {
    return (
      <div
        data-testid="admin-analytics-top-creators-empty"
        className="text-(--ink-3) text-sm"
        style={{ padding: '24px 0' }}
      >
        {emptyLabel}
      </div>
    )
  }

  return (
    <table
      data-testid="admin-analytics-top-creators"
      className="w-full text-sm"
      style={{ borderCollapse: 'collapse' }}
    >
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          <th
            className="text-(--ink-3) text-left"
            style={{ padding: '8px 12px', fontWeight: 500, width: 40 }}
          >
            {t('admin.analytics.financial.colRank')}
          </th>
          <th
            className="text-(--ink-3) text-left"
            style={{ padding: '8px 12px', fontWeight: 500 }}
          >
            {t('admin.analytics.financial.colCreator')}
          </th>
          <th
            className="text-(--ink-3) text-right"
            style={{ padding: '8px 12px', fontWeight: 500 }}
          >
            {t('admin.analytics.financial.colPayout')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr
            key={row.creator_id}
            data-testid="admin-analytics-top-creators-row"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <td className="text-(--ink-3)" style={{ padding: '8px 12px' }}>
              {idx + 1}
            </td>
            <td className="text-(--ink-1)" style={{ padding: '8px 12px' }}>
              {row.name}
            </td>
            <td
              className="text-(--ink-1) text-right"
              style={{ padding: '8px 12px', fontVariantNumeric: 'tabular-nums' }}
            >
              {formatVnd(row.revenue)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
