import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  listPendingOrders,
  listAllOrders,
  getPendingOrderCount,
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
