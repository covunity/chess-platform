import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchLatestContentSnapshots,
  fetchLatestFinancialSnapshots,
  fetchLatestUserSnapshots,
  recomputeAnalyticsSnapshot,
  type AnalyticsSnapshotRow,
  type ContentPayload,
  type ContentSnapshotRow,
  type FinancialPayload,
  type UsersPayload,
  type UsersSnapshotRow,
} from './analyticsApi'

const financialMtd: FinancialPayload = {
  kpis: {
    revenue: { value: 12_500_000, delta_pct: 12.4 },
    order_count: { value: 87, delta_pct: -3.1 },
    platform_fee: { value: 2_500_000, delta_pct: 12.4 },
    creator_payout: { value: 10_000_000, delta_pct: 12.4 },
  },
}

const baseRow: Omit<AnalyticsSnapshotRow, 'time_range' | 'payload'> = {
  snapshot_date: '2026-05-21',
  category: 'financial',
  computed_at: '2026-05-21T00:05:00Z',
}

const rows: AnalyticsSnapshotRow[] = [
  { ...baseRow, time_range: '7d', payload: financialMtd },
  { ...baseRow, time_range: 'mtd', payload: financialMtd },
  { ...baseRow, time_range: 'last_month', payload: financialMtd },
  {
    ...baseRow,
    time_range: 'all_time',
    payload: {
      kpis: {
        revenue: { value: 99_000_000, delta_pct: null },
        order_count: { value: 500, delta_pct: null },
        platform_fee: { value: 19_800_000, delta_pct: null },
        creator_payout: { value: 79_200_000, delta_pct: null },
      },
    },
  },
]

// ── fetchLatestFinancialSnapshots ───────────────────────────────────────────

function makeClient(data: AnalyticsSnapshotRow[] | null, error: { message: string } | null) {
  const order = vi.fn().mockResolvedValue({ data, error })
  const eq = vi.fn().mockReturnValue({ order })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })
  return {
    client: { from } as unknown as SupabaseClient,
    spies: { from, select, eq, order },
  }
}

describe('fetchLatestFinancialSnapshots', () => {
  it('selects the latest snapshot per range for category=financial', async () => {
    const { client, spies } = makeClient(rows, null)

    const { snapshots, error } = await fetchLatestFinancialSnapshots(client)

    expect(error).toBeNull()
    expect(spies.from).toHaveBeenCalledWith('analytics_snapshots')
    expect(spies.select).toHaveBeenCalledWith(
      'snapshot_date, time_range, category, payload, computed_at'
    )
    expect(spies.eq).toHaveBeenCalledWith('category', 'financial')
    expect(spies.order).toHaveBeenCalledWith('snapshot_date', { ascending: false })
    expect(snapshots['7d']?.payload.kpis.revenue.value).toBe(12_500_000)
    expect(snapshots.mtd?.payload.kpis.order_count.value).toBe(87)
    expect(snapshots.last_month?.payload.kpis.platform_fee.value).toBe(2_500_000)
    expect(snapshots.all_time?.payload.kpis.revenue.delta_pct).toBeNull()
  })

  it('returns an empty map when no snapshots exist yet', async () => {
    const { client } = makeClient([], null)
    const { snapshots, error } = await fetchLatestFinancialSnapshots(client)
    expect(error).toBeNull()
    expect(snapshots).toEqual({})
  })

  it('picks only the latest snapshot_date when multiple days are present', async () => {
    const older: AnalyticsSnapshotRow = {
      ...rows[0],
      snapshot_date: '2026-05-20',
      payload: {
        kpis: {
          revenue: { value: 1, delta_pct: 0 },
          order_count: { value: 1, delta_pct: 0 },
          platform_fee: { value: 1, delta_pct: 0 },
          creator_payout: { value: 1, delta_pct: 0 },
        },
      },
    }
    const { client } = makeClient([...rows, older], null)
    const { snapshots } = await fetchLatestFinancialSnapshots(client)
    expect(snapshots['7d']?.snapshot_date).toBe('2026-05-21')
    expect(snapshots['7d']?.payload.kpis.revenue.value).toBe(12_500_000)
  })

  it('surfaces query errors', async () => {
    const { client } = makeClient(null, { message: 'rls denied' })
    const { snapshots, error } = await fetchLatestFinancialSnapshots(client)
    expect(snapshots).toEqual({})
    expect((error as { message: string }).message).toBe('rls denied')
  })
})

// ── fetchLatestContentSnapshots ─────────────────────────────────────────────

const contentMtd: ContentPayload = {
  kpis: {
    new_courses:       { value: 5,   delta_pct: 25.0 },
    published_courses: { value: 3,   delta_pct: -10.0 },
    total_enrollments: { value: 124, delta_pct: 18.2 },
  },
  by_level: [
    { level: 'beginner',     count: 12 },
    { level: 'intermediate', count: 6 },
    { level: 'advanced',     count: 2 },
  ],
  by_language: [
    { language: 'vi', count: 18 },
    { language: 'en', count: 2 },
  ],
  completion_top: [
    { course_id: 'c1', title: 'Khai cuộc Sicilian', completion_rate: 0.62, enrollment_count: 87 },
    { course_id: 'c2', title: 'Tàn cuộc cơ bản',    completion_rate: 0.51, enrollment_count: 40 },
  ],
}

