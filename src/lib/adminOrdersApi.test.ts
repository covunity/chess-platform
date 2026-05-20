import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  listPendingOrders,
  listAllOrders,
  getPendingOrderCount,
  listStalePendingOrders,
  getStalePendingOrderCount,
  listRefundPendingOrders,
  getRefundPendingOrderCount,
  markOrderRefunded,
} from './adminOrdersApi'

const sampleRow = {
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
}

// ── listPendingOrders ──────────────────────────────────────────────────────

describe('listPendingOrders', () => {
  it('queries orders with status=pending and joins buyer + course', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [sampleRow], count: 1, error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { orders, total, error } = await listPendingOrders(client, { page: 1, pageSize: 20 })

    expect(error).toBeNull()
    expect(total).toBe(1)
    expect(orders).toHaveLength(1)
    expect(orders[0].id).toBe('ord-1')
    expect(orders[0].buyer?.name).toBe('Alice')
    expect(orders[0].course?.title).toBe('Chess Basics')

    expect(client.from).toHaveBeenCalledWith('orders')
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(chain.range).toHaveBeenCalledWith(0, 19)
  })

  it('paginates correctly for page 2 / pageSize 20', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], count: 25, error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    await listPendingOrders(client, { page: 2, pageSize: 20 })
    expect(chain.range).toHaveBeenCalledWith(20, 39)
  })

  it('returns empty + error when query fails', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: null, count: null, error: { message: 'rls' } }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { orders, total, error } = await listPendingOrders(client)
    expect(orders).toEqual([])
    expect(total).toBe(0)
    expect(error).toBeTruthy()
  })
})

// ── listAllOrders ──────────────────────────────────────────────────────────

describe('listAllOrders', () => {
  function makeChain(data: unknown[] = [], total = 0, error: unknown = null) {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data, count: total, error }),
    }
  }

  it('returns all rows by default (no status filter, no search)', async () => {
    const chain = makeChain([sampleRow], 1)
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { orders, total, error } = await listAllOrders(client, { page: 1, pageSize: 20 })
    expect(error).toBeNull()
    expect(total).toBe(1)
    expect(orders).toHaveLength(1)
    expect(chain.eq).not.toHaveBeenCalled()
    expect(chain.or).not.toHaveBeenCalled()
  })

  it('applies status filter when provided', async () => {
    const chain = makeChain([sampleRow], 1)
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    await listAllOrders(client, { status: 'active', page: 1, pageSize: 20 })
    expect(chain.eq).toHaveBeenCalledWith('status', 'active')
  })

  it('applies search across code and buyer email', async () => {
    const chain = makeChain([sampleRow], 1)
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    await listAllOrders(client, { search: 'alice', page: 1, pageSize: 20 })
    expect(chain.or).toHaveBeenCalledWith(
      expect.stringContaining('code.ilike.%alice%')
    )
    expect(chain.or).toHaveBeenCalledWith(
      expect.stringContaining('buyer.email.ilike.%alice%')
    )
  })

  it('combines status filter + search', async () => {
    const chain = makeChain([sampleRow], 1)
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    await listAllOrders(client, { status: 'pending', search: 'ORD-2026', page: 1, pageSize: 20 })
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending')
    expect(chain.or).toHaveBeenCalled()
  })
})

// ── getPendingOrderCount ───────────────────────────────────────────────────

describe('getPendingOrderCount', () => {
  it('returns count of pending orders via head=true select', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ count: 5, error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { count, error } = await getPendingOrderCount(client)
    expect(error).toBeNull()
    expect(count).toBe(5)
    expect(chain.select).toHaveBeenCalledWith('*', { count: 'exact', head: true })
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending')
  })

  it('returns 0 + error on failure', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ count: null, error: { message: 'rls' } }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { count, error } = await getPendingOrderCount(client)
    expect(count).toBe(0)
    expect(error).toBeTruthy()
  })
})

// ── listStalePendingOrders (Cần can thiệp) ─────────────────────────────────

describe('listStalePendingOrders', () => {
  it('queries pending orders older than 1 hour, newest first', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [sampleRow], count: 1, error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { orders, total, error } = await listStalePendingOrders(client, { page: 1, pageSize: 20 })

    expect(error).toBeNull()
    expect(total).toBe(1)
    expect(orders).toHaveLength(1)
    expect(orders[0].id).toBe('ord-1')

    expect(client.from).toHaveBeenCalledWith('orders')
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending')
    // The cutoff is `now - 1h` — assert the column and that some ISO string was passed
    expect(chain.lt).toHaveBeenCalledWith('created_at', expect.any(String))
    const cutoff = (chain.lt.mock.calls[0][1]) as string
    const cutoffMs = new Date(cutoff).getTime()
    const expected = Date.now() - 60 * 60 * 1000
    // Within 5s to allow for clock drift in tests
    expect(Math.abs(cutoffMs - expected)).toBeLessThan(5_000)

    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(chain.range).toHaveBeenCalledWith(0, 19)
  })

  it('paginates correctly for page 2 / pageSize 20', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], count: 25, error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    await listStalePendingOrders(client, { page: 2, pageSize: 20 })
    expect(chain.range).toHaveBeenCalledWith(20, 39)
  })

  it('returns empty + error when query fails', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: null, count: null, error: { message: 'rls' } }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { orders, total, error } = await listStalePendingOrders(client)
    expect(orders).toEqual([])
    expect(total).toBe(0)
    expect(error).toBeTruthy()
  })
})

