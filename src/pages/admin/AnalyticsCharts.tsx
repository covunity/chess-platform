import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type {
  CompletionRow,
  LanguageBucketRow,
  LevelBucketRow,
  RevenueTrendPoint,
  SignupTrendPoint,
  TopBuyerRow,
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

interface LevelDonutProps {
  kind: 'level-donut'
  data: LevelBucketRow[]
  emptyLabel: string
  /** Display labels per level, supplied by the page from i18n. */
  levelLabels: Record<LevelBucketRow['level'], string>
}

interface LanguagePieProps {
  kind: 'language-pie'
  data: LanguageBucketRow[]
  emptyLabel: string
  /** Display labels per language, supplied by the page from i18n. */
  languageLabels: Record<LanguageBucketRow['language'], string>
}

interface CompletionBarProps {
  kind: 'completion-bar'
  data: CompletionRow[]
  emptyLabel: string
}

interface SignupTrendProps {
  kind: 'signup-trend'
  data: SignupTrendPoint[]
  emptyLabel: string
  title: string
}

interface TopBuyersProps {
  kind: 'top-buyers'
  rows: TopBuyerRow[]
  emptyLabel: string
}

export type AnalyticsChartProps =
  | RevenueTrendProps
  | TopCoursesProps
  | TopCreatorsProps
  | LevelDonutProps
  | LanguagePieProps
  | CompletionBarProps
  | SignupTrendProps
  | TopBuyersProps

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
  if (props.kind === 'top-creators') {
    return <TopCreatorsTable {...props} />
  }
  if (props.kind === 'level-donut') {
    return <LevelDonut {...props} />
  }
  if (props.kind === 'language-pie') {
    return <LanguagePie {...props} />
  }
  if (props.kind === 'completion-bar') {
    return <CompletionBar {...props} />
  }
  if (props.kind === 'signup-trend') {
    return <SignupTrendChart {...props} />
  }
  return <TopBuyersTable {...props} />
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

// ── Chart palette ──────────────────────────────────────────────────────────
// Categorical chart colors defined as CSS custom properties in index.css
// (--chart-1 … --chart-8). Series cycle through this array via index % len
// so the same level / language / row index always renders the same color
// across renders.
const CHART_PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
] as const

// ── Donut by course level ──────────────────────────────────────────────────
// Recharts renders a "donut" by setting `innerRadius` on a <Pie>. Each slice
// pulls a color from CHART_PALETTE so the three levels stay visually
// distinct (no hardcoded hex — every value is a CSS custom property).
const LEVEL_COLORS = [
  'var(--chart-5)',  // green   — beginner
  'var(--chart-1)',  // teal    — intermediate
  'var(--chart-3)',  // magenta — advanced
] as const

function formatCount(n: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(n)
}