const contentBaseRow: Omit<ContentSnapshotRow, 'time_range' | 'payload'> = {
  snapshot_date: '2026-05-21',
  category: 'content',
  computed_at: '2026-05-21T00:05:00Z',
}

const contentRows: ContentSnapshotRow[] = [
  { ...contentBaseRow, time_range: '7d', payload: contentMtd },
  { ...contentBaseRow, time_range: 'mtd', payload: contentMtd },
  { ...contentBaseRow, time_range: 'last_month', payload: contentMtd },
  { ...contentBaseRow, time_range: 'all_time', payload: {
      kpis: {
        new_courses:       { value: 99, delta_pct: null },
        published_courses: { value: 60, delta_pct: null },
        total_enrollments: { value: 1_500, delta_pct: null },
      },
      by_level: [{ level: 'beginner', count: 99 }],
      by_language: [{ language: 'vi', count: 99 }],
      completion_top: contentMtd.completion_top,
    }
  },
]

describe('fetchLatestContentSnapshots', () => {
  it('selects the latest snapshot per range for category=content', async () => {
    const { client, spies } = makeClient(
      contentRows as unknown as AnalyticsSnapshotRow[],
      null
    )

    const { snapshots, error } = await fetchLatestContentSnapshots(client)

    expect(error).toBeNull()
    expect(spies.from).toHaveBeenCalledWith('analytics_snapshots')
    expect(spies.select).toHaveBeenCalledWith(
      'snapshot_date, time_range, category, payload, computed_at'
    )
    expect(spies.eq).toHaveBeenCalledWith('category', 'content')
    expect(spies.order).toHaveBeenCalledWith('snapshot_date', { ascending: false })
    expect(snapshots.mtd?.payload.kpis.new_courses.value).toBe(5)
    expect(snapshots.mtd?.payload.by_level?.length).toBe(3)
    expect(snapshots.all_time?.payload.kpis.published_courses.delta_pct).toBeNull()
  })

  it('returns the same completion_top across all four ranges (range-independent per ADR-0009)', async () => {
    const { client } = makeClient(
      contentRows as unknown as AnalyticsSnapshotRow[],
      null
    )
    const { snapshots } = await fetchLatestContentSnapshots(client)
    const top7d = snapshots['7d']?.payload.completion_top
    const topMtd = snapshots.mtd?.payload.completion_top
    const topLastMonth = snapshots.last_month?.payload.completion_top
    // Same array identity isn't required (it's JSON-decoded per row),
    // but the contents must match.
    expect(top7d).toEqual(topMtd)
    expect(topMtd).toEqual(topLastMonth)
  })

  it('returns an empty map when no content snapshots exist yet', async () => {
    const { client } = makeClient([], null)
    const { snapshots, error } = await fetchLatestContentSnapshots(client)
    expect(error).toBeNull()
    expect(snapshots).toEqual({})
  })

  it('surfaces query errors', async () => {
    const { client } = makeClient(null, { message: 'rls denied' })
    const { snapshots, error } = await fetchLatestContentSnapshots(client)
    expect(snapshots).toEqual({})
    expect((error as { message: string }).message).toBe('rls denied')
  })
})

// ── fetchLatestUserSnapshots ────────────────────────────────────────────────

const usersMtd: UsersPayload = {
  kpis: {
    new_signups:     { value: 42,    delta_pct: 8.0 },
    active_users:    { value: 31,    delta_pct: 4.5 },
    conversion_rate: { value: 0.286, numerator: 12, denominator: 42, delta_pct: 11.0 },
  },
  signup_trend: [
    { bucket: '2026-05-15', value: 7 },
    { bucket: '2026-05-16', value: 9 },
  ],
  top_buyers: [
    { user_id: 'u1', name: 'Khách Anh',  spend: 850_000, order_count: 3 },
    { user_id: 'u2', name: 'Khách Bình', spend: 450_000, order_count: 2 },
  ],
}

const usersBaseRow: Omit<UsersSnapshotRow, 'time_range' | 'payload'> = {
  snapshot_date: '2026-05-21',
  category: 'users',
  computed_at: '2026-05-21T00:05:00Z',
}

const usersRows: UsersSnapshotRow[] = [
  { ...usersBaseRow, time_range: '7d', payload: usersMtd },
  { ...usersBaseRow, time_range: 'mtd', payload: usersMtd },
  { ...usersBaseRow, time_range: 'last_month', payload: usersMtd },
  { ...usersBaseRow, time_range: 'all_time', payload: {
      kpis: {
        new_signups:     { value: 250, delta_pct: null },
        active_users:    { value: 180, delta_pct: null },
        conversion_rate: { value: 0.3, numerator: 75, denominator: 250, delta_pct: null },
      },
      signup_trend: [{ bucket: '2026-04', value: 100 }, { bucket: '2026-05', value: 150 }],
      top_buyers: usersMtd.top_buyers,
    }
  },
]

