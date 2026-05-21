import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchLatestFinancialSnapshots,
  recomputeAnalyticsSnapshot,
  type AnalyticsSnapshotRow,
  type FinancialPayload,
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