function LevelDonut({ data, emptyLabel, levelLabels }: LevelDonutProps) {
  const hasData = data.length > 0 && data.some(d => d.count > 0)

  if (!hasData) {
    return (
      <div
        data-testid="admin-analytics-level-donut-empty"
        className="text-(--ink-3) text-sm"
        style={{ padding: '24px 0' }}
      >
        {emptyLabel}
      </div>
    )
  }

  const rendered = data.map(d => ({
    name: levelLabels[d.level] ?? d.level,
    value: d.count,
    level: d.level,
  }))

  return (
    <div
      data-testid="admin-analytics-level-donut"
      style={{ width: '100%', height: 260 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Tooltip
            formatter={(v: unknown) => formatCount(Number(v ?? 0))}
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              color: 'var(--ink-1)',
            }}
            labelStyle={{ color: 'var(--ink-2)' }}
          />
          <Legend
            verticalAlign="bottom"
            height={32}
            wrapperStyle={{ fontSize: 12, color: 'var(--ink-2)' }}
          />
          <Pie
            data={rendered}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={1}
            isAnimationActive={false}
          >
            {rendered.map((_, idx) => (
              <Cell key={idx} fill={LEVEL_COLORS[idx % LEVEL_COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Pie by language ────────────────────────────────────────────────────────
const LANGUAGE_COLORS = [
  'var(--chart-2)',  // indigo — vi
  'var(--chart-4)',  // orange — en
] as const

function LanguagePie({ data, emptyLabel, languageLabels }: LanguagePieProps) {
  const hasData = data.length > 0 && data.some(d => d.count > 0)

  if (!hasData) {
    return (
      <div
        data-testid="admin-analytics-language-pie-empty"
        className="text-(--ink-3) text-sm"
        style={{ padding: '24px 0' }}
      >
        {emptyLabel}
      </div>
    )
  }

  const rendered = data.map(d => ({
    name: languageLabels[d.language] ?? d.language,
    value: d.count,
    language: d.language,
  }))

  return (
    <div
      data-testid="admin-analytics-language-pie"
      style={{ width: '100%', height: 260 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Tooltip
            formatter={(v: unknown) => formatCount(Number(v ?? 0))}
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              color: 'var(--ink-1)',
            }}
            labelStyle={{ color: 'var(--ink-2)' }}
          />
          <Legend
            verticalAlign="bottom"
            height={32}
            wrapperStyle={{ fontSize: 12, color: 'var(--ink-2)' }}
          />
          <Pie
            data={rendered}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius="80%"
            isAnimationActive={false}
          >
            {rendered.map((_, idx) => (
              <Cell key={idx} fill={LANGUAGE_COLORS[idx % LANGUAGE_COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Signup trend line ──────────────────────────────────────────────────────
// Same shape as RevenueTrendChart but counting people, not money. Daily
// buckets for 7d/mtd/last_month; monthly for all_time. The Y-axis is a plain
// count formatter (no VND tick rendering).
function formatSignupTick(value: number): string {
  if (value >= 1_000) return `${Math.round(value / 100) / 10}K`
  return String(value)
}

function SignupTrendChart({ data, emptyLabel, title }: SignupTrendProps) {
  const hasData = data.length > 0 && data.some(d => d.value > 0)

  if (!hasData) {
    return (
      <div
        data-testid="admin-analytics-signup-trend-empty"
        className="text-(--ink-3) text-sm"
        style={{ padding: '24px 0' }}
      >
        {emptyLabel}
      </div>
    )
  }

  return (
    <div
      data-testid="admin-analytics-signup-trend"
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
            tickFormatter={formatSignupTick}
            width={48}
            allowDecimals={false}
          />
          <Tooltip
            formatter={(v: unknown) => formatCount(Number(v ?? 0))}
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
            stroke="var(--chart-2)"
            strokeWidth={2}
            dot={{ fill: 'var(--chart-2)', r: 3 }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Top 10 buyers ──────────────────────────────────────────────────────────
// Sorted by spend DESC at the RPC layer (migration 077). A free-claim-only
// row (spend = 0) appears at the bottom but is never displaced by a paying
// customer above. The `order_count` column is informational — the sort is
// always on spend per CONTEXT.md "Leaderboards" → "Top buyers".
function TopBuyersTable({ rows, emptyLabel }: TopBuyersProps) {
  const { t } = useTranslation()

  if (rows.length === 0) {
    return (
      <div
        data-testid="admin-analytics-top-buyers-empty"
        className="text-(--ink-3) text-sm"
        style={{ padding: '24px 0' }}
      >
        {emptyLabel}
      </div>
    )
  }

  return (
    <table
      data-testid="admin-analytics-top-buyers"
      className="w-full text-sm"
      style={{ borderCollapse: 'collapse' }}
    >
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          <th
            className="text-(--ink-3) text-left"
            style={{ padding: '8px 12px', fontWeight: 500, width: 40 }}
          >
            {t('admin.analytics.users.colRank')}
          </th>
          <th
            className="text-(--ink-3) text-left"
            style={{ padding: '8px 12px', fontWeight: 500 }}
          >
            {t('admin.analytics.users.colBuyer')}
          </th>
          <th
            className="text-(--ink-3) text-right"
            style={{ padding: '8px 12px', fontWeight: 500 }}
          >
            {t('admin.analytics.users.colSpend')}
          </th>
          <th
            className="text-(--ink-3) text-right"
            style={{ padding: '8px 12px', fontWeight: 500, width: 80 }}
          >
            {t('admin.analytics.users.colOrders')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr
            key={row.user_id}
            data-testid="admin-analytics-top-buyers-row"
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
              {formatVnd(row.spend)}
            </td>
            <td
              className="text-(--ink-2) text-right"
              style={{ padding: '8px 12px', fontVariantNumeric: 'tabular-nums' }}
            >
              {formatCount(row.order_count)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Horizontal bar — completion rate top 10 ────────────────────────────────
// Range-independent: the same data ships in all four range rows for the day.
// The bar layout is vertical, with the long course-title labels on the Y
// axis. Recharts handles `layout="vertical"` by swapping the role of X/Y.
function CompletionBar({ data, emptyLabel }: CompletionBarProps) {
  if (data.length === 0) {
    return (
      <div
        data-testid="admin-analytics-completion-bar-empty"
        className="text-(--ink-3) text-sm"
        style={{ padding: '24px 0' }}
      >
        {emptyLabel}
      </div>
    )
  }

  // X axis = completion rate (0..1 → 0..100 %). We pre-multiply the value
  // here so Recharts can show it as a plain integer-ish number, and the
  // tooltip formatter appends "%".
  const rendered = data.map(d => ({
    course_id: d.course_id,
    title: d.title,
    pct: Math.round(d.completion_rate * 1000) / 10,
    enrollment_count: d.enrollment_count,
  }))

  // Compute a tall enough container — ~36 px per row + padding.
  const chartHeight = Math.max(220, rendered.length * 36 + 40)

  return (
    <div
      data-testid="admin-analytics-completion-bar"
      style={{ width: '100%', height: chartHeight }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rendered}
          layout="vertical"
          margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            stroke="var(--ink-3)"
            fontSize={11}
            tickLine={false}
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
          />
          <YAxis
            type="category"
            dataKey="title"
            stroke="var(--ink-3)"
            fontSize={11}
            tickLine={false}
            width={160}
            interval={0}
          />
          <Tooltip
            formatter={(v: unknown) => `${Number(v ?? 0).toFixed(1)}%`}
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              color: 'var(--ink-1)',
            }}
            labelStyle={{ color: 'var(--ink-2)' }}
          />
          <Bar
            dataKey="pct"
            isAnimationActive={false}
            radius={[0, 4, 4, 0]}
          >
            {rendered.map((_, idx) => (
              <Cell
                key={idx}
                fill={CHART_PALETTE[idx % CHART_PALETTE.length]}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