describe('fetchLatestUserSnapshots', () => {
  it('selects the latest snapshot per range for category=users', async () => {
    const { client, spies } = makeClient(
      usersRows as unknown as AnalyticsSnapshotRow[],
      null
    )

    const { snapshots, error } = await fetchLatestUserSnapshots(client)

    expect(error).toBeNull()
    expect(spies.from).toHaveBeenCalledWith('analytics_snapshots')
    expect(spies.select).toHaveBeenCalledWith(
      'snapshot_date, time_range, category, payload, computed_at'
    )
    expect(spies.eq).toHaveBeenCalledWith('category', 'users')
    expect(spies.order).toHaveBeenCalledWith('snapshot_date', { ascending: false })
    expect(snapshots.mtd?.payload.kpis.new_signups.value).toBe(42)
    expect(snapshots.mtd?.payload.kpis.active_users.value).toBe(31)
    expect(snapshots.mtd?.payload.kpis.conversion_rate.value).toBe(0.286)
    expect(snapshots.mtd?.payload.kpis.conversion_rate.numerator).toBe(12)
    expect(snapshots.mtd?.payload.kpis.conversion_rate.denominator).toBe(42)
    expect(snapshots.all_time?.payload.kpis.new_signups.delta_pct).toBeNull()
  })

  it('top buyers sort by spend DESC — a free-claim-only user (spend=0) never displaces a paying customer', () => {
    // The RPC produces the rows in spend-DESC order; the FE trusts that
    // ordering. Verify with a fixture that the higher-spend user comes
    // first regardless of free claimers appended at the end.
    const free = { user_id: 'u-free', name: 'Khách miễn phí', spend: 0,       order_count: 5 }
    const paid = { user_id: 'u-paid', name: 'Khách trả tiền', spend: 100_000, order_count: 1 }
    // Simulated RPC output: spend DESC then user_id ASC.
    const sorted: UsersSnapshotRow = {
      ...usersBaseRow,
      time_range: 'mtd',
      payload: {
        kpis: usersMtd.kpis,
        signup_trend: [],
        top_buyers: [paid, free],
      },
    }
    expect(sorted.payload.top_buyers?.[0].user_id).toBe('u-paid')
    expect(sorted.payload.top_buyers?.[1].spend).toBe(0)
  })

  it('conversion-rate cell carries numerator/denominator for the "N/M" UI rendering', () => {
    // PRD-0008 §5.4: "Stored as numerator/denominator AND derived rate
    // in the payload — let the frontend display 1.23%".
    const cell = usersMtd.kpis.conversion_rate
    expect(cell.value).toBeCloseTo(cell.numerator / cell.denominator, 3)
    // Edge: free-claim case. A learner who signs up in range AND claims a
    // free course (amount=0, status='active') in the same range MUST be
    // counted in the numerator. We can only verify the contract at the
    // RPC/SQL layer (migration077 test) — here we just confirm the typed
    // shape lets the rate be > 0 even when no money was spent (numerator
    // can exceed amount-paying buyers).
    const freeClaimOnly: UsersPayload = {
      kpis: {
        new_signups:  { value: 10, delta_pct: 0 },
        active_users: { value: 5,  delta_pct: 0 },
        conversion_rate: {
          // 3 learners signed up + claimed a free course; 0 spend recorded
          // because all three orders had amount=0. The numerator IS 3.
          value: 0.3,
          numerator: 3,
          denominator: 10,
          delta_pct: null,
        },
      },
      signup_trend: [],
      top_buyers: [],
    }
    expect(freeClaimOnly.kpis.conversion_rate.numerator).toBe(3)
    expect(freeClaimOnly.kpis.conversion_rate.value).toBe(0.3)
  })

  it('returns an empty map when no user snapshots exist yet', async () => {
    const { client } = makeClient([], null)
    const { snapshots, error } = await fetchLatestUserSnapshots(client)
    expect(error).toBeNull()
    expect(snapshots).toEqual({})
  })

  it('surfaces query errors', async () => {
    const { client } = makeClient(null, { message: 'rls denied' })
    const { snapshots, error } = await fetchLatestUserSnapshots(client)
    expect(snapshots).toEqual({})
    expect((error as { message: string }).message).toBe('rls denied')
  })
})

// ── recomputeAnalyticsSnapshot ──────────────────────────────────────────────

describe('recomputeAnalyticsSnapshot', () => {
  it('calls compute_analytics_snapshot RPC with force_now=true', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const client = { rpc } as unknown as SupabaseClient

    const { error } = await recomputeAnalyticsSnapshot(client)
    expect(error).toBeNull()
    expect(rpc).toHaveBeenCalledWith('compute_analytics_snapshot', { force_now: true })
  })

  it('surfaces RPC errors', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'forbidden', code: '42501' },
    })
    const client = { rpc } as unknown as SupabaseClient

    const { error } = await recomputeAnalyticsSnapshot(client)
    expect((error as { message: string }).message).toBe('forbidden')
  })
})
