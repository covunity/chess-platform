import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import {
  fetchLatestContentSnapshots,
  fetchLatestFinancialSnapshots,
  recomputeAnalyticsSnapshot,
  type AnalyticsSnapshotRow,
  type ContentPayload,
  type ContentSnapshotRow,
  type ContentSnapshotsByRange,
  type FinancialPayload,
  type FinancialSnapshotsByRange,
  type TimeRange,
} from '../../lib/analyticsApi'

// Lazy-load Recharts (and the chart components that depend on it) so the
// learner-facing routes never pull recharts (~95 KB gzipped) into their
// bundle. The build splits this into its own chunk thanks to the dynamic
// import; see CONTEXT.md "Chart library" + PRD-0008 §5.5.
const AnalyticsCharts = lazy(() => import('./AnalyticsCharts'))

const RANGES: readonly TimeRange[] = ['7d', 'mtd', 'last_month', 'all_time'] as const
const REFRESH_COOLDOWN_SECS = 30

// VND formatter — matches the rest of the admin pages.
const vnd = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
})

// Integer count formatter — vi-VN uses `.` as thousand separator.
const counter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 })

function formatVnd(n: number): string {
  return vnd.format(n)
}

function formatCount(n: number): string {
  return counter.format(n)
}

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  // Use vi-VN locale and the ICT-equivalent string — short, easy to scan.
  return d.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

interface DeltaProps {
  value: number | null
  noneLabel: string
}

function DeltaPill({ value, noneLabel }: DeltaProps) {
  if (value === null || value === undefined) {
    return (
      <span
        data-testid="kpi-delta"
        data-direction="none"
        className="pill"
        style={{ color: 'var(--ink-3)' }}
      >
        {noneLabel}
      </span>
    )
  }
  const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'flat'
  const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '•'
  const color =
    direction === 'up'
      ? 'var(--success)'
      : direction === 'down'
        ? 'var(--danger)'
        : 'var(--ink-3)'
  const magnitude = Math.abs(value).toLocaleString('vi-VN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  return (
    <span
      data-testid="kpi-delta"
      data-direction={direction}
      className="pill"
      style={{ color, fontVariantNumeric: 'tabular-nums' }}
    >
      {arrow} {magnitude}%
    </span>
  )
}

interface KpiCardProps {
  testId: string
  label: string
  display: string
  delta: number | null
  noneLabel: string
}

function KpiCard({ testId, label, display, delta, noneLabel }: KpiCardProps) {
  return (
    <div
      data-testid={testId}
      className="card"
      style={{
        padding: 20,
        borderRadius: 'var(--r-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 0,
      }}
    >
      <div
        className="text-(--ink-3) uppercase"
        style={{ fontSize: 11.5, letterSpacing: '0.06em', fontWeight: 500 }}
      >
        {label}
      </div>
      <div
        data-testid="kpi-value"
        className="text-(--ink-1)"
        style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.2 }}
      >
        {display}
      </div>
      <DeltaPill value={delta} noneLabel={noneLabel} />
    </div>
  )
}