// ── getStalePendingOrderCount ──────────────────────────────────────────────

describe('getStalePendingOrderCount', () => {
  it('returns count of pending orders older than 1h via head=true select', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockResolvedValue({ count: 3, error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { count, error } = await getStalePendingOrderCount(client)
    expect(error).toBeNull()
    expect(count).toBe(3)
    expect(chain.select).toHaveBeenCalledWith('*', { count: 'exact', head: true })
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending')
    expect(chain.lt).toHaveBeenCalledWith('created_at', expect.any(String))
  })

  it('returns 0 + error on failure', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockResolvedValue({ count: null, error: { message: 'rls' } }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { count, error } = await getStalePendingOrderCount(client)
    expect(count).toBe(0)
    expect(error).toBeTruthy()
  })
})

// ── listRefundPendingOrders (Cần refund) ───────────────────────────────────
// Slice 5 of PRD-0005. Lists status='refund_pending' orders so admin can
// transfer funds back manually and mark them as refunded.

describe('listRefundPendingOrders', () => {
  const refundRow = {
    ...sampleRow,
    id: 'ord-rp',
    status: 'refund_pending',
    code: 'ORD-2026-000777',
    refund_due_to: {
      payer_account: '0123456789',
      payer_name: 'NGUYEN VAN A',
      payer_bank: 'Vietcombank',
      amount: '480000',
      paid_at: '2026-05-18T10:00:00Z',
    },
  }

  it('queries orders with status=refund_pending and joins buyer + course', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [refundRow], count: 1, error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { orders, total, error } = await listRefundPendingOrders(client, { page: 1, pageSize: 20 })

    expect(error).toBeNull()
    expect(total).toBe(1)
    expect(orders).toHaveLength(1)
    expect(orders[0].id).toBe('ord-rp')
    expect(orders[0].refund_due_to?.payer_account).toBe('0123456789')

    expect(client.from).toHaveBeenCalledWith('orders')
    expect(chain.eq).toHaveBeenCalledWith('status', 'refund_pending')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(chain.range).toHaveBeenCalledWith(0, 19)
    // refund_due_to JSONB must be in the projection so the UI can render
    // the payer bank info without a second fetch.
    const selectCall = chain.select.mock.calls[0][0] as string
    expect(selectCall).toContain('refund_due_to')
  })

  it('paginates correctly for page 2 / pageSize 20', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], count: 25, error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    await listRefundPendingOrders(client, { page: 2, pageSize: 20 })
    expect(chain.range).toHaveBeenCalledWith(20, 39)
  })

  it('returns empty + error when query fails', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: null, count: null, error: { message: 'rls' } }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { orders, total, error } = await listRefundPendingOrders(client)
    expect(orders).toEqual([])
    expect(total).toBe(0)
    expect(error).toBeTruthy()
  })
})

// ── getRefundPendingOrderCount ────────────────────────────────────────────

describe('getRefundPendingOrderCount', () => {
  it('returns count of refund_pending orders via head=true select', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ count: 4, error: null }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { count, error } = await getRefundPendingOrderCount(client)
    expect(error).toBeNull()
    expect(count).toBe(4)
    expect(chain.select).toHaveBeenCalledWith('*', { count: 'exact', head: true })
    expect(chain.eq).toHaveBeenCalledWith('status', 'refund_pending')
  })

  it('returns 0 + error on failure', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ count: null, error: { message: 'rls' } }),
    }
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient

    const { count, error } = await getRefundPendingOrderCount(client)
    expect(count).toBe(0)
    expect(error).toBeTruthy()
  })
})

// ── markOrderRefunded ─────────────────────────────────────────────────────
// Calls RPC `mark_order_refunded(p_order_id, p_refund_reference)`.

describe('markOrderRefunded', () => {
  it('calls mark_order_refunded RPC with the correct args', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { id: 'ord-rp', status: 'refunded', refund_reference: 'TF260519123456' },
      error: null,
    })
    const client = { rpc } as unknown as SupabaseClient

    const { order, error } = await markOrderRefunded(client, 'ord-rp', 'TF260519123456')

    expect(error).toBeNull()
    expect(order?.status).toBe('refunded')
    expect(rpc).toHaveBeenCalledWith('mark_order_refunded', {
      p_order_id: 'ord-rp',
      p_refund_reference: 'TF260519123456',
    })
  })

  it('returns null order + error on RPC failure', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'order not in refund_pending status' },
    })
    const client = { rpc } as unknown as SupabaseClient

    const { order, error } = await markOrderRefunded(client, 'ord-rp', 'TF26')
    expect(order).toBeNull()
    expect(error).toBeTruthy()
  })
})