export default function AdminAnalyticsPage() {
  const { t } = useTranslation()
  const [snapshots, setSnapshots] = useState<FinancialSnapshotsByRange>({})
  const [contentSnapshots, setContentSnapshots] = useState<ContentSnapshotsByRange>({})
  const [range, setRange] = useState<TimeRange>('mtd')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Initial + post-refresh fetch. RLS on analytics_snapshots makes this a
  // safe call — non-admins (defence in depth beyond ProtectedAdminRoute)
  // get 0 rows. Financial + content fire in parallel; either failing reports
  // the same load-error banner.
  const reload = useCallback(async () => {
    const [financialResult, contentResult] = await Promise.all([
      fetchLatestFinancialSnapshots(supabase),
      fetchLatestContentSnapshots(supabase),
    ])
    if (financialResult.error || contentResult.error) {
      setLoadError(t('admin.analytics.loadError'))
      setSnapshots({})
      setContentSnapshots({})
    } else {
      setLoadError(null)
      setSnapshots(financialResult.snapshots)
      setContentSnapshots(contentResult.snapshots)
    }
    setLoading(false)
  }, [t])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [financialResult, contentResult] = await Promise.all([
        fetchLatestFinancialSnapshots(supabase),
        fetchLatestContentSnapshots(supabase),
      ])
      if (cancelled) return
      if (financialResult.error || contentResult.error) {
        setLoadError(t('admin.analytics.loadError'))
        setSnapshots({})
        setContentSnapshots({})
      } else {
        setLoadError(null)
        setSnapshots(financialResult.snapshots)
        setContentSnapshots(contentResult.snapshots)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [t])

  // 30s client-side refresh cooldown (server has no rate limit per ADR-0009).
  useEffect(() => {
    if (cooldown <= 0) {
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current)
        cooldownTimerRef.current = null
      }
      return
    }
    if (cooldownTimerRef.current) return
    cooldownTimerRef.current = setInterval(() => {
      setCooldown(c => (c <= 1 ? 0 : c - 1))
    }, 1000)
    return () => {
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current)
        cooldownTimerRef.current = null
      }
    }
  }, [cooldown])

  async function handleRefresh() {
    if (cooldown > 0 || refreshing) return
    setRefreshing(true)
    setRefreshError(null)
    setCooldown(REFRESH_COOLDOWN_SECS)
    const { error } = await recomputeAnalyticsSnapshot(supabase)
    if (error) {
      setRefreshError(t('admin.analytics.refreshError'))
      setRefreshing(false)
      return
    }
    await reload()
    setRefreshing(false)
  }

  const current: AnalyticsSnapshotRow | undefined = snapshots[range]
  const payload = current?.payload as FinancialPayload | undefined
  const kpis = payload?.kpis
  const revenueTrend = payload?.revenue_trend ?? []
  const topCourses = payload?.top_courses ?? []
  const topCreators = payload?.top_creators ?? []

  const currentContent: ContentSnapshotRow | undefined = contentSnapshots[range]
  const contentPayload = currentContent?.payload as ContentPayload | undefined
  const contentKpis = contentPayload?.kpis
  const byLevel = contentPayload?.by_level ?? []
  const byLanguage = contentPayload?.by_language ?? []
  const completionTop = contentPayload?.completion_top ?? []

  const lastUpdated = useMemo(() => {
    // Show the freshest computed_at across the four range rows; they all
    // come from the same compute_analytics_snapshot call so they share a
    // timestamp in practice, but be defensive.
    const stamps = RANGES.map(r => snapshots[r]?.computed_at).filter(
      (x): x is string => typeof x === 'string'
    )
    if (stamps.length === 0) return null
    return stamps.reduce((max, s) => (s > max ? s : max), stamps[0])
  }, [snapshots])

  const refreshLabel = cooldown > 0
    ? t('admin.analytics.refreshCountdown', { secs: cooldown })
    : refreshing
      ? t('admin.analytics.refreshing')
      : t('admin.analytics.refreshBtn')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 border-b border-(--border) bg-(--surface) shrink-0"
        style={{ height: 60 }}
      >
        <h1
          className="text-lg font-semibold text-(--ink-1)"
          style={{ letterSpacing: '-0.01em' }}
        >
          {t('admin.analytics.pageTitle')}
        </h1>
        <div className="flex items-center gap-3">
          <span
            data-testid="admin-analytics-last-updated"
            className="text-(--ink-3)"
            style={{ fontSize: 12 }}
          >
            {lastUpdated
              ? t('admin.analytics.lastUpdated', { at: formatTimestamp(lastUpdated) })
              : t('admin.analytics.lastUpdatedUnknown')}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            data-testid="admin-analytics-refresh-btn"
            onClick={handleRefresh}
            disabled={cooldown > 0 || refreshing}
          >
            {refreshLabel}
          </button>
        </div>
      </div>

      <p
        className="px-6 pt-4 text-sm text-(--ink-2)"
        style={{ lineHeight: 1.55, maxWidth: 720 }}
      >
        {t('admin.analytics.intro')}
      </p>

      {/* Range selector */}
      <div
        className="px-6 pt-4 pb-2 flex items-center gap-2"
        data-testid="admin-analytics-range-selector"
        role="tablist"
        aria-label={t('admin.analytics.rangeLabel')}
      >
        {RANGES.map(r => (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={range === r}
            data-testid={`admin-analytics-range-${r}`}
            className={range === r ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
            onClick={() => setRange(r)}
          >
            {t(`admin.analytics.range.${r}`)}
          </button>
        ))}
      </div>

      <div className="flex-1 px-6 pb-6 pt-4 overflow-auto">
        {loadError && (
          <div
            role="alert"
            data-testid="admin-analytics-load-error"
            style={{
              background: 'var(--danger-soft)',
              color: 'var(--danger)',
              borderRadius: 'var(--r-md)',
              padding: '10px 14px',
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {loadError}
          </div>
        )}

        {refreshError && (
          <div
            role="alert"
            data-testid="admin-analytics-refresh-error"
            style={{
              background: 'var(--danger-soft)',
              color: 'var(--danger)',
              borderRadius: 'var(--r-md)',
              padding: '10px 14px',
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {refreshError}
          </div>
        )}

        {loading ? (
          <div className="text-(--ink-3) text-sm">…</div>
        ) : !current || !kpis ? (
          Object.keys(snapshots).length === 0 ? (
            <div
              data-testid="admin-analytics-empty"
              className="text-(--ink-3) text-sm"
              style={{ padding: '24px 0' }}
            >
              {t('admin.analytics.noSnapshotYet')}
            </div>
          ) : (
            <div
              data-testid="admin-analytics-empty-range"
              className="text-(--ink-3) text-sm"
              style={{ padding: '24px 0' }}
            >
              {t('admin.analytics.noSnapshotForRange')}
            </div>
          )
        ) : (
          <section>
            <h2
              className="text-base font-semibold text-(--ink-1) mb-3"
              style={{ letterSpacing: '-0.005em' }}
            >
              {t('admin.analytics.financial.sectionTitle')}
            </h2>
            <div
              className="grid"
              style={{
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: 16,
              }}
            >
              <KpiCard
                testId="admin-analytics-kpi-revenue"
                label={t('admin.analytics.financial.kpiRevenue')}
                display={formatVnd(kpis.revenue.value)}
                delta={kpis.revenue.delta_pct}
                noneLabel={t('admin.analytics.financial.deltaNone')}
              />
              <KpiCard
                testId="admin-analytics-kpi-order-count"
                label={t('admin.analytics.financial.kpiOrders')}
                display={formatCount(kpis.order_count.value)}
                delta={kpis.order_count.delta_pct}
                noneLabel={t('admin.analytics.financial.deltaNone')}
              />
              <KpiCard
                testId="admin-analytics-kpi-platform-fee"
                label={t('admin.analytics.financial.kpiPlatformFee')}
                display={formatVnd(kpis.platform_fee.value)}
                delta={kpis.platform_fee.delta_pct}
                noneLabel={t('admin.analytics.financial.deltaNone')}
              />
              <KpiCard
                testId="admin-analytics-kpi-creator-payout"
                label={t('admin.analytics.financial.kpiCreatorPayout')}
                display={formatVnd(kpis.creator_payout.value)}
                delta={kpis.creator_payout.delta_pct}
                noneLabel={t('admin.analytics.financial.deltaNone')}
              />
            </div>

            {/* Revenue trend chart */}
            <div
              className="card"
              style={{ padding: 20, borderRadius: 'var(--r-lg)', marginTop: 24 }}
            >
              <h3
                className="text-(--ink-1) mb-3"
                style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.005em' }}
              >
                {t('admin.analytics.financial.trendTitle')}
              </h3>
              <Suspense
                fallback={
                  <div
                    data-testid="admin-analytics-charts-loading"
                    className="text-(--ink-3) text-sm"
                    style={{ padding: '24px 0' }}
                  >
                    {t('admin.analytics.financial.chartLoading')}
                  </div>
                }
              >
                <AnalyticsCharts
                  kind="revenue-trend"
                  data={revenueTrend}
                  emptyLabel={t('admin.analytics.financial.emptyRange')}
                  title={t('admin.analytics.financial.trendTitle')}
                />
              </Suspense>
            </div>

            {/* Leaderboards */}
            <div
              className="grid"
              style={{
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 16,
                marginTop: 24,
              }}
            >
              <div
                className="card"
                style={{ padding: 20, borderRadius: 'var(--r-lg)' }}
              >
                <h3
                  className="text-(--ink-1) mb-3"
                  style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.005em' }}
                >
                  {t('admin.analytics.financial.topCoursesTitle')}
                </h3>
                <Suspense
                  fallback={
                    <div
                      className="text-(--ink-3) text-sm"
                      style={{ padding: '24px 0' }}
                    >
                      {t('admin.analytics.financial.chartLoading')}
                    </div>
                  }
                >
                  <AnalyticsCharts
                    kind="top-courses"
                    rows={topCourses}
                    emptyLabel={t('admin.analytics.financial.emptyRange')}
                  />
                </Suspense>
              </div>

              <div
                className="card"
                style={{ padding: 20, borderRadius: 'var(--r-lg)' }}
              >
                <h3
                  className="text-(--ink-1) mb-3"
                  style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.005em' }}
                >
                  {t('admin.analytics.financial.topCreatorsTitle')}
                </h3>
                <Suspense
                  fallback={
                    <div
                      className="text-(--ink-3) text-sm"
                      style={{ padding: '24px 0' }}
                    >
                      {t('admin.analytics.financial.chartLoading')}
                    </div>
                  }
                >
                  <AnalyticsCharts
                    kind="top-creators"
                    rows={topCreators}
                    emptyLabel={t('admin.analytics.financial.emptyRange')}
                  />
                </Suspense>
              </div>
            </div>
          </section>
        )}

        {/* Content section — PRD-0008 P2 US2.1–US2.3 */}
        {!loading && currentContent && contentKpis && (
          <section
            data-testid="admin-analytics-content-section"
            style={{ marginTop: 32 }}
          >
            <h2
              className="text-base font-semibold text-(--ink-1) mb-3"
              style={{ letterSpacing: '-0.005em' }}
            >
              {t('admin.analytics.content.sectionTitle')}
            </h2>

            <div
              className="grid"
              style={{
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 16,
              }}
            >
              <KpiCard
                testId="admin-analytics-kpi-new-courses"
                label={t('admin.analytics.content.kpiNewCourses')}
                display={formatCount(contentKpis.new_courses.value)}
                delta={contentKpis.new_courses.delta_pct}
                noneLabel={t('admin.analytics.financial.deltaNone')}
              />
              <KpiCard
                testId="admin-analytics-kpi-published-courses"
                label={t('admin.analytics.content.kpiPublishedCourses')}
                display={formatCount(contentKpis.published_courses.value)}
                delta={contentKpis.published_courses.delta_pct}
                noneLabel={t('admin.analytics.financial.deltaNone')}
              />
              <KpiCard
                testId="admin-analytics-kpi-total-enrollments"
                label={t('admin.analytics.content.kpiTotalEnrollments')}
                display={formatCount(contentKpis.total_enrollments.value)}
                delta={contentKpis.total_enrollments.delta_pct}
                noneLabel={t('admin.analytics.financial.deltaNone')}
              />
            </div>

            {/* Distribution charts — donut by level + pie by language */}
            <div
              className="grid"
              style={{
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 16,
                marginTop: 24,
              }}
            >
              <div className="card" style={{ padding: 20, borderRadius: 'var(--r-lg)' }}>
                <h3
                  className="text-(--ink-1) mb-3"
                  style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.005em' }}
                >
                  {t('admin.analytics.content.byLevelTitle')}
                </h3>
                <Suspense
                  fallback={
                    <div className="text-(--ink-3) text-sm" style={{ padding: '24px 0' }}>
                      {t('admin.analytics.financial.chartLoading')}
                    </div>
                  }
                >
                  <AnalyticsCharts
                    kind="level-donut"
                    data={byLevel}
                    emptyLabel={t('admin.analytics.content.emptyRange')}
                    levelLabels={{
                      beginner: t('admin.analytics.content.level.beginner'),
                      intermediate: t('admin.analytics.content.level.intermediate'),
                      advanced: t('admin.analytics.content.level.advanced'),
                    }}
                  />
                </Suspense>
              </div>

              <div className="card" style={{ padding: 20, borderRadius: 'var(--r-lg)' }}>
                <h3
                  className="text-(--ink-1) mb-3"
                  style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.005em' }}
                >
                  {t('admin.analytics.content.byLanguageTitle')}
                </h3>
                <Suspense
                  fallback={
                    <div className="text-(--ink-3) text-sm" style={{ padding: '24px 0' }}>
                      {t('admin.analytics.financial.chartLoading')}
                    </div>
                  }
                >
                  <AnalyticsCharts
                    kind="language-pie"
                    data={byLanguage}
                    emptyLabel={t('admin.analytics.content.emptyRange')}
                    languageLabels={{
                      vi: t('admin.analytics.content.language.vi'),
                      en: t('admin.analytics.content.language.en'),
                    }}
                  />
                </Suspense>
              </div>
            </div>

            {/* Completion bar — range-independent (ADR-0009) */}
            <div
              className="card"
              style={{ padding: 20, borderRadius: 'var(--r-lg)', marginTop: 24 }}
            >
              <h3
                className="text-(--ink-1) mb-3"
                style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.005em' }}
              >
                {t('admin.analytics.content.completionTopTitle')}
              </h3>
              <Suspense
                fallback={
                  <div className="text-(--ink-3) text-sm" style={{ padding: '24px 0' }}>
                    {t('admin.analytics.financial.chartLoading')}
                  </div>
                }
              >
                <AnalyticsCharts
                  kind="completion-bar"
                  data={completionTop}
                  emptyLabel={t('admin.analytics.content.emptyRange')}
                />
              </Suspense>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
